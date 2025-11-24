import { extractJson } from '../markdown.mjs';
import { FINAL_ANSWER_TOOL } from '../constants.mjs';

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
    return [
        'Agent context:',
        agentContextSerialized,
        'Task description:',
        description,
        outputSchema ? `Use the following output schema:\n${JSON.stringify(outputSchema, null, 2)}` : '',
        'Response:',
    ].filter(Boolean).join('\n\n');
};

const buildDoTaskWithReviewPrompt = (agentContextSerialized, description, maxIterations) => {
    return [
        'Agent context:',
        agentContextSerialized,
        'Task description:',
        description,
        `Create a plan with at most ${maxIterations} steps and provide a reviewed answer.`,
        'Response:',
    ].filter(Boolean).join('\n\n');
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
     Output: { "addRequirement": "...", "prioritizeRequirement": "set priority to Critical..." }

2. Map each identified intent to one of the available skills.

3. Extract the specific description for the skill from the prompt. 
   CRITICAL: The description must be SELF-CONTAINED. It should include all details (names, places, ID's, acronyms, etc) from the user prompt so the skill can be executed without further context. 
   If in doubt, copy the full clause from the user prompt into the description.
   - for example: Set priority to high for NFS: All external API calls must have a fallback mechanism to prevent system-wide failures. Your skill description should be:
    Set priority to high for the NFS that is about external API calls which must have a fallback mechanism to prevent system wide failures
   
4. Output a JSON object where:
   - Keys are the names of the matched skills.
   - Values are the self-contained descriptions for that skill.
   
Example input:
The current NFS-001, 'System uptime must be 99.9%', needs to be updated to 'System uptime must be 99.99% for critical services'. This is a high priority change. Also, we need to add a new URS: 'Users can save their preferences for dashboard widgets.'
Example Output:
{
    "modifyRequirement": "update NFS-001 from 'System uptime must be 99.9%' to 'System uptime must be 99.99% for critical services'.",
    "prioritizeRequirement": "set priority to High for the modified NFS-001 regarding system uptime.",
    "addRequirement": "add a new URS: 'Users can save their preferences for dashboard widgets.'"
 }

Respond ONLY with the JSON object.`;
}

const buildAgenticSessionPlannerPrompt = (options) => {
    const {
        tools,
        history,
        toolCalls,
        userPrompt,
        systemPrompt = '',
    } = options;

    const toolNames = tools ? Object.keys(tools) : [];
    const mentionedTools = typeof userPrompt === 'string'
        ? toolNames.filter((name) => userPrompt.toLowerCase().includes(name.toLowerCase()))
        : [];

    const lines = [];
    lines.push('You are an agentic planner that decides which tools to call.');
    if (systemPrompt && typeof systemPrompt === 'string') {
        lines.push('');
        lines.push('System prompt / context:');
        lines.push(systemPrompt);
    }
    lines.push('You must reason step by step and emit ONLY a JSON object.');
    lines.push('JSON schema:');
    lines.push('{');
    lines.push('  "action": "call_tool",');
    lines.push('  "tool": "<toolName>",');
    lines.push('  "toolPrompt": "<instruction for the tool>",');
    lines.push('  "reason": "<short explanation>"');
    lines.push('}');
    lines.push('');
    lines.push('Available tools:');
    for (const [name, spec] of Object.entries(tools || {})) {
        const description = spec && typeof spec.description === 'string'
            ? spec.description
            : '';
        lines.push(`- ${name}: ${description}`);
    }

    const lastToolCall = toolCalls && toolCalls.length
        ? toolCalls[toolCalls.length - 1]
        : null;
    if (lastToolCall) {
        lines.push('');
        lines.push('Most recent tool call relevant to this instruction:');
        lines.push(`- tool: ${lastToolCall.tool}`);
        lines.push(`- result: ${String(lastToolCall.result)}`);
    }

    lines.push('');
    lines.push('Conversation so far (most recent last):');
    for (const h of history || []) {
        if (h.type === 'user') {
            lines.push(`USER: ${h.prompt}`);
        } else if (h.type === 'tool') {
            lines.push(`TOOL[${h.tool}]: ${String(h.result)}`);
        } else if (h.type === 'final_answer') {
            lines.push(`FINAL: ${h.answer}`);
        } else if (h.type === 'cannot_complete') {
            lines.push(`CANNOT_COMPLETE: ${h.answer}`);
        }
    }
    lines.push('');
    lines.push(`Current user instruction: ${userPrompt}`);
    if (mentionedTools.length) {
        lines.push('');
        lines.push('Tools explicitly mentioned in the current instruction:');
        mentionedTools.forEach((name) => {
            lines.push(`- ${name}`);
        });
    }
    lines.push('');
    lines.push('Guidelines:');
    lines.push('- Use "call_tool" to obtain NEW information or perform calculations.');
    lines.push(`- When you have the final response, call the reserved tool "${FINAL_ANSWER_TOOL}" with ONLY the final text in "toolPrompt" (no extra wording).`);
    lines.push(`- If the task truly cannot be completed, call the reserved tool "cannot_complete" with a short reason in "toolPrompt".`);
    lines.push('- Avoid calling the same tool repeatedly with equivalent instructions that do not change the result.');
    lines.push('- If the user instruction explicitly mentions a tool by name, you MUST call that tool at least once in this turn before finishing.');
    lines.push('');
    lines.push('Decide the next action. Respond ONLY with the JSON object, no extra text.');

    return lines.join('\n');
};

export {
    buildInterpretMessagePrompt,
    buildDoTaskPrompt,
    buildDoTaskWithReviewPrompt,
    buildDetectIntentsPrompt,
    buildAgenticSessionPlannerPrompt,
    extractJson,
};
