/**
 * ActionReporter - Real-time action feedback system
 *
 * Provides Claude Code-style feedback showing what the agent is doing:
 * - LLM calls with model info
 * - Skill execution steps
 * - File operations
 * - Planning and routing decisions
 *
 * Note: For 'spinner' mode, you must provide a spinnerFactory option.
 * If not provided, falls back to 'log' mode.
 */

// Action types for categorization
export const ActionType = {
    THINKING: 'thinking',
    LLM_CALL: 'llm_call',
    SKILL_EXECUTE: 'skill_execute',
    SKILL_PLAN: 'skill_plan',
    FILE_READ: 'file_read',
    FILE_WRITE: 'file_write',
    ROUTING: 'routing',
    VALIDATION: 'validation',
    CODE_GEN: 'code_gen',
    STEP: 'step',
};

// Icons for each action type (used in terminal output)
const ActionIcons = {
    [ActionType.THINKING]: '💭',
    [ActionType.LLM_CALL]: '🤖',
    [ActionType.SKILL_EXECUTE]: '⚡',
    [ActionType.SKILL_PLAN]: '📋',
    [ActionType.FILE_READ]: '📖',
    [ActionType.FILE_WRITE]: '✏️',
    [ActionType.ROUTING]: '🔀',
    [ActionType.VALIDATION]: '✅',
    [ActionType.CODE_GEN]: '🔧',
    [ActionType.STEP]: '→',
};

/**
 * ActionReporter class - manages real-time feedback
 */
export class ActionReporter {
    constructor(options = {}) {
        // Spinner factory function - must be provided for 'spinner' mode
        // Signature: (message, options) => spinnerInstance
        // spinnerInstance should have: update(msg), pause(), resume(), succeed(msg), fail(msg), info(msg), stop(msg)
        this.spinnerFactory = options.spinnerFactory || null;

        // Default to 'log' mode if no spinner factory provided and spinner mode requested
        const requestedMode = options.mode || 'log';
        if (requestedMode === 'spinner' && !this.spinnerFactory) {
            this.mode = 'log'; // Fallback to log mode
        } else {
            this.mode = requestedMode; // 'spinner', 'log', 'silent', 'custom'
        }

        this.spinner = null;
        this.customHandler = options.onAction || null;
        this.logger = options.logger || console;
        this.useIcons = options.useIcons !== false;
        this.startTime = null;
        this.actionStack = [];
        this.stepCount = 0;
        this.totalSteps = 0;
        this.showInterruptHint = options.showInterruptHint || false;

        // Track action history for debugging
        this.history = [];
        this.maxHistory = options.maxHistory || 100;

        // Nested action depth tracking
        this.depth = 0;
        this.maxDepthToShow = options.maxDepthToShow || 3;
    }

    /**
     * Start tracking a new action
     */
    startAction(type, description, metadata = {}) {
        const action = {
            type,
            description,
            metadata,
            startTime: Date.now(),
            depth: this.depth,
        };

        this.actionStack.push(action);
        this.depth++;

        if (!this.startTime) {
            this.startTime = Date.now();
        }

        this._recordHistory('start', action);
        this._displayAction(action);

        return action;
    }

    /**
     * Update the current action's description
     */
    updateAction(description, metadata = {}) {
        const current = this.actionStack[this.actionStack.length - 1];
        if (current) {
            current.description = description;
            Object.assign(current.metadata, metadata);
            this._displayAction(current);
        }
    }

    /**
     * Complete the current action
     */
    completeAction(result = null) {
        const action = this.actionStack.pop();
        if (action) {
            this.depth = Math.max(0, this.depth - 1);
            action.endTime = Date.now();
            action.duration = action.endTime - action.startTime;
            action.result = result;
            this._recordHistory('complete', action);
        }

        // If all actions complete, show final status
        if (this.actionStack.length === 0 && this.spinner) {
            const totalTime = Date.now() - this.startTime;
            this.spinner.succeed(`Complete (${this._formatDuration(totalTime)})`);
            this.spinner = null;
            this.startTime = null;
        }

        return action;
    }

    /**
     * Report a step in a multi-step process
     */
    reportStep(stepNum, total, description) {
        this.stepCount = stepNum;
        this.totalSteps = total;

        const stepInfo = total > 0 ? `[${stepNum}/${total}] ` : '';
        this._display(`${stepInfo}${description}`);
    }

    /**
     * Quick helper methods for common actions
     */
    thinking(description = 'Thinking...') {
        return this.startAction(ActionType.THINKING, description);
    }

    llmCall(model, purpose = 'Processing') {
        const modelName = this._extractModelName(model);
        return this.startAction(ActionType.LLM_CALL, `${purpose} (${modelName})`, { model });
    }

    executingSkill(skillName, input = null) {
        return this.startAction(ActionType.SKILL_EXECUTE, `Executing: ${skillName}`, { skillName, input });
    }

    planningSkills(skillCount) {
        return this.startAction(ActionType.SKILL_PLAN, `Planning (${skillCount} skills available)`, { skillCount });
    }

    readingFile(filePath) {
        const fileName = filePath.split('/').pop();
        return this.startAction(ActionType.FILE_READ, `Reading: ${fileName}`, { filePath });
    }

    writingFile(filePath) {
        const fileName = filePath.split('/').pop();
        return this.startAction(ActionType.FILE_WRITE, `Writing: ${fileName}`, { filePath });
    }

    routing(intent, targetSkill = null) {
        const desc = targetSkill ? `Routing to: ${targetSkill}` : `Analyzing intent: ${intent}`;
        return this.startAction(ActionType.ROUTING, desc, { intent, targetSkill });
    }

    generatingCode(skillName) {
        return this.startAction(ActionType.CODE_GEN, `Generating code: ${skillName}`, { skillName });
    }

    /**
     * Mark current action as failed
     */
    failAction(error) {
        const action = this.actionStack.pop();
        if (action) {
            this.depth = Math.max(0, this.depth - 1);
            action.endTime = Date.now();
            action.duration = action.endTime - action.startTime;
            action.error = error;
            this._recordHistory('fail', action);
        }

        if (this.spinner) {
            this.spinner.fail(error?.message || 'Failed');
            this.spinner = null;
            this.startTime = null;
        }

        return action;
    }

    /**
     * Mark current action as interrupted by user
     */
    interrupted(message = 'Interrupted') {
        const action = this.actionStack.pop();
        if (action) {
            this.depth = Math.max(0, this.depth - 1);
            action.endTime = Date.now();
            action.duration = action.endTime - action.startTime;
            action.interrupted = true;
            this._recordHistory('interrupted', action);
        }

        if (this.spinner) {
            this.spinner.stop(`⚠ ${message}`);
            this.spinner = null;
            this.startTime = null;
        } else if (this.mode === 'log') {
            this.logger.log(`⚠ ${message}`);
        }

        // Clear remaining action stack
        this.actionStack = [];
        this.depth = 0;

        return action;
    }

    /**
     * Display an info message without affecting action stack
     */
    info(message) {
        if (this.mode === 'spinner' && this.spinner) {
            this.spinner.info(message);
            this.spinner = null;
        } else if (this.mode === 'log') {
            this.logger.log(`ℹ️  ${message}`);
        } else if (this.mode === 'custom' && this.customHandler) {
            this.customHandler({ type: 'info', message });
        }
    }

    /**
     * Get action history
     */
    getHistory() {
        return [...this.history];
    }

    /**
     * Clear state and reset
     */
    reset() {
        if (this.spinner) {
            this.spinner.stop();
            this.spinner = null;
        }
        this.actionStack = [];
        this.depth = 0;
        this.startTime = null;
        this.stepCount = 0;
        this.totalSteps = 0;
    }

    /**
     * Pause the reporter (e.g., while waiting for user input)
     */
    pause() {
        if (this.mode === 'spinner' && this.spinner) {
            this.spinner.pause();
        }
    }

    /**
     * Resume the reporter after pausing
     */
    resume() {
        if (this.mode === 'spinner' && this.spinner) {
            this.spinner.resume();
        }
    }

    // Private methods

    _displayAction(action) {
        if (action.depth > this.maxDepthToShow) {
            return; // Don't show deeply nested actions
        }

        const icon = this.useIcons ? (ActionIcons[action.type] || '•') + ' ' : '';
        const indent = '  '.repeat(Math.min(action.depth, 2));
        const message = `${indent}${icon}${action.description}`;

        this._display(message);
    }

    _display(message) {
        switch (this.mode) {
            case 'spinner':
                if (this.spinnerFactory) {
                    if (!this.spinner) {
                        this.spinner = this.spinnerFactory(message, {
                            showInterruptHint: this.showInterruptHint,
                        });
                    } else {
                        this.spinner.update(message);
                    }
                } else {
                    // Fallback to log if no spinner factory (shouldn't happen due to constructor check)
                    this.logger.log(`◐ ${message}`);
                }
                break;

            case 'log':
                this.logger.log(`◐ ${message}`);
                break;

            case 'custom':
                if (this.customHandler) {
                    this.customHandler({
                        type: 'update',
                        message,
                        stack: this.actionStack,
                        depth: this.depth,
                    });
                }
                break;

            case 'silent':
            default:
                // No output
                break;
        }
    }

    _recordHistory(event, action) {
        this.history.push({
            event,
            type: action.type,
            description: action.description,
            timestamp: Date.now(),
            duration: action.duration || null,
            depth: action.depth,
        });

        // Trim history if too long
        if (this.history.length > this.maxHistory) {
            this.history = this.history.slice(-this.maxHistory);
        }
    }

    _formatDuration(ms) {
        if (ms < 1000) {
            return `${ms}ms`;
        } else if (ms < 60000) {
            return `${(ms / 1000).toFixed(1)}s`;
        } else {
            const mins = Math.floor(ms / 60000);
            const secs = Math.floor((ms % 60000) / 1000);
            return `${mins}m${secs}s`;
        }
    }

    _extractModelName(model) {
        if (!model) return 'LLM';
        if (typeof model === 'string') {
            // Extract short name from model string
            const parts = model.split('/');
            const name = parts[parts.length - 1];
            // Shorten common model names
            if (name.includes('claude-3-5-sonnet')) return 'sonnet-3.5';
            if (name.includes('claude-3-haiku')) return 'haiku';
            if (name.includes('claude-3-opus')) return 'opus';
            if (name.includes('gpt-4')) return 'gpt-4';
            if (name.includes('gpt-3.5')) return 'gpt-3.5';
            return name.slice(0, 20);
        }
        return 'LLM';
    }
}

/**
 * Create a default reporter instance
 */
export function createActionReporter(options = {}) {
    return new ActionReporter(options);
}

/**
 * Silent reporter for testing - no output
 */
export function createSilentReporter() {
    return new ActionReporter({ mode: 'silent' });
}

/**
 * Logging reporter - outputs to console.log
 */
export function createLoggingReporter(logger = console) {
    return new ActionReporter({ mode: 'log', logger });
}

export default ActionReporter;
