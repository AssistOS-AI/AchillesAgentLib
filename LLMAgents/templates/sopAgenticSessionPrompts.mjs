const buildSOPAgenticInstructions = ({ currentPlan = '', userPrompt = '' }) => {
    const rawPrompt = typeof userPrompt === 'string' ? userPrompt : '';
    const promptText = rawPrompt.trim();
    const existingPlan = typeof currentPlan === 'string' ? currentPlan.trim() : '';

    if (!existingPlan) {
        return rawPrompt;
    }

    const lines = [];
    lines.push('You are updating an existing LightSOPLang plan.');
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
    lines.push('');
    lines.push('Emit ONLY valid LightSOPLang code for the updated plan, with all steps needed for the combined behaviour.');

    return lines.join('\n');
};

export {
    buildSOPAgenticInstructions,
};
