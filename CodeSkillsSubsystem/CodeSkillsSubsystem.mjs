import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { BaseSkillsSubsystem } from '../SkillsSubsystems/BaseSkillsSubsystem.mjs';

const CODE_ARGUMENT_NAME = 'input';
const DEFAULT_CODE_ARGUMENT_DESCRIPTION = 'Primary natural-language instruction or text payload.';
const DECISION_TIMEOUT_MS = 5000;
const EXECUTION_TIMEOUT_MS = 60000;

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

function createDefaultAction({ skillName, prompt = '', llmAgent }) {
    return async ({ input }, { contextManager = null } = {}) => {
        if (typeof input !== 'string' || !input.trim()) {
            throw new Error(`Code skill "${skillName}" requires the "${CODE_ARGUMENT_NAME}" argument.`);
        }

        if (!llmAgent || typeof llmAgent.complete !== 'function') {
            throw new Error(`Code skill "${skillName}" requires an LLMAgent with a "complete" method.`);
        }

        const instructions = prompt ? prompt.trim() : 'Decide whether to respond directly or craft JavaScript to solve the task.';
        const decisionPrompt = [
            '# Code Skill Decision',
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

        const rawDecision = await Promise.race([
            llmAgent.complete({
                prompt: decisionPrompt,
                mode: 'fast',
                context: { intent: 'code-skill-default', skillName },
            }),
            new Promise((resolve) => setTimeout(() => resolve(JSON.stringify({ mode: 'text', text: '[timeout]' })), DECISION_TIMEOUT_MS)),
        ]);

        let decision;
        try {
            decision = typeof rawDecision === 'string' ? JSON.parse(rawDecision) : rawDecision;
        } catch (error) {
            throw new Error(`Code skill "${skillName}" expected JSON decision. Received: ${rawDecision}`);
        }

        if (!decision || typeof decision !== 'object' || typeof decision.mode !== 'string') {
            throw new Error(`Code skill "${skillName}" requires a decision object with a "mode" property.`);
        }

        const mode = decision.mode.toLowerCase();
        let outcome = '';

        if (mode === 'text') {
            if (typeof decision.text !== 'string' || !decision.text.trim()) {
                throw new Error(`Code skill "${skillName}" received text mode without a valid "text" response.`);
            }
            outcome = decision.text.trim();
        } else if (mode === 'code') {
            if (typeof decision.code !== 'string' || !decision.code.trim()) {
                throw new Error(`Code skill "${skillName}" received code mode without executable "code".`);
            }
            const wrapped = `(async () => { ${decision.code} })()`;
            try {
                const execution = Promise.resolve(eval(wrapped)); // eslint-disable-line no-eval
                const result = await Promise.race([
                    execution,
                    new Promise((resolve, reject) => setTimeout(() => reject(new Error('execution timed out.')), EXECUTION_TIMEOUT_MS)),
                ]);
                if (typeof result === 'string') {
                    outcome = result;
                } else if (result === null || result === undefined) {
                    outcome = '';
                } else {
                    outcome = JSON.stringify(result);
                }
            } catch (error) {
                throw new Error(`Code skill "${skillName}" execution failed: ${error.message}`);
            }
        } else {
            throw new Error(`Code skill "${skillName}" received unsupported mode "${decision.mode}".`);
        }

        if (contextManager && typeof contextManager.appendToHistory === 'function') {
            try {
                contextManager.appendToHistory({ user: input, ai: outcome });
            } catch (error) {
                // Ignore context persistence issues
            }
        }

        return outcome;
    };
}

function createModuleAction({ skillName, modulePath, prompt = '', llmAgent }) {
    let cached = null;
    return async ({ input }, { contextManager = null } = {}) => {
        if (typeof input !== 'string' || !input.trim()) {
            throw new Error(`Code skill "${skillName}" requires the "${CODE_ARGUMENT_NAME}" argument.`);
        }
        if (!cached) {
            const moduleUrl = pathToFileURL(modulePath);
            const imported = await import(moduleUrl.href);
            cached = typeof imported.action === 'function'
                ? imported.action
                : (typeof imported.default === 'function' ? imported.default : null);
            if (typeof cached !== 'function') {
                throw new Error(`Code skill module at ${modulePath} does not export an action function.`);
            }
        }
        return cached(input, {
            llmAgent,
            prompt,
            skillName,
            argumentName: CODE_ARGUMENT_NAME,
            contextManager,
        });
    };
}

export class CodeSkillsSubsystem extends BaseSkillsSubsystem {
    registerSkillDescriptor({ skillName, summary, filePath, skillDir, sections, body, title }) {
        const llmAgent = this.skilledAgent.llmAgent;
        const prompt = extractSectionContent(sections, 'prompt');
        const argumentDescription = extractSectionContent(sections, 'argument', 'input', 'parameters') || DEFAULT_CODE_ARGUMENT_DESCRIPTION;
        const folderName = skillDir ? path.basename(skillDir) : null;
        const localModulePath = folderName ? path.join(skillDir, `${folderName}.js`) : null;
        const moduleExists = localModulePath ? fs.existsSync(localModulePath) : false;

        const specs = {
            name: skillName,
            description: summary,
            what: summary,
            why: `Automatically registered code skill originating from ${filePath}.`,
            arguments: {
                [CODE_ARGUMENT_NAME]: {
                    description: argumentDescription,
                    type: 'string',
                },
            },
            requiredArguments: [CODE_ARGUMENT_NAME],
            argumentOrder: [CODE_ARGUMENT_NAME],
            needConfirmation: false,
        };

        const action = moduleExists
            ? createModuleAction({ skillName, modulePath: localModulePath, prompt, llmAgent })
            : createDefaultAction({ skillName, prompt, llmAgent });

        const roles = ['code'];
        const registeredName = this.skilledAgent.registerSkill({ specs, action, roles });
        const canonicalName = registeredName || skillName;

        this.recordMetadata(canonicalName, {
            type: 'code',
            prompt,
            modulePath: moduleExists ? localModulePath : null,
            filePath,
            skillDir,
            title,
            summary,
            body,
            sections,
            defaultArgument: CODE_ARGUMENT_NAME,
        });

        return canonicalName;
    }
}
