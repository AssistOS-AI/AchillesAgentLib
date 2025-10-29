export async function action(instruction, context = {}) {
    if (typeof instruction !== 'string' || !instruction.trim()) {
        throw new Error('mathEval skill requires a non-empty instruction string.');
    }

    const { llmAgent, prompt = '', skillName = 'math-eval-code' } = context;
    if (!llmAgent || typeof llmAgent.complete !== 'function') {
        throw new Error('mathEval skill requires an LLMAgent with a "complete" method.');
    }

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

    const llmResponse = await llmAgent.complete({
        prompt: guidance,
        mode: 'deep',
        context: { intent: 'code-synthesis', skillName },
    });

    let payload;
    try {
        payload = typeof llmResponse === 'string' ? JSON.parse(llmResponse) : llmResponse;
    } catch (error) {
        throw new Error(`mathEval skill expected JSON with code. Received: ${llmResponse}`);
    }

    if (!payload || typeof payload.code !== 'string' || !payload.code.trim()) {
        throw new Error('mathEval skill requires a "code" property with executable JavaScript.');
    }

    const wrapped = `(async () => { ${payload.code} })()`;

    try {
        const result = await eval(wrapped); // eslint-disable-line no-eval
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
        throw new Error(`mathEval execution failed: ${error.message}`);
    }
}
