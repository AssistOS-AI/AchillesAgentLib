import { stripDependsOn } from '../../../utils/internalSkillsUtils.mjs';

export const shortName = 'ask-user';
export const skillType = 'cskill';

export async function action(context) {
    const { llmAgent, promptText } = context;
    const sanitizedPrompt = stripDependsOn(promptText);

    if (!llmAgent?.inputReader || typeof llmAgent.inputReader.read !== 'function') {
        throw new Error('ask-user requires an interactive input reader.');
    }

    const prompt = typeof sanitizedPrompt === 'string' && sanitizedPrompt.trim()
        ? sanitizedPrompt.trim()
        : 'Please provide the missing details.';

    const response = await llmAgent.inputReader.read(prompt);
    if (typeof response === 'string') {
        return response.trim();
    }

    return '';
}
