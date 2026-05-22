import { getDebugLogger, DEBUG_ACTIVE } from '../../utils/DebugLogger.mjs';
import {
    FINAL_ANSWER_TOOL,
    FINAL_ANSWER_DESCRIPTION,
    CANNOT_COMPLETE_TOOL,
    CANNOT_COMPLETE_DESCRIPTION,
    CLARIFY_CONTEXT_TOOL,
    CLARIFY_CONTEXT_DESCRIPTION,
    SESSION_STATUS_IDLE,
} from '../constants.mjs';
import {
    getParentContext,
    wrapExecutionRegistry,
    recordToolsRefreshed,
    isAbortError,
    createPromptAbortController,
    clearPromptAbortController,
    ensureNotCancelled,
    markInterrupted,
    getRecentInterruptions,
    cancel,
    emitCommandComment,
    answerParentContextClarification,
} from './runtime.mjs';
import {
    runPreparation,
} from './preparation.mjs';
import {
    newPrompt,
    deriveLastAnswerFromVariables,
    runPlan,
    buildExecutionFeedbackComment,
    generatePlanFromEnglish,
    createPlanCommandsRegistry,
    listAllowedCommandsForPrompt,
    getExecutableCommandNames,
    validatePlanCommands,
} from './planning.mjs';

const DEBUG_LOGGER = DEBUG_ACTIVE ? getDebugLogger() : null;

class SOPAgenticSession {
    constructor({ agent, skillsDescription, options = {} }) {
        if (!agent) {
            throw new Error('SOPAgenticSession requires an LLMAgent instance.');
        }
        if (!skillsDescription || typeof skillsDescription !== 'object') {
            throw new Error('SOPAgenticSession requires a skillsDescription object.');
        }
        [FINAL_ANSWER_TOOL, CANNOT_COMPLETE_TOOL, CLARIFY_CONTEXT_TOOL].forEach((reserved) => {
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
        this.clarifyContextAvailable = options.preparationSession === true && options.enableClarifyContextCommand !== false;
        this.parentContextForClarification = this.clarifyContextAvailable
            ? getParentContext(options.parentContext)
            : null;
        if (this.clarifyContextAvailable) {
            this.skillsDescription[CLARIFY_CONTEXT_TOOL] = CLARIFY_CONTEXT_DESCRIPTION;
        }
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
        this.preparationContextLines = [];
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

    replaceSkillSurface({ skillsDescription, commandsRegistry } = {}, metadata = {}) {
        if (!skillsDescription || typeof skillsDescription !== 'object') {
            throw new Error('replaceSkillSurface requires a skillsDescription object.');
        }
        [FINAL_ANSWER_TOOL, CANNOT_COMPLETE_TOOL, CLARIFY_CONTEXT_TOOL].forEach((reserved) => {
            if (Object.prototype.hasOwnProperty.call(skillsDescription, reserved)) {
                throw new Error(`Tool name "${reserved}" is reserved by the agent runtime.`);
            }
        });
        if (commandsRegistry !== undefined && commandsRegistry !== null) {
            if (typeof commandsRegistry.executeCommand !== 'function' || typeof commandsRegistry.listCommands !== 'function') {
                throw new Error('commandsRegistry must provide executeCommand and listCommands functions.');
            }
        }

        this._userSkillsDescription = { ...skillsDescription };
        this.skillsDescription = {
            ...skillsDescription,
            [FINAL_ANSWER_TOOL]: FINAL_ANSWER_DESCRIPTION,
            [CANNOT_COMPLETE_TOOL]: CANNOT_COMPLETE_DESCRIPTION,
        };
        if (this.clarifyContextAvailable) {
            this.skillsDescription[CLARIFY_CONTEXT_TOOL] = CLARIFY_CONTEXT_DESCRIPTION;
        }
        this._unwrappedCommandsRegistry = commandsRegistry || null;
        this.commandsRegistry = commandsRegistry && typeof commandsRegistry === 'object'
            ? this._wrapExecutionRegistry(commandsRegistry)
            : null;
        this.planCommandsRegistry = this._createPlanCommandsRegistry();
        this._recordToolsRefreshed(metadata);
        return {
            skillsDescription: this.skillsDescription,
            commandsRegistry: this.commandsRegistry,
        };
    }

    async newPrompt(userPrompt, promptOptions = {}) {
        return newPrompt(this, SOPAgenticSession, userPrompt, promptOptions);
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

    static debugLog(...args) {
        if (DEBUG_LOGGER) {
            DEBUG_LOGGER.log(...args);
        }
    }

    static async runPreparation(args) {
        return runPreparation({ ...args, SessionClass: SOPAgenticSession });
    }

    _debug(...args) {
        SOPAgenticSession.debugLog(...args);
    }

    _recordToolsRefreshed(metadata = {}) {
        return recordToolsRefreshed(this, metadata);
    }

    _isAbortError(error) {
        return isAbortError(error);
    }

    _createPromptAbortController(externalSignal = null) {
        return createPromptAbortController(this, externalSignal);
    }

    _clearPromptAbortController() {
        return clearPromptAbortController(this);
    }

    _ensureNotCancelled() {
        return ensureNotCancelled(this);
    }

    _markInterrupted(reason = 'cancelled') {
        return markInterrupted(this, reason);
    }

    _getRecentInterruptions(limit = 5) {
        return getRecentInterruptions(this, limit);
    }

    cancel(reason = 'cancelled') {
        return cancel(this, reason);
    }

    _runPlan(planSource) {
        return runPlan(this, planSource);
    }

    _deriveLastAnswerFromVariables(variables) {
        return deriveLastAnswerFromVariables(variables);
    }

    _buildExecutionFeedbackComment(feedback) {
        return buildExecutionFeedbackComment(feedback);
    }

    _generatePlanFromEnglish(instructions) {
        return generatePlanFromEnglish(this, instructions);
    }

    _createPlanCommandsRegistry() {
        return createPlanCommandsRegistry(this);
    }

    _listAllowedCommandsForPrompt() {
        return listAllowedCommandsForPrompt(this);
    }

    _getExecutableCommandNames() {
        return getExecutableCommandNames(this);
    }

    _validatePlanCommands(planSource) {
        return validatePlanCommands(this, planSource);
    }

    _emitCommandComment(payload) {
        return emitCommandComment(this, payload);
    }

    _wrapExecutionRegistry(registry) {
        return wrapExecutionRegistry(this, registry);
    }

    _answerParentContextClarification(questions) {
        return answerParentContextClarification(this, questions);
    }
}

export {
    SOPAgenticSession,
};
