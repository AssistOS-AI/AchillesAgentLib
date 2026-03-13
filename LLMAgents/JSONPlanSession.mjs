import { extractJson } from './markdown.mjs';
import { buildJSONPlanInstructions } from './templates/jsonPlanPrompts.mjs';
import { appendAgenticLog } from '../utils/AgenticSessionLogger.mjs';
import {
    FINAL_ANSWER_TOOL,
    FINAL_ANSWER_DESCRIPTION,
    CANNOT_COMPLETE_TOOL,
    CANNOT_COMPLETE_DESCRIPTION,
    SESSION_STATUS_IDLE,
    SESSION_STATUS_RUNNING,
    SESSION_STATUS_ACTIVE,
    SESSION_STATUS_AWAITING_INPUT,
    SESSION_STATUS_DONE,
    SESSION_STATUS_FAILED,
    normalizeResponsePayload,
} from './constants.mjs';

const DEBUG_ENABLED = String(process.env.ACHILLES_DEBUG ?? '').toLowerCase() === 'true';
const SESSION_LOG_TRIM_LIMIT = 400;

function debugLog(...args) {
    if (DEBUG_ENABLED) console.log(...args);
}

async function logJsonPlanEvent(label, content, trimLimit = SESSION_LOG_TRIM_LIMIT) {
    await appendAgenticLog({
        sessionType: 'JSONPlanSession',
        label,
        content,
        trimLimit,
    });
}

function formatLogValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
}

function coerceResultToText(result) {
    if (result == null) return '';
    if (typeof result === 'string') return result;
    if (typeof result === 'object') {
        if (typeof result.text === 'string') return result.text;
        if (typeof result.output === 'string') return result.output;
        if (typeof result.result === 'string') return result.result;
        try { return JSON.stringify(result); } catch { return String(result); }
    }
    return String(result);
}

function isInteractiveToolResult(value) {
    if (!value || typeof value !== 'object') return false;
    return Boolean(value.requiresInput || value.requiresConfirmation);
}

function getPendingToolFromHistory(history = []) {
    for (let i = history.length - 1; i >= 0; i -= 1) {
        const entry = history[i];
        if (entry?.type === 'awaiting_input' && typeof entry.tool === 'string' && entry.tool.trim()) {
            return entry.tool.trim();
        }
        if (entry?.type === 'final_answer' || entry?.type === 'cannot_complete') break;
    }
    return null;
}

function isLikelyFreshInstruction(prompt = '') {
    const text = String(prompt || '').trim();
    if (!text) return false;
    return /^(list|show|display|view|get|find|search|add|create|new|update|edit|change|delete|remove|import|wipe|help|exit|quit|start|stop)\b/i.test(text);
}

class JSONPlanSession {
    constructor({ agent, skillsDescription, options = {} }) {
        if (!agent) throw new Error('JSONPlanSession requires an LLMAgent instance.');
        if (!skillsDescription || typeof skillsDescription !== 'object') {
            throw new Error('JSONPlanSession requires a skillsDescription object.');
        }
        [FINAL_ANSWER_TOOL, CANNOT_COMPLETE_TOOL].forEach((reserved) => {
            if (Object.prototype.hasOwnProperty.call(skillsDescription, reserved)) {
                throw new Error(`Tool name "${reserved}" is reserved by the agent runtime.`);
            }
        });

        if (agent.__toolState instanceof Map) {
            agent.__toolState.clear();
        } else {
            agent.__toolState = new Map();
        }

        this.agent = agent;
        this._userSkillsDescription = { ...skillsDescription };
        this.skillsDescription = {
            ...skillsDescription,
            [FINAL_ANSWER_TOOL]: FINAL_ANSWER_DESCRIPTION,
            [CANNOT_COMPLETE_TOOL]: CANNOT_COMPLETE_DESCRIPTION,
        };
        this.options = {
            ...options,
            mode: options.mode || 'plan',
            model: options.model || null,
        };
        this._unwrappedCommandsRegistry = options.commandsRegistry || null;
        this.commandsRegistry = options.commandsRegistry && typeof options.commandsRegistry === 'object'
            ? this._wrapExecutionRegistry(options.commandsRegistry)
            : null;
        this.systemPrompt = typeof options.systemPrompt === 'string' ? options.systemPrompt : '';

        this.history = [];
        this.currentPlan = null;
        this.lastExecution = null;
        this._lastFinalAnswer = null;
        this.maxPlanAttempts = Number.isFinite(options.maxPlanAttempts) ? options.maxPlanAttempts : 3;
        this.lastRunFailures = [];
        this.pendingTool = null;
        this.status = SESSION_STATUS_IDLE;
    }

    async newPrompt(userPrompt) {
        if (!userPrompt || typeof userPrompt !== 'string') {
            throw new Error('newPrompt requires a prompt string.');
        }

        debugLog(`[JSONPlanSession] New prompt: "${userPrompt}"`);
        await logJsonPlanEvent('JSON plan session start', userPrompt, SESSION_LOG_TRIM_LIMIT);
        this.status = SESSION_STATUS_RUNNING;

        // Handle pending tool awaiting input
        const pendingTool = this.pendingTool || getPendingToolFromHistory(this.history);
        if (pendingTool) {
            const interpretation = this.agent && typeof this.agent.interpretMessage === 'function'
                ? await this.agent.interpretMessage(userPrompt, { intents: ['accept', 'cancel', 'update'] })
                : { intent: 'unknown', confidence: 0 };
            const shouldContinuePending = interpretation?.intent === 'accept'
                || interpretation?.intent === 'cancel'
                || interpretation?.intent === 'update'
                || !isLikelyFreshInstruction(userPrompt);
            if (shouldContinuePending) {
                const singleStepPlan = {
                    steps: [
                        { id: 'pendingResult', tool: pendingTool, args: [userPrompt] },
                        { id: 'lastAnswer', tool: FINAL_ANSWER_TOOL, args: ['$pendingResult'] },
                    ],
                };
                this.currentPlan = singleStepPlan;
                this.lastExecution = null;
                this.history.push({
                    prompt: userPrompt,
                    plan: singleStepPlan,
                    routeReason: 'pending_awaiting_input',
                    tool: pendingTool,
                });
                await this._executePlan(singleStepPlan.steps);
                const answer = this.getLastResult();
                return { plan: this.currentPlan, answer };
            }
        }

        // Generate-then-execute loop
        const maxAttempts = this.maxPlanAttempts > 0 ? this.maxPlanAttempts : 1;
        let attempt = 0;
        let lastFeedback = null;

        while (true) {
            const instructions = buildJSONPlanInstructions({
                skillsDescription: this.skillsDescription,
                userPrompt,
                systemPrompt: this.systemPrompt,
                currentPlan: lastFeedback ? this.currentPlan : null,
                feedback: lastFeedback,
            });

            await logJsonPlanEvent('Plan generation prompt', instructions, null);

            const raw = await this.agent.complete({
                prompt: instructions,
                mode: this.options.mode,
                model: this.options.model,
                context: { intent: 'json-plan-generation', attempt },
            });

            await logJsonPlanEvent('Plan generation response', typeof raw === 'string' ? raw : JSON.stringify(raw), null);

            const parsed = typeof raw === 'object' && raw !== null ? raw : extractJson(raw);
            const steps = this._validatePlan(parsed);

            if (!steps) {
                attempt += 1;
                if (attempt >= maxAttempts) {
                    debugLog('[JSONPlanSession] Max plan generation attempts reached.');
                    this.status = SESSION_STATUS_FAILED;
                    this.lastExecution = { variables: {}, lastAnswer: 'Failed to generate a valid JSON plan.' };
                    return { plan: null, answer: this.getLastResult() };
                }
                lastFeedback = {
                    failures: [{ variable: '__plan__', reason: 'Invalid JSON plan structure. Must have a "steps" array with {id, tool, args} objects.' }],
                    variables: {},
                };
                continue;
            }

            this.currentPlan = parsed;
            this.lastExecution = null;
            this.history.push({ prompt: userPrompt, plan: parsed });

            debugLog('[JSONPlanSession] Plan generated:', JSON.stringify(parsed, null, 2));
            await logJsonPlanEvent('Plan validated', JSON.stringify(parsed), SESSION_LOG_TRIM_LIMIT);

            if (!this.commandsRegistry) {
                // Plan-only mode
                break;
            }

            const runResult = await this._executePlan(steps);
            this.lastRunFailures = runResult.failures;

            if (!runResult.failures.length) break;

            attempt += 1;
            if (attempt >= maxAttempts) {
                debugLog('[JSONPlanSession] Max plan attempts reached after execution failures.');
                break;
            }

            lastFeedback = {
                failures: runResult.failures,
                variables: runResult.variables,
            };
            await logJsonPlanEvent('Plan retry', `attempt=${attempt + 1}, failures=${runResult.failures.length}`, SESSION_LOG_TRIM_LIMIT);
        }

        const answer = this.getLastResult();
        return { plan: this.currentPlan, answer };
    }

    getLastResult() {
        return this.lastExecution?.lastAnswer ?? null;
    }

    async getVariables() {
        return {
            lastPlan: this.currentPlan,
            lastAnswer: this.getLastResult(),
            variables: this.lastExecution?.variables || {},
            status: this.lastExecution ? 'active' : 'idle',
        };
    }

    async getPlan() {
        return this.currentPlan;
    }

    // ─── Plan Validation ────────────────────────────────────────────────

    _validatePlan(parsed) {
        if (!parsed || typeof parsed !== 'object') return null;
        const steps = parsed.steps;
        if (!Array.isArray(steps) || steps.length === 0) return null;

        const seenIds = new Set();
        for (const step of steps) {
            if (!step || typeof step !== 'object') return null;
            if (typeof step.id !== 'string' || !step.id.trim()) return null;
            if (typeof step.tool !== 'string' || !step.tool.trim()) return null;
            if (!Array.isArray(step.args)) {
                // Auto-fix: if args is a string, wrap it
                if (typeof step.args === 'string') {
                    step.args = [step.args];
                } else if (step.args === undefined || step.args === null) {
                    step.args = [];
                } else {
                    return null;
                }
            }
            if (seenIds.has(step.id)) return null; // Duplicate ID
            seenIds.add(step.id);
        }

        // Validate the last step is final_answer or cannot_complete
        const lastStep = steps[steps.length - 1];
        if (lastStep.tool !== FINAL_ANSWER_TOOL && lastStep.tool !== CANNOT_COMPLETE_TOOL) {
            // Auto-fix: append a final_answer step referencing the last step
            const lastId = lastStep.id;
            steps.push({ id: '_final', tool: FINAL_ANSWER_TOOL, args: [`$${lastId}`] });
        }

        return steps;
    }

    // ─── Plan Execution ─────────────────────────────────────────────────

    async _executePlan(steps) {
        const variables = new Map();
        const failures = [];

        await logJsonPlanEvent('Plan execution start', `${steps.length} steps`, SESSION_LOG_TRIM_LIMIT);

        for (const step of steps) {
            const { id, tool, args } = step;

            // Resolve variable references in args
            const resolvedArgs = args.map((arg) => this._resolveArg(arg, variables));

            debugLog(`[JSONPlanSession] Step "${id}": ${tool}(${resolvedArgs.map(formatLogValue).join(', ')})`);
            await logJsonPlanEvent('Step execute', `${id}: ${tool}(${resolvedArgs.map(formatLogValue).join(', ')})`, SESSION_LOG_TRIM_LIMIT);

            // Handle terminal steps
            if (tool === FINAL_ANSWER_TOOL) {
                const text = normalizeResponsePayload(resolvedArgs[0] ?? '');
                this._lastFinalAnswer = text;
                variables.set(id, text);
                this.lastExecution = {
                    variables: Object.fromEntries(variables),
                    lastAnswer: text,
                };
                this.status = SESSION_STATUS_ACTIVE;
                this.pendingTool = null;
                this.history.push({ type: 'final_answer', answer: text });
                await logJsonPlanEvent('Final answer', text, SESSION_LOG_TRIM_LIMIT);
                return { variables: Object.fromEntries(variables), failures };
            }

            if (tool === CANNOT_COMPLETE_TOOL) {
                const text = normalizeResponsePayload(resolvedArgs[0] ?? '', 'Agent cannot complete the task.');
                this._lastFinalAnswer = text;
                variables.set(id, text);
                this.lastExecution = {
                    variables: Object.fromEntries(variables),
                    lastAnswer: text,
                };
                this.status = SESSION_STATUS_FAILED;
                this.pendingTool = null;
                this.history.push({ type: 'cannot_complete', answer: text });
                await logJsonPlanEvent('Cannot complete', text, SESSION_LOG_TRIM_LIMIT);
                return { variables: Object.fromEntries(variables), failures };
            }

            // Execute the tool via commandsRegistry
            try {
                const prompt = resolvedArgs.map((v) => (v == null ? '' : String(v))).join(' ');
                const result = await this._executeCommand(tool, resolvedArgs);

                // Check for interactive results
                if (isInteractiveToolResult(result)) {
                    const message = result.message || formatLogValue(result);
                    this.pendingTool = tool;
                    this.lastExecution = {
                        variables: Object.fromEntries(variables),
                        lastAnswer: message,
                    };
                    this.status = SESSION_STATUS_AWAITING_INPUT;
                    this.history.push({ type: 'awaiting_input', tool, answer: message });
                    await logJsonPlanEvent('Awaiting input', message, SESSION_LOG_TRIM_LIMIT);
                    variables.set(id, message);
                    return { variables: Object.fromEntries(variables), failures };
                }

                const resultText = coerceResultToText(result);
                variables.set(id, resultText);
                debugLog(`[JSONPlanSession] Step "${id}" result: ${resultText.slice(0, 200)}`);
                await logJsonPlanEvent('Step result', `${id}: ${resultText}`, SESSION_LOG_TRIM_LIMIT);
            } catch (error) {
                const reason = error?.message || String(error);
                debugLog(`[JSONPlanSession] Step "${id}" failed: ${reason}`);
                await logJsonPlanEvent('Step error', `${id}: ${reason}`, SESSION_LOG_TRIM_LIMIT);
                failures.push({ variable: id, reason });
                variables.set(id, null);
            }
        }

        // If we reach here without a final_answer, derive from last variable
        const varEntries = [...variables.entries()];
        const lastValue = varEntries.length ? varEntries[varEntries.length - 1][1] : null;
        this.lastExecution = {
            variables: Object.fromEntries(variables),
            lastAnswer: this._lastFinalAnswer ?? lastValue,
        };
        this.status = SESSION_STATUS_ACTIVE;

        return { variables: Object.fromEntries(variables), failures };
    }

    // ─── Variable Resolution ────────────────────────────────────────────

    _resolveArg(arg, variables) {
        if (typeof arg !== 'string') return arg;

        // Full variable reference: "$sum"
        if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(arg)) {
            const varName = arg.slice(1);
            if (variables.has(varName)) return variables.get(varName);
            return arg;
        }

        // Inline variable references within a string
        return arg.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, varName) => {
            if (variables.has(varName)) {
                const val = variables.get(varName);
                return typeof val === 'string' ? val : JSON.stringify(val);
            }
            return match;
        });
    }

    // ─── Command Execution ──────────────────────────────────────────────

    async _executeCommand(toolName, args) {
        const payload = { command: toolName, args };

        return new Promise((resolve, reject) => {
            const responder = {
                success: (data) => resolve(data),
                fail: (error) => reject(typeof error === 'string' ? new Error(error) : error),
            };
            try {
                const result = this.commandsRegistry.executeCommand(payload, responder);
                if (result && typeof result.then === 'function') {
                    result.catch(reject);
                }
            } catch (error) {
                reject(error);
            }
        });
    }

    // ─── Registry Wrapping ──────────────────────────────────────────────

    _wrapExecutionRegistry(registry) {
        if (typeof registry.executeCommand !== 'function' || typeof registry.listCommands !== 'function') {
            throw new Error('commandsRegistry must provide executeCommand and listCommands functions.');
        }
        const executeCommand = registry.executeCommand.bind(registry);
        const listCommands = registry.listCommands.bind(registry);

        return {
            executeCommand: async (payload, responder) => {
                const commandName = payload?.command || '';
                const args = Array.isArray(payload?.args) ? payload.args : [];
                await logJsonPlanEvent('Tool call', `${commandName} | ${formatLogValue(args)}`, SESSION_LOG_TRIM_LIMIT);

                if (commandName === FINAL_ANSWER_TOOL) {
                    const text = normalizeResponsePayload(args[0] ?? '');
                    this._lastFinalAnswer = text;
                    await logJsonPlanEvent('Tool result', `${FINAL_ANSWER_TOOL} | ${text}`, SESSION_LOG_TRIM_LIMIT);
                    return responder.success(text);
                }
                if (commandName === CANNOT_COMPLETE_TOOL) {
                    const text = normalizeResponsePayload(args[0] ?? '');
                    this._lastFinalAnswer = text;
                    await logJsonPlanEvent('Tool result', `${CANNOT_COMPLETE_TOOL} | ${text}`, SESSION_LOG_TRIM_LIMIT);
                    return responder.fail(text);
                }

                const wrappedResponder = {
                    success: async (data) => {
                        await logJsonPlanEvent('Tool result', `${commandName} | ${formatLogValue(data)}`, SESSION_LOG_TRIM_LIMIT);
                        if (isInteractiveToolResult(data)) {
                            this.pendingTool = commandName;
                            this.history.push({ type: 'awaiting_input', tool: commandName, answer: formatLogValue(data) });
                        } else {
                            this.pendingTool = null;
                        }
                        return responder.success(data);
                    },
                    fail: async (error) => {
                        await logJsonPlanEvent('Tool error', `${commandName} | ${formatLogValue(error)}`, SESSION_LOG_TRIM_LIMIT);
                        if (isInteractiveToolResult(error)) {
                            this.pendingTool = commandName;
                            this.history.push({ type: 'awaiting_input', tool: commandName, answer: formatLogValue(error) });
                        } else {
                            this.pendingTool = null;
                        }
                        return responder.fail(error);
                    },
                };
                return executeCommand(payload, wrappedResponder);
            },
            listCommands: () => {
                const commands = listCommands() || [];
                const names = commands.map((cmd) => cmd?.name || cmd?.command);
                if (!names.includes(FINAL_ANSWER_TOOL)) {
                    commands.push({ name: FINAL_ANSWER_TOOL, description: FINAL_ANSWER_DESCRIPTION });
                }
                if (!names.includes(CANNOT_COMPLETE_TOOL)) {
                    commands.push({ name: CANNOT_COMPLETE_TOOL, description: CANNOT_COMPLETE_DESCRIPTION });
                }
                return commands;
            },
        };
    }
}

export { JSONPlanSession };
