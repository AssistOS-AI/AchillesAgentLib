import path from 'node:path';
import readline from 'node:readline';

import { LLMAgent } from '../LLMAgents/LLMAgent.mjs';
import { defaultPromptReader } from '../utils/defaultPromptReader.mjs';
import { getDebugLogger, DEBUG_ACTIVE } from '../utils/DebugLogger.mjs';

// Import extracted modules
import { SKILL_FILE_TYPES, SKILL_FILE_NAMES } from './constants/skillFileTypes.mjs';
import { isDirectory, isReadableFile } from './utils/fileUtils.mjs';
import { SubsystemFactory } from './services/SubsystemFactory.mjs';
import { SkillRegistry } from './services/SkillRegistry.mjs';
import { SkillDiscoveryService } from './services/SkillDiscoveryService.mjs';
import { SkillSelector } from './services/SkillSelector.mjs';
import { SkillExecutor } from './services/SkillExecutor.mjs';
import { generateCode } from './generate-code-skill.mjs';

// Re-export for backward compatibility
export { SKILL_FILE_TYPES, SKILL_FILE_NAMES };

/**
 * RecursiveSkilledAgent - Main entry point for skill-based execution.
 *
 * This class acts as a facade, coordinating skill discovery, registration,
 * selection, and execution through specialized services.
 */
export class RecursiveSkilledAgent {
    /**
     * Create a new RecursiveSkilledAgent.
     * @param {Object} options - Agent options
     * @param {Object} [options.llmAgent] - Pre-configured LLM agent instance
     * @param {Object} [options.llmAgentOptions] - Options for creating a new LLM agent
     * @param {string} [options.startDir] - Starting directory for skill discovery
     * @param {boolean} [options.searchUpwards=true] - Search upwards through parent directories
     * @param {Function} [options.skillFilter] - Filter function for skill inclusion
     * @param {Object} [options.logger] - Logger instance
     * @param {Object} [options.dbAdapter] - Database adapter for DBTableSkillsSubsystem
     * @param {Function} [options.promptReader] - Custom prompt reader function
     * @param {Function} [options.onProcessingBegin] - Callback when processing begins
     * @param {Function} [options.onProcessingProgress] - Callback during processing
     * @param {Function} [options.onProcessingEnd] - Callback when processing ends
     * @param {string[]} [options.additionalSkillRoots] - Additional directories to scan for skills
     */
    constructor({
        llmAgent = null,
        llmAgentOptions = {},
        startDir = process.cwd(),
        searchUpwards = true,
        skillFilter = null,
        logger = console,
        dbAdapter = null,
        promptReader = null,
        onProcessingBegin = null,
        onProcessingProgress = null,
        onProcessingEnd = null,
        additionalSkillRoots = [],
    } = {}) {
        if (llmAgent && !(llmAgent instanceof LLMAgent)) {
            throw new TypeError('RecursiveSkilledAgent requires an LLMAgent instance.');
        }

        this.logger = logger || console;
        this.startDir = startDir;
        this.dbAdapter = dbAdapter;
        this.searchUpwards = Boolean(searchUpwards);
        this.additionalSkillRoots = Array.isArray(additionalSkillRoots) ? additionalSkillRoots : [];
        this.promptReader = typeof promptReader === 'function' ? promptReader : defaultPromptReader;

        // Debug logger
        this.debugLogger = DEBUG_ACTIVE ? getDebugLogger() : null;
        this.debugLogger?.log('RecursiveSkilledAgent:init', {
            startDir: this.startDir,
            hasLLMAgent: Boolean(llmAgent),
            llmAgentOptions: Object.keys(llmAgentOptions || {}),
        });

        // Create or use provided LLM agent
        this.llmAgent = llmAgent || new LLMAgent({ ...llmAgentOptions });

        // Initialize services
        this._initializeServices({
            skillFilter,
            onProcessingBegin,
            onProcessingProgress,
            onProcessingEnd,
        });

        // ActionReporter for real-time feedback
        this._actionReporter = null;

        // Run skill discovery
        this._discoverAndRegister();
    }

    /**
     * Initialize all internal services.
     * @private
     */
    _initializeServices({ skillFilter, onProcessingBegin, onProcessingProgress, onProcessingEnd }) {
        // Skill registry
        this.registry = new SkillRegistry({
            skillFilter,
            debugLogger: this.debugLogger,
        });

        // Subsystem factory
        this.subsystemFactory = new SubsystemFactory({
            llmAgent: this.llmAgent,
            dbAdapter: this.dbAdapter,
        });

        // Skill discovery service
        this.discoveryService = new SkillDiscoveryService({
            logger: this.logger,
            debugLogger: this.debugLogger,
            searchUpwards: this.searchUpwards,
        });

        // Skill selector
        this.selector = new SkillSelector({
            llmAgent: this.llmAgent,
            logger: this.logger,
            debugLogger: this.debugLogger,
        });

        // Skill executor
        this.executor = new SkillExecutor({
            registry: this.registry,
            subsystemFactory: this.subsystemFactory,
            selector: this.selector,
            logger: this.logger,
            debugLogger: this.debugLogger,
            promptReader: this.promptReader,
            callbacks: {
                onBegin: onProcessingBegin,
                onProgress: onProcessingProgress,
                onEnd: onProcessingEnd,
            },
        });

        // Legacy compatibility properties
        this.subsystems = this.subsystemFactory.instances;
        this.skillToSubsystem = this.registry.skillToSubsystem;
        this.skillCatalog = this.registry.catalog;
        this.skillAliases = this.registry.aliases;
        this.pendingPreparations = this.executor.pendingPreparations;
    }

    /**
     * Discover and register all skills.
     * @private
     */
    _discoverAndRegister() {
        const roots = this.discoveryService.findRoots(
            [this.startDir, process.cwd()],
            this.additionalSkillRoots
        );

        for (const root of roots) {
            const skills = this.discoveryService.discoverFromRoot(root);
            for (const skillRecord of skills) {
                this._registerSkill(skillRecord);
            }
        }
    }

    /**
     * Register a skill and prepare it with its subsystem.
     * @private
     */
    _registerSkill(skillRecord) {
        const registered = this.registry.register(skillRecord);
        if (!registered) {
            return;
        }

        // Handle code generation for cskill types
        if (skillRecord.type === 'cskill') {
            this.executor.addPendingPreparation(
                generateCode(skillRecord, this.llmAgent, this.logger).catch(error => {
                    this.logger.warn(`[RecursiveSkilledAgent] Failed to generate code for skill ${skillRecord.name}: ${error.message}`);
                })
            );
        }

        // Prepare skill with its subsystem
        const subsystem = this.subsystemFactory.get(skillRecord.type);
        if (subsystem && typeof subsystem.prepareSkill === 'function') {
            try {
                const prep = subsystem.prepareSkill(skillRecord, this);
                if (prep instanceof Promise) {
                    this.executor.addPendingPreparation(
                        prep.catch(error => {
                            this.logger.warn(`[RecursiveSkilledAgent] Failed to prepare skill ${skillRecord.name}: ${error.message}`);
                        })
                    );
                }
            } catch (error) {
                this.logger.warn(`[RecursiveSkilledAgent] Failed to prepare skill ${skillRecord.name}: ${error.message}`);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // ActionReporter Management
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Set an ActionReporter for real-time feedback.
     * @param {Object} reporter - The reporter instance
     */
    setActionReporter(reporter) {
        this._actionReporter = reporter;
        this.executor.setActionReporter(reporter);
        if (this.llmAgent && typeof this.llmAgent.setActionReporter === 'function') {
            this.llmAgent.setActionReporter(reporter);
        }
    }

    /**
     * Get the current ActionReporter.
     * @returns {Object|null} The action reporter
     */
    getActionReporter() {
        return this._actionReporter || this.llmAgent?._actionReporter || null;
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Subsystem Management (Legacy API)
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Get or create a subsystem instance.
     * @param {string} type - The subsystem type
     * @returns {Object} The subsystem instance
     */
    ensureSubsystem(type) {
        return this.subsystemFactory.get(type);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Skill Discovery (Legacy API)
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Register discovered skills (re-runs discovery).
     */
    registerDiscoveredSkills() {
        this._discoverAndRegister();
    }

    /**
     * Find .AchillesSkills roots from start directories.
     * @param {string[]} startDirs - Directories to start from
     * @param {boolean} searchUpwards - Whether to search upwards
     * @returns {string[]} Array of root directories
     */
    findAchillesSkillRoots(startDirs = [], searchUpwards = true) {
        const service = new SkillDiscoveryService({
            logger: this.logger,
            debugLogger: this.debugLogger,
            searchUpwards,
        });
        return service.findRoots(startDirs, []);
    }

    /**
     * Register skills from a root directory.
     * @param {string} rootDir - The root directory
     */
    registerSkillsFromRoot(rootDir) {
        const skills = this.discoveryService.discoverFromRoot(rootDir);
        for (const skillRecord of skills) {
            this._registerSkill(skillRecord);
        }
    }

    /**
     * Register skill from a directory.
     * @param {string} skillDir - The skill directory
     */
    registerSkillFromDirectory(skillDir) {
        const skills = this.discoveryService.discoverFromDirectory(skillDir);
        for (const skillRecord of skills) {
            this._registerSkill(skillRecord);
        }
    }

    /**
     * Register a skill from a specific file.
     * @param {Object} options
     * @param {string} options.filePath - Path to the skill file
     * @param {string} options.type - Skill type
     * @param {string} options.skillDir - Skill directory
     */
    registerSkillFromFile({ filePath, type, skillDir }) {
        const skills = this.discoveryService.discoverFromDirectory(skillDir);
        for (const skillRecord of skills) {
            this._registerSkill(skillRecord);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Skill Catalog Access
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Get a skill record by name or alias.
     * @param {string} identifier - Skill name or alias
     * @returns {Object|null} The skill record
     */
    getSkillRecord(identifier) {
        return this.registry.get(identifier);
    }

    /**
     * List skills by type.
     * @param {string} type - The skill type
     * @returns {Object[]} Array of skill records
     */
    listSkillsByType(type) {
        return this.registry.listByType(type);
    }

    /**
     * Get all registered skills.
     * @returns {Object[]} Array of skill records
     */
    getSkills() {
        return this.registry.getAll();
    }

    /**
     * Get the starting directory.
     * @returns {string} The start directory path
     */
    getStartDir() {
        return this.startDir;
    }

    /**
     * Get the skills directory path (.AchillesSkills folder).
     * @returns {string} The skills directory path
     */
    getSkillsDir() {
        return path.join(this.startDir, '.AchillesSkills');
    }

    /**
     * Get additional skill roots.
     * @returns {string[]} Array of additional skill root paths
     */
    getAdditionalSkillRoots() {
        return this.additionalSkillRoots;
    }

    /**
     * Find a skill file by skill name.
     * @param {string} skillName - The skill name
     * @returns {{filePath: string, type: string, record: Object|null}|null} Skill file info
     */
    findSkillFile(skillName) {
        const record = this.getSkillRecord(skillName);
        if (record?.filePath) {
            return { filePath: record.filePath, type: record.type, record };
        }

        const skillDir = path.join(this.getSkillsDir(), skillName);
        if (!isDirectory(skillDir)) {
            return null;
        }

        for (const [filename, descriptor] of Object.entries(SKILL_FILE_TYPES)) {
            const filePath = path.join(skillDir, filename);
            if (isReadableFile(filePath)) {
                return { filePath, type: descriptor.type, record: null };
            }
        }
        return null;
    }

    /**
     * Get user skills (excludes built-in skills).
     * @returns {Object[]} Array of user skill records
     */
    getUserSkills() {
        const builtInRoot = this.additionalSkillRoots?.[0];
        return this.registry.getUserSkills(builtInRoot);
    }

    /**
     * Check if a skill is built-in.
     * @param {Object} skillRecord - The skill record
     * @returns {boolean} True if built-in
     */
    isBuiltInSkill(skillRecord) {
        const builtInRoot = this.additionalSkillRoots?.[0];
        return this.registry.isBuiltIn(skillRecord, builtInRoot);
    }

    /**
     * Reload all skills from disk.
     * @returns {number} Number of skills registered
     */
    reloadSkills() {
        this.registry.clear();
        this._discoverAndRegister();
        return this.registry.size;
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Skill Selection
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Build searchable text from a skill record.
     * @param {Object} record - The skill record
     * @returns {string} Combined searchable text
     */
    buildSearchText(record) {
        return this.selector.buildSearchText(record);
    }

    /**
     * Select an orchestrator for a task.
     * @param {string} taskDescription - The task description
     * @returns {Object|null} The selected orchestrator
     */
    selectOrchestratorForPrompt(taskDescription) {
        const orchestrators = this.listSkillsByType('orchestrator');
        return this.selector.selectOrchestrator(taskDescription, orchestrators);
    }

    /**
     * Choose a skill by heuristic.
     * @param {string} taskDescription - The task description
     * @param {Object[]} candidates - Candidate skills
     * @returns {Object|null} The selected skill
     */
    chooseSkillByHeuristic(taskDescription, candidates) {
        return this.selector.chooseByHeuristic(taskDescription, candidates);
    }

    /**
     * Choose a skill using LLM.
     * @param {string} taskDescription - The task description
     * @param {Object[]} candidates - Candidate skills
     * @returns {Promise<Object|null>} The selected skill
     */
    async chooseSkillWithLLM(taskDescription, candidates) {
        return this.selector.chooseWithLLM(taskDescription, candidates);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Skill Execution
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Execute without an explicit skill.
     * @param {string} taskDescription - The task description
     * @param {Object} forwardOptions - Options to forward
     * @param {string} reviewMode - Review mode
     * @returns {Promise<Object>} The execution result
     */
    async executeWithoutExplicitSkill(taskDescription, forwardOptions, reviewMode) {
        return this.executor.executeWithoutExplicitSkill(taskDescription, forwardOptions, reviewMode, this);
    }

    /**
     * Execute with a specific review mode.
     * @param {string} taskDescription - The task description
     * @param {Object} options - Execution options
     * @param {string} reviewMode - Review mode ('none', 'llm', 'human')
     * @returns {Promise<Object>} The execution result
     */
    async executeWithReviewMode(taskDescription, options = {}, reviewMode = 'none') {
        return this.executor.execute(taskDescription, options, reviewMode, this);
    }

    /**
     * Execute a prompt (no review).
     * @param {string} promptDescription - The prompt
     * @param {Object} options - Execution options
     * @returns {Promise<Object>} The execution result
     */
    async executePrompt(promptDescription, options = {}) {
        return this.executeWithReviewMode(promptDescription, options, 'none');
    }

    /**
     * Execute with LLM review.
     * @param {string} taskDescription - The task description
     * @param {Object} options - Execution options
     * @returns {Promise<Object>} The execution result
     */
    async executePromptWithReview(taskDescription, options = {}) {
        return this.executeWithReviewMode(taskDescription, options, 'llm');
    }

    /**
     * Execute with human review.
     * @param {string} taskDescription - The task description
     * @param {Object} options - Execution options
     * @returns {Promise<Object>} The execution result
     */
    async executePromptWithHumanReview(taskDescription, options = {}) {
        return this.executeWithReviewMode(taskDescription, options, 'human');
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // User Interaction
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Read a multi-line user prompt from stdin.
     * @param {Object} options
     * @param {string} [options.prompt] - The prompt message
     * @returns {Promise<string>} The user input
     */
    async readUserPrompt({ prompt = 'Enter multi-line prompt (blank line or END to finish):' } = {}) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        return new Promise((resolve) => {
            const lines = [];
            if (prompt) {
                rl.setPrompt(`${prompt}\n> `);
                rl.prompt();
            }

            rl.on('line', (line) => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.toUpperCase() === 'END') {
                    rl.close();
                    return;
                }
                lines.push(line);
                rl.setPrompt('> ');
                rl.prompt();
            });

            rl.on('close', () => {
                resolve(lines.join('\n'));
            });
        });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Processing Callbacks (Legacy API)
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * @private
     */
    _invokeProcessingBegin() {
        this.executor._invokeBegin();
    }

    /**
     * @private
     */
    _invokeProcessingProgress() {
        this.executor._invokeProgress();
    }

    /**
     * @private
     */
    _invokeProcessingEnd() {
        this.executor._invokeEnd();
    }

    // Legacy getters for callback properties
    get onProcessingBegin() {
        return this.executor.callbacks.onBegin;
    }

    set onProcessingBegin(fn) {
        this.executor.callbacks.onBegin = typeof fn === 'function' ? fn : null;
    }

    get onProcessingProgress() {
        return this.executor.callbacks.onProgress;
    }

    set onProcessingProgress(fn) {
        this.executor.callbacks.onProgress = typeof fn === 'function' ? fn : null;
    }

    get onProcessingEnd() {
        return this.executor.callbacks.onEnd;
    }

    set onProcessingEnd(fn) {
        this.executor.callbacks.onEnd = typeof fn === 'function' ? fn : null;
    }

    get skillFilter() {
        return this.registry.skillFilter;
    }
}
