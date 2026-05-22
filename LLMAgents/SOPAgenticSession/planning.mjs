import { LightSOPLangInterpreter } from '../../lightSOPLang/interpreter.mjs';
import { parseCode } from '../../lightSOPLang/parser.mjs';
import {
    FINAL_ANSWER_TOOL,
    CANNOT_COMPLETE_TOOL,
    SESSION_STATUS_RUNNING,
    SESSION_STATUS_ACTIVE,
    SESSION_STATUS_AWAITING_INPUT,
    SESSION_STATUS_INTERRUPTED,
} from '../constants.mjs';
import { buildSOPAgenticInstructions } from './prompts.mjs';
import {
    getPendingToolFromHistory,
    isLikelyFreshInstruction,
} from './utils.mjs';

function deriveLastAnswerFromVariables(variables) {
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

function encodeSopString(value = '') {
    return JSON.stringify(String(value ?? ''));
}

function buildDirectToolPlan(toolName, userPrompt) {
    return [
        `@pendingResult ${toolName} ${encodeSopString(userPrompt)}`,
        '@lastAnswer final_answer $pendingResult',
    ].join('\n');
}

async function runPlan(session, planSource) {
    const normalizedPlanSource = typeof planSource === 'string' ? planSource.trimStart() : '';
    if (!normalizedPlanSource || !normalizedPlanSource.trim()) {
        session.lastExecution = null;
        return { hasFailures: false, failures: [] };
    }
    const baseOptions = session.executionInterpreterOptions || {};
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
                    session._debug('[SOPAgenticSession] execution onFail handler threw:', error);
                }
            }
        },
    };
    if (!Object.prototype.hasOwnProperty.call(interpreterOptions, 'llmAgent')) {
        interpreterOptions.llmAgent = session.agent;
    }
    if (!Object.prototype.hasOwnProperty.call(interpreterOptions, 'llmModel')) {
        interpreterOptions.llmModel = session.options.model;
    }
    if (!Object.prototype.hasOwnProperty.call(interpreterOptions, 'llmTags')) {
        interpreterOptions.llmTags = session.options.tags;
    }
    if (!Object.prototype.hasOwnProperty.call(interpreterOptions, 'llmSignal')) {
        interpreterOptions.llmSignal = session._currentAbortSignal;
    }
    session._lastFinalAnswer = null;
    let interpreter;
    try {
        interpreter = new LightSOPLangInterpreter(
            normalizedPlanSource,
            session.commandsRegistry,
            interpreterOptions,
        );
        await interpreter.ready;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        session._debug('[SOPAgenticSession] Plan execution failed:', message);
        session.lastExecution = {
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
    const derivedLastAnswer = session._deriveLastAnswerFromVariables(variables);
    session.lastExecution = {
        variables,
        lastAnswer: session._lastFinalAnswer ?? derivedLastAnswer,
    };
    session._lastFinalAnswer = null;
    const hasFailures = collectedFailures.length > 0;
    const failures = hasFailures ? collectedFailures : [];
    session.lastRunFailures = failures;
    return { hasFailures, failures };
}

function logPlanDiff(session, event) {
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

        session._debug(`[LightSOPLang] Plan generation (${reason}, attempt ${attempt})`);

        if (!previous) {
            session._debug('[LightSOPLang] Generated initial plan:');
            session._debug(current || '(empty plan)');
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

        session._debug('[LightSOPLang] Plan diff by variable:');

        const allNames = new Set([...prevVars.keys(), ...currVars.keys()]);
        const sortedNames = Array.from(allNames).sort();

        for (const name of sortedNames) {
            const oldLine = prevVars.get(name) || '';
            const newLine = currVars.get(name) || '';
            if (oldLine && !newLine) {
                session._debug(`${COLOR_RED}- [REMOVED]${COLOR_RESET} ${name}: ${oldLine}`);
            } else if (!oldLine && newLine) {
                session._debug(`${COLOR_GREEN}+ [ADDED]${COLOR_RESET}   ${name}: ${newLine}`);
            } else if (oldLine !== newLine) {
                session._debug(`${COLOR_YELLOW}~ [CHANGED]${COLOR_RESET} ${name}:`);
                session._debug(`    old: ${oldLine}`);
                session._debug(`    new: ${newLine}`);
            } else {
                session._debug(`${COLOR_DIM}= [UNCHANGED]${COLOR_RESET} ${name}: ${oldLine}`);
            }
        }
    } catch (logError) {
        session._debug('[LightSOPLang] Failed to log plan diff:', logError);
    }
}

async function generatePlanFromEnglish(session, instructions) {
    const trimmed = typeof instructions === 'string' ? instructions.trim() : '';
    if (!trimmed) {
        return '';
    }
    const englishSource = trimmed.startsWith('#!english')
        ? trimmed
        : `#!english
${trimmed}`;
    const planOptions = {
        ...session.planGeneratorOptions,
        llmAgent: session.agent,
        generateOnly: true,
        onPlanGenerated: (event) => {
            logPlanDiff(session, event);
        },
    };
    if (!Object.prototype.hasOwnProperty.call(planOptions, 'llmModel')) {
        planOptions.llmModel = session.options.model;
    }
    if (!Object.prototype.hasOwnProperty.call(planOptions, 'llmTags')) {
        planOptions.llmTags = session.options.tags;
    }
    if (!Object.prototype.hasOwnProperty.call(planOptions, 'llmSignal')) {
        planOptions.llmSignal = session._currentAbortSignal;
    }
    const interpreter = new LightSOPLangInterpreter(
        englishSource,
        session.planCommandsRegistry,
        planOptions,
    );
    await interpreter.ready;
    return interpreter.currentSourceCode || '';
}

function createPlanCommandsRegistry(session) {
    return {
        executeCommand: async () => ({ status: 'success', data: 'noop' }),
        listCommands: () => Object.entries(session.skillsDescription).map(([name, description]) => ({
            name,
            description,
        })),
    };
}

function listAllowedCommandsForPrompt(session) {
    const registry = session.commandsRegistry || session.planCommandsRegistry;
    const raw = registry && typeof registry.listCommands === 'function'
        ? registry.listCommands()
        : [];
    const commands = Array.isArray(raw) ? raw : [];
    const seen = new Set();
    const result = [];
    const addCommand = (name, description = '') => {
        const normalizedName = typeof name === 'string' ? name.trim() : '';
        if (!normalizedName || seen.has(normalizedName)) {
            return;
        }
        seen.add(normalizedName);
        result.push({
            name: normalizedName,
            description: typeof description === 'string' ? description.trim() : '',
        });
    };

    for (const command of commands) {
        addCommand(command?.name || command?.command, command?.description || '');
    }
    addCommand('assign', 'Create a local text variable without calling an external skill.');

    return result;
}

function getExecutableCommandNames(session) {
    const commands = listAllowedCommandsForPrompt(session);
    return new Set(commands.map((command) => command.name));
}

function validatePlanCommands(session, planSource) {
    const source = typeof planSource === 'string' ? planSource : '';
    const failures = [];
    let declarations;
    try {
        declarations = parseCode(source);
    } catch (error) {
        session.lastExecution = {
            variables: {},
            lastAnswer: null,
        };
        return {
            hasFailures: true,
            failures: [{
                variable: '__plan__',
                reason: `plan-error:${error?.message || String(error)}`,
            }],
        };
    }

    const allowedCommands = getExecutableCommandNames(session);
    for (const declaration of declarations.values()) {
        const commandName = declaration?.command || '';
        if (!allowedCommands.has(commandName)) {
            failures.push({
                variable: declaration?.name || '__plan__',
                reason: `command-not-allowed:${commandName}`,
            });
        }
    }

    if (failures.length) {
        session.lastExecution = {
            variables: {},
            lastAnswer: null,
        };
        return { hasFailures: true, failures };
    }

    return { hasFailures: false, failures: [] };
}

function buildExecutionFeedbackComment(feedback) {
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

async function runPendingTool(session, userPrompt, pendingTool) {
    const interpretation = session.agent && typeof session.agent.interpretMessage === 'function'
        ? await session.agent.interpretMessage(userPrompt, { intents: ['accept', 'cancel', 'update'], signal: session._currentAbortSignal })
        : { intent: 'unknown', confidence: 0 };
    const shouldContinuePending = interpretation?.intent === 'accept'
        || interpretation?.intent === 'cancel'
        || interpretation?.intent === 'update'
        || !isLikelyFreshInstruction(userPrompt);
    if (!shouldContinuePending) {
        return null;
    }

    session.currentPlan = buildDirectToolPlan(pendingTool, userPrompt);
    session.lastExecution = null;
    session.history.push({
        prompt: userPrompt,
        plan: session.currentPlan,
        routeReason: 'pending_awaiting_input',
        tool: pendingTool,
    });
    try {
        const runResult = await session._runPlan(session.currentPlan);
        session.lastRunFailures = runResult?.failures || [];
        const answer = session.getLastResult();
        if (session.lastExecution && answer !== session.lastExecution.lastAnswer) {
            throw new Error('SOPAgenticSession invariant violated: getLastResult() mismatch with lastExecution.lastAnswer.');
        }
        session.status = session.pendingTool ? SESSION_STATUS_AWAITING_INPUT : SESSION_STATUS_ACTIVE;
        return { plan: session.currentPlan, answer };
    } catch (error) {
        if (session._isAbortError(error) || session.status === SESSION_STATUS_INTERRUPTED) {
            const answer = session._markInterrupted(session._cancelReason || 'cancelled');
            return { plan: session.currentPlan, answer };
        }
        throw error;
    } finally {
        session._clearPromptAbortController();
    }
}

async function newPrompt(session, SessionClass, userPrompt, promptOptions = {}) {
    if (!userPrompt || typeof userPrompt !== 'string') {
        throw new Error('newPrompt requires a prompt string.');
    }
    if (session.status === SESSION_STATUS_INTERRUPTED) {
        session.status = SESSION_STATUS_ACTIVE;
    }
    const runSignal = promptOptions.signal || session.options.signal || null;
    session._createPromptAbortController(runSignal);
    session.status = SESSION_STATUS_RUNNING;

    let preparationContext = [];
    if (session.preparation?.text) {
        const preparationSkillsDescription = session.preparation?.skillsDescription && typeof session.preparation.skillsDescription === 'object'
            ? session.preparation.skillsDescription
            : session._userSkillsDescription;
        const preparationCommandsRegistry = session.preparation?.commandsRegistry && typeof session.preparation.commandsRegistry === 'object'
            ? session.preparation.commandsRegistry
            : session._unwrappedCommandsRegistry;
        const prepResult = await SessionClass.runPreparation({
            agent: session.agent,
            skillsDescription: preparationSkillsDescription,
            commandsRegistry: preparationCommandsRegistry,
            options: {
                model: session.options.model,
                tags: session.options.tags,
                signal: session._currentAbortSignal,
                supervisor: session.supervisor,
                parentContext: session.preparation.parentContext || null,
                preparationContext: session.preparation.context || '',
            },
            preparationText: session.preparation.text,
            userPrompt,
            retries: session.preparation.retries ?? 1,
        });
        session.preparationContextText = typeof prepResult?.contextText === 'string'
            ? prepResult.contextText
            : '';
        preparationContext = session.preparationContextText
            ? session.preparationContextText.split(/\r?\n/)
            : [];
        session.preparationContextLines = [];
        session.systemPrompt = session.baseSystemPrompt;
    }

    const modeHint = session.options.planOnly ? ' plan-only' : '';
    session._debug(`[SOPAgenticSession${modeHint}] New prompt: "${userPrompt}"`);

    const pendingTool = session.pendingTool || getPendingToolFromHistory(session.history);
    if (pendingTool) {
        const pendingResult = await runPendingTool(session, userPrompt, pendingTool);
        if (pendingResult) {
            return pendingResult;
        }
    }

    const maxAttempts = session.maxPlanAttempts > 0 ? session.maxPlanAttempts : 1;
    let attempt = 0;
    let lastFeedback = null;

    try {
        while (true) {
            const baseInstructions = buildSOPAgenticInstructions({
                currentPlan: session.currentPlan,
                userPrompt,
                systemPrompt: session.systemPrompt,
                preparationContext,
                interruptedEvents: session._getRecentInterruptions(),
            });

            const feedbackBlock = session._buildExecutionFeedbackComment(lastFeedback);
            const englishInstructions = feedbackBlock
                ? `${baseInstructions}\n\n${feedbackBlock}`
                : baseInstructions;

            session._ensureNotCancelled();
            const plan = await session._generatePlanFromEnglish(englishInstructions);

            session.currentPlan = plan || '';
            session.lastExecution = null;
            session.history.push({
                prompt: userPrompt,
                plan: session.currentPlan,
            });

            if (!session.commandsRegistry || session.options.planOnly) {
                break;
            }

            const validationResult = session._validatePlanCommands(session.currentPlan);
            const runResult = validationResult.hasFailures
                ? validationResult
                : await session._runPlan(session.currentPlan);
            const hasFailures = runResult?.hasFailures;
            const failures = runResult?.failures || [];
            session.lastRunFailures = failures;

            if (!hasFailures) {
                break;
            }

            attempt += 1;
            session._debug('[SOPAgenticSession] Plan attempt failed', {
                attempt,
                maxAttempts,
                failures,
            });
            if (attempt >= maxAttempts) {
                session._debug('[SOPAgenticSession] Maximum plan attempts reached; stopping retries.');
                break;
            }

            lastFeedback = {
                failures,
                variables: session.lastExecution?.variables || {},
            };
        }
    } catch (error) {
        if (session._isAbortError(error) || session.status === SESSION_STATUS_INTERRUPTED) {
            const answer = session._markInterrupted(session._cancelReason || 'cancelled');
            session._clearPromptAbortController();
            return { plan: session.currentPlan, answer };
        }
        session._clearPromptAbortController();
        throw error;
    }

    try {
        const answer = session.getLastResult();
        if (session.lastExecution && answer !== session.lastExecution.lastAnswer) {
            throw new Error('SOPAgenticSession invariant violated: getLastResult() mismatch with lastExecution.lastAnswer.');
        }
        session.status = session.pendingTool ? SESSION_STATUS_AWAITING_INPUT : SESSION_STATUS_ACTIVE;
        return { plan: session.currentPlan, answer };
    } catch (error) {
        if (session._isAbortError(error) || session.status === SESSION_STATUS_INTERRUPTED) {
            const answer = session._markInterrupted(session._cancelReason || 'cancelled');
            return { plan: session.currentPlan, answer };
        }
        throw error;
    } finally {
        session._clearPromptAbortController();
    }
}

export {
    newPrompt,
    deriveLastAnswerFromVariables,
    runPlan,
    buildExecutionFeedbackComment,
    generatePlanFromEnglish,
    createPlanCommandsRegistry,
    listAllowedCommandsForPrompt,
    getExecutableCommandNames,
    validatePlanCommands,
};
