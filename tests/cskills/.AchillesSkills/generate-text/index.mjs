export async function action(context) {
    const { promptText, llmAgent } = context;
    if (!promptText) {
        throw new Error('Invalid input for generate-text: expected promptText.');
    }
    if (!llmAgent) {
        throw new Error('Invalid input for generate-text: expected llmAgent.');
    }
    return "OK";
}
