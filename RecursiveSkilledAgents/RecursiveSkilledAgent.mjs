import path from 'node:path';
import readline from 'node:readline';

import { LLMAgent } from '../LLMAgents/LLMAgent.mjs';
import { getDebugLogger, DEBUG_ACTIVE } from '../utils/DebugLogger.mjs';

// Import extracted modules
import { SKILL_FILE_TYPES, SKILL_FILE_NAMES } from './constants/skillFileTypes.mjs';
import { DEFAULT_SESSION_ID, DEFAULT_SESSION_CONFIG } from './constants/sessionConfig.mjs';
import { isDirectory, isReadableFile } from './utils/fileUtils.mjs';
import { Sanitiser } from '../utils/Sanitiser.mjs';
import { SubsystemFactory } from './services/SubsystemFactory.mjs';
import { SkillRegistry } from './services/SkillRegistry.mjs';
import { SkillDiscoveryService } from './services/SkillDiscoveryService.mjs';
import { SkillSelector } from './services/SkillSelector.mjs';
import { SkillExecutor } from './services/SkillExecutor.mjs';

// Re-export for backward compatibility
export { SKILL_FILE_TYPES, SKILL_FILE_NAMES };
export { DEFAULT_SESSION_ID, DEFAULT_SESSION_CONFIG };

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
     * @param {Function} [options.onProcessingBegin] - Callback when processing begins
     * @param {Function} [options.onProcessingProgress] - Callback during processing
     * @param {Function} [options.onProcessingEnd] - Callback when processing ends
     * @param {string[]} [options.additionalSkillRoots] - Additional directories to scan for skills
     * @param {Object} [options.sessionConfig] - Session memory configuration
     * @param {number} [options.sessionConfig.maxSessions=1000] - Maximum sessions to keep (0 = unlimited)
     * @param {number} [options.sessionConfig.sessionTTL=7200000] - Session TTL in ms (0 = never expire, default 2 hours)
     * @param {number} [options.sessionConfig.cleanupInterval=300000] - Cleanup interval in ms (default 5 minutes)
     * @param {Object} [options.inputReader] - InputReader instance for user input (falls back to global IOServices)
     * @param {Object} [options.outputWriter] - OutputWriter instance for output (falls back to global IOServices)
     * @param {boolean} [options.exposeInternalSkills=true] - Whether internal skills are visible to LLM skill selection
     */
    constructor({
        llmAgent = null,
        llmAgentOptions = {},
        startDir = process.cwd(),
        searchUpwards = true,
        skillFilter = null,
        logger = console,
        dbAdapter = null,
        onProcessingBegin = null,
        onProcessingProgress = null,
        onProcessingEnd = null,
        additionalSkillRoots = [],
        sessionConfig = {},
        inputReader = null,
        outputWriter = null,
        exposeInternalSkills = true,
        tierConfig = {},
        fallbackSessionType = 'loop',
    } = {}) {
        if (llmAgent && !(llmAgent instanceof LLMAgent)) {
            throw new TypeError('RecursiveSkilledAgent requires an LLMAgent instance.');
        }

        this.logger = logger || console;
        this.startDir = startDir;
        this.dbAdapter = dbAdapter;
        this.searchUpwards = Boolean(searchUpwards);
        this.exposeInternalSkills = Boolean(exposeInternalSkills);
        const baseTierConfig = { plan: 'plan', execution: 'fast', code: 'code', ...tierConfig };
        // Expanded tier config: orchestrator and skill levels
        // Backwards compatible: skillPlan/skillExec fall back to plan/execution
        this.tierConfig = {
            ...baseTierConfig,
            skillPlan: baseTierConfig.skillPlan || baseTierConfig.execution || 'fast',
            skillExec: baseTierConfig.skillExec || baseTierConfig.execution || 'fast',
        };
        this.fallbackSessionType = fallbackSessionType === 'sop' ? 'sop' : 'loop';

        // Add internal skills directory to additionalSkillRoots
        const packageRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');
        const internalSkillsDir = path.join(packageRoot, 'skills');
        this.additionalSkillRoots = Array.isArray(additionalSkillRoots) ? [...additionalSkillRoots] : [];
        if (!this.additionalSkillRoots.includes(internalSkillsDir)) {
            this.additionalSkillRoots.push(internalSkillsDir);
        }
        
        // I/O services (optional, falls back to global IOServices)
        this.inputReader = inputReader;
        this.outputWriter = outputWriter;

        // Debug logger
        this.debugLogger = DEBUG_ACTIVE ? getDebugLogger() : null;
        this.debugLogger?.log('RecursiveSkilledAgent:init', {
            startDir: this.startDir,
            hasLLMAgent: Boolean(llmAgent),
            llmAgentOptions: Object.keys(llmAgentOptions || {}),
            exposeInternalSkills: this.exposeInternalSkills,
        });

        // Create or use provided LLM agent
        this.llmAgent = llmAgent || new LLMAgent({ ...llmAgentOptions });

        // Initialize services
        this._initializeServices({
            skillFilter,
            onProcessingBegin,
            onProcessingProgress,
            onProcessingEnd,
            tierConfig: this.tierConfig,
        });

        // ActionReporter for real-time feedback
        this._actionReporter = null;

        // Session memory management
        // Supports both single-session (CLI) and multi-session (webchat) modes
        this._sessions = new Map();
        this._sessionMeta = new Map(); // Stores { createdAt, lastAccessTime } per session
        this._sessionConfig = {
            ...DEFAULT_SESSION_CONFIG,
            ...sessionConfig,
        };
        this._cleanupTimer = null;

        // Start cleanup timer if TTL or maxSessions is configured
        if (this._sessionConfig.sessionTTL > 0 || this._sessionConfig.maxSessions > 0) {
            this._startCleanupTimer();
        }

        // Run skill discovery
        this._discoverAndRegister();
    }

    /**
     * Initialize all internal services.
     * @private
     */
    _initializeServices({ skillFilter, onProcessingBegin, onProcessingProgress, onProcessingEnd, tierConfig }) {
        // Skill registry
        this.registry = new SkillRegistry({
            skillFilter,
            debugLogger: this.debugLogger,
        });

        // Subsystem factory
        this.subsystemFactory = new SubsystemFactory({
            llmAgent: this.llmAgent,
            dbAdapter: this.dbAdapter,
            tierConfig,
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
            tierConfig,
        });

        // Skill executor
        this.executor = new SkillExecutor({
            registry: this.registry,
            subsystemFactory: this.subsystemFactory,
            selector: this.selector,
            logger: this.logger,
            debugLogger: this.debugLogger,
            callbacks: {
                onBegin: onProcessingBegin,
                onProgress: onProcessingProgress,
                onEnd: onProcessingEnd,
            },
            tierConfig,
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

        const allSkills = [];

        for (const root of roots) {
            const skills = this.discoveryService.discoverFromRoot(root);
            allSkills.push(...skills);
        }

        if (!allSkills.length) {
            return;
        }

        let mirrorSkill = null;
        const otherSkills = [];
        for (const skillRecord of allSkills) {
            if (!mirrorSkill && skillRecord.shortName === 'mirror-code-generator') {
                mirrorSkill = skillRecord;
                continue;
            }
            otherSkills.push(skillRecord);
        }

        if (mirrorSkill) {
            this._registerSkill(mirrorSkill);
        }

        for (const skillRecord of otherSkills) {
            this._registerSkill(skillRecord);
        }
    }

    /**
     * Register a skill and prepare it with its subsystem.
     * @private
     */
    _registerSkill(skillRecord) {
        const subsystem = this.subsystemFactory.get(skillRecord.type);
        if (subsystem && typeof subsystem.parseSkillDescriptor === 'function') {
            try {
                skillRecord.descriptor = subsystem.parseSkillDescriptor({
                    filePath: skillRecord.filePath,
                    skillDir: skillRecord.skillDir,
                    shortName: skillRecord.shortName,
                });
            } catch (error) {
                this.logger.warn(`[RecursiveSkilledAgent] Failed to parse skill ${skillRecord.shortName}: ${error.message}`);
            }
        }
        if (!skillRecord.descriptor) {
            skillRecord.descriptor = {
                name: skillRecord.shortName,
                rawContent: '',
                sections: {},
            };
        }
        const baseName = Sanitiser.sanitiseName(skillRecord.descriptor?.name || skillRecord.shortName);
        const canonicalName = Sanitiser.sanitiseName(`${baseName}-${skillRecord.type}`)
            || Sanitiser.sanitiseName(`${skillRecord.shortName}-${skillRecord.type}`);
        skillRecord.name = canonicalName;

        // Mark as internal if from internal skills directory
        const packageRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');
        const internalSkillsDir = path.join(packageRoot, 'skills');
        skillRecord.isInternal = skillRecord.skillDir?.startsWith(internalSkillsDir) || false;

        const registered = this.registry.register(skillRecord);
        if (!registered) {
            return;
        }

        // Handle code generation for cskill
        if (skillRecord.type === 'cskill') {
            this.executor.addPendingPreparation(
                this.executePrompt(skillRecord.skillDir, {
                    skillName: 'mirror-code-generator',
                    skipPreparationAwait: true,
                }).catch(error => {
                    this.logger.warn(`[RecursiveSkilledAgent] Failed to generate code for cskill ${skillRecord.name}: ${error.message}`);
                })
            );
        }

        // Prepare skill with its subsystem
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
    // Session Memory Management
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Get the session memory for a given session ID.
     * 
     * In single-session mode (CLI), call without arguments to get the default session.
     * In multi-session mode (webchat), pass a sessionId to isolate user state.
     * 
     * Also updates session access time and enforces maxSessions limit.
     * 
     * @param {string} [sessionId] - Optional session identifier. If null/undefined,
     *                               uses the default session (for CLI mode).
     * @returns {Map} The session memory Map for this session
     */
    getSessionMemory(sessionId = null) {
        const key = sessionId || DEFAULT_SESSION_ID;
        const now = Date.now();
        
        if (!this._sessions.has(key)) {
            // Enforce maxSessions limit before creating new session
            this._enforceMaxSessions();
            
            this._sessions.set(key, new Map());
            this._sessionMeta.set(key, {
                createdAt: now,
                lastAccessTime: now,
            });
            this.debugLogger?.log('RecursiveSkilledAgent:createSession', { 
                sessionId: key,
                totalSessions: this._sessions.size,
            });
        } else {
            // Update last access time
            const meta = this._sessionMeta.get(key);
            if (meta) {
                meta.lastAccessTime = now;
            }
        }
        
        return this._sessions.get(key);
    }

    /**
     * Clear a specific session's memory.
     * @param {string} [sessionId] - Session to clear. If null, clears default session.
     */
    clearSessionMemory(sessionId = null) {
        const key = sessionId || DEFAULT_SESSION_ID;
        const session = this._sessions.get(key);
        
        if (session) {
            session.clear();
            // Update access time on clear
            const meta = this._sessionMeta.get(key);
            if (meta) {
                meta.lastAccessTime = Date.now();
            }
            this.debugLogger?.log('RecursiveSkilledAgent:clearSession', { sessionId: key });
        }
    }

    /**
     * Delete a session entirely.
     * @param {string} sessionId - Session to delete (cannot delete default session)
     * @returns {boolean} True if session was deleted
     */
    deleteSession(sessionId) {
        if (!sessionId || sessionId === DEFAULT_SESSION_ID) {
            // Cannot delete default session, only clear it
            this.clearSessionMemory(null);
            return false;
        }
        
        const deleted = this._sessions.delete(sessionId);
        this._sessionMeta.delete(sessionId);
        
        if (deleted) {
            this.debugLogger?.log('RecursiveSkilledAgent:deleteSession', { 
                sessionId,
                remainingSessions: this._sessions.size,
            });
        }
        return deleted;
    }

    /**
     * Get all active session IDs.
     * @returns {string[]} Array of session IDs (excludes default session marker)
     */
    getActiveSessions() {
        return Array.from(this._sessions.keys())
            .filter(key => key !== DEFAULT_SESSION_ID);
    }

    /**
     * Check if a session exists.
     * @param {string} [sessionId] - Session to check
     * @returns {boolean} True if session exists
     */
    hasSession(sessionId = null) {
        const key = sessionId || DEFAULT_SESSION_ID;
        return this._sessions.has(key);
    }

    /**
     * Get session statistics for monitoring.
     * @returns {Object} Session stats
     */
    getSessionStats() {
        const now = Date.now();
        const sessions = [];
        
        for (const [key, meta] of this._sessionMeta.entries()) {
            if (key === DEFAULT_SESSION_ID) continue;
            sessions.push({
                sessionId: key,
                createdAt: meta.createdAt,
                lastAccessTime: meta.lastAccessTime,
                ageMs: now - meta.createdAt,
                idleMs: now - meta.lastAccessTime,
                size: this._sessions.get(key)?.size || 0,
            });
        }
        
        return {
            totalSessions: this._sessions.size,
            userSessions: sessions.length,
            config: this._sessionConfig,
            sessions,
        };
    }

    /**
     * Manually trigger session cleanup.
     * Removes expired sessions and enforces maxSessions limit.
     * @returns {number} Number of sessions cleaned up
     */
    cleanupSessions() {
        const now = Date.now();
        const { sessionTTL, maxSessions } = this._sessionConfig;
        let cleaned = 0;

        // Remove expired sessions (TTL-based)
        if (sessionTTL > 0) {
            for (const [key, meta] of this._sessionMeta.entries()) {
                if (key === DEFAULT_SESSION_ID) continue;
                
                const idleTime = now - meta.lastAccessTime;
                if (idleTime > sessionTTL) {
                    this._sessions.delete(key);
                    this._sessionMeta.delete(key);
                    cleaned++;
                    this.debugLogger?.log('RecursiveSkilledAgent:expiredSession', {
                        sessionId: key,
                        idleTimeMs: idleTime,
                    });
                }
            }
        }

        // Enforce maxSessions (LRU eviction)
        cleaned += this._enforceMaxSessions();

        if (cleaned > 0) {
            this.debugLogger?.log('RecursiveSkilledAgent:cleanupComplete', {
                cleanedSessions: cleaned,
                remainingSessions: this._sessions.size,
            });
        }

        return cleaned;
    }

    /**
     * Enforce maxSessions limit using LRU eviction.
     * @private
     * @returns {number} Number of sessions evicted
     */
    _enforceMaxSessions() {
        const { maxSessions } = this._sessionConfig;
        if (maxSessions <= 0) return 0;

        // Count non-default sessions
        const userSessions = this.getActiveSessions();
        const excess = userSessions.length - maxSessions + 1; // +1 to make room for new session
        
        if (excess <= 0) return 0;

        // Sort by lastAccessTime (oldest first)
        const sorted = userSessions
            .map(key => ({
                key,
                lastAccess: this._sessionMeta.get(key)?.lastAccessTime || 0,
            }))
            .sort((a, b) => a.lastAccess - b.lastAccess);

        // Evict oldest sessions
        let evicted = 0;
        for (let i = 0; i < excess && i < sorted.length; i++) {
            const { key } = sorted[i];
            this._sessions.delete(key);
            this._sessionMeta.delete(key);
            evicted++;
            this.debugLogger?.log('RecursiveSkilledAgent:evictSession', {
                sessionId: key,
                reason: 'maxSessions exceeded',
            });
        }

        return evicted;
    }

    /**
     * Start the periodic cleanup timer.
     * @private
     */
    _startCleanupTimer() {
        if (this._cleanupTimer) return;

        const { cleanupInterval } = this._sessionConfig;
        if (cleanupInterval <= 0) return;

        this._cleanupTimer = setInterval(() => {
            this.cleanupSessions();
        }, cleanupInterval);

        // Don't prevent process exit
        if (this._cleanupTimer.unref) {
            this._cleanupTimer.unref();
        }
    }

    /**
     * Stop the periodic cleanup timer.
     * Call this when shutting down the agent.
     */
    stopCleanupTimer() {
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
            this._cleanupTimer = null;
        }
    }

    /**
     * Shutdown the agent gracefully.
     * Stops cleanup timer and clears all sessions.
     */
    shutdown() {
        this.stopCleanupTimer();
        this._sessions.clear();
        this._sessionMeta.clear();
        this.debugLogger?.log('RecursiveSkilledAgent:shutdown', { message: 'Sessions cleared' });
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
     * Find skills roots from start directories.
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
     * Get the skills directory path (skills folder).
     * @returns {string} The skills directory path
     */
    getSkillsDir() {
        return path.join(this.startDir, 'skills');
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

    /**
     * Await all pending skill preparations.
     * @returns {Promise<void>}
     */
    async awaitPreparations() {
        if (this.executor && typeof this.executor.awaitPendingPreparations === 'function') {
            await this.executor.awaitPendingPreparations();
        }
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
        // Filter out internal skills if exposeInternalSkills is false
        const filteredCandidates = this.exposeInternalSkills
            ? candidates
            : candidates.filter(skill => !skill.isInternal);
        
        return this.selector.chooseWithLLM(taskDescription, filteredCandidates);
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
     * 
     * Automatically injects sessionMemory into options.context based on:
     * 1. Explicit options.context.sessionId → uses that session
     * 2. options.context.user.sessionId → uses user's session (webchat)
     * 3. Otherwise → uses default session (CLI mode)
     * 
     * @param {string} taskDescription - The task description
     * @param {Object} options - Execution options
     * @param {Object} [options.context] - Execution context
     * @param {string} [options.context.sessionId] - Explicit session ID
     * @param {Object} [options.context.user] - User info (may contain sessionId)
     * @param {Map} [options.context.sessionMemory] - Override auto-injection
     * @param {string} reviewMode - Review mode ('none', 'llm', 'human')
     * @returns {Promise<Object>} The execution result
     */
    async executeWithReviewMode(taskDescription, options = {}, reviewMode = 'none') {
        // Auto-inject sessionMemory if not already provided
        const context = options.context || {};
        
        if (!context.sessionMemory) {
            // Determine session ID from context
            const sessionId = context.sessionId 
                || context.user?.sessionId 
                || context.user?.sessionToken
                || null;
            
            // Get or create session memory
            const sessionMemory = this.getSessionMemory(sessionId);
            
            // Inject into options
            options = {
                ...options,
                context: {
                    ...context,
                    sessionMemory,
                },
            };
            
            this.debugLogger?.log('RecursiveSkilledAgent:injectSessionMemory', {
                sessionId: sessionId || '__default__',
                sessionSize: sessionMemory.size,
            });
        }

        // Auto-inject I/O services if configured on agent and not already in context
        if (this.inputReader || this.outputWriter) {
            const currentContext = options.context || {};
            if (!currentContext.io) {
                options = {
                    ...options,
                    context: {
                        ...currentContext,
                        io: {
                            inputReader: this.inputReader,
                            outputWriter: this.outputWriter,
                        },
                    },
                };
                
                this.debugLogger?.log('RecursiveSkilledAgent:injectIO', {
                    hasInputReader: Boolean(this.inputReader),
                    hasOutputWriter: Boolean(this.outputWriter),
                });
            }
        }
        
        return this.executor.execute(taskDescription, options, reviewMode, this);
    }

    /**
     * Execute a prompt (no review).
     * @param {string} promptDescription - The prompt
     * @param {Object} options - Execution options
     * @param {Object} [options.context] - Execution context (sessionMemory auto-injected)
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
