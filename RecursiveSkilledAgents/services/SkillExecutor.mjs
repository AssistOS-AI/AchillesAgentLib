import path from 'node:path';
import { stat } from 'node:fs/promises';
import { SKILL_FILE_TYPES } from '../constants/skillFileTypes.mjs';
import { Sanitiser } from '../../utils/Sanitiser.mjs';

/**
 * Registry of internal skill module paths.
 * Each entry maps a skill name to its module path (relative to this file).
 * Modules must export: shortName, descriptor, action(promptText, recursiveAgent, logger)
 */
const INTERNAL_SKILLS = {
    'mirror-code-generator': '../mirror-code-generator/src/index.mjs',
    'ask-user': '../ask-user/src/index.mjs',
    // Future internal skills: just add the module path here
};

const CONVERSATION_SUMMARY_KEY = '__conversation_summary__';
const CONVERSATION_TURN_KEY = '__conversation_turn__';
const MAX_RESULT_CHARS_FOR_SUMMARY = 800;

const SKILL_TYPE_TO_FILENAME = Object.entries(SKILL_FILE_TYPES).reduce((acc, [filename, descriptor]) => {
    acc[descriptor.type] = filename;
    return acc;
}, {});

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
        tierConfig = null,
        modelConfig = null,
        enableSummary = false,
    } = {}) {
        this.registry = registry;
        this.subsystemFactory = subsystemFactory;
        this.selector = selector;
        this.logger = logger;
        this.debugLogger = debugLogger;
        this.tierConfig = modelConfig || tierConfig;
        this.enableSummary = enableSummary;
        this.callbacks = {
            onBegin: typeof callbacks.onBegin === 'function' ? callbacks.onBegin : null,
            onProgress: typeof callbacks.onProgress === 'function' ? callbacks.onProgress : null,
            onEnd: typeof callbacks.onEnd === 'function' ? callbacks.onEnd : null,
        };
        this._isProcessing = false;
        this._actionReporter = null;
        this.pendingPreparations = [];
        this._pendingPreparationSet = new Set();
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
        const tracked = Promise.resolve(preparation);
        this._pendingPreparationSet.add(tracked);
        tracked.finally(() => {
            this._pendingPreparationSet.delete(tracked);
        });
        this.pendingPreparations.push(tracked);
    }

    /**
     * Await all pending preparations, including those added during await.
     * @returns {Promise<void>}
     */
    async awaitPendingPreparations() {
        while (this._pendingPreparationSet.size > 0) {
            const toAwait = Array.from(this._pendingPreparationSet);
            await Promise.all(toAwait);
        }
        this.pendingPreparations.length = 0;
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
     * Tries to find a registered orchestrator first, then creates an ad-hoc
     * orchestrator that wraps all available skills as tools in a loop/SOP session.
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

        // No orchestrator found — create ad-hoc orchestration
        const exposeInternal = recursiveAgent?.exposeInternalSkills !== false;
        const allSkills = this.registry.getAll();
        const candidates = allSkills.filter(s => {
            if (s.type === 'orchestrator') return false;
            if (!exposeInternal && s.isInternal) return false;
            return true;
        });

        if (!candidates.length) {
            throw new Error('No skills available to handle the request.');
        }

        // Single candidate — execute directly without orchestration overhead
        if (candidates.length === 1) {
            this.debugLogger?.log('SkillExecutor:adHocOrchestration:singleSkill', {
                skill: candidates[0].name,
            });
            return this.execute(taskDescription, {
                ...forwardOptions,
                skillName: candidates[0].name,
            }, reviewMode, recursiveAgent);
        }

        // Multiple candidates — create ad-hoc orchestrator session
        const sessionType = recursiveAgent?.fallbackSessionType === 'sop' ? null : 'loop';
        this.debugLogger?.log('SkillExecutor:adHocOrchestration', {
            candidateCount: candidates.length,
            sessionType: sessionType || 'sop',
            candidates: candidates.map(s => s.name),
        });

        const subsystem = this.subsystemFactory.get('orchestrator');
        const allowedSkillNames = candidates.map(s => Sanitiser.sanitiseName(s.name));

        const syntheticRecord = {
            name: '__ad-hoc-orchestrator__',
            shortName: '__ad-hoc-orchestrator__',
            type: 'orchestrator',
            preparedConfig: {
                type: 'orchestrator',
                instructions: 'You are an intelligent assistant. Use the available skills (tools) to satisfy the user\'s request. You may call multiple skills if needed. Respond with a clear final answer.',
                preparation: null,
                allowedSkills: allowedSkillNames,
                allowedPrepSkills: [],
                allowedPrepSkillsSectionPresent: true,
                description: '',
                sessionType,
                sections: {},
            },
            descriptor: {
                name: 'Ad-Hoc Orchestrator',
                rawContent: '',
                sections: {},
            },
        };

        const execution = await subsystem.executeSkillPrompt({
            skillRecord: syntheticRecord,
            recursiveAgent,
            promptText: taskDescription,
            options: {
                ...forwardOptions,
                reviewMode,
            },
        });

        return {
            ...execution,
            reviewMode,
            subsystem: 'orchestrator',
            adHoc: true,
        };
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
            const {
                skillName = null,
                promptReader = null,
                subsystemType = null, // retained for backwards compatibility
                skipPreparationAwait = false,
                ...forward
            } = options || {};

            // Await any pending preparations
            if (!skipPreparationAwait && this._pendingPreparationSet.size > 0) {
                await this.awaitPendingPreparations();
            }

            // Inject conversation summary into context if available
            const sessionMemory = forward.context?.sessionMemory || null;
            let enrichedDescription = taskDescription;
            if (isTopLevel && sessionMemory) {
                const previousSummary = sessionMemory.get(CONVERSATION_SUMMARY_KEY);
                if (previousSummary) {
                    enrichedDescription = `Conversation context:\n${previousSummary}\n\nCurrent request:\n${taskDescription}`;
                    this.debugLogger?.log('SkillExecutor:injectSummary', {
                        summaryLength: previousSummary.length,
                    });
                }
            }

            if (!skillName) {
                // Report that we're routing/planning
                if (actionReporter && isTopLevel) {
                    actionReporter.routing(taskDescription?.slice(0, 50) || 'request');
                }
                const result = await this.executeWithoutExplicitSkill(enrichedDescription, forward, reviewMode, recursiveAgent);
                if (actionReporter && isTopLevel) {
                    actionReporter.completeAction();
                }

                // Generate conversation summary after top-level execution
                if (isTopLevel && this.enableSummary && sessionMemory) {
                    await this._updateConversationSummary(sessionMemory, taskDescription, result, null, recursiveAgent);
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
                    args[name] = enrichedDescription;
                }
            };

            if (skillRecord.preparedConfig?.defaultArgument) {
                injectArg(skillRecord.preparedConfig.defaultArgument);
            }

            if (!Object.keys(args).length) {
                args.input = enrichedDescription;
            }

            const execution = await subsystem.executeSkillPrompt({
                skillRecord,
                recursiveAgent,
                promptText: enrichedDescription,
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
            const finalResult = isPrimitive
                ? { result: execution, reviewMode, subsystem: skillRecord.type }
                : { ...execution, reviewMode, subsystem: skillRecord.type };

            // Generate conversation summary after top-level execution
            if (isTopLevel && this.enableSummary && sessionMemory) {
                await this._updateConversationSummary(sessionMemory, taskDescription, finalResult, skillRecord.shortName || skillName, recursiveAgent);
            }

            return finalResult;
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
     * Generate/update rolling conversation summary after a top-level execution.
     * @private
     */
    async _updateConversationSummary(sessionMemory, userPrompt, executionResult, skillName, recursiveAgent) {
        try {
            const llmAgent = recursiveAgent?.llmAgent;
            if (!llmAgent || typeof llmAgent.executePrompt !== 'function') return;

            const previousSummary = sessionMemory.get(CONVERSATION_SUMMARY_KEY) || '';
            const turnNumber = (sessionMemory.get(CONVERSATION_TURN_KEY) || 0) + 1;

            // Extract result text, truncate safely
            const rawResult = executionResult?.result;
            let resultText = '';
            if (typeof rawResult === 'string') {
                resultText = rawResult;
            } else if (rawResult != null) {
                try { resultText = JSON.stringify(rawResult); } catch { resultText = String(rawResult); }
            }
            if (resultText.length > MAX_RESULT_CHARS_FOR_SUMMARY) {
                resultText = resultText.slice(0, MAX_RESULT_CHARS_FOR_SUMMARY) + '…';
            }

            const summaryPrompt = [
                'Generate a concise conversation summary (under 150 words).',
                '',
                previousSummary ? `Previous summary: ${previousSummary}` : '',
                '',
                `Turn ${turnNumber}:`,
                `User asked: ${userPrompt}`,
                skillName ? `Skill used: ${skillName}` : '',
                `Result: ${resultText || '(no result)'}`,
                '',
                'Instructions:',
                '- Incorporate previous summary and new turn into one rolling summary.',
                '- Include: what the user requested, which skill was used, key outcomes.',
                '- Be factual and terse. No preamble, no markdown.',
                '- Output ONLY the summary text.',
            ].filter(Boolean).join('\n');

            const summaryTier = this.tierConfig?.summary || this.tierConfig?.execution || 'fast';
            const summary = await llmAgent.executePrompt(summaryPrompt, {
                tier: summaryTier,
                context: { intent: 'conversation-summary' },
            });

            if (typeof summary === 'string' && summary.trim()) {
                sessionMemory.set(CONVERSATION_SUMMARY_KEY, summary.trim());
                sessionMemory.set(CONVERSATION_TURN_KEY, turnNumber);
                this.debugLogger?.log('SkillExecutor:summaryGenerated', {
                    turnNumber,
                    summaryLength: summary.trim().length,
                });
            }
        } catch (error) {
            // Non-fatal — summary generation should never block execution
            this.logger?.warn?.(`[SkillExecutor] Summary generation failed: ${error.message}`);
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
                const skillType = module.skillType || module.type || null;
                const descriptorFileName = SKILL_TYPE_TO_FILENAME[skillType];
                if (!descriptorFileName) {
                    this.logger?.warn?.(`[SkillExecutor] Internal skill "${name}" is missing a valid skill type.`);
                    continue;
                }
                const descriptorFilePath = path.resolve(path.dirname(resolvedPath), '..', descriptorFileName);
                const hasDescriptorFile = await stat(descriptorFilePath).then(s => s.isFile()).catch(() => false);
                if (!hasDescriptorFile) {
                    this.logger?.warn?.(`[SkillExecutor] Internal skill "${name}" must provide ${descriptorFileName}.`);
                    continue;
                }

                definitions[name] = {
                    shortName: module.shortName || name,
                    skillType,
                    descriptorFilePath,
                    modulePath: resolvedPath,
                };
            } catch (error) {
                this.logger?.warn?.(`[SkillExecutor] Failed to load internal skill "${name}": ${error.message}`);
            }
        }

        return definitions;
    }
}
