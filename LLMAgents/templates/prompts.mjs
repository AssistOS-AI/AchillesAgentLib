import { extractJson } from '../markdown.mjs';
import { FINAL_ANSWER_TOOL, SESSION_STATUS_AWAITING_INPUT } from '../constants.mjs';

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
        'Respond ONLY with JSON:',
        '{ "decision": "yes" | "no" | "unclear", "confidence": 0.0-1.0 }',
    );

    return lines.join('\n');
};

const buildAgenticSessionPlannerPrompt = (options) => {
    const {
        tools,
        history,
        toolCalls,
        userPrompt,
        systemPrompt = '',
        toolVars,
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
        lines.push('---------');
    }

    const lastToolCall = toolCalls && toolCalls.length
        ? toolCalls[toolCalls.length - 1]
        : null;
    if (lastToolCall) {
        lines.push('');
        lines.push('Most recent tool call relevant to this instruction:');
        lines.push(`- tool: ${lastToolCall.tool}`);
        lines.push(`- prompt: ${lastToolCall.prompt}`);
        const lastResultRef = lastToolCall.resultRef;
        lines.push(`- resultRef: ${lastResultRef}`);
    }

    lines.push('');
    // Check for pending awaiting_input state (tool waiting for user confirmation)
    let pendingTool = null;
    for (let i = history.length - 1; i >= 0; i--) {
        const h = history[i];
        if (h.type === SESSION_STATUS_AWAITING_INPUT) {
            pendingTool = h.tool;
            break;
        }
        // If we see a final_answer or user after awaiting_input, the pending state is resolved
        if (h.type === 'final_answer' || h.type === 'cannot_complete') {
            break;
        }
    }

    lines.push('Conversation so far (most recent last):');
    for (const h of history || []) {
        if (h.type === 'user') {
            lines.push(`USER: ${h.prompt}`);
        } else if (h.type === 'tool') {
            const value = toolVars.get(h.result.resultRef);
            lines.push(`TOOL[${h.tool}]: resultRef=${h.result.resultRef} result=${formatValue(value)}`);
        } else if (h.type === SESSION_STATUS_AWAITING_INPUT) {
            lines.push(`AWAITING_INPUT[${h.tool}]: ${h.answer} (step=${h.step || 'confirmation'})`);
        } else if (h.type === 'final_answer') {
            lines.push(`FINAL: ${h.answer}`);
        } else if (h.type === 'cannot_complete') {
            lines.push(`CANNOT_COMPLETE: ${h.answer}`);
        } else if (h.type === 'validation_failed') {
            lines.push(`VALIDATION_FAILED: expected="${h.expected}", got="${h.actual}", retry=${h.retryCount}`);
        } else if (h.type === 'timeout') {
            lines.push(`TIMEOUT: ${h.reason || 'previous step exceeded time limit'}`);
        }
    }
    
    // If there's a pending tool awaiting input, add explicit instruction
    if (pendingTool) {
        lines.push('');
        lines.push(`IMPORTANT: The tool "${pendingTool}" is awaiting user confirmation/input.`);
        lines.push(`If the user's response is a confirmation (yes, ok, proceed, etc.) or cancellation (no, cancel, etc.), route it back to "${pendingTool}".`);
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
    lines.push('- First identify the PRIMARY target entity (what the user wants to act on) and any SECONDARY entities (destination, location, reference, filter context).');
    lines.push('- Route to the tool owning the PRIMARY target entity, not to a secondary/destination entity.');
    lines.push('- For movement intents (move/relocate/transfer/assign), if the prompt matches "<objects> ... to <destination>", choose the tool for "<objects>". Treat the destination as a parameter.');
    lines.push('- Do NOT choose a destination tool unless the user explicitly asks to edit that destination record itself (for example rename/update/create/delete it).');
    lines.push('- Before emitting JSON, validate tool choice against the target-entity rule and correct it if mismatched.');
    lines.push('- Use "call_tool" to obtain NEW information or perform calculations.');
    lines.push('- If you want to pass the result of a previous tool as a parameter, use the exact resultRef shown above, prefixed with $$ (example: $$shell-res-1).');
    lines.push('- Do NOT use the literal token $$resultRef; always substitute the real resultRef ID.');
    lines.push(`- When you have the final response, call the reserved tool "${FINAL_ANSWER_TOOL}" via action "call_tool" with ONLY the final text in "toolPrompt" (no extra wording).`);
    lines.push(`- If the task truly cannot be completed, call the reserved tool "cannot_complete" via action "call_tool" with a short reason in "toolPrompt".`);
    lines.push('- Avoid calling the same tool repeatedly with equivalent instructions that do not change the result.');
    lines.push('- If the most recent tool result already satisfies the current instruction or expected answer, call "final_answer" and set "toolPrompt" to the exact $$<resultRef> of that result.');
    lines.push('- If the user instruction explicitly mentions a tool by name, you MUST call that tool at least once in this turn before finishing.');
    lines.push('- When passing literal strings as tool arguments, do NOT wrap them in extra quotes if they are already quoted in the user text; pass the value once without adding additional quotation marks.');
    lines.push('- When calling the shell tool, prefer the simplest canonical command with no code fences, no extra flags, and standard quoting (use single quotes for globs like *.js).');
    lines.push('- When calling a tool, keep the user instruction intact; do NOT rewrite it into a different type of request (e.g., do not ask for a command if the user asked for a number).');
    lines.push('- If the history shows any failure (validation failed, timeout, or similar), adjust your next tool call or parameters to fix it; do NOT repeat the same failing call.');
    lines.push('');
    lines.push('Decide the next action. Respond ONLY with the JSON object, no extra text.');

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
    parts.push('Based on the preparation instructions, output only lines in the format:');
    parts.push('@context_key := "value"');
    parts.push('Do not include any extra text.');
    return parts.join('\n');
};

export {
    buildInterpretMessagePrompt,
    buildDoTaskPrompt,
    buildDoTaskWithReviewPrompt,
    buildDetectIntentsPrompt,
    buildResolveConfirmationPrompt,
    buildAgenticSessionPlannerPrompt,
    buildPreparationPrompt,
    extractJson,
};
    const formatValue = (value) => {
        if (typeof value === 'string') {
            return value;
        }
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    };
