import { createExecutionContext } from './context.mjs';
import { interactiveMainLoop } from './interactiveMainLoop.mjs';

export async function runInteractiveSkill({
    skill,
    action,
    providedArgs = {},
    llmAgent = null,
    readUserPrompt,
    taskDescription = '',
    securityContext = null,
    contextManager = null,
} = {}) {
    if (!skill || typeof skill !== 'object') {
        throw new Error('runInteractiveSkill requires a skill definition.');
    }
    if (typeof action !== 'function') {
        throw new Error('runInteractiveSkill requires an executable action.');
    }
    if (typeof readUserPrompt !== 'function') {
        throw new Error('runInteractiveSkill requires a readUserPrompt function.');
    }

    const context = await createExecutionContext({
        skill,
        action,
        providedArgs,
        llmAgent,
        securityContext,
    });

    const finalArgs = await interactiveMainLoop(context, {
        readUserPrompt,
        taskDescription,
    });

    const argumentDefinitions = context.argumentDefinitions;
    const requiredArguments = context.requiredArguments;

    const orderedNames = argumentDefinitions.length
        ? argumentDefinitions.map((def) => def.name)
        : requiredArguments.slice();

    // Pass llmAgent to action so skills can use LLM capabilities
    const executionOptions = { contextManager, llmAgent };

    if (!orderedNames.length) {
        return action({ ...finalArgs }, executionOptions);
    }

    const positionalValues = orderedNames.map((name) => finalArgs[name]);
    const wantsPositional = action.length > 1 && orderedNames.length === action.length;

    if (wantsPositional) {
        return action(...positionalValues, executionOptions);
    }

    return action({ ...finalArgs }, executionOptions);
}

export default {
    runInteractiveSkill,
};
