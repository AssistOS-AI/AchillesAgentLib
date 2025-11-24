import { PERFORMANCE_TOOLS } from '../../tools/allTools.mjs';
import {
    FINAL_ANSWER_TOOL,
    FINAL_ANSWER_DESCRIPTION,
    CANNOT_COMPLETE_TOOL,
    CANNOT_COMPLETE_DESCRIPTION,
    normalizeResponsePayload,
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
    [FINAL_ANSWER_TOOL, CANNOT_COMPLETE_TOOL].forEach((reserved) => {
        if (Object.prototype.hasOwnProperty.call(toolsConfiguration, reserved)) {
            throw new Error(`Tool name "${reserved}" is reserved by the agent runtime.`);
        }
    });
    const requestedTools = Object.keys(toolsConfiguration || {});
    const mergedNames = requestedTools.concat([FINAL_ANSWER_TOOL, CANNOT_COMPLETE_TOOL]);
    const availableEntries = mergedNames.map((name) => {
        if (name === FINAL_ANSWER_TOOL) {
            return [name, { description: FINAL_ANSWER_DESCRIPTION }];
        }
        if (name === CANNOT_COMPLETE_TOOL) {
            return [name, { description: CANNOT_COMPLETE_DESCRIPTION }];
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
            if (command === FINAL_ANSWER_TOOL) {
                const text = normalizeResponsePayload(args?.[0] ?? '');
                if (agent && agent.currentSession) {
                    agent.currentSession.lastAnswer = text;
                }
                return response.success(text);
            }
            if (command === CANNOT_COMPLETE_TOOL) {
                const text = normalizeResponsePayload(args?.[0] ?? '');
                if (agent && agent.currentSession) {
                    agent.currentSession.lastAnswer = text;
                }
                return response.fail(text);
            }
            const spec = commandMap[command];
            if (!spec) {
                return response.fail(`Unknown command: ${command}`);
            }
            const prompt = Array.isArray(args)
                ? args.map((v) => (v === null || v === undefined ? '' : String(v))).join(' ')
                : (args === null || args === undefined ? '' : String(args));
            try {
                const value = await spec.handler(agent, prompt);
                return response.success(value);

            } catch (error) {
                return response.fail(error?.message || String(error));
            }
        },
        listCommands: () => availableEntries.map(([name]) => ({
            name,
            description: name === FINAL_ANSWER_TOOL
                ? FINAL_ANSWER_DESCRIPTION
                : name === CANNOT_COMPLETE_TOOL
                    ? CANNOT_COMPLETE_DESCRIPTION
                : toolsConfiguration?.[name] || PERFORMANCE_TOOLS[name].description || '',
        })),
    };
}

export {
    createPlanningCommandsRegistry,
};
