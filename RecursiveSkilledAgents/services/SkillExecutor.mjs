import path from 'node:path';
import { stat } from 'node:fs/promises';
import { SKILL_FILE_TYPES } from '../constants/skillFileTypes.mjs';
import { createSessionAdapter } from '../../LLMAgents/AgenticSessionAdapter.mjs';
import { Sanitiser } from '../../utils/Sanitiser.mjs';
import { SESSION_STATUS_AWAITING_INPUT, SESSION_KEY_PREFIX } from '../../LLMAgents/constants.mjs';

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

const SKILL_TYPE_TO_FILENAME = Object.entries(SKILL_FILE_TYPES).reduce((acc, [filename, descriptor]) => {
    acc[descriptor.type] = filename;
    return acc;
}, {});

/**
 * Service for executing skills with review modes and processing callbacks.
 * Coordinates skill execution through the appropriate subsystem.
 * When no explicit skill is specified, creates a top-level agentic session
 * with all registered skills as tools.
 */
export class SkillExecutor {
    /**
     * Create a new SkillExecutor.
     * @param {Object} options - Executor options
     * @param {Object} options.registry - SkillRegistry instance
     * @param {Object} options.subsystemFactory - SubsystemFactory instance
     * @param {Object} options.llmAgent - LLMAgent instance for top-level session
     * @param {Object} [options.logger] - Logger instance
     * @param {Object} [options.debugLogger] - Debug logger instance
     * @param {Object} [options.callbacks] - Processing callbacks
     * @param {string} [options.systemPrompt] - System prompt for top-level session
     * @param {number} [options.maxStepsPerTurn] - Max steps per turn for top-level session
     * @param {string} [options.sessionType='loop'] - Session type ('loop', 'sop', 'json', or 'md')
     */
    constructor({
        registry,
        subsystemFactory,
        llmAgent = null,
        logger = console,
        debugLogger = null,
        callbacks = {},
        systemPrompt = null,
        maxStepsPerTurn = null,
        sessionType = 'loop',
    } = {}) {
        this.registry = registry;
        this.subsystemFactory = subsystemFactory;
        this._llmAgent = llmAgent;
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

        // Top-level session configuration
        this._systemPrompt = systemPrompt || 'You are a routing assistant. You MUST delegate every request to one of the available tools — never answer directly from your own knowledge. Pick the best-matching tool, pass the user request as the toolPrompt, and call final_answer with the tool result when done.';
        this._maxStepsPerTurn = Number.isFinite(maxStepsPerTurn) ? maxStepsPerTurn : 15;
        const VALID_SESSION_TYPES = new Set(['loop', 'sop', 'json', 'md']);
        this._sessionType = VALID_SESSION_TYPES.has(sessionType) ? sessionType : 'loop';
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
     * Build a unified skills list from all registered skills.
     * Each skill is represented as { name, description, handler }.
     * @param {Object} recursiveAgent - The recursive agent instance
     * @param {Object} forwardedContext - Context to forward to each skill
     * @returns {Array<{name: string, description: string, handler: Function}>}
     * @private
     */
    _buildSkillsList(recursiveAgent, forwardedContext, originalTaskDescription = null) {
        const allSkills = this.registry.getAll();
        const skills = [];

        for (const skillRecord of allSkills) {
            const name = Sanitiser.sanitiseName(skillRecord.shortName || skillRecord.name);
            // Prefer the dedicated routing description from frontmatter over full rawContent
            const description = skillRecord.descriptor?.description
                || skillRecord.descriptor?.rawContent
                || skillRecord.descriptor?.name
                || skillRecord.name
                || 'No description';
            // Truncate long descriptions
            const truncatedDescription = description.length > 500
                ? description.slice(0, 497) + '...'
                : description;

            skills.push({
                name,
                description: truncatedDescription,
                handler: async (agent, promptText) => {
                    // Coerce to string — loop session may pass structured objects
                    const plannerPrompt = typeof promptText === 'string'
                        ? promptText
                        : JSON.stringify(promptText);

                    // Include the original user request so the inner loop has full context,
                    // even if the outer planner simplified/rewrote the prompt
                    let fullPrompt = plannerPrompt;
                    if (originalTaskDescription && plannerPrompt !== originalTaskDescription) {
                        fullPrompt = `${plannerPrompt}\n\nOriginal user request:\n${originalTaskDescription}`;
                    }

                    this.debugLogger?.log('SkillExecutor:skillHandler:invoke', {
                        skillName: skillRecord.name,
                        plannerPrompt: plannerPrompt.slice(0, 200),
                        hasOriginalContext: Boolean(originalTaskDescription),
                    });

                    const result = await recursiveAgent.executePrompt(fullPrompt, {
                        skillName: skillRecord.name,
                        context: forwardedContext,
                    });

                    this.debugLogger?.log('SkillExecutor:skillHandler:result', {
                        skillName: skillRecord.name,
                        resultType: typeof result?.result,
                        resultPreview: String(result?.result ?? '').slice(0, 200),
                    });

                    return result?.result;
                },
            });
        }

        return skills;
    }

    /**
     * Execute via a top-level agentic session where all skills are tools.
     * The session planner decides which skills to call, in what order.
     * @param {string} taskDescription - The task description
     * @param {Object} options - Forwarded options
     * @param {Object} recursiveAgent - The recursive agent instance
     * @returns {Promise<Object>} The execution result
     * @private
     */
    async _executeViaTopLevelSession(taskDescription, options, recursiveAgent) {
        const forwardedContext = options?.context || {};
        const sessionMemory = options?.sessionMemory || null;
        const sessionKey = `${SESSION_KEY_PREFIX}__top_level__`;

        // Check for existing session in awaiting_input state
        let adapter = sessionMemory?.get?.(sessionKey) || null;
        let result;

        if (adapter && adapter.status === SESSION_STATUS_AWAITING_INPUT) {
            this.debugLogger?.log('SkillExecutor:topLevelSession:resume', {
                sessionType: this._sessionType,
            });
            result = await adapter.newPrompt(taskDescription);
        } else {
            const skills = this._buildSkillsList(recursiveAgent, forwardedContext, taskDescription);

            this.debugLogger?.log('SkillExecutor:topLevelSession:create', {
                sessionType: this._sessionType,
                skillCount: skills.length,
                skillNames: skills.map((s) => s.name),
            });

            if (!skills.length) {
                throw new Error('No skills registered. Cannot execute without an explicit skill name.');
            }

            adapter = createSessionAdapter(this._sessionType, {
                agent: this._llmAgent,
                skills,
                options: {
                    systemPrompt: this._systemPrompt,
                    maxStepsPerTurn: this._maxStepsPerTurn,
                    mode: options?.mode || 'plan',
                },
            });

            result = await adapter.newPrompt(taskDescription);
        }

        // Store or clear session based on status
        if (adapter.status === SESSION_STATUS_AWAITING_INPUT && sessionMemory?.set) {
            sessionMemory.set(sessionKey, adapter);
        } else if (sessionMemory?.delete) {
            sessionMemory.delete(sessionKey);
        }

        return {
            result,
            session: this._sessionType,
            sessionMemory,
            metrics: adapter.getMetrics?.() || {},
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
                const result = await this._executeViaTopLevelSession(taskDescription, forward, recursiveAgent);
                if (actionReporter && isTopLevel) {
                    actionReporter.completeAction();
                }
                return {
                    ...result,
                    reviewMode,
                    subsystem: 'top-level-session',
                };
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

            if (skillRecord.preparedConfig?.defaultArgument) {
                injectArg(skillRecord.preparedConfig.defaultArgument);
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
