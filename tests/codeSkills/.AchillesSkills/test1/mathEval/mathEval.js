import { performance } from 'node:perf_hooks';

export async function action(instruction, context = {}) {
    if (typeof instruction !== 'string' || !instruction.trim()) {
        throw new Error('mathEval skill requires a non-empty instruction string.');
    }

    const {
        llmAgent,
        prompt = '',
        skillName = 'math-expression-evaluator-code',
    } = context;
    if (!llmAgent || typeof llmAgent.complete !== 'function') {
        throw new Error('mathEval skill requires an LLMAgent with a "complete" method.');
    }

    const start = performance.now();
    const log = (stage, details = '') => {
        const elapsed = (performance.now() - start).toFixed(1);
        const suffix = details ? ` | ${details}` : '';
        console.info(`[mathEval.skill] +${elapsed}ms ${stage}${suffix}`);
    };

    log('start', `input="${instruction.slice(0, 80)}${instruction.length > 80 ? '…' : ''}"`);

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

    log('llm-call', 'mode=deep');
    const llmResponse = await llmAgent.complete({
        prompt: guidance,
        mode: 'deep',
        context: { intent: 'code-synthesis', skillName },
    });
    log('llm-response', `type=${typeof llmResponse} length=${typeof llmResponse === 'string' ? llmResponse.length : 'n/a'}`);

    let payload;
    try {
        payload = typeof llmResponse === 'string' ? JSON.parse(llmResponse) : llmResponse;
        log('payload-parsed', Array.isArray(payload) ? 'array' : typeof payload);
    } catch (error) {
        log('payload-parse-failed', `error=${error.message}`);
        throw new Error(`mathEval skill expected JSON with code. Received: ${llmResponse}`);
    }

    if (!payload || typeof payload.code !== 'string' || !payload.code.trim()) {
        throw new Error('mathEval skill requires a "code" property with executable JavaScript.');
    }

    const snippet = payload.code.trim().slice(0, 160);
    log('executing-code', `length=${payload.code.length} preview=${JSON.stringify(snippet)}`);

    const wrapped = `(async () => { ${payload.code} })()`;

    try {
        const result = await eval(wrapped); // eslint-disable-line no-eval
        log('execution-complete', `type=${typeof result}`);
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
