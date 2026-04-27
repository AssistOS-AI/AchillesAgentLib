import { parseSkillDocument } from '../utils/skillDocumentParser.mjs';

const CODE_ARGUMENT_NAME = 'input';
const DEFAULT_CODE_ARGUMENT_DESCRIPTION = 'Primary natural-language instruction or text payload.';

const parseTimeout = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const SKILL_TIMEOUT_MS = parseTimeout(
    process.env.ACHILLES_SKILL_TIMEOUT
    ?? process.env.ACHILESS_SKILL_TIMEOUT
    ?? process.env.ACHILES_SKILL_TIMEOUT,
    60_000,
);

function extractSectionContent(sections = {}, ...aliases) {
    if (!sections || typeof sections !== 'object') {
        return '';
    }
    for (const alias of aliases) {
        if (!alias) {
            continue;
        }
        const key = alias.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
        if (sections[key]) {
            return sections[key];
        }
    }
    return '';
}

function withTimeout(promiseLike, timeoutMs, errorFactory) {
    let timerHandle;
    const timeoutPromise = new Promise((_, reject) => {
        timerHandle = setTimeout(() => {
            const produced = typeof errorFactory === 'function' ? errorFactory() : errorFactory;
            const error = produced instanceof Error
                ? produced
                : new Error(produced ? String(produced) : 'Operation timed out.');
            reject(error);
        }, timeoutMs);
        if (typeof timerHandle?.unref === 'function') {
            timerHandle.unref();
        }
    });

    const raceTarget = promiseLike instanceof Promise ? promiseLike : Promise.resolve(promiseLike);

    return Promise.race([raceTarget, timeoutPromise]).finally(() => {
        if (timerHandle) {
            clearTimeout(timerHandle);
        }
    });
}

function determineModelSelector(value) {
    const selector = String(value || '').trim();
    return selector || 'code';
}

function unwrapCodeFence(payload) {
    if (typeof payload !== 'string') {
        return payload;
    }
    const trimmed = payload.trim();
    const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
    if (fenceMatch) {
        return fenceMatch[1].trim();
    }
    return trimmed;
}

function createDefaultExecutor({ skillName, prompt = '', llmAgent, llmModel = 'code' }) {
    return async (invocation) => {
        const input = invocation?.input;
        if (typeof input !== 'string' || !input.trim()) {
            throw new Error(`Dynamic code generation skill "${skillName}" requires the "${CODE_ARGUMENT_NAME}" argument.`);
        }

        if (!llmAgent || typeof llmAgent.executePrompt !== 'function') {
            throw new Error(`Dynamic code generation skill "${skillName}" requires an LLMAgent with an "executePrompt" method.`);
        }

        const instructions = prompt ? prompt.trim() : 'Decide whether to respond directly or craft JavaScript to solve the task.';
        const decisionPrompt = [
            '# Dynamic Code Generation Skill Decision',
            instructions,
            '',
            '## Input',
            input,
            '',
            '## Response Format',
            '{',
            '  "mode": "text" | "code",',
            '  "text": "string // required when mode === \\"text\\"",',
            '  "code": "string // required when mode === \\"code\\"; must end with `return <string>;`",',
            '  "explanation": "string // optional"',
            '}',
            '',
            'Choose "code" when JavaScript execution is safer or more precise than a free-form answer.',
        ].join('\n');

        const decision = await withTimeout(
            llmAgent.executePrompt(decisionPrompt, {
                model: llmModel,
                context: { intent: 'dynamic-code-generation-skill-default', skillName },
                responseShape: 'json',
            }),
            SKILL_TIMEOUT_MS,
            () => new Error(`Dynamic code generation skill "${skillName}" decision timed out after ${SKILL_TIMEOUT_MS}ms.`),
        );

        if (!decision || typeof decision !== 'object') {
            throw new Error(`Dynamic code generation skill "${skillName}" expected a JSON object response.`);
        }

        const mode = typeof decision.mode === 'string'
            ? decision.mode.toLowerCase()
            : (decision.code ? 'code' : 'text');

        let outcome = '';

        if (mode === 'text') {
            if (typeof decision.text !== 'string' || !decision.text.trim()) {
                throw new Error(`Dynamic code generation skill "${skillName}" received text mode without a valid "text" response.`);
            }
            outcome = decision.text.trim();
        } else if (mode === 'code') {
            if (typeof decision.code !== 'string' || !decision.code.trim()) {
                throw new Error(`Dynamic code generation skill "${skillName}" received code mode without executable "code".`);
            }
            outcome = await executeCodeSnippet({
                skillName,
                code: decision.code,
            });
        } else {
            throw new Error(`Dynamic code generation skill "${skillName}" received unsupported mode "${decision.mode}".`);
        }

        return outcome;
    };
}

const MAX_SNIPPET_PREVIEW = 160;

async function runSnippet(code, label) {
    const wrapped = `(async () => { ${code} })()`;
    const execution = Promise.resolve(eval(wrapped)); // eslint-disable-line no-eval
    const result = await withTimeout(
        execution,
        SKILL_TIMEOUT_MS,
        () => new Error(`Code execution timed out after ${SKILL_TIMEOUT_MS}ms while running ${label}.`),
    );
    return result;
}

async function executeCodeSnippet({ skillName, code }) {
    const attempt = async (snippet, note) => {
        const preview = snippet.slice(0, MAX_SNIPPET_PREVIEW);
        try {
            return await runSnippet(snippet, note || skillName);
        } catch (error) {
            throw new Error(`Dynamic code generation skill "${skillName}" execution failed: ${error.message}. Snippet: ${preview}…`);
        }
    };

    let result = await attempt(code, skillName);

    if (result === undefined) {
        const fnMatches = Array.from(code.matchAll(/function\s+([a-zA-Z0-9_]+)\s*\(/g));
        if (fnMatches.length) {
            const lastFn = fnMatches[fnMatches.length - 1][1];
            const augmented = `${code}\nreturn typeof ${lastFn} === 'function' ? ${lastFn}() : undefined;`;
            result = await attempt(augmented, `${skillName}:call-${lastFn}`);
        }
    }

    if (result === undefined) {
        throw new Error(`Dynamic code generation skill "${skillName}" execution returned undefined. Ensure the generated code ends with \`return "…"\`.`);
    }

    if (typeof result === 'string') {
        return result;
    }
    if (result === null || result === undefined) {
        return '';
    }
    try {
        return JSON.stringify(result);
    } catch (error) {
        return String(result);
    }
}

export class DynamicCodeGenerationSubsystem {
    constructor({ llmAgent, modelConfig = null }) {
        this.llmAgent = llmAgent;
        this.modelConfig = modelConfig || { plan: 'plan', code: 'code' };
        this.executors = new Map();
    }

    parseSkillDescriptor({ filePath }) {
        return parseSkillDocument(filePath);
    }

    prepareSkill(skillRecord) {
        const { descriptor, skillDir, filePath } = skillRecord;
        const sections = descriptor?.sections || {};
        const prompt = extractSectionContent(sections, 'prompt');
        const argumentDescription = extractSectionContent(sections, 'argument', 'input', 'parameters') || DEFAULT_CODE_ARGUMENT_DESCRIPTION;
        const rawLlmModel = extractSectionContent(sections, 'llm model', 'llm-model', 'model');
        const llmModel = rawLlmModel ? determineModelSelector(rawLlmModel) : (this.modelConfig.code || 'code');

        skillRecord.preparedConfig = {
            type: 'dynamic-code-generation',
            prompt,
            filePath,
            skillDir,
            name: descriptor?.name || null,
            rawContent: descriptor?.rawContent || null,
            sections,
            defaultArgument: CODE_ARGUMENT_NAME,
            argumentDescription,
            llmModel,
        };

        const executor = createDefaultExecutor({
            skillName: skillRecord.name,
            prompt,
            llmAgent: this.llmAgent,
            llmModel,
        });

        this.executors.set(skillRecord.name, executor);
    }

    /**
     * Initialize a skill — async, heavy operations.
     *
     * No initialization needed for dynamic code generation skills.
     *
     * @param {Object} skillRecord - The skill record to initialize
     * @param {MainAgent} mainAgent - The main agent instance
     */
    async initSkill(skillRecord, mainAgent) {
        // No initialization needed for dynamic code generation skills.
    }

    async executeSkillPrompt({ skillRecord, mainAgent, promptText, options = {} }) {
        const executor = this.executors.get(skillRecord.name);
        if (!executor) {
            throw new Error(`Executor not prepared for dynamic code generation skill "${skillRecord.name}".`);
        }

        const {
            args = {},
        } = options;

        const input = typeof args[CODE_ARGUMENT_NAME] === 'string' && args[CODE_ARGUMENT_NAME].trim()
            ? args[CODE_ARGUMENT_NAME]
            : String(promptText ?? '').trim();

        if (!input) {
            throw new Error(`Dynamic code generation skill "${skillRecord.name}" requires either prompt text or the "${CODE_ARGUMENT_NAME}" argument.`);
        }

        const result = await executor({
            llmAgent: this.llmAgent,
            input,
            promptText: String(promptText ?? '').trim(),
            context: options.context || {},
            user: options.context?.user || null,
            attachments: options.context?.attachments || [],
        });

        return {
            skill: skillRecord.name,
            preparedConfig: skillRecord.preparedConfig || null,
            result,
        };
    }
}
