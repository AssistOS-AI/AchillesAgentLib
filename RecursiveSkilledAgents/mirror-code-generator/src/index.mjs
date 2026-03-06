import { generateMirrorCode } from './codegen.mjs';


/**
 * Orchestrator skill action entry point.
 * @param {Object} context - Execution context provided by OrchestratorSkillsSubsystem.
 * @param {string} context.prompt - The skill directory path to generate code for.
 * @param {Object} context.recursiveAgent - The recursive agent instance (provides llmAgent).
 * @param {Object} context.llmAgent - The LLM agent instance.
 * @returns {Promise<Object>} Result object with message and generatedFiles array.
 */
export async function action(context) {
    const { prompt, recursiveAgent, llmAgent, logger = console } = context;
    const targetDir = prompt?.trim();

    if (!targetDir) {
        throw new Error('mirror-code-generator requires a skill directory path as input.');
    }

    const agent = llmAgent || recursiveAgent?.llmAgent;
    if (!agent) {
        throw new Error('mirror-code-generator requires an LLM agent.');
    }

    const generatedFiles = await generateMirrorCode(targetDir, agent, logger);

    return {
        message: `Code generation completed for ${targetDir}`,
        generatedFiles: generatedFiles || [],
    };
}
