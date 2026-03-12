export const shortName = 'ask-user';
export const skillType = 'cskill';

export async function action(context) {
    const { llmAgent, promptText } = context;

    if (!llmAgent?.inputReader || typeof llmAgent.inputReader.read !== 'function') {
        throw new Error('ask-user requires an interactive input reader.');
    }

    const prompt = typeof promptText === 'string' && promptText.trim()
        ? promptText.trim()
        : 'Please provide the missing details.';

    const response = await llmAgent.inputReader.read(prompt);
    if (typeof response === 'string') {
        return response.trim();
    }

    return '';
}
