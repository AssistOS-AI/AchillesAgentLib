import { randomUUID } from 'node:crypto';
import { LLMAgent } from './LLMAgent.mjs';

const OPT_OUT = new Set(['none', 'off']);
const DEFAULT_TIMEOUT_MS = 120000;

export function isOptOutModel(model) {
    return typeof model === 'string' && OPT_OUT.has(model.trim().toLowerCase());
}

export function mapMessagesToLoopInput(messages) {
    const list = Array.isArray(messages) ? messages : [];
    const systemParts = [];
    const prior = [];
    let initialPrompt = null;
    let lastUserIndex = -1;
    list.forEach((m, i) => { if (m && m.role === 'user') lastUserIndex = i; });
    list.forEach((m, i) => {
        if (!m || typeof m !== 'object') return;
        const content = typeof m.content === 'string' ? m.content : '';
        if (m.role === 'system') { systemParts.push(content); return; }
        if (i === lastUserIndex) { initialPrompt = content; return; }
        if (m.role === 'user') prior.push(`User: ${content}`);
        else if (m.role === 'assistant') prior.push(`Assistant: ${content}`);
    });
    return {
        systemPrompt: systemParts.length ? systemParts.join('\n\n') : null,
        transcript: prior.join('\n'),
        initialPrompt,
    };
}

function createTimeoutSignal(signal, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const controller = new AbortController();
    const abortFromExternal = () => controller.abort(signal?.reason || 'external-signal');
    if (signal?.aborted) {
        abortFromExternal();
        return { signal: controller.signal, cleanup: () => {} };
    }
    const timer = setTimeout(() => {
        controller.abort(`timeout:${timeoutMs}`);
    }, timeoutMs);
    if (typeof timer.unref === 'function') {
        timer.unref();
    }
    if (signal && typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', abortFromExternal, { once: true });
    }
    return {
        signal: controller.signal,
        cleanup: () => {
            clearTimeout(timer);
            if (signal && typeof signal.removeEventListener === 'function') {
                signal.removeEventListener('abort', abortFromExternal);
            }
        },
    };
}

export async function runOpenAiAgenticResponse({
    toolsMap,
    messages,
    model,
    agentId,
    logger = null,
    signal = null,
    agentFactory = (opts) => new LLMAgent(opts),
}) {
    const { systemPrompt, transcript, initialPrompt } = mapMessagesToLoopInput(messages);
    if (!initialPrompt || !initialPrompt.trim()) {
        throw new Error('runOpenAiAgenticResponse: no user message in request');
    }
    // Preserve multi-turn context by folding prior turns into the system prompt
    // (the loop API takes a single initial prompt). True history seeding is a follow-up.
    const effectiveSystem = [systemPrompt, transcript ? `Conversation so far:\n${transcript}` : '']
        .filter(Boolean).join('\n\n') || null;

    const agent = agentFactory({ name: agentId || 'DefaultLLMAgent', logger });
    const timeout = createTimeoutSignal(signal);
    let session;
    try {
        // model === undefined -> achillesAgentLib resolves the 'plan' default (-> base-local).
        session = await agent.startLoopAgentSession(toolsMap || {}, initialPrompt, {
            model: model || undefined,
            systemPrompt: effectiveSystem,
            signal: timeout.signal,
        });
    } finally {
        timeout.cleanup();
    }
    const raw = session.getLastResult();
    const content = typeof raw === 'string' ? raw : (raw == null ? '' : JSON.stringify(raw));
    return {
        id: `chatcmpl-${randomUUID()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model || 'default',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
}

export default { isOptOutModel, mapMessagesToLoopInput, runOpenAiAgenticResponse };
