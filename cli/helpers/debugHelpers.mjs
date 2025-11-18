import {
    COLOR_DEBUG,
    COLOR_DEBUG_REQUEST,
    COLOR_DEBUG_RESPONSE,
    COLOR_ERROR,
    COLOR_RESET,
} from './styles.mjs';

const DEBUG_PREFIX = 'LLM_DEBUG:';

const logEvent = (cli, event = {}) => {
    if (!cli.debugMode || !cli.output) {
        return;
    }
    const phase = event.phase || 'event';
    const id = event.id ? `#${event.id}` : '';
    const method = event.method || 'complete';
    const metadata = [];
    if (event.mode) {
        metadata.push(`mode=${event.mode}`);
    }
    if (event.model) {
        metadata.push(`model=${event.model}`);
    }
    const color = phase === 'request'
        ? COLOR_DEBUG_REQUEST
        : (phase === 'response' ? COLOR_DEBUG_RESPONSE : COLOR_DEBUG);
    const header = `${color}${DEBUG_PREFIX} ${method}${id} ${phase}${metadata.length ? ` | ${metadata.join(' ')}` : ''}${COLOR_RESET}`;
    cli.output.write(`${header}\n`);
    if (phase === 'request') {
        const history = Array.isArray(event.history) ? event.history.length : 0;
        if (history) {
            cli.output.write(`${color}${DEBUG_PREFIX} history: ${history} message(s)${COLOR_RESET}\n`);
        }
        if (event.prompt) {
            cli.output.write(`${color}${DEBUG_PREFIX} prompt:\n${event.prompt}\n${COLOR_RESET}`);
        }
    } else if (phase === 'response') {
        if (event.output) {
            cli.output.write(`${color}${DEBUG_PREFIX} response:\n${event.output}\n${COLOR_RESET}`);
        }
    } else if (phase === 'error' && event.error) {
        cli.output.write(`${COLOR_ERROR}${DEBUG_PREFIX} error: ${event.error}${COLOR_RESET}\n`);
    }
};

export const setupLLMDebugging = (cli) => {
    if (!cli.llmAgent) {
        return;
    }
    const supportsDebug = typeof cli.llmAgent?.setDebugLogger === 'function'
        && typeof cli.llmAgent?.setDebugEnabled === 'function';
    cli._llmDebugSupported = supportsDebug;
    if (supportsDebug) {
        cli.llmAgent.setDebugLogger((event) => logEvent(cli, event));
        cli.llmAgent.setDebugEnabled(cli.debugMode);
    }

    if (cli._llmCompleteWrapped || typeof cli.llmAgent?.complete !== 'function') {
        return;
    }
    const originalComplete = cli.llmAgent.complete.bind(cli.llmAgent);
    cli.llmAgent.complete = async (...args) => {
        const [optionsArg] = args;
        const promptText = optionsArg?.prompt || '';
        const modeValue = optionsArg?.mode || 'fast';
        const modelValue = optionsArg?.model || null;
        logEvent(cli, {
            method: 'complete',
            phase: 'request',
            prompt: promptText,
            mode: modeValue,
            model: modelValue,
        });
        try {
            const response = await originalComplete(...args);
            logEvent(cli, {
                method: 'complete',
                phase: 'response',
                output: typeof response === 'string' ? response : JSON.stringify(response),
            });
            return response;
        } catch (error) {
            logEvent(cli, {
                method: 'complete',
                phase: 'error',
                error: error?.message || String(error),
            });
            throw error;
        }
    };
    cli._llmCompleteWrapped = true;
};

export default {
    setupLLMDebugging,
};
