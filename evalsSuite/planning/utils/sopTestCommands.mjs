import { PERFORMANCE_TOOLS } from '../../tools/allTools.mjs';
import {
    RETURN_RESPONSE_TOOL,
    RETURN_RESPONSE_DESCRIPTION,
} from '../../../LLMAgents/constants.mjs';

/**
 * Build a commands registry for SOP execution tests.
 *
 * @param {LLMAgent} agent
 * @param {Object} toolsConfiguration Tool descriptions defined in the case file.
 * @returns {{executeCommand: Function, listCommands: Function}}
 */
function createPlanningCommandsRegistry(agent, toolsConfiguration = {}) {
    if (agent) {
        if (agent.__toolState instanceof Map) {
            agent.__toolState.clear();
        } else {
            agent.__toolState = new Map();
        }
    }
    if (Object.prototype.hasOwnProperty.call(toolsConfiguration, RETURN_RESPONSE_TOOL)) {
        throw new Error(`Tool name "${RETURN_RESPONSE_TOOL}" is reserved by the agent runtime.`);
    }
    const requestedTools = Object.keys(toolsConfiguration || {});
    const mergedNames = requestedTools.concat(RETURN_RESPONSE_TOOL);
    const availableEntries = mergedNames.map((name) => {
        if (name === RETURN_RESPONSE_TOOL) {
            return [name, { description: RETURN_RESPONSE_DESCRIPTION }];
        }
        const spec = PERFORMANCE_TOOLS[name];
        if (!spec) {
            throw new Error(`Unknown tool "${name}" referenced in planning test configuration.`);
        }
        return [name, spec];
    });

    const commandMap = availableEntries.reduce((acc, [name, spec]) => {
        acc[name] = spec;
        return acc;
    }, {});

    return {
        async executeCommand(payload, response) {
            const { command, args } = payload;
            if (command === RETURN_RESPONSE_TOOL) {
                const text = normalizeResponsePayload(args?.[0] ?? '');
                if (agent && agent.currentSession) {
                    agent.currentSession.lastAnswer = text;
                }
                return response.success(text);
            }
            const spec = commandMap[command];
            if (!spec) {
                return response.fail(`Unknown command: ${command}`);
            }
            try {
                const value = await spec.handler(agent, ...(args ?? []));
                return response.success(value);
            } catch (error) {
                return response.fail(error?.message || String(error));
            }
        },
        listCommands: () => availableEntries.map(([name]) => ({
            name,
            description: name === RETURN_RESPONSE_TOOL
                ? RETURN_RESPONSE_DESCRIPTION
                : toolsConfiguration?.[name] || PERFORMANCE_TOOLS[name].description || '',
        })),
    };
}

export {
    createPlanningCommandsRegistry,
};
