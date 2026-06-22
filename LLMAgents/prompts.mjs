import { extractJson } from './markdown.mjs';

const buildInterpretMessagePrompt = (intents, instructions) => {
    const promptSections = [
        instructions || 'Interpret the user response and summarise the intent.',
        `Expected intents: ${intents.join(', ') || 'accept, cancel, update'}.`,
        'Respond using Markdown bullet points, for example:',
        '- intent: accept|cancel|update|ideas',
        '- updates: field=value; other=value (if relevant)',
        '- ideas: item one; item two (optional)',
    ];

    return promptSections.join('\n\n');
};

const buildDoTaskPrompt = (agentContextSerialized, description, outputSchema) => {
    const parts = [];
    if (agentContextSerialized && agentContextSerialized.trim()) {
        parts.push('Agent context:', agentContextSerialized);
    }
    parts.push('Task description:', description);
    if (outputSchema) {
        parts.push(`Use the following output schema:\n${JSON.stringify(outputSchema, null, 2)}`);
    }
    parts.push('Response:');
    return parts.join('\n\n');
};

const buildDoTaskWithReviewPrompt = (agentContextSerialized, description, maxIterations) => {
    const parts = [];
    if (agentContextSerialized && agentContextSerialized.trim()) {
        parts.push('Agent context:', agentContextSerialized);
    }
    parts.push('Task description:', description);
    parts.push(`Create a plan with at most ${maxIterations} steps and provide a reviewed answer.`);
    parts.push('Response:');
    return parts.join('\n\n');
};

const buildDetectIntentsPrompt = (skillsDescription, userPrompt) => {
    return `You are an expert agent with deep understanding of IT, software development, GAMP, software architectures, and user experience.
Your task is to map a user's natural language prompt to a set of available software engineering skills (tools).

Available Skills:
${JSON.stringify(skillsDescription, null, 2)}

User Prompt:
"${userPrompt}"

Instructions:
1. Analyze the user prompt to identify distinct actions or intents.
   - Only extract multiple intents for the same subject if they represent fundamentally different operations (e.g., 'addRequirement' vs 'prioritizeRequirement').
   - If a user requests a requirement change AND specifies a priority (e.g., "This is critical"), generate TWO separate skills: one for the change and one for 'prioritizeRequirement'.
   - For 'linkRequirements', if multiple links are requested, describe ALL of them in the parameter.
   - Do NOT invent 'linkRequirements' unless the user explicitly asks to create or update links. Requests for reports, proofs, audits, or summaries do NOT imply new links.
   - For 'generateTestCases', if the user asks for tests to be made, always map this intent.
   - Ensure the subject/parameter for each skill is always clear, self-contained, and well-defined.
   - CRITICAL: Keep all qualifiers and scope phrases verbatim. Do NOT generalize or drop specifics, environment names, component names, IDs, directions , etc. . 

   Example of splitting intents:
   - Input: "Add a new NFS for encryption. This is critical."
     Output: markdown sections for addRequirement and prioritizeRequirement.

2. Map each identified intent to one of the available skills.

3. Extract the specific description for the skill from the prompt. 
   CRITICAL: The description must be SELF-CONTAINED. It should include all details (names, places, ID's, acronyms, etc) from the user prompt so the skill can be executed without further context. 
   If in doubt, copy the full clause from the user prompt into the description.
   - for example: Set priority to high for NFS: All external API calls must have a fallback mechanism to prevent system-wide failures. Your skill description should be:
    Set priority to high for the NFS that is about external API calls which must have a fallback mechanism to prevent system wide failures
   
4. Output markdown sections where:
   - Each heading is the name of a matched skill.
   - Each section body is the self-contained description for that skill.
   
Example input:
The current NFS-001, 'System uptime must be 99.9%', needs to be updated to 'System uptime must be 99.99% for critical services'. This is a high priority change. Also, we need to add a new URS: 'Users can save their preferences for dashboard widgets.'
Example Output:
## modifyRequirement
update NFS-001 from 'System uptime must be 99.9%' to 'System uptime must be 99.99% for critical services'.

## prioritizeRequirement
set priority to High for the modified NFS-001 regarding system uptime.

## addRequirement
add a new URS: 'Users can save their preferences for dashboard widgets.'

Respond ONLY with the markdown sections, no extra text.`;
};

const buildResolveConfirmationPrompt = (userInput, actionContext = null) => {
    const lines = [
        'Determine if the user reply indicates approval or rejection.',
    ];

    if (actionContext) {
        lines.push(`Action being confirmed: ${actionContext}`);
    }

    lines.push(
        '',
        'User reply:',
        `"${userInput}"`,
        '',
        'Rules:',
        '- "yes", "y", "ok", "sure", "confirm", "accept", "proceed", "go ahead", "do it" → yes',
        '- "no", "n", "cancel", "stop", "abort", "nevermind", "don\'t", "reject" → no',
        '- Ambiguous or unrelated responses → unclear',
        '',
        'Respond ONLY with markdown:',
        '## decision',
        'yes | no | unclear',
        '',
        '## confidence',
        '0.0-1.0',
    );

    return lines.join('\n');
};

export {
    buildInterpretMessagePrompt,
    buildDoTaskPrompt,
    buildDoTaskWithReviewPrompt,
    buildDetectIntentsPrompt,
    buildResolveConfirmationPrompt,
    extractJson,
};
