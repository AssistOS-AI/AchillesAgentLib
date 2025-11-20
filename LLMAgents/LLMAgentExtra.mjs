import {
    buildDoTaskPrompt,
    buildDoTaskWithReviewPrompt,
} from './templates/prompts.mjs';
import { serializeContext } from './LLMAgentHelpers.mjs';

// NOTE: These helpers encapsulate the legacy doTask* behaviour so that
// LLMAgent can delegate to them. This makes it easier to detect external
// usage and eventually remove or replace them without touching the agent
// core.

async function extraDoTask(agent, agentContext, description, options = {}) {
    const {
        mode = 'fast',
        model = null,
        outputSchema = null,
        ...rest
    } = options;

    if (!description || typeof description !== 'string') {
        throw new Error('doTask requires a task description string.');
    }

    const prompt = buildDoTaskPrompt(serializeContext(agentContext), description, outputSchema);

    return agent.complete({
        prompt,
        mode,
        model,
        context: { intent: 'task-execution' },
        ...rest,
    });
}

async function extraDoTaskWithReview(agent, agentContext, description, options = {}) {
    const {
        mode = 'deep',
        maxIterations = 3,
        model = null,
        ...rest
    } = options;

    const prompt = buildDoTaskWithReviewPrompt(
        serializeContext(agentContext),
        description,
        maxIterations,
    );

    return agent.complete({
        prompt,
        mode,
        model,
        context: { intent: 'task-review', maxIterations },
        ...rest,
    });
}

async function extraDoTaskWithHumanReview(agent, agentContext, description, options = {}) {
    const draft = await extraDoTask(agent, agentContext, description, options);
    return {
        draft,
        humanReviewRequired: true,
    };
}

export {
    extraDoTask,
    extraDoTaskWithReview,
    extraDoTaskWithHumanReview,
};
