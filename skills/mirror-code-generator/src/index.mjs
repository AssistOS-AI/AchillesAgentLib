import { generateMirrorCode } from './codegen.mjs';

export const shortName = 'mirror-code-generator';
export const skillType = 'cskill';
export const descriptor = {
    title: 'mirror-code-generator',
    summary: 'Generates code from specs in a skill directory.',
    sections: {
        'input-format': 'A single string containing the skill directory path that has a ./specs folder.',
        'output-format': 'An object with message and generatedFiles array describing code generation output.',
        'constraints': 'Requires a valid directory path that contains a specs folder with FDS files.',
    },
};


/**
 * Skill action entry point.
 * @param {Object} context - Execution context provided by OrchestratorSkillsSubsystem.
 * @param {string} context.promptText - The skill directory path to generate code for.
 * @param {Object} context.recursiveAgent - The recursive agent instance (provides llmAgent).
 * @param {Object} context.llmAgent - The LLM agent instance.
 * @returns {Promise<Object>} Result object with message and generatedFiles array.
 */
export async function action(context) {
    const { promptText, recursiveAgent, llmAgent, logger = console } = context;
    const targetDir = promptText?.trim();

    if (!targetDir) {
        throw new Error('mirror-code-generator requires a skill directory path as input.');
    }

    const agent = llmAgent || recursiveAgent?.llmAgent;
    if (!agent) {
        throw new Error('mirror-code-generator requires an LLM agent.');
    }

    const generationResult = await generateMirrorCode(targetDir, agent, logger);

    return {
        message: generationResult?.message || `Code generation completed for ${targetDir}`,
        generatedFiles: generationResult?.generatedFiles || [],
    };
}
