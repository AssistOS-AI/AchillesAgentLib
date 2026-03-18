import { buildMDPlanInstructions } from './templates/mdPlanPrompts.mjs';
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
    SESSION_STATUS_FAILED,
    normalizeResponsePayload,
} from './constants.mjs';

const DEBUG_ENABLED = String(process.env.ACHILLES_DEBUG ?? '').toLowerCase() === 'true';
const SESSION_LOG_TRIM_LIMIT = 400;

function debugLog(...args) {
    if (DEBUG_ENABLED) console.log(...args);
}

async function logMdPlanEvent(label, content, trimLimit = SESSION_LOG_TRIM_LIMIT) {
    await appendAgenticLog({ sessionType: 'MDPlanSession', label, content, trimLimit });
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

// ─── Markdown Plan Parser ───────────────────────────────────────────────

// Matches: N. varName = toolName(args...)
// Also handles: - varName = toolName(args...)  or  varName = toolName(args...)
// Tool names may contain hyphens (e.g., pdf-lite, docx-lite)
const STEP_REGEX = /^(?:\d+[.)]\s*|-\s*)?(\w+)\s*=\s*([\w-]+)\((.*)?\)\s*$/;

function parseArgs(argsStr) {
    if (!argsStr || !argsStr.trim()) return [];
    const args = [];
    let current = '';
    let inQuotes = false;
    let depth = 0;

    for (let i = 0; i < argsStr.length; i += 1) {
        const ch = argsStr[i];
        if (ch === '"' && argsStr[i - 1] !== '\\') {
            inQuotes = !inQuotes;
            continue;
        }
        if (!inQuotes) {
            if (ch === '(') { depth += 1; current += ch; continue; }
            if (ch === ')') { depth -= 1; current += ch; continue; }
            if (ch === ',' && depth === 0) {
                args.push(current.trim());
                current = '';
                continue;
            }
        }
        current += ch;
    }
    if (current.trim()) args.push(current.trim());
    return args;
}

function parseMDPlan(text) {
    if (typeof text !== 'string') return null;

    // Strip markdown code fences if present
    let cleaned = text.trim();
    const fenceMatch = cleaned.match(/^```[\w-]*\n?([\s\S]*?)```\s*$/);
    if (fenceMatch) cleaned = fenceMatch[1].trim();

    const lines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return null;

    const steps = [];
    const seenIds = new Set();

    for (const line of lines) {
        // Skip comment lines
        if (line.startsWith('#') || line.startsWith('//')) continue;

        const match = line.match(STEP_REGEX);
        if (!match) continue;

        const [, id, tool, argsRaw] = match;
        if (seenIds.has(id)) return null; // Duplicate ID
        seenIds.add(id);

        steps.push({ id, tool, args: parseArgs(argsRaw || '') });
    }

    if (!steps.length) return null;

    // Auto-fix: if last step isn't final_answer/cannot_complete, append one
    const lastStep = steps[steps.length - 1];
    if (lastStep.tool !== FINAL_ANSWER_TOOL && lastStep.tool !== CANNOT_COMPLETE_TOOL) {
        steps.push({ id: '_final', tool: FINAL_ANSWER_TOOL, args: [`$${lastStep.id}`] });
    }

    return steps;
}

// ─── Session Class ──────────────────────────────────────────────────────

class MDPlanSession {
    constructor({ agent, skillsDescription, options = {} }) {
        if (!agent) throw new Error('MDPlanSession requires an LLMAgent instance.');
        if (!skillsDescription || typeof skillsDescription !== 'object') {
            throw new Error('MDPlanSession requires a skillsDescription object.');
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
        this._metrics = { planTimeMs: 0, execTimeMs: 0, planAttempts: 0 };
    }

    async newPrompt(userPrompt) {
        if (!userPrompt || typeof userPrompt !== 'string') {
            throw new Error('newPrompt requires a prompt string.');
        }

        debugLog(`[MDPlanSession] New prompt: "${userPrompt}"`);
        await logMdPlanEvent('MD plan session start', userPrompt, SESSION_LOG_TRIM_LIMIT);
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
                const steps = [
                    { id: 'pendingResult', tool: pendingTool, args: [userPrompt] },
                    { id: 'lastAnswer', tool: FINAL_ANSWER_TOOL, args: ['$pendingResult'] },
                ];
                this.currentPlan = steps;
                this.lastExecution = null;
                this.history.push({ prompt: userPrompt, plan: steps, routeReason: 'pending_awaiting_input', tool: pendingTool });
                await this._executePlan(steps);
                return { plan: this.currentPlan, answer: this.getLastResult() };
            }
        }

        // Generate-then-execute loop
        const maxAttempts = this.maxPlanAttempts > 0 ? this.maxPlanAttempts : 1;
        let attempt = 0;
        let lastFeedback = null;

        while (true) {
            const instructions = buildMDPlanInstructions({
                skillsDescription: this.skillsDescription,
                userPrompt,
                systemPrompt: this.systemPrompt,
                feedback: lastFeedback,
            });

            await logMdPlanEvent('Plan generation prompt', instructions, null);

            const _planCallStart = Date.now();
            const raw = await this.agent.complete({
                prompt: instructions,
                mode: this.options.mode,
                model: this.options.model,
                context: { intent: 'md-plan-generation', attempt },
            });
            this._metrics.planTimeMs += Date.now() - _planCallStart;
            this._metrics.planAttempts += 1;

            await logMdPlanEvent('Plan generation response', typeof raw === 'string' ? raw : String(raw), null);

            const steps = parseMDPlan(typeof raw === 'string' ? raw : String(raw));

            if (!steps) {
                attempt += 1;
                if (attempt >= maxAttempts) {
                    debugLog('[MDPlanSession] Max plan generation attempts reached.');
                    this.status = SESSION_STATUS_FAILED;
                    this.lastExecution = { variables: {}, lastAnswer: 'Failed to generate a valid markdown plan.' };
                    return { plan: null, answer: this.getLastResult() };
                }
                lastFeedback = {
                    failures: [{ variable: '__plan__', reason: 'Could not parse plan. Use format: N. variable = tool(arg1, arg2)' }],
                    variables: {},
                };
                continue;
            }

            this.currentPlan = steps;
            this.lastExecution = null;
            this.history.push({ prompt: userPrompt, plan: steps });

            debugLog('[MDPlanSession] Plan parsed:', steps.map((s) => `${s.id} = ${s.tool}(${s.args.join(', ')})`).join(' -> '));
            await logMdPlanEvent('Plan validated', steps.map((s) => `${s.id}=${s.tool}(${s.args.join(',')})`).join('; '), SESSION_LOG_TRIM_LIMIT);

            if (!this.commandsRegistry) break;

            const _execStart = Date.now();
            const runResult = await this._executePlan(steps);
            this._metrics.execTimeMs += Date.now() - _execStart;
            this.lastRunFailures = runResult.failures;

            if (!runResult.failures.length) break;

            attempt += 1;
            if (attempt >= maxAttempts) {
                debugLog('[MDPlanSession] Max plan attempts reached after execution failures.');
                break;
            }

            lastFeedback = { failures: runResult.failures, variables: runResult.variables };
            await logMdPlanEvent('Plan retry', `attempt=${attempt + 1}, failures=${runResult.failures.length}`, SESSION_LOG_TRIM_LIMIT);
        }

        return { plan: this.currentPlan, answer: this.getLastResult() };
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

    // ─── Plan Execution ─────────────────────────────────────────────────

    async _executePlan(steps) {
        const variables = new Map();
        const failures = [];

        await logMdPlanEvent('Plan execution start', `${steps.length} steps`, SESSION_LOG_TRIM_LIMIT);

        for (const step of steps) {
            const { id, tool, args } = step;
            const resolvedArgs = args.map((arg) => this._resolveArg(arg, variables));

            debugLog(`[MDPlanSession] Step "${id}": ${tool}(${resolvedArgs.map(formatLogValue).join(', ')})`);
            await logMdPlanEvent('Step execute', `${id}: ${tool}(${resolvedArgs.map(formatLogValue).join(', ')})`, SESSION_LOG_TRIM_LIMIT);

            if (tool === FINAL_ANSWER_TOOL) {
                const text = normalizeResponsePayload(resolvedArgs[0] ?? '');
                this._lastFinalAnswer = text;
                variables.set(id, text);
                this.lastExecution = { variables: Object.fromEntries(variables), lastAnswer: text };
                this.status = SESSION_STATUS_ACTIVE;
                this.pendingTool = null;
                this.history.push({ type: 'final_answer', answer: text });
                await logMdPlanEvent('Final answer', text, SESSION_LOG_TRIM_LIMIT);
                return { variables: Object.fromEntries(variables), failures };
            }

            if (tool === CANNOT_COMPLETE_TOOL) {
                const text = normalizeResponsePayload(resolvedArgs[0] ?? '', 'Agent cannot complete the task.');
                this._lastFinalAnswer = text;
                variables.set(id, text);
                this.lastExecution = { variables: Object.fromEntries(variables), lastAnswer: text };
                this.status = SESSION_STATUS_FAILED;
                this.pendingTool = null;
                this.history.push({ type: 'cannot_complete', answer: text });
                await logMdPlanEvent('Cannot complete', text, SESSION_LOG_TRIM_LIMIT);
                return { variables: Object.fromEntries(variables), failures };
            }

            try {
                const result = await this._executeCommand(tool, resolvedArgs);

                if (isInteractiveToolResult(result)) {
                    const message = result.message || formatLogValue(result);
                    this.pendingTool = tool;
                    this.lastExecution = { variables: Object.fromEntries(variables), lastAnswer: message };
                    this.status = SESSION_STATUS_AWAITING_INPUT;
                    this.history.push({ type: 'awaiting_input', tool, answer: message });
                    await logMdPlanEvent('Awaiting input', message, SESSION_LOG_TRIM_LIMIT);
                    variables.set(id, message);
                    return { variables: Object.fromEntries(variables), failures };
                }

                const resultText = coerceResultToText(result);
                variables.set(id, resultText);
                debugLog(`[MDPlanSession] Step "${id}" result: ${resultText.slice(0, 200)}`);
                await logMdPlanEvent('Step result', `${id}: ${resultText}`, SESSION_LOG_TRIM_LIMIT);
            } catch (error) {
                const reason = error?.message || String(error);
                debugLog(`[MDPlanSession] Step "${id}" failed: ${reason}`);
                await logMdPlanEvent('Step error', `${id}: ${reason}`, SESSION_LOG_TRIM_LIMIT);
                failures.push({ variable: id, reason });
                variables.set(id, null);
            }
        }

        const varEntries = [...variables.entries()];
        const lastValue = varEntries.length ? varEntries[varEntries.length - 1][1] : null;
        this.lastExecution = { variables: Object.fromEntries(variables), lastAnswer: this._lastFinalAnswer ?? lastValue };
        this.status = SESSION_STATUS_ACTIVE;
        return { variables: Object.fromEntries(variables), failures };
    }

    // ─── Variable Resolution ────────────────────────────────────────────

    _resolveArg(arg, variables) {
        if (typeof arg !== 'string') return arg;
        if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(arg)) {
            const varName = arg.slice(1);
            if (variables.has(varName)) return variables.get(varName);
            return arg;
        }
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
                if (result && typeof result.then === 'function') result.catch(reject);
            } catch (error) { reject(error); }
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
                await logMdPlanEvent('Tool call', `${commandName} | ${formatLogValue(args)}`, SESSION_LOG_TRIM_LIMIT);

                if (commandName === FINAL_ANSWER_TOOL) {
                    const text = normalizeResponsePayload(args[0] ?? '');
                    this._lastFinalAnswer = text;
                    await logMdPlanEvent('Tool result', `${FINAL_ANSWER_TOOL} | ${text}`, SESSION_LOG_TRIM_LIMIT);
                    return responder.success(text);
                }
                if (commandName === CANNOT_COMPLETE_TOOL) {
                    const text = normalizeResponsePayload(args[0] ?? '');
                    this._lastFinalAnswer = text;
                    await logMdPlanEvent('Tool result', `${CANNOT_COMPLETE_TOOL} | ${text}`, SESSION_LOG_TRIM_LIMIT);
                    return responder.fail(text);
                }

                const wrappedResponder = {
                    success: async (data) => {
                        await logMdPlanEvent('Tool result', `${commandName} | ${formatLogValue(data)}`, SESSION_LOG_TRIM_LIMIT);
                        if (isInteractiveToolResult(data)) {
                            this.pendingTool = commandName;
                            this.history.push({ type: 'awaiting_input', tool: commandName, answer: formatLogValue(data) });
                        } else {
                            this.pendingTool = null;
                        }
                        return responder.success(data);
                    },
                    fail: async (error) => {
                        await logMdPlanEvent('Tool error', `${commandName} | ${formatLogValue(error)}`, SESSION_LOG_TRIM_LIMIT);
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

export { MDPlanSession, parseMDPlan };
