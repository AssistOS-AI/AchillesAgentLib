import { FINAL_ANSWER_TOOL, CANNOT_COMPLETE_TOOL } from '../constants.mjs';

const FINAL_RESPONSE_NOTE = [
    `- Finish every plan with EXACTLY ONE line of the form "@lastAnswer ${FINAL_ANSWER_TOOL} <final text>" so the runtime knows the final response.`,
    `- If the task truly cannot be completed, finish with "@lastAnswer ${CANNOT_COMPLETE_TOOL} <reason>".`,
    '- <final text> must be ONLY one value or a single variable reference like "$finalResult", no extra explanation.',
    '- Do not include additional final responses outside of this command.',
    '- Do not prefix the value with phrases like "The result is" unless the user explicitly asked for that wording.',
    '- When an argument is a literal string containing spaces, wrap it in double quotes (e.g., @step tool "foo bar" $var).',
].join('\n');

const buildSOPAgenticInstructions = ({ currentPlan = '', userPrompt = '', systemPrompt = '' }) => {
    const rawPrompt = typeof userPrompt === 'string' ? userPrompt : '';
    const promptText = rawPrompt.trim();
    const existingPlan = typeof currentPlan === 'string' ? currentPlan.trim() : '';
    const systemLines = [];
    if (systemPrompt && typeof systemPrompt === 'string') {
        systemLines.push('System prompt / context:');
        systemLines.push(systemPrompt.trim());
        systemLines.push('');
    }

    if (!existingPlan) {
        return [
            'You are generating a new LightSOPLang plan.',
            ...systemLines,
            '',
            'User requirement:',
            promptText,
            '',
            'Instructions:',
            '- Emit ONLY valid LightSOPLang code.',
            '- Use descriptive variable names and preserve context between steps.',
            '- IMPORTANT: Do NOT use variable interpolation inside strings (e.g., "Result: $var"). Pass variables as separate arguments (e.g., "Result:" $var).',
            FINAL_RESPONSE_NOTE,
        ].join('\n');
    }

    const lines = [];
    lines.push('You are updating an existing LightSOPLang plan.');
    if (systemLines.length) {
        lines.push('');
        lines.push(...systemLines);
    }
    lines.push('');
    lines.push('Current plan:');
    lines.push(existingPlan);
    lines.push('');
    lines.push('New user requirement:');
    lines.push(promptText);
    lines.push('');
    lines.push('Instructions:');
    lines.push('- Extend or adjust the existing plan so that it satisfies BOTH the previous requirements and the new requirement.');
    lines.push('- Prefer to keep existing variables and declarations whenever possible.');
    lines.push('- For clearly new behaviour, introduce NEW variables instead of overwriting old ones.');
    lines.push('- If the new requirement changes the behaviour of an existing step, you may update that step\'s declaration.');
    lines.push('- When you update declarations, the runtime will automatically recalculate the affected variables based on dependencies.');
    lines.push('- Avoid deleting existing steps unless they are clearly obsolete for all requirements.');
    lines.push('- IMPORTANT: Do NOT use variable interpolation inside strings (e.g., "Result: $var"). Pass variables as separate arguments (e.g., "Result:" $var).');
    lines.push(FINAL_RESPONSE_NOTE);
    lines.push('');
    lines.push('Emit ONLY valid LightSOPLang code for the updated plan, with all steps needed for the combined behaviour.');

    return lines.join('\n');
};

const buildPreparationPrompt = (preparationText, userPrompt) => {
    const preparation = String(preparationText || '').trim();
    if (!preparation) {
        return '';
    }
    const requestText = String(userPrompt || '').trim();
    const parts = [
        'Preparation instructions:',
        preparation,
        '',
    ];
    if (requestText) {
        parts.push('User request:');
        parts.push(requestText);
        parts.push('');
    }
    parts.push('Do NOT execute the user request in this step; use it only as context to follow the preparation instructions.');
    parts.push('If you need to return multiple prepared outputs, finish with:');
    parts.push('@lastAnswer final_answer $var1 $var2 $var3');
    parts.push('Use variables for each prepared output so they can be mapped into context.');
    parts.push('Do NOT use variable interpolation inside strings (e.g., "Result: $var"). Pass variables as separate arguments (e.g., "Result:" $var).');
    parts.push('Do not include any extra text.');
    return parts.join('\n');
};

export {
    buildSOPAgenticInstructions,
    buildPreparationPrompt,
};
