export async function action(context) {
    const { generationPrompt, context: contextStr = '', mode = 'fast', llmAgent } = context;
    if (!generationPrompt) {
        throw new Error('Invalid input for generate-text: expected generationPrompt.');
    }
    if(!llmAgent){
        throw new Error('Invalid input for generate-text: expected llmAgent.');
    }
    return "OK";
}
