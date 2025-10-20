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

function buildArgumentLine(context, name) {
    const definition = context.argumentDefinitions.find(def => def.name === name) || null;
    const description = definition?.description ? `— ${definition.description}` : '';
    const aliases = typeof context.getAliases === 'function' ? context.getAliases(name) : [];
    const aliasText = aliases.length ? `(aliases: ${aliases.join(', ')})` : '';
    const samples = typeof context.getOptionSamples === 'function'
        ? context.getOptionSamples(name, 10)
        : [];
    const examples = samples.length ? `(examples: ${samples.join(', ')}${samples.length >= 10 ? ', ...' : ''})` : '';
    return [`- ${name}`, aliasText, description, examples].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function buildArgumentSection(context, includeOptional = false) {
    const lines = [];
    const missingRequired = context.missingRequired();
    const optionalMissing = includeOptional ? context.missingOptional() : [];

    if (missingRequired.length) {
        lines.push('Missing required arguments:');
        for (const name of missingRequired) {
            lines.push(buildArgumentLine(context, name));
        }
    }

    if (optionalMissing.length) {
        lines.push('Optional arguments you may include:');
        for (const name of optionalMissing) {
            lines.push(buildArgumentLine(context, name));
        }
    }

    return lines.join('\n');
}

function buildAliasHints(context) {
    if (typeof context.getAliases !== 'function') {
        return '';
    }
    const lines = [];
    for (const definition of context.argumentDefinitions || []) {
        const aliases = context.getAliases(definition.name);
        if (!aliases.length) {
            continue;
        }
        lines.push(`- ${definition.name}: also referred to as ${aliases.join(', ')}`);
    }
    return lines.join('\n');
}

async function extractArgumentsWithLLM(context, userMessage, { taskDescription = '' } = {}) {
    const llm = context.llmAgent;
    if (!llm) {
        return {};
    }

    const skillName = context.skill?.name || 'unknown';
    const skillDescription = context.skill?.humanDescription || context.skill?.description || '';
    const argumentSection = buildArgumentSection(context, true);
    const existingValues = JSON.stringify(context.normalizedArgs, null, 2);
    const aliasHints = buildAliasHints(context);

    const prompt = [
        '# Extract Argument Values',
        '## Skill Context',
        `Skill: ${skillName}`,
        skillDescription ? `Description: ${skillDescription}` : null,
        taskDescription ? `Original request: ${taskDescription}` : null,
        '## Current Arguments',
        `Current arguments: ${existingValues}`,
        argumentSection ? `## Needed Details\n${argumentSection}` : null,
        aliasHints ? `## Argument Synonyms\n${aliasHints}` : null,
        '## Argument Guidance',
        '- `job_name`: the title of the job or project (e.g., "job name is Alpha Build", "call it Maintenance Update").',
        '- `client_name`: the customer or organization the job is for. Capture phrases like "for Smith Construction", "client is ACME Corp", or "customer: Apex Homes".',
        '- `status`: optional lifecycle state such as Pending, Active, or Completed.',
        '## Critical Instructions',
        '- Extract ONLY the values explicitly stated by the user.',
        '- Use bullet list entries in the format `- argument_name: value`.',
        '- Ensure argument names use snake_case.',
        '- Do NOT invent, guess, or use placeholder values like "your_job_name" or "not_provided".',
        '- If a value is not explicitly mentioned by the user, do NOT include it in the response.',
        '- If no changes are needed, reply with `- result: none`.',
        '- Keep values concise and relevant.',
        '- When the user references an argument via a synonym or alias, map it to the canonical argument name.',
        '',
        '## Example (Good):',
        'User says: "job name is programmer"',
        'Correct response: `- job_name: programmer`',
        '',
        '## Example (Bad):',
        'User says: "job name is programmer"',
        'Wrong response: `- job_name: your_job_name` ❌ (This is a placeholder, not the actual value)',
        '',
        'User says: "create a job for Smith Construction"',
        'Correct response:',
        '- client_name: Smith Construction',
    ].filter(Boolean).join('\n\n');

    if (process.env.LLMAgentClient_DEBUG === 'true') {
        console.log('[DEBUG] argument-extraction prompt:\n', prompt);
    }

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

    if (process.env.LLMAgentClient_DEBUG === 'true') {
        console.log('[DEBUG] argument-extraction response:\n', raw);
    }

    const keyValues = llm.parseMarkdownKeyValues(raw);
    const updates = {};

    for (const [key, value] of Object.entries(keyValues)) {
        if (!value) {
            continue;
        }
        if (key === 'result' && value.toLowerCase() === 'none') {
            continue;
        }
        let targetName = typeof context.resolveArgumentKey === 'function'
            ? context.resolveArgumentKey(key)
            : null;
        if (!targetName) {
            const match = context.argumentDefinitions.find(def => def.name.toLowerCase() === key.toLowerCase());
            targetName = match ? match.name : null;
        }
        if (!targetName) {
            continue;
        }
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
