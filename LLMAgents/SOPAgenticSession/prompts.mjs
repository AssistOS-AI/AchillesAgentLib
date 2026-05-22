import { FINAL_ANSWER_TOOL, CANNOT_COMPLETE_TOOL } from '../constants.mjs';

const FINAL_RESPONSE_NOTE = [
    `- Finish every plan with EXACTLY ONE line of the form "@lastAnswer ${FINAL_ANSWER_TOOL} <final text>" so the runtime knows the final response.`,
    `- If the task truly cannot be completed, finish with "@lastAnswer ${CANNOT_COMPLETE_TOOL} <reason>".`,
    '- <final text> must be ONLY one value or a single variable reference like "$finalResult", no extra explanation.',
    '- Do not include additional final responses outside of this command.',
    '- Do not prefix the value with phrases like "The result is" unless the user explicitly asked for that wording.',
].join('\n');

const buildLightSOPLangInstructions = ({
    includeProgressComments = true,
    includeFinalAnswer = true,
} = {}) => {
    const lines = [
        '- Emit ONLY valid LightSOPLang code.',
        '- Every executable line must use the format "@varName command arg1 arg2".',
        '- The command/tool name is the SECOND token, after the variable name. Do not write "@command arg1 arg2".',
        '- Use descriptive variable names and preserve context between steps.',
        '- Args on the declaration line are space-separated. Do not use parentheses, commas, JSON-call syntax, markdown fences, or prose outside comments.',
        '- When an argument is a literal string containing spaces, wrap it in double quotes (e.g., @step tool "foo bar" $var).',
        '- Use $var to reference previous results.',
        '- Do NOT use variable interpolation inside strings (e.g., "Result: $var"). Pass variables as separate arguments (e.g., "Result:" $var).',
        '- For long text arguments, put the text on the lines after the declaration; all lines until the next @ declaration become one clean multiline literal argument.',
        '- Use ONLY commands available to the current session. Do not use command, skill, or orchestrator names from parent context unless they are available in the current session.',
        '- Use assign for local text variables.',
    ];
    if (includeProgressComments) {
        lines.push('- Before each user-visible tool/skill step, add a short # comment explaining what is about to happen; this comment is shown as progress in the UI.');
        lines.push('- Do not add progress comments before assign, final_answer, or cannot_complete.');
    }
    if (includeFinalAnswer) {
        lines.push(FINAL_RESPONSE_NOTE);
    }
    return lines.join('\n');
};

const buildSOPAgenticInstructions = ({
    currentPlan = '',
    userPrompt = '',
    systemPrompt = '',
    preparationContext = [],
    interruptedEvents = [],
}) => {
    const rawPrompt = typeof userPrompt === 'string' ? userPrompt : '';
    const promptText = rawPrompt.trim();
    const existingPlan = typeof currentPlan === 'string' ? currentPlan.trim() : '';
    const systemLines = [];
    if (systemPrompt && typeof systemPrompt === 'string') {
        systemLines.push('System prompt / context:');
        systemLines.push(systemPrompt.trim());
        systemLines.push('');
    }
    const prepLines = Array.isArray(preparationContext) ? preparationContext.filter(Boolean) : [];
    const interruptionLines = Array.isArray(interruptedEvents)
        ? interruptedEvents
            .filter((event) => event && typeof event === 'object')
            .map((event) => `- interrupted by ${event.by || 'user'}: ${event.reason || event.message || 'cancelled'}`)
        : [];

    if (!existingPlan) {
        return [
            'You are generating a new LightSOPLang plan.',
            ...systemLines,
            ...(prepLines.length
                ? [
                    'Additional context gathered during the previous preparation phase:',
                    ...prepLines,
                    '',
                ]
                : []),
            ...(interruptionLines.length
                ? [
                    'Recent interruption context:',
                    ...interruptionLines,
                    '',
                ]
                : []),
            '',
            'User requirement:',
            promptText,
            '',
            'Instructions:',
            buildLightSOPLangInstructions(),
        ].join('\n');
    }

    const lines = [];
    lines.push('You are updating an existing LightSOPLang plan.');
    if (systemLines.length) {
        lines.push('');
        lines.push(...systemLines);
    }
    if (prepLines.length) {
        lines.push('');
        lines.push('Additional context gathered during the previous preparation phase:');
        lines.push(...prepLines);
        lines.push('');
    }
    if (interruptionLines.length) {
        lines.push('');
        lines.push('Recent interruption context:');
        lines.push(...interruptionLines);
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
    lines.push(buildLightSOPLangInstructions());
    lines.push('');
    lines.push('Emit ONLY valid LightSOPLang code for the updated plan, with all steps needed for the combined behaviour.');

    return lines.join('\n');
};

const buildPreparationPrompt = (preparationText, userPrompt, preparationContext = '') => {
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
    parts.push('Your job is to produce a LightSOPLang plan that gathers the missing context needed by the main execution step.');
    parts.push('Do not guess the clarified facts yourself. Plan calls to available preparation commands so the plan result becomes the clarified context.');
    parts.push('Only the value passed to "@lastAnswer final_answer <value>" is carried into the main execution step.');
    parts.push('If the clarify_context command is available and you need more conversation context, call it with one or more specific questions for the exact information you need. Its result is the answer to those questions, sourced only from the parent conversation context.');
    parts.push('Do not use clarify_context to ask for information already answered by the preparation instructions. Do not finish with "awaiting clarification"; finish with the prepared context you actually recovered.');
    parts.push('Finish with a single final answer value.');
    parts.push('LightSOPLang instructions:');
    parts.push(buildLightSOPLangInstructions());
    parts.push('Do not include any extra text.');
    return parts.join('\n');
};

export {
    buildLightSOPLangInstructions,
    buildSOPAgenticInstructions,
    buildPreparationPrompt,
};
