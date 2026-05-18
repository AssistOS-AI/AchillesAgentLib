import { LightSOPLangInterpreter } from '../lightSOPLang/interpreter.mjs';
import { parseCode } from '../lightSOPLang/parser.mjs';
import { getDebugLogger, DEBUG_ACTIVE } from '../utils/DebugLogger.mjs';
import { buildSOPAgenticInstructions, buildPreparationPrompt } from './templates/sopAgenticSessionPrompts.mjs';
import {
    FINAL_ANSWER_TOOL,
    FINAL_ANSWER_DESCRIPTION,
    CANNOT_COMPLETE_TOOL,
    CANNOT_COMPLETE_DESCRIPTION,
    SESSION_STATUS_IDLE,
    SESSION_STATUS_RUNNING,
    SESSION_STATUS_ACTIVE,
    SESSION_STATUS_AWAITING_INPUT,
    SESSION_STATUS_INTERRUPTED,
    normalizeResponsePayload,
} from './constants.mjs';

const DEBUG_LOGGER = DEBUG_ACTIVE ? getDebugLogger() : null;


function injectContextIntoPrompt(promptText, contextLines = []) {
    if (!contextLines.length) {
        return promptText;
    }
    const block = contextLines.join('\n');
    if (!promptText) {
        return block;
    }
    return `${promptText}\n\n${block}`;
}

function debugLog(...args) {
    if (DEBUG_LOGGER) {
        DEBUG_LOGGER.log(...args);
    }
}


function coerceResultToText(result) {
    if (result == null) {
        return '';
    }
    if (typeof result === 'string') {
        return result;
    }
    if (typeof result === 'object') {
        if (typeof result.text === 'string') {
            return result.text;
        }
        if (typeof result.output === 'string') {
            return result.output;
        }
        if (typeof result.result === 'string') {
            return result.result;
        }
        try {
            return JSON.stringify(result);
        } catch (error) {
            return String(result);
        }
    }
    return String(result);
}

function formatLogValue(value) {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    try {
        return JSON.stringify(value);
    } catch (error) {
        return String(value);
    }
}


function coerceStructuredResult(value) {
    if (value == null) {
        return value;
    }
    if (typeof value === 'object') {
        return value;
    }
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }
    return value;
}

function formatInterruptionMessage(reason = 'cancelled') {
    const normalized = String(reason || 'cancelled').trim().toLowerCase();
    if (!normalized || normalized === 'cancelled') {
        return 'Interrupted by user';
    }
    if (normalized === 'esc' || normalized === 'escape' || normalized === 'external-signal' || normalized === 'user') {
        return 'Interrupted by user';
    }
    return `Interrupted: ${reason}`;
}

function isInteractiveToolResult(value) {
    const structured = coerceStructuredResult(value);
    return Boolean(structured && typeof structured === 'object' && (structured.requiresInput || structured.requiresConfirmation));
}

function getPendingToolFromHistory(history = []) {
    for (let i = history.length - 1; i >= 0; i -= 1) {
        const entry = history[i];
        if (entry?.type === 'awaiting_input' && typeof entry.tool === 'string' && entry.tool.trim()) {
            return entry.tool.trim();
        }
        if (entry?.type === 'final_answer' || entry?.type === 'cannot_complete') {
            break;
        }
    }
    return null;
}

function isLikelyFreshInstruction(prompt = '') {
    const text = String(prompt || '').trim();
    if (!text) return false;
    return /^(list|show|display|view|get|find|search|add|create|new|update|edit|change|delete|remove|import|wipe|help|exit|quit|start|stop)\b/i.test(text);
}

function encodeSopString(value = '') {
    return JSON.stringify(String(value ?? ''));
}

function buildDirectToolPlan(toolName, userPrompt) {
    return [
        `@pendingResult ${toolName} ${encodeSopString(userPrompt)}`,
        '@lastAnswer final_answer $pendingResult',
    ].join('\n');
}

function isValidSOPLang(source) {
    if (typeof source !== 'string' || !source.trim()) {
        return false;
    }
    try {
        parseCode(source);
        return true;
    } catch (error) {
        return false;
    }
}

function buildHereDocToken(content, base = 'prep-context') {
    const raw = typeof content === 'string' ? content : '';
    let token = base;
    let counter = 0;
    while (raw.includes(`--begin-${token}--`) || raw.includes(`--end-${token}--`)) {
        counter += 1;
        token = `${base}-${counter}`;
    }
    return token;
}

function wrapPreparationContext(text) {
    const token = buildHereDocToken(text);
    const lines = typeof text === 'string' && text.length ? text.split(/\r?\n/) : [];
    return [
        '@preparation_result assign',
        `--begin-${token}--`,
        ...lines,
        `--end-${token}--`,
    ];
}

function commentLines(lines) {
    return lines.map((line) => (line ? `# ${line}` : '#'));
}

function createPrepContextPrompt(prepResult) {
    const contextText = typeof prepResult?.contextText === 'string' ? prepResult.contextText : '';
    const preparationPlan = prepResult?.preparationPlan || '';
    const preparationContextLines = [];

    if (preparationPlan) {
        preparationContextLines.push(...commentLines([
            'As preparation to provide context, the following plan was executed:',
            ...preparationPlan.split(/\r?\n/),
            '',
        ]));
    }
    if (contextText) {
        if (isValidSOPLang(contextText)) {
            preparationContextLines.push(...contextText.split(/\r?\n/));
        } else {
            preparationContextLines.push(...wrapPreparationContext(contextText));
        }
    }

    return preparationContextLines;
}

async function runWithRetry(fn, retries = 1) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}

class SOPAgenticSession {
    constructor({ agent, skillsDescription, options = {} }) {
        if (!agent) {
            throw new Error('SOPAgenticSession requires an LLMAgent instance.');
        }
        if (!skillsDescription || typeof skillsDescription !== 'object') {
            throw new Error('SOPAgenticSession requires a skillsDescription object.');
        }
        [FINAL_ANSWER_TOOL, CANNOT_COMPLETE_TOOL].forEach((reserved) => {
            if (Object.prototype.hasOwnProperty.call(skillsDescription, reserved)) {
                throw new Error(`Tool name "${reserved}" is reserved by the agent runtime.`);
            }
        });

        if (agent) {
            if (agent.__toolState instanceof Map) {
                agent.__toolState.clear();
            } else {
                agent.__toolState = new Map();
            }
        }

        this.agent = agent;
        this._userSkillsDescription = { ...skillsDescription };
        this.skillsDescription = { ...skillsDescription };
        this.skillsDescription[FINAL_ANSWER_TOOL] = FINAL_ANSWER_DESCRIPTION;
        this.skillsDescription[CANNOT_COMPLETE_TOOL] = CANNOT_COMPLETE_DESCRIPTION;
        const planOnlyFlag = options.planOnly ?? options.generatePlanOnly ?? false;
        this.options = {
            ...options,
            model: options.model || null,
            tags: options.tags || null,
            planOnly: planOnlyFlag,
        };
        this.executionInterpreterOptions = options.interpreterOptions || {};
        this.planGeneratorOptions = options.planGeneratorOptions
            || options.planGenerator
            || this.executionInterpreterOptions
            || {};
        this.supervisor = options.supervisor || null;
        this._unwrappedCommandsRegistry = options.commandsRegistry || null;
        this.commandsRegistry = options.commandsRegistry && typeof options.commandsRegistry === 'object'
            ? this._wrapExecutionRegistry(options.commandsRegistry)
            : null;
        this.planCommandsRegistry = this._createPlanCommandsRegistry();
        this.systemPrompt = typeof options.systemPrompt === 'string' ? options.systemPrompt : '';
        this.baseSystemPrompt = this.systemPrompt;
        this.preparation = options.preparation || null;

        this.history = [];
        this.currentPlan = '';
        this.lastExecution = null;
        this._lastFinalAnswer = null;
        this.preparationContextText = '';
        this.maxPlanAttempts = Number.isFinite(options.maxPlanAttempts)
            ? options.maxPlanAttempts
            : 3;
        this.lastRunFailures = [];
        this.pendingTool = null;
        this.status = SESSION_STATUS_IDLE;
        this._currentAbortController = null;
        this._currentAbortSignal = null;
        this._cancelReason = null;
    }

    _isAbortError(error) {
        return Boolean(error && (
            error.name === 'AbortError'
            || error.code === 'ABORT_ERR'
            || /aborted|cancelled|canceled/i.test(error.message || '')
        ));
    }

    _createPromptAbortController(externalSignal = null) {
        const controller = new AbortController();
        this._currentAbortController = controller;
        this._currentAbortSignal = controller.signal;
        this._cancelReason = null;
        if (externalSignal && typeof externalSignal.addEventListener === 'function') {
            externalSignal.addEventListener('abort', () => {
                this.cancel('external-signal');
            }, { once: true });
        }
        return controller.signal;
    }

    _clearPromptAbortController() {
        this._currentAbortController = null;
        this._currentAbortSignal = null;
    }

    _ensureNotCancelled() {
        if (this.status !== SESSION_STATUS_INTERRUPTED) {
            return;
        }
        const error = new Error(this._cancelReason || 'Operation cancelled.');
        error.name = 'AbortError';
        throw error;
    }

    _markInterrupted(reason = 'cancelled') {
        const message = formatInterruptionMessage(reason);
        this.status = SESSION_STATUS_INTERRUPTED;
        this._cancelReason = reason;
        this.pendingTool = null;
        this.lastExecution = {
            variables: this.lastExecution?.variables || {},
            lastAnswer: message,
        };
        const lastEntry = this.history[this.history.length - 1];
        if (!(lastEntry && lastEntry.type === 'system' && lastEntry.event === SESSION_STATUS_INTERRUPTED)) {
            this.history.push({
                type: 'system',
                event: SESSION_STATUS_INTERRUPTED,
                by: 'user',
                reason,
                message,
                at: new Date().toISOString(),
            });
        }
        return message;
    }

    _getRecentInterruptions(limit = 5) {
        if (!Array.isArray(this.history) || !this.history.length) {
            return [];
        }
        const interruptions = this.history
            .filter((entry) => entry?.type === 'system' && entry?.event === SESSION_STATUS_INTERRUPTED)
            .slice(-limit)
            .map((entry) => ({
                by: entry.by || 'user',
                reason: entry.reason || null,
                message: entry.message || null,
                at: entry.at || null,
            }));
        return interruptions;
    }

    cancel(reason = 'cancelled') {
        this._markInterrupted(String(reason || 'cancelled'));
        if (this._currentAbortController) {
            this._currentAbortController.abort(this._cancelReason);
        }
    }

    static async runPreparation({
        agent,
        skillsDescription,
        commandsRegistry,
        options = {},
        preparationText,
        userPrompt,
        retries = 1,
    }) {
        const preparationPrompt = buildPreparationPrompt(preparationText, userPrompt);
        if (!preparationPrompt) {
            return { contextEntries: [], contextLines: [] };
        }

        debugLog('[SOPAgenticSession] Preparation start', {
            preparationLength: String(preparationText || '').length,
            userPromptLength: String(userPrompt || '').length,
            retries,
        });

        const attemptRun = async () => {
            const sessionOptions = {
                ...options,
                planOnly: false,
                systemPrompt: 'Plan and execute skills to prepare context for the user request.',
                commandsRegistry,
            };
            const session = new SOPAgenticSession({
                agent,
                skillsDescription,
                options: sessionOptions,
            });
            debugLog('[SOPAgenticSession] Preparation session start', {
                promptLength: String(preparationPrompt || '').length,
            });
            await session.newPrompt(preparationPrompt, { signal: options.signal || null });
            const failures = Array.isArray(session.lastRunFailures) ? session.lastRunFailures : [];
            if (failures.length) {
                debugLog('[SOPAgenticSession] Preparation session failures', {
                    failureCount: failures.length,
                });
                throw new Error('Preparation SOP plan reported failures.');
            }
            const lastResult = session.getLastResult();
            const resultText = coerceResultToText(lastResult);
            const preparationPlan = session.currentPlan || '';
            debugLog('[SOPAgenticSession] Preparation result parsed', {
                rawTextLength: String(resultText || '').length,
                contextTextLength: String(resultText || '').length,
            });
            return { contextText: resultText, rawText: resultText, preparationPlan };
        };

        return runWithRetry(attemptRun, retries);
    }
 
     async newPrompt(userPrompt, promptOptions = {}) {

        if (!userPrompt || typeof userPrompt !== 'string') {
            throw new Error('newPrompt requires a prompt string.');
        }
        if (this.status === SESSION_STATUS_INTERRUPTED) {
            this.status = SESSION_STATUS_ACTIVE;
        }
        const runSignal = promptOptions.signal || this.options.signal || null;
        this._createPromptAbortController(runSignal);
        this.status = SESSION_STATUS_RUNNING;

        let preparationContext = [];
        // Run preparation if configured
        if (this.preparation?.text) {
            const preparationSkillsDescription = this.preparation?.skillsDescription && typeof this.preparation.skillsDescription === 'object'
                ? this.preparation.skillsDescription
                : this._userSkillsDescription;
            const preparationCommandsRegistry = this.preparation?.commandsRegistry && typeof this.preparation.commandsRegistry === 'object'
                ? this.preparation.commandsRegistry
                : this._unwrappedCommandsRegistry;
            const prepResult = await SOPAgenticSession.runPreparation({
                agent: this.agent,
                skillsDescription: preparationSkillsDescription,
                commandsRegistry: preparationCommandsRegistry,
                options: {
                    model: this.options.model,
                    tags: this.options.tags,
                    signal: this._currentAbortSignal,
                    supervisor: this.supervisor,
                },
                preparationText: this.preparation.text,
                userPrompt,
                retries: this.preparation.retries ?? 1,
            });
            this.preparationContextText = typeof prepResult?.contextText === 'string'
                ? prepResult.contextText
                : '';
            preparationContext = createPrepContextPrompt(prepResult);
            this.systemPrompt = this.baseSystemPrompt;
        }

        const modeHint = this.options.planOnly ? ' plan-only' : '';
        debugLog(`[SOPAgenticSession${modeHint}] New prompt: "${userPrompt}"`);
 
        const maxAttempts = this.maxPlanAttempts > 0 ? this.maxPlanAttempts : 1;
        let attempt = 0;
        let lastFeedback = null;

        const pendingTool = this.pendingTool || getPendingToolFromHistory(this.history);
        if (pendingTool) {
            const interpretation = this.agent && typeof this.agent.interpretMessage === 'function'
                ? await this.agent.interpretMessage(userPrompt, { intents: ['accept', 'cancel', 'update'], signal: this._currentAbortSignal })
                : { intent: 'unknown', confidence: 0 };
            const shouldContinuePending = interpretation?.intent === 'accept'
                || interpretation?.intent === 'cancel'
                || interpretation?.intent === 'update'
                || !isLikelyFreshInstruction(userPrompt);
            if (shouldContinuePending) {
                this.currentPlan = buildDirectToolPlan(pendingTool, userPrompt);
                this.lastExecution = null;
                this.history.push({
                    prompt: userPrompt,
                    plan: this.currentPlan,
                    routeReason: 'pending_awaiting_input',
                    tool: pendingTool,
                });
                try {
                    const runResult = await this._runPlan(this.currentPlan);
                    this.lastRunFailures = runResult?.failures || [];
                    const answer = this.getLastResult();
                    if (this.lastExecution && answer !== this.lastExecution.lastAnswer) {
                        throw new Error('SOPAgenticSession invariant violated: getLastResult() mismatch with lastExecution.lastAnswer.');
                    }
                    this.status = this.pendingTool ? SESSION_STATUS_AWAITING_INPUT : SESSION_STATUS_ACTIVE;
                    return { plan: this.currentPlan, answer };
                } catch (error) {
                    if (this._isAbortError(error) || this.status === SESSION_STATUS_INTERRUPTED) {
                        const answer = this._markInterrupted(this._cancelReason || 'cancelled');
                        return { plan: this.currentPlan, answer };
                    }
                    throw error;
                } finally {
                    this._clearPromptAbortController();
                }
            }
        }
 
        try {
            while (true) {
                const baseInstructions = buildSOPAgenticInstructions({
                    currentPlan: this.currentPlan,
                    userPrompt,
                    systemPrompt: this.systemPrompt,
                    preparationContext,
                    interruptedEvents: this._getRecentInterruptions(),
                });
    
                const feedbackBlock = this._buildExecutionFeedbackComment(lastFeedback);
                const englishInstructions = feedbackBlock
                    ? `${baseInstructions}\n\n${feedbackBlock}`
                    : baseInstructions;
    
                this._ensureNotCancelled();
                const plan = await this._generatePlanFromEnglish(englishInstructions);
    
                this.currentPlan = plan || '';
                this.lastExecution = null;
                this.history.push({
                    prompt: userPrompt,
                    plan: this.currentPlan,
                });
    
                if (!this.commandsRegistry || this.options.planOnly) {
                    break;
                }
    
                const runResult = await this._runPlan(this.currentPlan);
                const hasFailures = runResult?.hasFailures;
                const failures = runResult?.failures || [];
                this.lastRunFailures = failures;
    
                if (!hasFailures) {
                    break;
                }
    
                if (attempt + 1 < maxAttempts) {
                }
                attempt += 1;
                if (attempt >= maxAttempts) {
                    debugLog('[SOPAgenticSession] Maximum plan attempts reached; stopping retries.');
                    break;
                }
    
                lastFeedback = {
                    failures,
                    variables: this.lastExecution?.variables || {},
                };
            }
        } catch (error) {
            if (this._isAbortError(error) || this.status === SESSION_STATUS_INTERRUPTED) {
                const answer = this._markInterrupted(this._cancelReason || 'cancelled');
                this._clearPromptAbortController();
                return { plan: this.currentPlan, answer };
            }
            this._clearPromptAbortController();
            throw error;
        }
 
        try {
            const answer = this.getLastResult();
            if (this.lastExecution && answer !== this.lastExecution.lastAnswer) {
                throw new Error('SOPAgenticSession invariant violated: getLastResult() mismatch with lastExecution.lastAnswer.');
            }
            this.status = this.pendingTool ? SESSION_STATUS_AWAITING_INPUT : SESSION_STATUS_ACTIVE;
            return { plan: this.currentPlan, answer };
        } catch (error) {
            if (this._isAbortError(error) || this.status === SESSION_STATUS_INTERRUPTED) {
                const answer = this._markInterrupted(this._cancelReason || 'cancelled');
                return { plan: this.currentPlan, answer };
            }
            throw error;
        } finally {
            this._clearPromptAbortController();
        }
     }
 
     getLastResult() {

        return this.lastExecution?.lastAnswer ?? null;
    }
 
    async getVariables() {
        return {
            lastPlan: this.currentPlan,
            lastAnswer: this.getLastResult(),
            variables: this.lastExecution?.variables || {},
            status: this.status,
        };
    }


    async getPlan() {
        return this.currentPlan;
    }


     async _runPlan(planSource) {
        const normalizedPlanSource = typeof planSource === 'string' ? planSource.trimStart() : '';
        if (!normalizedPlanSource || !normalizedPlanSource.trim()) {
            this.lastExecution = null;
            return { hasFailures: false, failures: [] };
        }
        const prepContext = typeof this.preparationContextText === 'string'
            ? this.preparationContextText.trim()
            : '';
        const planWithContext = prepContext
            ? `${prepContext}\n${normalizedPlanSource}`
            : normalizedPlanSource;
        if (planWithContext !== normalizedPlanSource) {
            debugLog('[SOPAgenticSession] Executing plan with injected context variables:');
            debugLog(planWithContext);
        }
        const baseOptions = this.executionInterpreterOptions || {};
        const originalOnFail = typeof baseOptions.onFail === 'function'
            ? baseOptions.onFail
            : null;
        const collectedFailures = [];
        const interpreterOptions = {
            ...baseOptions,
            onFail: (failures) => {
                if (Array.isArray(failures)) {
                    collectedFailures.splice(0, collectedFailures.length, ...failures);
                }
                if (originalOnFail) {
                    try {
                        originalOnFail(failures);
                    } catch (error) {
                        debugLog('[SOPAgenticSession] execution onFail handler threw:', error);
                    }
                }
            },
        };
        if (!Object.prototype.hasOwnProperty.call(interpreterOptions, 'llmAgent')) {
            interpreterOptions.llmAgent = this.agent;
        }
        if (!Object.prototype.hasOwnProperty.call(interpreterOptions, 'llmModel')) {
            interpreterOptions.llmModel = this.options.model;
        }
        if (!Object.prototype.hasOwnProperty.call(interpreterOptions, 'llmTags')) {
            interpreterOptions.llmTags = this.options.tags;
        }
        if (!Object.prototype.hasOwnProperty.call(interpreterOptions, 'llmSignal')) {
            interpreterOptions.llmSignal = this._currentAbortSignal;
        }
        this._lastFinalAnswer = null;
        let interpreter;
        try {
            interpreter = new LightSOPLangInterpreter(
                planWithContext,
                this.commandsRegistry,
                interpreterOptions,
            );
            await interpreter.ready;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            debugLog('[SOPAgenticSession] Plan execution failed:', message);
            this.lastExecution = {
                variables: {},
                lastAnswer: null,
            };
            const failures = [{
                variable: '__plan__',
                reason: `plan-error:${message}`,
            }];
            return { hasFailures: true, failures };
        }
        const variables = {};
        for (const [varName] of interpreter.variables) {
            variables[varName] = interpreter.getVarValue(varName);
        }
        const derivedLastAnswer = this._deriveLastAnswerFromVariables(variables);
        this.lastExecution = {
            variables,
            lastAnswer: this._lastFinalAnswer ?? derivedLastAnswer,
        };
        this._lastFinalAnswer = null;
        const hasFailures = collectedFailures.length > 0;
        const failures = hasFailures ? collectedFailures : [];
        this.lastRunFailures = failures;
        if (hasFailures) {
        }
        return { hasFailures, failures };
    }
 
    _deriveLastAnswerFromVariables(variables) {
        if (!variables || typeof variables !== 'object') {
            return null;
        }
        if (variables.lastAnswer !== undefined && variables.lastAnswer !== null) {
            return variables.lastAnswer;
        }
        const priorityKeys = ['result', 'final', 'answer', 'domain'];
        for (const key of priorityKeys) {
            if (Object.prototype.hasOwnProperty.call(variables, key)
                && variables[key] !== undefined
                && variables[key] !== null) {
                return variables[key];
            }
        }
        const names = Object.keys(variables);
        if (names.length === 1) {
            const soleValue = variables[names[0]];
            return soleValue !== undefined ? soleValue : null;
        }
        return null;
    }
 
    _buildExecutionFeedbackComment(feedback) {
        if (!feedback || !Array.isArray(feedback.failures)) {
            return '';
        }
        const { failures, variables } = feedback;
        if (!failures.length && (!variables || typeof variables !== 'object')) {
            return '';
        }
        const lines = [];
        lines.push('---');
        lines.push('Execution feedback from previous SOP plan:');
        if (failures.length) {
            lines.push('Failed variables:');
            failures.forEach((entry) => {
                lines.push(`- ${entry.variable}: ${entry.reason}`);
            });
        } else {
            lines.push('No failed variables were reported, but the plan did not meet expectations.');
        }
        const entries = variables && typeof variables === 'object'
            ? Object.entries(variables)
            : [];
        if (entries.length) {
            lines.push('Variable snapshot:');
            entries.forEach(([name, value]) => {
                lines.push(`- ${name}: ${String(value)}`);
            });
        }
        lines.push('Please update ONLY the LightSOPLang code to fix these issues.');
        lines.push('You may retry failing commands, adjust arguments, or add new steps.');
        lines.push(`Keep using "@lastAnswer ${FINAL_ANSWER_TOOL} <final text>" as the final step, or "@lastAnswer ${CANNOT_COMPLETE_TOOL} <reason>" when truly impossible.`);
        return lines.join('\n');
    }
 
     async _generatePlanFromEnglish(instructions) {


        const trimmed = typeof instructions === 'string' ? instructions.trim() : '';
        if (!trimmed) {
            return '';
        }
        const englishSource = trimmed.startsWith('#!english')
            ? trimmed
            : `#!english
${trimmed}`;
        const planOptions = {
            ...this.planGeneratorOptions,
            llmAgent: this.agent,
            generateOnly: true,
            onPlanGenerated: (event) => {
                try {
                    const previous = typeof event?.previousCode === 'string' ? event.previousCode : '';
                    const current = typeof event?.code === 'string' ? event.code : '';
                    const reason = event?.reason || 'unknown';
                    const attempt = Number.isFinite(event?.attempt) ? event.attempt : 0;
                    const COLOR_RESET = '\x1b[0m';
                    const COLOR_GREEN = '\x1b[32m';
                    const COLOR_RED = '\x1b[31m';
                    const COLOR_YELLOW = '\x1b[33m';
                    const COLOR_DIM = '\x1b[2m';

                    debugLog(`[LightSOPLang] Plan generation (${reason}, attempt ${attempt})`);

                    if (!previous) {
                        debugLog('[LightSOPLang] Generated initial plan:');
                        debugLog(current || '(empty plan)');
                        return;
                    }

                    const buildVarMap = (code) => {
                        const map = new Map();
                        if (!code || typeof code !== 'string') {
                            return map;
                        }
                        const lines = code.split(/\r?\n/);
                        for (const rawLine of lines) {
                            const line = rawLine.trim();
                            if (!line.startsWith('@')) {
                                continue;
                            }
                            const afterAt = line.slice(1).trim();
                            if (!afterAt) {
                                continue;
                            }
                            const [name] = afterAt.split(/\s+/, 1);
                            if (!name) {
                                continue;
                            }
                            map.set(name, line);
                        }
                        return map;
                    };

                    const prevVars = buildVarMap(previous);
                    const currVars = buildVarMap(current);

                    debugLog('[LightSOPLang] Plan diff by variable:');

                    const allNames = new Set([...prevVars.keys(), ...currVars.keys()]);
                    const sortedNames = Array.from(allNames).sort();

                    for (const name of sortedNames) {
                        const oldLine = prevVars.get(name) || '';
                        const newLine = currVars.get(name) || '';
                        if (oldLine && !newLine) {
                            // Removed
                            debugLog(`${COLOR_RED}- [REMOVED]${COLOR_RESET} ${name}: ${oldLine}`);
                        } else if (!oldLine && newLine) {
                            // Added
                            debugLog(`${COLOR_GREEN}+ [ADDED]${COLOR_RESET}   ${name}: ${newLine}`);
                        } else if (oldLine !== newLine) {
                            // Changed
                            debugLog(`${COLOR_YELLOW}~ [CHANGED]${COLOR_RESET} ${name}:`);
                            debugLog(`    old: ${oldLine}`);
                            debugLog(`    new: ${newLine}`);
                        } else {
                            // Unchanged
                            debugLog(`${COLOR_DIM}= [UNCHANGED]${COLOR_RESET} ${name}: ${oldLine}`);
                        }
                    }
                } catch (logError) {
                    debugLog('[LightSOPLang] Failed to log plan diff:', logError);
                }
            },
        };
        if (!Object.prototype.hasOwnProperty.call(planOptions, 'llmModel')) {
            planOptions.llmModel = this.options.model;
        }
        if (!Object.prototype.hasOwnProperty.call(planOptions, 'llmTags')) {
            planOptions.llmTags = this.options.tags;
        }
        if (!Object.prototype.hasOwnProperty.call(planOptions, 'llmSignal')) {
            planOptions.llmSignal = this._currentAbortSignal;
        }
        const interpreter = new LightSOPLangInterpreter(
            englishSource,
            this.planCommandsRegistry,
            planOptions,
        );
        await interpreter.ready;
        return interpreter.currentSourceCode || '';
    }

    _createPlanCommandsRegistry() {
        return {
            executeCommand: async () => ({ status: 'success', data: 'noop' }),
            listCommands: () => Object.entries(this.skillsDescription).map(([name, description]) => ({
                name,
                description,
            })),
        };
    }

    async _emitCommandComment(payload) {
        const commandName = String(payload?.command || '').trim();
        if (!commandName || commandName === FINAL_ANSWER_TOOL || commandName === CANNOT_COMPLETE_TOOL) {
            return;
        }
        const reason = String(payload?.comment || '').trim();
        if (!reason || !this.supervisor || typeof this.supervisor.getOutputWriter !== 'function') {
            return;
        }
        try {
            const outputWriter = this.supervisor.getOutputWriter();
            if (outputWriter && typeof outputWriter.write === 'function') {
                await outputWriter.write({
                    type: 'tool_reason',
                    tool: commandName,
                    reason,
                    stepIndex: Number.isFinite(payload?.lineNumber) ? payload.lineNumber : null,
                });
            }
        } catch (error) {
            debugLog('[SOPAgenticSession] Tool reason output failed', {
                tool: commandName,
                error: error?.message || String(error),
            });
        }
    }

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
                if (payload?.command === FINAL_ANSWER_TOOL) {
                    const args = Array.isArray(payload?.args) ? payload.args : [];
                    const text = normalizeResponsePayload(args[0] ?? '');
                    this._lastFinalAnswer = text;
                    return responder.success(text);
                }
                if (payload?.command === CANNOT_COMPLETE_TOOL) {
                    const text = normalizeResponsePayload(payload?.args?.[0] ?? '');
                    this._lastFinalAnswer = text;
                    return responder.fail(text);
                }
                await this._emitCommandComment(payload);
                const wrappedResponder = {
                    success: async (data) => {
                        const interactive = isInteractiveToolResult(data);
                        if (interactive) {
                            this.pendingTool = commandName;
                            this.history.push({ type: 'awaiting_input', tool: commandName, answer: formatLogValue(data) });
                        } else {
                            this.pendingTool = null;
                        }
                        return responder.success(data);
                    },
                    fail: async (error) => {
                        const interactive = isInteractiveToolResult(error);
                        if (interactive) {
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
                    commands.push({
                        name: FINAL_ANSWER_TOOL,
                        description: FINAL_ANSWER_DESCRIPTION,
                    });
                }
                if (!names.includes(CANNOT_COMPLETE_TOOL)) {
                    commands.push({
                        name: CANNOT_COMPLETE_TOOL,
                        description: CANNOT_COMPLETE_DESCRIPTION,
                    });
                }
                return commands;
            },
        };
    }

}

export {
    SOPAgenticSession,
};
