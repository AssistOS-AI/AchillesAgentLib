const stringify = (value) => {
    if (value === undefined) {
        return 'not provided';
    }
    if (value === null) {
        return 'null value';
    }
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch (error) {
            return String(value);
        }
    }
    return String(value);
};

function buildArgumentSection(context, includeOptional = false) {
    const lines = [];
    const missingRequired = context.missingRequired();
    const optionalMissing = includeOptional ? context.missingOptional() : [];

    if (missingRequired.length) {
        lines.push('Missing required arguments:');
        for (const name of missingRequired) {
            const samples = context.getOptionSamples(name, 10);
            const sampleText = samples.length ? ` (examples: ${samples.join(', ')}${samples.length >= 10 ? ', ...' : ''})` : '';
            lines.push(`- ${name}${sampleText}`);
        }
    }

    if (optionalMissing.length) {
        lines.push('Optional arguments you may include:');
        for (const name of optionalMissing) {
            const samples = context.getOptionSamples(name, 10);
            const sampleText = samples.length ? ` (examples: ${samples.join(', ')}${samples.length >= 10 ? ', ...' : ''})` : '';
            lines.push(`- ${name}${sampleText}`);
        }
    }

    return lines.join('\n');
}

async function extractArgumentsWithLLM(context, userMessage, { taskDescription = '' } = {}) {
    const llm = context.llmAgent;
    if (!llm) {
        return {};
    }

    const argumentSection = buildArgumentSection(context, true);
    const existingValues = JSON.stringify(context.normalizedArgs, null, 2);

    const prompt = [
        '# Extract Argument Values',
        '## Context',
        `Current arguments: ${existingValues}`,
        argumentSection ? `## Required Details\n${argumentSection}` : null,
        '## Critical Instructions',
        '- Extract ONLY the values explicitly stated by the user.',
        '- Use bullet list entries in the format `- argument_name: value`.',
        '- Ensure argument names use snake_case.',
        '- Do NOT invent, guess, or use placeholder values like "your_job_name" or "not_provided".',
        '- If a value is not explicitly mentioned by the user, do NOT include it in the response.',
        '- If no changes are needed, reply with `- result: none`.',
        '- Keep values concise and relevant.',
        '',
        '## Example (Good):',
        'User says: "job name is programmer"',
        'Correct response: `- job_name: programmer`',
        '',
        '## Example (Bad):',
        'User says: "job name is programmer"',
        'Wrong response: `- job_name: your_job_name` ❌ (This is a placeholder, not the actual value)',
    ].filter(Boolean).join('\n\n');

    const history = [];
    if (taskDescription) {
        history.push({ role: 'system', message: `Initial context: ${taskDescription}` });
    }
    history.push({ role: 'user', message: userMessage });

    const raw = await llm.complete({
        prompt,
        history,
        mode: 'fast',
        context: { intent: 'skill-argument-extraction', skillName: context.skill.name },
    });

    const keyValues = llm.parseMarkdownKeyValues(raw);
    const updates = {};

    for (const [key, value] of Object.entries(keyValues)) {
        if (!value) {
            continue;
        }
        if (key === 'result' && value.toLowerCase() === 'none') {
            continue;
        }
        const match = context.argumentDefinitions.find(def => def.name.toLowerCase() === key.toLowerCase());
        const targetName = match ? match.name : key;
        updates[targetName] = value;
    }

    return updates;
}

async function interpretConfirmationWithLLM(context, userMessage) {
    const llm = context.llmAgent;
    if (!llm) {
        return null;
    }

    const result = await llm.interpretMessage(userMessage, { intents: ['accept', 'cancel', 'update'] });
    if (!result) {
        return null;
    }

    if (result.intent === 'update' && result.updates) {
        return { action: 'update', updates: result.updates };
    }

    return { action: result.intent || 'unknown', updates: result.updates || {} };
}

export {
    extractArgumentsWithLLM,
    interpretConfirmationWithLLM,
    stringify,
};
