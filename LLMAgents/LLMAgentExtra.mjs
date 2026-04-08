
import {
    buildDoTaskPrompt,
    buildDoTaskWithReviewPrompt,
} from './templates/prompts.mjs';
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

// NOTE: These helpers encapsulate complete/doTask* behaviour so that LLMAgent
// can delegate to them without duplicating orchestration logic.
async function extraComplete(agent, options = {}) {
    const {
        prompt,
        history = [],
        model = null,
        tags = null,
        context = {},
        ...invokerExtras
    } = options;

    if (!prompt || typeof prompt !== 'string') {
        throw new Error('complete requires a prompt string.');
    }

    const requestId = agent._debugEnabled ? agent._nextDebugRequestId() : null;
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
    const emit = (event) => {
        if (!requestId) {
            return;
        }
        agent._emitDebugEvent({
            id: requestId,
            method: 'complete',
            ...event,
        });
    };
    emit({
        phase: 'traffic',
        direction: 'input',
        characters: inputCharacters,
        prompt: loggedPrompt,
    });

    if (agent._processingCallbacks?.onStart) {
        try {
            agent._processingCallbacks.onStart();
        } catch (error) {
            // Silently ignore callback errors
        }
    }

    // Report LLM call via ActionReporter if available
    const actionReporter = agent._actionReporter;
    let llmAction = null;
    if (actionReporter) {
        const purpose = context?.intent || 'Processing';
        const modelName = model || process.env.ACHILLES_MODEL_PLAN || 'plan';
        llmAction = actionReporter.llmCall(modelName, purpose);
    }

    let responseMetadata = null;
    try {
        const conversation = Array.isArray(history) ? history.slice() : [];
        emit({
            phase: 'request',
            model,
            prompt,
            history: conversation,
            context,
            options: invokerExtras,
        });
        const response = await agent.invokerStrategy({
            prompt,
            history: conversation,
            model: model || process.env.ACHILLES_MODEL_PLAN || 'plan',
            tags,
            agent,
            context,
            ...invokerExtras,
        });

        if (agent._processingCallbacks?.onEnd) {
            try {
                agent._processingCallbacks.onEnd();
            } catch (error) {
                // Silently ignore callback errors
            }
        }

        let finalResponse = null;
        if (typeof response === 'string') {
            finalResponse = response;
        } else if (response && typeof response === 'object' && typeof response.output === 'string') {
            responseMetadata = response;
            finalResponse = response.output;
        } else {
            throw new Error('LLMAgent invokerStrategy must return a string response.');
        }
        emit({
            phase: 'response',
            output: finalResponse,
        });
        const outputCharacters = finalResponse.length;
        agent._recordOutputChars(outputCharacters);
        emit({
            phase: 'traffic',
            direction: 'output',
            characters: outputCharacters,
            output: finalResponse,
        });
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

        // Per-call tracking
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

        // Complete the action reporter action
        if (llmAction && actionReporter) {
            actionReporter.completeAction({ model: loggedModel, duration: Date.now() - startedAt });
        }

        return finalResponse;
    } catch (error) {
        emit({
            phase: 'error',
            error: error?.message || String(error),
        });

        // Report failure via ActionReporter
        if (llmAction && actionReporter) {
            actionReporter.failAction(error);
        }

        if (agent._processingCallbacks?.onEnd) {
            try {
                agent._processingCallbacks.onEnd();
            } catch (callbackError) {
                // Silently ignore callback errors
            }
        }
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
        model: model || process.env.ACHILLES_MODEL_PLAN || 'plan',
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
        model: model || process.env.ACHILLES_MODEL_PLAN || 'plan',
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
    extraComplete,
    extraDoTask,
    extraDoTaskWithReview,
    extraDoTaskWithHumanReview,
};
