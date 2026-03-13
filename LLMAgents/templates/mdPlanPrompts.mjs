import { FINAL_ANSWER_TOOL, CANNOT_COMPLETE_TOOL } from '../constants.mjs';

const buildMDPlanInstructions = ({ skillsDescription, userPrompt, systemPrompt = '', preparationContext = [], feedback = null }) => {
    const lines = [];

    lines.push('You are a task planner. Given a user request and available tools, generate an execution plan.');
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

    if (feedback) {
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
                lines.push(`- ${name} = ${formatVal(value)}`);
            }
        }
        lines.push('');
        lines.push('Fix the plan to address these failures.');
        lines.push('');
    }

    lines.push('Instructions:');
    lines.push('- Output a numbered list of steps.');
    lines.push('- Format: N. variable_name = tool_name(arg1, arg2)');
    lines.push('- Use $variable_name to reference the result of a previous step.');
    lines.push('- Arguments containing commas or parentheses must be wrapped in double quotes.');
    lines.push(`- The LAST step MUST call "${FINAL_ANSWER_TOOL}" or "${CANNOT_COMPLETE_TOOL}".`);
    lines.push(`- The "${FINAL_ANSWER_TOOL}" step should contain ONLY a single $variable reference. Do NOT add labels or combine multiple variables.`);
    lines.push('- Keep plans concise -- use the minimum steps needed.');
    lines.push('');
    lines.push('Example (add 7 and 3, check if even, return result):');
    lines.push('1. sum = add(7, 3)');
    lines.push('2. check = isEven($sum)');
    lines.push('3. result = final_answer($check)');
    lines.push('');
    lines.push('Respond ONLY with the numbered plan. No extra text.');

    return lines.join('\n');
};

function formatVal(value) {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
}

export { buildMDPlanInstructions };
