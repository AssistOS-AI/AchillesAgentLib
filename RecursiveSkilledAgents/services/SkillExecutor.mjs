/**
 * Registry of internal skill module paths.
 * Each entry maps a skill name to its module path (relative to this file).
 * Modules must export: shortName, descriptor, action(promptText, recursiveAgent, logger)
 */
const INTERNAL_SKILLS = {
    'mirror-code-generator': '../mirror-code-generator.mjs',
    // Future internal skills: just add the module path here
};

/**
 * Service for executing skills with review modes and processing callbacks.
 * Coordinates skill execution through the appropriate subsystem.
 */
export class SkillExecutor {
    /**
     * Create a new SkillExecutor.
     * @param {Object} options - Executor options
     * @param {Object} options.registry - SkillRegistry instance
     * @param {Object} options.subsystemFactory - SubsystemFactory instance
     * @param {Object} options.selector - SkillSelector instance
     * @param {Object} [options.logger] - Logger instance
     * @param {Object} [options.debugLogger] - Debug logger instance
     * @param {Object} [options.callbacks] - Processing callbacks
     * @param {Function} [options.callbacks.onBegin] - Called when processing begins
     * @param {Function} [options.callbacks.onProgress] - Called during processing
     * @param {Function} [options.callbacks.onEnd] - Called when processing ends
     */
    constructor({
        registry,
        subsystemFactory,
        selector,
        logger = console,
        debugLogger = null,
        callbacks = {},
    } = {}) {
        this.registry = registry;
        this.subsystemFactory = subsystemFactory;
        this.selector = selector;
        this.logger = logger;
        this.debugLogger = debugLogger;
        this.callbacks = {
            onBegin: typeof callbacks.onBegin === 'function' ? callbacks.onBegin : null,
            onProgress: typeof callbacks.onProgress === 'function' ? callbacks.onProgress : null,
            onEnd: typeof callbacks.onEnd === 'function' ? callbacks.onEnd : null,
        };
        this._isProcessing = false;
        this._actionReporter = null;
        this.pendingPreparations = [];
    }

    /**
     * Set an ActionReporter for real-time feedback.
     * @param {Object} reporter - The reporter instance
     */
    setActionReporter(reporter) {
        this._actionReporter = reporter;
    }

    /**
     * Get the current ActionReporter.
     * @returns {Object|null} The action reporter
     */
    getActionReporter() {
        return this._actionReporter;
    }

    /**
     * Add a pending preparation promise.
     * @param {Promise} preparation - The preparation promise
     */
    addPendingPreparation(preparation) {
        this.pendingPreparations.push(preparation);
    }

    /**
     * Invoke the onBegin callback safely.
     * @private
     */
    _invokeBegin() {
        if (this.callbacks.onBegin) {
            try {
                this.callbacks.onBegin();
            } catch (error) {
                this.logger?.warn?.(`[SkillExecutor] onBegin callback error: ${error.message}`);
            }
        }
    }

    /**
     * Invoke the onProgress callback safely.
     * @private
     */
    _invokeProgress() {
        if (this.callbacks.onProgress) {
            try {
                this.callbacks.onProgress();
            } catch (error) {
                this.logger?.warn?.(`[SkillExecutor] onProgress callback error: ${error.message}`);
            }
        }
    }

    /**
     * Invoke the onEnd callback safely.
     * @private
     */
    _invokeEnd() {
        if (this.callbacks.onEnd) {
            try {
                this.callbacks.onEnd();
            } catch (error) {
                this.logger?.warn?.(`[SkillExecutor] onEnd callback error: ${error.message}`);
            }
        }
    }

    /**
     * Execute a skill without an explicit skill name.
     * Tries to find an orchestrator first, then falls back to LLM selection.
     * @param {string} taskDescription - The task description
     * @param {Object} forwardOptions - Options to forward to the skill
     * @param {string} reviewMode - Review mode ('none', 'llm', 'human')
     * @param {Object} recursiveAgent - The recursive agent instance (for orchestrator execution)
     * @returns {Promise<Object>} The execution result
     */
    async executeWithoutExplicitSkill(taskDescription, forwardOptions, reviewMode, recursiveAgent) {
        this.debugLogger?.log('SkillExecutor:executeWithoutExplicitSkill', {
            taskDescription,
            reviewMode,
        });

        // Try to find an orchestrator
        const orchestrators = this.registry.listByType('orchestrator');
        const orchestratorRecord = this.selector.selectOrchestrator(taskDescription, orchestrators);

        if (orchestratorRecord) {
            const subsystem = this.subsystemFactory.get('orchestrator');
            const execution = await subsystem.executeSkillPrompt({
                skillRecord: orchestratorRecord,
                recursiveAgent,
                promptText: taskDescription,
                options: {
                    ...forwardOptions,
                    reviewMode,
                },
            });
            this.debugLogger?.log('SkillExecutor:executeWithoutExplicitSkill:orchestrator', {
                selected: orchestratorRecord.name,
                reviewMode,
            });
            return {
                ...execution,
                reviewMode,
                subsystem: orchestratorRecord.type,
            };
        }

        // Fall back to LLM-based skill selection
        const candidates = this.registry.getAll();
        this.debugLogger?.log('SkillExecutor:executeWithoutExplicitSkill:fallback-selection', {
            candidateCount: candidates.length,
        });
        const selected = await this.selector.chooseWithLLM(taskDescription, candidates);

        if (selected) {
            this.debugLogger?.log('SkillExecutor:executeWithoutExplicitSkill:llm-selected', {
                selected: selected.name,
            });
            return this.execute(taskDescription, {
                ...forwardOptions,
                skillName: selected.name,
            }, reviewMode, recursiveAgent);
        }

        throw new Error('Unable to determine an appropriate skill for the request.');
    }

    /**
     * Execute a skill with the specified review mode.
     * @param {string} taskDescription - The task description
     * @param {Object} options - Execution options
     * @param {string} [options.skillName] - Explicit skill name to execute
     * @param {Object} [options.args] - Arguments to pass to the skill
     * @param {string} reviewMode - Review mode ('none', 'llm', 'human')
     * @param {Object} recursiveAgent - The recursive agent instance
     * @returns {Promise<Object>} The execution result
     */
    async execute(taskDescription, options = {}, reviewMode = 'none', recursiveAgent) {
        // Only invoke callbacks at the top level, not for nested calls
        const isTopLevel = !this._isProcessing;
        if (isTopLevel) {
            this._isProcessing = true;
            this._invokeBegin();
        }

        const actionReporter = this.getActionReporter();
        let skillAction = null;

        try {
            // Await any pending preparations
            if (this.pendingPreparations.length) {
                const toAwait = this.pendingPreparations;
                this.pendingPreparations = [];
                await Promise.all(toAwait);
            }

            const {
                skillName = null,
                promptReader = null,
                subsystemType = null, // retained for backwards compatibility
                ...forward
            } = options || {};

            if (!skillName) {
                // Report that we're routing/planning
                if (actionReporter && isTopLevel) {
                    actionReporter.routing(taskDescription?.slice(0, 50) || 'request');
                }
                const result = await this.executeWithoutExplicitSkill(taskDescription, forward, reviewMode, recursiveAgent);
                if (actionReporter && isTopLevel) {
                    actionReporter.completeAction();
                }
                return result;
            }

            const skillRecord = this.registry.get(skillName);
            if (!skillRecord) {
                throw new Error(`Skill "${skillName}" is not registered.`);
            }

            // Report skill execution start
            if (actionReporter) {
                const displayName = skillRecord.shortName || skillRecord.name || skillName;
                skillAction = actionReporter.executingSkill(displayName, taskDescription?.slice(0, 50));
            }

            const subsystem = this.subsystemFactory.get(skillRecord.type);

            const args = { ...(forward.args || {}) };
            const hasOwn = (name) => Object.prototype.hasOwnProperty.call(args, name);
            const injectArg = (name) => {
                if (typeof name === 'string' && name && !hasOwn(name)) {
                    args[name] = taskDescription;
                }
            };

            if (skillRecord.metadata?.defaultArgument) {
                injectArg(skillRecord.metadata.defaultArgument);
            }

            if (!Object.keys(args).length) {
                args.input = taskDescription;
            }

            const execution = await subsystem.executeSkillPrompt({
                skillRecord,
                recursiveAgent,
                promptText: taskDescription,
                options: {
                    ...forward,
                    args,
                },
            });

            // Report skill completion
            if (skillAction && actionReporter) {
                actionReporter.completeAction({ skill: skillName });
            }

            // If execution result is a primitive or null, wrap it in a result property
            // to avoid spread operator issues (e.g., spreading a string creates { "0": "H", "1": "e", ... })
            const isPrimitive = execution === null || typeof execution !== 'object';
            if (isPrimitive) {
                return {
                    result: execution,
                    reviewMode,
                    subsystem: skillRecord.type,
                };
            }

            return {
                ...execution,
                reviewMode,
                subsystem: skillRecord.type,
            };
        } catch (error) {
            // Report skill failure
            if (skillAction && actionReporter) {
                actionReporter.failAction(error);
            }
            throw error;
        } finally {
            // Only invoke end callback and reset flag at the top level
            if (isTopLevel) {
                this._invokeEnd();
                this._isProcessing = false;
            }
        }
    }

    /**
     * Update processing callbacks.
     * @param {Object} callbacks - New callbacks
     */
    setCallbacks(callbacks) {
        if (typeof callbacks.onBegin === 'function') {
            this.callbacks.onBegin = callbacks.onBegin;
        }
        if (typeof callbacks.onProgress === 'function') {
            this.callbacks.onProgress = callbacks.onProgress;
        }
        if (typeof callbacks.onEnd === 'function') {
            this.callbacks.onEnd = callbacks.onEnd;
        }
    }

    /**
     * Get definitions for all internal skills.
     * Dynamically imports each module to read its descriptor and shortName.
     * Used by RecursiveSkilledAgent to register internal skills when exposeInternalSkills is true.
     * @returns {Promise<Object>} Map of skill name to definition (includes modulePath for orchestrator subsystem)
     */
    async getInternalSkillDefinitions() {
        const definitions = {};

        for (const [name, modulePath] of Object.entries(INTERNAL_SKILLS)) {
            try {
                const module = await import(modulePath);
                // Resolve the absolute path for the module
                const resolvedPath = new URL(modulePath, import.meta.url).pathname;
                definitions[name] = {
                    shortName: module.shortName || name,
                    descriptor: module.descriptor || { title: name, summary: '', sections: {} },
                    modulePath: resolvedPath,
                };
            } catch (error) {
                this.logger?.warn?.(`[SkillExecutor] Failed to load internal skill "${name}": ${error.message}`);
            }
        }

        return definitions;
    }
}
