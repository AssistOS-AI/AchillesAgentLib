import { FINAL_ANSWER_TOOL, CANNOT_COMPLETE_TOOL } from '../constants.mjs';

const buildJSONPlanInstructions = ({ skillsDescription, userPrompt, systemPrompt = '', preparationContext = [], currentPlan = null, feedback = null }) => {
    const lines = [];

    lines.push('You are a task planner. Given a user request and available tools, generate a JSON execution plan.');
    lines.push('');

    if (systemPrompt && typeof systemPrompt === 'string') {
        lines.push('System context:');
        lines.push(systemPrompt.trim());
        lines.push('');
    }

    const prepLines = Array.isArray(preparationContext) ? preparationContext.filter(Boolean) : [];
    if (prepLines.length) {
        lines.push('Preparation context:');
        lines.push(...prepLines);
        lines.push('');
    }

    lines.push('Available tools:');
    for (const [name, description] of Object.entries(skillsDescription || {})) {
        lines.push(`- ${name}: ${description}`);
    }
    lines.push('');

    lines.push('User request:');
    lines.push(typeof userPrompt === 'string' ? userPrompt.trim() : '');
    lines.push('');

    if (currentPlan && feedback) {
        lines.push('Your previous plan had execution failures:');
        if (Array.isArray(feedback.failures) && feedback.failures.length) {
            for (const f of feedback.failures) {
                lines.push(`- Step "${f.variable}": ${f.reason}`);
            }
        }
        const vars = feedback.variables && typeof feedback.variables === 'object'
            ? Object.entries(feedback.variables)
            : [];
        if (vars.length) {
            lines.push('');
            lines.push('Variable snapshot from last execution:');
            for (const [name, value] of vars) {
                lines.push(`- ${name}: ${formatVal(value)}`);
            }
        }
        lines.push('');
        lines.push('Fix the plan to address these failures. Output the complete corrected JSON plan.');
        lines.push('');
    }

    lines.push('Instructions:');
    lines.push('- Output a JSON object with a "steps" array.');
    lines.push('- Each step: { "id": "<unique_name>", "tool": "<tool_name>", "args": ["<arg1>", "<arg2>"] }');
    lines.push('- Use "$id" in args to reference the result of a previous step (e.g., "$sum").');
    lines.push('- Args are joined with a space before being passed to the tool, so split naturally.');
    lines.push(`- The LAST step MUST use "${FINAL_ANSWER_TOOL}" or "${CANNOT_COMPLETE_TOOL}" as the tool.`);
    lines.push(`- The "${FINAL_ANSWER_TOOL}" step args should contain ONLY a single "$id" reference to the step whose result is the answer. Do NOT add labels, prefixes, or combine multiple references.`);
    lines.push('- Step IDs must be unique and contain only letters, numbers, and underscores.');
    lines.push('- Keep plans concise -- use the minimum number of steps needed.');
    lines.push('- Do NOT use variable interpolation inside strings (e.g., "Result: $var"). Pass variables as separate args.');
    lines.push('');
    lines.push('Example (add 7 and 3, check if even, return result):');
    lines.push(JSON.stringify({
        steps: [
            { id: 'sum', tool: 'add', args: ['7', '3'] },
            { id: 'check', tool: 'isEven', args: ['$sum'] },
            { id: 'result', tool: 'final_answer', args: ['$check'] },
        ],
    }, null, 2));
    lines.push('');
    lines.push('Respond ONLY with the JSON object. No extra text.');

    return lines.join('\n');
};

function formatVal(value) {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
}

export { buildJSONPlanInstructions };
