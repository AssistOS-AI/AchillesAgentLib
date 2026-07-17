
import {
    buildDoTaskPrompt,
    buildDoTaskWithReviewPrompt,
} from './prompts.mjs';
import { serializeContext } from './LLMAgentHelpers.mjs';
import { logLLMInteraction } from '../utils/LLMLogger.mjs';

function normalizeTagArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
}

function describeInvokerResponse(response) {
    if (response === null) {
        return 'The LLM provider adapter returned null instead of text. The model completed without a usable response.';
    }
    if (response === undefined) {
        return 'The LLM provider adapter returned undefined instead of text. No usable model response was received.';
    }
    if (response && typeof response === 'object' && Object.prototype.hasOwnProperty.call(response, 'output')) {
        const outputType = response.output === null
            ? 'null'
            : Array.isArray(response.output)
                ? 'an array'
                : typeof response.output;
        return `The LLM provider adapter returned an object whose output field was ${outputType} instead of text.`;
    }
    const responseType = Array.isArray(response) ? 'an array' : typeof response;
    return `The LLM provider adapter returned ${responseType} instead of text or an object with a text output field.`;
}

async function extraComplete(agent, options = {}) {
    const {
        prompt,
        history = [],
        model = null,
        tags = null,
        context = {},
        reasoningEffort = null,
        ...invokerExtras
    } = options;

    if (!prompt || typeof prompt !== 'string') {
        throw new Error('complete requires a prompt string.');
    }

    const startedAt = Date.now();
    const conversation = Array.isArray(history) ? history.slice() : [];
    const historyText = conversation.map((entry) => {
        const role = entry?.role || 'user';
        const message = entry?.message ?? '';
        return `${role}: ${String(message)}`;
    }).join('\n');
    const loggedPrompt = historyText
        ? `${historyText}

${prompt}`
        : prompt;
    const inputCharacters = loggedPrompt.length;
    agent._recordInputChars(inputCharacters);

    const effectiveReasoningEffort = reasoningEffort
        || (agent && typeof agent._resolveReasoningEffort === 'function' ? agent._resolveReasoningEffort(options) : null);

    let responseMetadata = null;
    try {
        const response = await agent.invokerStrategy({
            prompt,
            history: conversation,
            model,
            tags,
            modelConfig: agent.modelConfig,
            agent,
            context,
            reasoningEffort: effectiveReasoningEffort || undefined,
            ...invokerExtras,
        });

        let finalResponse = null;
        if (typeof response === 'string') {
            finalResponse = response;
        } else if (response && typeof response === 'object' && typeof response.output === 'string') {
            responseMetadata = response;
            finalResponse = response.output;
        } else {
            throw new Error(describeInvokerResponse(response));
        }

        const outputCharacters = finalResponse.length;
        agent._recordOutputChars(outputCharacters);

        const loggedModel = responseMetadata?.model
            || agent.invokerStrategy?.getLastInvocationDetails?.()?.model
            || model
            || 'auto';
        const lastInvocation = agent.invokerStrategy?.getLastInvocationDetails?.() || null;
        const loggedRequestedTags = normalizeTagArray(
            responseMetadata?.requestedTags
            || lastInvocation?.requestedTags
            || tags
        );
        const loggedMatchedTags = normalizeTagArray(
            responseMetadata?.matchedTags
            || lastInvocation?.matchedTags
        );
        const callDurationMs = Date.now() - startedAt;
        logLLMInteraction({
            prompt: loggedPrompt,
            response: finalResponse,
            model: loggedModel,
            requestedTags: loggedRequestedTags,
            matchedTags: loggedMatchedTags,
            durationMs: callDurationMs,
        });

        if (agent._callLog) {
            agent._callLog.push({
                inputChars: inputCharacters,
                outputChars: outputCharacters,
                model: loggedModel,
                requestedTags: loggedRequestedTags,
                matchedTags: loggedMatchedTags,
                durationMs: callDurationMs,
                intent: context?.intent || null,
            });
        }

        return finalResponse;
    } catch (error) {
        const lastInvocation = agent.invokerStrategy?.getLastInvocationDetails?.() || null;
        const loggedModel = lastInvocation?.model || responseMetadata?.model || model || 'auto';
        const loggedRequestedTags = normalizeTagArray(lastInvocation?.requestedTags || tags);
        const loggedMatchedTags = normalizeTagArray(lastInvocation?.matchedTags);
        logLLMInteraction({
            prompt: loggedPrompt,
            response: error?.message || '',
            model: loggedModel,
            requestedTags: loggedRequestedTags,
            matchedTags: loggedMatchedTags,
            durationMs: Date.now() - startedAt,
        });
        throw error;
    }
}

async function extraDoTask(agent, agentContext, description, options = {}) {
    const {
        model = null,
        tags = null,
        outputSchema = null,
        ...rest
    } = options;

    if (!description || typeof description !== 'string') {
        throw new Error('doTask requires a task description string.');
    }

    const prompt = buildDoTaskPrompt(serializeContext(agentContext), description, outputSchema);

    return agent.complete({
        prompt,
        model,
        tags,
        context: { intent: 'task-run' },
        ...rest,
    });
}

async function extraDoTaskWithReview(agent, agentContext, description, options = {}) {
    const {
        maxIterations = 3,
        model = null,
        tags = null,
        ...rest
    } = options;

    const prompt = buildDoTaskWithReviewPrompt(
        serializeContext(agentContext),
        description,
        maxIterations,
    );

    return agent.complete({
        prompt,
        model,
        tags,
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
    describeInvokerResponse,
    extraComplete,
    extraDoTask,
    extraDoTaskWithReview,
    extraDoTaskWithHumanReview,
};
