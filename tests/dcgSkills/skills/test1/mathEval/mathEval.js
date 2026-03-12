import { performance } from 'node:perf_hooks';

export async function action(context) {
    const {
        input,
        llmAgent,
        promptText,
        sessionMemory,
        llmMode: contextMode,
        skillName: contextSkillName,
    } = context || {};
    const instruction = input;
    const prompt = promptText || '';
    const skillName = contextSkillName || 'math-expression-evaluator-code';
    const llmMode = contextMode || 'fast';

    if (typeof instruction !== 'string' || !instruction.trim()) {
        throw new Error('mathEval skill requires a non-empty instruction string.');
    }

    if (!llmAgent || typeof llmAgent.executePrompt !== 'function') {
        throw new Error('mathEval skill requires an LLMAgent with an "executePrompt" method.');
    }

    const start = performance.now();
    const log = (stage, details = '') => {
        const elapsed = (performance.now() - start).toFixed(1);
        const suffix = details ? ` | ${details}` : '';
        console.info(`[mathEval.skill] +${elapsed}ms ${stage}${suffix}`);
    };

    const appendMemory = (entry) => {
        if (!sessionMemory || typeof sessionMemory.appendToHistory !== 'function') {
            return;
        }
        try {
            sessionMemory.appendToHistory(entry);
        } catch (_error) {
            // Memory persistence issues must not block execution.
        }
    };

    log('start', `input="${instruction.slice(0, 80)}${instruction.length > 80 ? '…' : ''}"`);
    appendMemory({ user: instruction });

    const guidance = [
        '# Code Synthesis for Math Evaluation',
        prompt || 'Create JavaScript that fulfils the mathematical instruction.',
        '',
        '## Instruction',
        instruction,
        '',
        '## Response Format',
        '- Return a JSON object with keys "code" and "summary".',
        '- "code" must contain JavaScript statements that end with `return "<final string>";`.',
        '- The JavaScript should compute the requested result and embed it in the final string.',
        '- Use only standard JavaScript (no external modules).',
    ].join('\n');

    log('prompt-ready', `promptLength=${guidance.length}`);

    log('llm-call', `mode=${llmMode}`);
    const llmResponse = await llmAgent.executePrompt(guidance, {
        mode: llmMode,
        context: { intent: 'code-synthesis', skillName },
        responseShape: 'json-code',
        sessionMemory,
    });

    log('llm-response', `shape=json-code keys=${Object.keys(llmResponse || {}).join(',')}`);

    const payload = {
        ...llmResponse,
        code: unwrapCodeFence(llmResponse.code),
    };

    if (!payload || typeof payload.code !== 'string' || !payload.code.trim()) {
        throw new Error('mathEval skill requires a "code" property with executable JavaScript.');
    }

    const snippet = payload.code.trim().slice(0, 160);
    log('executing-code', `length=${payload.code.length} preview=${JSON.stringify(snippet)}`);

    try {
        const result = await executeSnippetWithFallback(payload.code, skillName, log);
        log('execution-complete', `type=${typeof result}`);
        if (result !== undefined) {
            const rendered = typeof result === 'string'
                ? result
                : (() => {
                    try {
                        return JSON.stringify(result);
                    } catch (_error) {
                        return String(result);
                    }
                })();
            appendMemory({ ai: rendered });
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
    } catch (error) {
        log('execution-error', `error=${error.message}`);
        throw new Error(`mathEval execution failed: ${error.message}`);
    }
}

function unwrapCodeFence(candidate) {
    if (typeof candidate !== 'string') {
        return candidate;
    }
    const trimmed = candidate.trim();
    const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
    if (fence) {
        return fence[1].trim();
    }
    return trimmed;
}

async function executeSnippetWithFallback(source, skillName, log) {
    const runSnippet = async (code, label) => {
        try {
            return await eval(`(async () => { ${code} })()`); // eslint-disable-line no-eval
        } catch (error) {
            const message = error?.message ? String(error.message) : 'Unknown execution error';
            throw new Error(`Code execution failed in ${label}: ${message}`);
        }
    };

    const attempt = async (code, label) => {
        try {
            return await runSnippet(code, label);
        } catch (error) {
            throw error;
        }
    };

    let result = await attempt(source, skillName);

    if (result === undefined) {
        const lastFn = detectLastFunctionName(source);
        if (lastFn) {
            log('execution-fallback', `invoking ${lastFn}()`);
            const augmented = `${source}\nreturn typeof ${lastFn} === 'function' ? ${lastFn}() : undefined;`;
            result = await attempt(augmented, `${skillName}:${lastFn}`);
        }
    }

    if (result === undefined) {
        throw new Error(`mathEval execution returned undefined. Ensure generated code ends with \`return "…"\`.`);
    }

    return result;
}

function detectLastFunctionName(code) {
    const matches = Array.from(code.matchAll(/function\s+([A-Za-z0-9_]+)\s*\(/g));
    if (!matches.length) {
        return null;
    }
    return matches[matches.length - 1][1];
}
