import { buildPlanPrompt } from './helpers/planHelpers.mjs';
import { parsePlan } from './helpers/cliUtils.mjs';

export const PLAN_INTENT = 'cli-orchestrator-planning';

/**
 * Uses an LLM to map a user's natural language task description into a sequence of skill calls (a plan).
 *
 * @param {object} options - The options for generating the skill plan.
 * @param {object} options.llmAgent - The LLM agent instance to use for planning.
 * @param {string} options.taskDescription - The user's task description.
 * @param {Array<object>} options.orchestrators - A list of available orchestrator skill records.
 * @param {string} [options.languageContract] - Optional language contract to guide the LLM's response language.
 * @param {string} [options.fallbackSkillName] - Optional name of a skill to use as a fallback if planning fails.
 * @param {string} [options.modelMode] - The preferred model mode ('fast' or 'deep').
 * @returns {Promise<{plan: Array<{skill: string, prompt: string}>, error: string|null}>} - A promise that resolves to the generated plan and any error information.
 */
export const intentionToSkillPlan = async ({
    llmAgent,
    taskDescription,
    orchestrators = [],
    languageContract = '',
    modelMode = 'fast',
}) => {
    if (!llmAgent || typeof llmAgent.executePrompt !== 'function') {
        return {
            plan: [],
            error: 'LLM agent is not available.',
        };
    }

    const plannerPrompt = buildPlanPrompt({
        task: taskDescription,
        orchestrators,
        languageContract,
    });

    try {
        const rawPlan = await llmAgent.executePrompt(plannerPrompt, {
            responseShape: 'json',
            context: { intent: PLAN_INTENT, task: taskDescription },
            mode: modelMode,
        });
        const plan = parsePlan(rawPlan);
        if (!plan.length) {
            return {
                plan: [],
                error: 'Planner did not produce any steps for this request.',
            };
        }
        return { plan, error: null };
    } catch (error) {
        return {
            plan: [],
            error: `Planner failed to generate a plan: ${error.message}`,
        };
    }
};
