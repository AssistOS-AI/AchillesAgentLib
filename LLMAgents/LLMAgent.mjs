import {
    extractKeyValuePairs,
    extractIdeaList,
    classifyIntent,
    responseToJSON,
    extractJson,
} from './markdown.mjs';
import { defaultLLMInvokerStrategy, cancelRequests } from '../utils/LLMClient.mjs';
import { logLLMInteraction } from '../utils/LLMLogger.mjs';

import { LightSOPLangInterpreter } from '../lightSOPLang/interpreter.mjs';
import { STATUS_SUCCESS } from '../lightSOPLang/constants.mjs';

const DEFAULT_AGENT_NAME = 'DefaultLLMAgent';

const stripCodeFence = (value) => {
    if (typeof value === 'string') {
        return value;
    }
    if (!value || typeof value !== 'object') {
        return '';
    }
    try {
        return JSON.stringify(value, null, 2);
    } catch (error) {
        return String(value);
    }
};

const serializeContext = (context) => {
    if (typeof context === 'string') {
        return context;
    }
    if (!context || typeof context !== 'object') {
        return '';
    }
    try {
        return JSON.stringify(context, null, 2);
    } catch (error) {
        return String(context);
    }
};

class LLMAgent {
    constructor(options = {}) {
        const {
            name = DEFAULT_AGENT_NAME,
            invokerStrategy = null,
        } = options;

        if (!name || typeof name !== 'string') {
            throw new Error('LLMAgent requires a non-empty name.');
        }

        const resolvedStrategy = invokerStrategy || defaultLLMInvokerStrategy;
        if (typeof resolvedStrategy !== 'function') {
            throw new Error(`LLMAgent "${name}" requires an invokerStrategy function.`);
        }

        this.name = name;
        this.invokerStrategy = resolvedStrategy;
        this._debugEnabled = false;
        this._debugLogger = null;
        this._debugCounter = 0;
    }

    parseMarkdownKeyValues(markdown) {
        return extractKeyValuePairs(markdown);
    }

    parseMarkdownIdeas(markdown) {
        return extractIdeaList(markdown);
    }

    classifyMessage(message, options = {}) {
        return classifyIntent(message, options);
    }

    responseToJSON(markdown) {
        return responseToJSON(markdown);
    }

    async interpretMessage(message, { intents = ['accept', 'cancel', 'update'], instructions = null } = {}) {
        const heuristic = classifyIntent(message, { intents });
        if (heuristic.intent !== 'unknown' && (!intents.length || intents.includes(heuristic.intent))) {
            const hasMeaningfulUpdates = heuristic.updates && Object.keys(heuristic.updates).length;
            if (heuristic.intent !== 'update' || hasMeaningfulUpdates) {
                return heuristic;
            }
        }

        const promptSections = [
            instructions || 'Interpret the user response and summarise the intent.',
            `Expected intents: ${intents.join(', ') || 'accept, cancel, update'}.`,
            'Respond using Markdown bullet points, for example:',
            '- intent: accept|cancel|update|ideas',
            '- updates: field=value; other=value (if relevant)',
            '- ideas: item one; item two (optional)',
        ];

        const raw = await this.complete({
            prompt: promptSections.join('\n\n'),
            history: [{ role: 'user', message }],
            mode: 'fast',
            context: { intent: 'classify-message', expectedIntents: intents },
        });

        const keyValues = extractKeyValuePairs(raw);
        const ideas = extractIdeaList(raw);

        const primaryIntent = (keyValues.intent || keyValues.action || '').toLowerCase();
        const intent = primaryIntent && intents.includes(primaryIntent)
            ? primaryIntent
            : (ideas.length ? 'ideas' : 'unknown');

        const updatesRaw = keyValues.updates || keyValues.values;
        const updates = typeof updatesRaw === 'string'
            ? extractKeyValuePairs(updatesRaw)
            : updatesRaw || {};

        const fallbackUpdates = { ...keyValues };
        delete fallbackUpdates.intent;
        delete fallbackUpdates.action;
        delete fallbackUpdates.updates;
        delete fallbackUpdates.values;

        const mergedUpdates = { ...fallbackUpdates, ...updates };

        return {
            intent,
            confidence: intent === 'unknown' ? 0 : 0.6,
            updates: Object.keys(mergedUpdates).length ? mergedUpdates : undefined,
            ideas: ideas.length ? ideas : undefined,
            raw,
        };
    }
    
    setDebugLogger(logger) {
        this._debugLogger = typeof logger === 'function' ? logger : null;
    }

    setDebugEnabled(enabled) {
        this._debugEnabled = Boolean(enabled);
    }

    _emitDebugEvent(event) {
        if (!this._debugEnabled || typeof this._debugLogger !== 'function') {
            return;
        }
        try {
            this._debugLogger(event);
        } catch {
            // Avoid cascading failures from debug hooks
        }
    }

    _nextDebugRequestId() {
        this._debugCounter += 1;
        return `llm-${this._debugCounter}`;
    }

    getSupportedModes() {
        if (this.invokerStrategy && typeof this.invokerStrategy.getSupportedModes === 'function') {
            const modes = this.invokerStrategy.getSupportedModes();
            if (Array.isArray(modes) && modes.length) {
                return modes;
            }
        }
        return ['fast'];
    }

    async complete(options = {}) {
        const {
            prompt,
            history = [],
            mode = process.env.DEFAULT_MODEL_TYPE === 'deep' ? 'deep' : 'fast',
            model = null,
            context = {},
            ...invokerExtras
        } = options;

        if (!prompt || typeof prompt !== 'string') {
            throw new Error('complete requires a prompt string.');
        }

        const requestId = this._debugEnabled ? this._nextDebugRequestId() : null;
        const startedAt = Date.now();
        const emit = (event) => {
            if (!requestId) {
                return;
            }
            this._emitDebugEvent({
                id: requestId,
                method: 'complete',
                ...event,
            });
        };

        // Show processing indicator before LLM processing
        if (this._processingCallbacks?.onStart) {
            try {
                this._processingCallbacks.onStart();
            } catch (error) {
                // Silently ignore callback errors
            }
        }

        let responseMetadata = null;
        try {
            const conversation = Array.isArray(history) ? history.slice() : [];
            emit({
                phase: 'request',
                mode,
                model,
                prompt,
                history: conversation,
                context,
                options: invokerExtras,
            });
            const response = await this.invokerStrategy({
                prompt,
                history: conversation,
                mode,
                model,
                agent: this,
                context,
                ...invokerExtras,
            });
            
            // Hide processing indicator after LLM processing
            if (this._processingCallbacks?.onEnd) {
                try {
                    this._processingCallbacks.onEnd();
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
            const loggedModel = responseMetadata?.model
                || this.invokerStrategy?.getLastInvocationDetails?.()?.model
                || model
                || 'auto';
            const loggedMode = responseMetadata?.mode || mode;
            logLLMInteraction({
                prompt,
                response: finalResponse,
                model: loggedModel,
                mode: loggedMode,
                durationMs: Date.now() - startedAt,
            });
            return finalResponse;
        } catch (error) {
            emit({
                phase: 'error',
                error: error?.message || String(error),
            });
            // Hide processing indicator on error
            if (this._processingCallbacks?.onEnd) {
                try {
                    this._processingCallbacks.onEnd();
                } catch (callbackError) {
                    // Silently ignore callback errors
                }
            }
            const lastInvocation = this.invokerStrategy?.getLastInvocationDetails?.() || null;
            const loggedModel = lastInvocation?.model || responseMetadata?.model || model || 'auto';
            const loggedMode = lastInvocation?.mode || responseMetadata?.mode || mode;
            logLLMInteraction({
                prompt,
                response: error?.message || '',
                model: loggedModel,
                mode: loggedMode,
                durationMs: Date.now() - startedAt,
            });
            throw error;
        }
    }

    cancel() {
        try {
            cancelRequests();
        } catch {
            // ignore cancellation failures
        }
        if (this._processingCallbacks?.onEnd) {
            try {
                this._processingCallbacks.onEnd();
            } catch {
                // ignore callback errors
            }
        }
    }

    async executePrompt(promptText, options = {}) {
        if (!promptText || typeof promptText !== 'string') {
            throw new Error('executePrompt requires a promptText string.');
        }

        const {
            mode = 'fast',
            model = null,
            responseShape = null,
            globalMemory = null,
            userMemory = null,
            sessionMemory = null,
            skillShortMemory = null,
            ...rest
        } = options || {};

        const segments = [];
        const pushSegment = (label, value) => {
            if (value === null || value === undefined) {
                return;
            }
            try {
                const rendered = typeof value === 'string' ? value : value.toString();
                if (rendered && rendered.trim()) {
                    segments.push(`${label}:\n${rendered.trim()}`);
                }
            } catch (error) {
                // ignore serialization issues
            }
        };

        pushSegment('Global Memory', globalMemory);
        pushSegment('User Memory', userMemory);
        pushSegment('Session Memory', sessionMemory);
        pushSegment('Skill Memory', skillShortMemory);

        const combinedContext = segments.length
            ? `${segments.join('\n\n')}\n\nPrompt:\n${promptText}`
            : promptText;

        const result = await this.doTask(combinedContext, promptText, {
            mode,
            model,
            ...rest,
        });

        if (!responseShape) {
            return result;
        }

        if (responseShape === 'json') {
            const parsed = extractJson(result);
            if (parsed === null) {
                throw new Error(`Expected JSON response but parsing failed. Raw: ${String(result).slice(0, 200)}…`);
            }
            return parsed;
        }

        if (responseShape === 'code') {
            return stripCodeFence(result);
        }

        if (responseShape === 'json-code') {
            try {
                const payload = JSON.parse(result);
                if (!payload || typeof payload !== 'object' || typeof payload.code !== 'string') {
                    throw new Error('missing "code" property');
                }
                payload.code = payload.code.trim();
                return payload;
            } catch (error) {
                throw new Error(`Expected JSON with code, but parsing failed: ${error.message}. Raw: ${String(result).slice(0, 200)}…`);
            }
        }

        return result;
    }

    async doTask(agentContext, description, options = {}) {
        const {
            mode = 'fast',
            model = null,
            outputSchema = null,
            ...rest
        } = options;

        if (!description || typeof description !== 'string') {
            throw new Error('doTask requires a task description string.');
        }
        const prompt = [
            'Agent context:',
            serializeContext(agentContext),
            'Task description:',
            description,
            outputSchema ? `Use the following output schema:\n${JSON.stringify(outputSchema, null, 2)}` : '',
            'Response:',
        ].filter(Boolean).join('\n\n');

        return this.complete({
            prompt,
            mode,
            model,
            context: { intent: 'task-execution' },
            ...rest,
        });
    }

    async doTaskWithReview(agentContext, description, options = {}) {
        const {
            mode = 'deep',
            maxIterations = 3,
            model = null,
            ...rest
        } = options;

        const prompt = [
            'Agent context:',
            serializeContext(agentContext),
            'Task description:',
            description,
            `Create a plan with at most ${maxIterations} steps and provide a reviewed answer.`, 
            'Response:',
        ].filter(Boolean).join('\n\n');

        return this.complete({
            prompt,
            mode,
            model,
            context: { intent: 'task-review', maxIterations },
            ...rest,
        });
    }

    async doTaskWithHumanReview(agentContext, description, options = {}) {
        const draft = await this.doTask(agentContext, description, options);
        return {
            draft,
            humanReviewRequired: true,
        };
    }

    async createSOPLangPlan(skillsDescription, userPrompt, options = {}) {
        const {
            mode = 'deep',
            model = null,
            useInterpreter = false,
            ...rest
        } = options;

        // Use the interpreter to generate code from english
        const commandsRegistry = {
            executeCommand: async () => ({ status: 'success', data: 'dummy' }),
            listCommands: () => Object.entries(skillsDescription).map(([name, desc]) => ({
                name,
                description: desc,
            })),
        };

        const englishPrompt = `#!english\n${userPrompt}`;
        const interpreter = new LightSOPLangInterpreter(englishPrompt, commandsRegistry, {
            llmAgent: this,
            generateOnly: true,
            ...rest,
        });

        await interpreter.ready;
        return interpreter.currentSourceCode;
    }

    async detectIntents(skillsDescription, userPrompt, options = {}) {
        const {
            mode = 'fast',
            model = null,
            ...rest
        } = options;

        const prompt = `You are an expert agent with deep understanding of IT, software development, GAMP, software architectures, and user experience.
Your task is to map a user's natural language prompt to a set of available software engineering skills (tools).

Available Skills:
${JSON.stringify(skillsDescription, null, 2)}

User Prompt:
"${userPrompt}"

Instructions:
1. Analyze the user prompt to identify distinct actions or intents.
   - Do NOT separate intents like "Modify this AND clarify that" if they are about the same subject; merge the clarification or context into the primary skill (e.g., 'modifyRequirement').
   - Only extract multiple intents for the same subject if they represent fundamentally different operations (e.g., 'addRequirement' vs 'prioritizeRequirement').
   - If a user requests a requirement change AND specifies a priority (e.g., "This is critical"), generate TWO separate skills: one for the change and one for 'prioritizeRequirement'.
   - For 'linkRequirements', if multiple links are requested, describe ALL of them in the parameter.
   - For 'generateTestCases', if the user asks for tests to be generated, always map this intent.
   - Ensure the subject/parameter for each skill is always clear, self-contained, and well-defined.

   Example of splitting intents:
   - Input: "Add a new NFS for encryption. This is critical."
     Output: { "addRequirement": "...", "prioritizeRequirement": "set priority to Critical..." }

2. Map each identified intent to one of the available skills.

3. Extract the specific parameters or description for the skill from the prompt. 
   CRITICAL: The parameter description must be SELF-CONTAINED. It should include all relevant details from the user prompt so the skill can be executed without further context.
   - for example when the use is prioritizing and saying very high priority do not simply to simple say " high priority"
   
4. Output a JSON object where:
   - Keys are the names of the matched skills.
   - Values are the self-contained descriptions/parameters for that skill.

Example Output:
{
  "addRequirement": "add a new URS for the user profile page stating 'The user must be able to upload a profile picture not exceeding 5MB.'",
  "prioritizeRequirement": "set priority to High for the new URS regarding user profile picture upload size limit."
}

Respond ONLY with the JSON object.`;

        const result = await this.complete({
            prompt,
            mode,
            model,
            context: { intent: 'detect-intents' },
            ...rest,
        });

        const parsed = extractJson(result);
        if (parsed === null) {
             // Fallback if direct JSON extraction fails, though complete() usually handles this well if prompted correctly.
             // For now, we rely on extractJson which handles code fences etc.
             throw new Error(`Failed to parse JSON from LLM response: ${result}`);
        }
        return parsed;
    }

    async planAndExecute(tools, prompt, options = {}) {
        if (!tools || typeof tools !== 'object') {
            throw new Error('planAndExecute requires a tools object.');
        }
        if (!prompt || typeof prompt !== 'string') {
            throw new Error('planAndExecute requires a prompt string.');
        }

        const {
            onPlanGenerated = null,
            mode = 'fast',
            model = null,
            ...rest
        } = options;

        // Create commands registry from tools
        const commandsRegistry = {
            executeCommand: async (payload) => {
                const { command, args } = payload;
                const tool = tools[command];
                if (!tool || typeof tool.handler !== 'function') {
                    return {
                        status: STATUS_FAIL,
                        data: `Unknown command: ${command}`,
                        raw: `Unknown command: ${command}`,
                    };
                }
                try {
                    const result = await tool.handler(...args);
                    return {
                        status: STATUS_SUCCESS,
                        data: result,
                        raw: String(result),
                    };
                } catch (error) {
                    return {
                        status: STATUS_FAIL,
                        data: error.message || String(error),
                        raw: error.message || String(error),
                    };
                }
            },
            listCommands: () => {
                return Object.entries(tools).map(([name, tool]) => ({
                    name,
                    description: tool.description || '',
                }));
            },
        };

        // Create interpreter with english prompt
        const englishPrompt = `#!english\n${prompt}`;
        const interpreter = new LightSOPLangInterpreter(englishPrompt, commandsRegistry, {
            llmAgent: this,
            onPlanGenerated,
            ...rest,
        });

        // Wait for execution to complete
        await interpreter.ready;

        // Collect final variables
        const variables = {};
        for (const [name] of interpreter.variables) {
            variables[name] = interpreter.getVarValue(name);
        }

        return variables;
    }
}

export {
    LLMAgent,
    DEFAULT_AGENT_NAME,
};