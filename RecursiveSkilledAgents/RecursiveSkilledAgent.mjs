import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { LLMAgent } from '../LLMAgents/LLMAgent.mjs';
import { defaultPromptReader } from '../utils/defaultPromptReader.mjs';
import { CodeSkillsSubsystem } from '../CodeSkillsSubsystem/CodeSkillsSubsystem.mjs';
import { InteractiveSkillsSubsystem } from '../InteractiveSkillsSubsystem/InteractiveSkillsSubsystem.mjs';
import { ClaudeSkillsSubsystem } from '../ClaudeSkillsSubsystem/ClaudeSkillsSubsystem.mjs';
import { MCPSkillsSubsystem } from '../MCPSkillsSubsystem/MCPSkillsSubsystem.mjs';
import { OrchestratorSkillsSubsystem } from '../OrchestratorSkillsSubsystem/OrchestratorSkillsSubsystem.mjs';
import { DBTableSkillsSubsystem } from '../DBTableSkillsSubsystem/DBTableSkillsSubsystem.mjs';
import { Sanitiser } from '../utils/Sanitiser.mjs';
import { createFlexSearchAdapter } from '../utils/flexsearchAdapter.mjs';
import { getDebugLogger, DEBUG_ACTIVE } from '../utils/DebugLogger.mjs';

export const SKILL_FILE_TYPES = {
    'skill.md': { type: 'claude' },
    'iskill.md': { type: 'interactive' },
    'cskill.md': { type: 'code' },
    'mskill.md': { type: 'mcp' },
    'oskill.md': { type: 'orchestrator' },
    'tskill.md': { type: 'dbtable' },
};

/** List of valid skill definition filenames */
export const SKILL_FILE_NAMES = Object.keys(SKILL_FILE_TYPES);

function isReadableFile(candidate) {
    try {
        const stats = fs.statSync(candidate);
        return stats.isFile();
    } catch {
        return false;
    }
}

function isDirectory(candidate) {
    try {
        const stats = fs.statSync(candidate);
        return stats.isDirectory();
    } catch {
        return false;
    }
}

function createSectionKey(heading) {
    return heading
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function parseSkillDocument(filePath) {
    let raw = '';
    try {
        raw = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        return {
            title: path.basename(path.dirname(filePath)),
            summary: `Unable to read ${path.basename(filePath)}: ${error.message}`,
            body: '',
            sections: {},
        };
    }

    const lines = raw.split(/\r?\n/);
    let title = null;
    let summary = null;
    const bodyLines = [];
    const sections = new Map();
    const sectionBuffers = new Map();
    let currentSection = null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!title && trimmed.startsWith('#')) {
            const headingText = trimmed.replace(/^#+\s*/, '').trim();
            title = headingText;
            currentSection = createSectionKey(headingText);
            if (!sectionBuffers.has(currentSection)) {
                sectionBuffers.set(currentSection, []);
            }
            continue;
        }

        const headingMatch = trimmed.match(/^#{2,}\s*(.+)$/);
        if (headingMatch) {
            const headingText = headingMatch[1].trim();
            currentSection = createSectionKey(headingText);
            if (!sectionBuffers.has(currentSection)) {
                sectionBuffers.set(currentSection, []);
            }
            continue;
        }

        if (!summary && trimmed) {
            summary = trimmed;
        }

        if (currentSection) {
            const buffer = sectionBuffers.get(currentSection) || [];
            buffer.push(line);
            sectionBuffers.set(currentSection, buffer);
        }

        if (trimmed) {
            bodyLines.push(trimmed);
        }
    }

    if (!title) {
        title = path.basename(path.dirname(filePath));
    }

    if (!summary) {
        summary = `Auto-registered skill described in ${path.basename(filePath)}.`;
    }

    sectionBuffers.forEach((buffer, key) => {
        const joined = buffer.join('\n').trim();
        if (joined) {
            sections.set(key, joined);
        }
    });

    return {
        title,
        summary,
        body: bodyLines.join('\n'),
        sections: Object.fromEntries(sections),
    };
}

function sanitiseName(value) {
    return Sanitiser.sanitiseName(value);
}

export class RecursiveSkilledAgent {
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
        this.skillFilter = typeof skillFilter === 'function' ? skillFilter : (() => true);
        this.dbAdapter = dbAdapter;
        this.onProcessingBegin = typeof onProcessingBegin === 'function' ? onProcessingBegin : null;
        this.onProcessingProgress = typeof onProcessingProgress === 'function' ? onProcessingProgress : null;
        this.onProcessingEnd = typeof onProcessingEnd === 'function' ? onProcessingEnd : null;
        this._isProcessing = false; // Track if we're already processing to prevent nested callbacks
        this.searchUpwards = Boolean(searchUpwards);
        this.additionalSkillRoots = Array.isArray(additionalSkillRoots) ? additionalSkillRoots : [];

        this.llmAgent = llmAgent
            || new LLMAgent({ ...llmAgentOptions });

        this.subsystems = new Map();
        this.skillToSubsystem = new Map();
        this.skillCatalog = new Map();
        this.skillAliases = new Map();
        this.promptReader = typeof promptReader === 'function' ? promptReader : defaultPromptReader;
        this.pendingPreparations = [];

        this.debugLogger = DEBUG_ACTIVE ? getDebugLogger() : null;
        this.debugLogger?.log('RecursiveSkilledAgent:init', {
            startDir: this.startDir,
            hasLLMAgent: Boolean(llmAgent),
            llmAgentOptions: Object.keys(llmAgentOptions || {}),
        });

        // ActionReporter for real-time feedback (can be set via setActionReporter or inherited from llmAgent)
        this._actionReporter = null;

        this.registerDiscoveredSkills();
    }

    /**
     * Set an ActionReporter for real-time feedback
     * @param {ActionReporter} reporter - The reporter instance
     */
    setActionReporter(reporter) {
        this._actionReporter = reporter;
        // Also set on llmAgent if available
        if (this.llmAgent && typeof this.llmAgent.setActionReporter === 'function') {
            this.llmAgent.setActionReporter(reporter);
        }
    }

    /**
     * Get the current ActionReporter (from this instance or llmAgent)
     * @returns {ActionReporter|null}
     */
    getActionReporter() {
        return this._actionReporter || this.llmAgent?._actionReporter || null;
    }

    ensureSubsystem(type) {
        if (this.subsystems.has(type)) {
            return this.subsystems.get(type);
        }

        let subsystem;
        if (type === 'code') {
            subsystem = new CodeSkillsSubsystem({ llmAgent: this.llmAgent });
        } else if (type === 'interactive') {
            subsystem = new InteractiveSkillsSubsystem({ llmAgent: this.llmAgent });
        } else if (type === 'mcp') {
            subsystem = new MCPSkillsSubsystem({ llmAgent: this.llmAgent });
        } else if (type === 'orchestrator') {
            subsystem = new OrchestratorSkillsSubsystem({ llmAgent: this.llmAgent });
        } else if (type === 'dbtable') {
            subsystem = new DBTableSkillsSubsystem({
                llmAgent: this.llmAgent,
                dbAdapter: this.dbAdapter
            });
        } else {
            subsystem = new ClaudeSkillsSubsystem();
        }

        this.subsystems.set(type, subsystem);
        return subsystem;
    }

    registerDiscoveredSkills() {
        const roots = this.findAchillesSkillRoots([
            this.startDir,
            process.cwd(),
        ], this.searchUpwards);
        for (const root of roots) {
            this.registerSkillsFromRoot(root);
        }

        // Register additional skill roots (e.g., built-in skills from a library)
        for (const root of this.additionalSkillRoots) {
            if (isDirectory(root)) {
                this.registerSkillsFromRoot(root);
            }
        }
    }

    findAchillesSkillRoots(startDirs = [], searchUpwards = true) {
        const roots = [];
        const discovered = new Set();
        const directionLabel = searchUpwards ? 'up' : 'down';

        const registerCandidate = (candidate, source = null) => {
            if (!candidate || discovered.has(candidate)) {
                return;
            }
            discovered.add(candidate);
            this.debugLogger?.log('RecursiveSkilledAgent:discoveredRoot', {
                candidate,
                direction: directionLabel,
                source,
            });
            roots.push(candidate);
        };

        const visitedAscending = new Set();
        const collectAscending = (startDir) => {
            if (!startDir) {
                return;
            }
            let current = path.resolve(startDir);
            const { root } = path.parse(current);

            while (!visitedAscending.has(current)) {
                visitedAscending.add(current);
                const candidate = path.join(current, '.AchillesSkills');
                if (isDirectory(candidate)) {
                    registerCandidate(candidate, 'ascend');
                }
                if (current === root) {
                    break;
                }
                current = path.dirname(current);
            }
        };

        const visitedDescending = new Set();
        const collectSkillsDescending = (startDir) => {
            if (!startDir) {
                return;
            }
            const queue = [path.resolve(startDir)];

            for (let index = 0; index < queue.length; index += 1) {
                const current = queue[index];
                if (visitedDescending.has(current)) {
                    continue;
                }
                visitedDescending.add(current);

                const candidate = path.join(current, '.AchillesSkills');
                if (isDirectory(candidate)) {
                    registerCandidate(candidate, startDir);
                }

                let entries = [];
                try {
                    entries = fs.readdirSync(current, { withFileTypes: true });
                } catch (error) {
                    this.logger?.warn?.(`[RecursiveSkilledAgent] Failed to inspect directory ${current}: ${error.message}`);
                    continue;
                }

                for (const entry of entries) {
                    if (!entry.isDirectory()) {
                        continue;
                    }
                    if (entry.name === '.' || entry.name === '..') {
                        continue;
                    }
                    if (entry.name === 'node_modules') {
                        continue;
                    }
                    if (typeof entry.isSymbolicLink === 'function' && entry.isSymbolicLink()) {
                        continue;
                    }
                    const nextPath = path.join(current, entry.name);
                    if (!visitedDescending.has(nextPath)) {
                        queue.push(nextPath);
                    }
                }
            }
        };

        const findReposRoot = (startDir) => {
            if (!startDir) {
                return null;
            }
            const queue = [path.resolve(startDir)];
            const visited = new Set();

            for (let index = 0; index < queue.length; index += 1) {
                const current = queue[index];
                if (visited.has(current)) {
                    continue;
                }
                visited.add(current);

                const baseName = path.basename(current).toLowerCase();
                if (baseName === 'repos') {
                    return current;
                }

                let entries = [];
                try {
                    entries = fs.readdirSync(current, { withFileTypes: true });
                } catch (error) {
                    this.logger?.warn?.(`[RecursiveSkilledAgent] Failed to inspect directory ${current}: ${error.message}`);
                    continue;
                }

                for (const entry of entries) {
                    if (!entry.isDirectory()) {
                        continue;
                    }
                    if (entry.name === '.' || entry.name === '..') {
                        continue;
                    }
                    if (entry.name === 'node_modules') {
                        continue;
                    }
                    if (typeof entry.isSymbolicLink === 'function' && entry.isSymbolicLink()) {
                        continue;
                    }
                    const nextPath = path.join(current, entry.name);
                    queue.push(nextPath);
                }
            }
            return null;
        };

        if (!searchUpwards) {
            let reposRoot = null;
            for (const dir of startDirs) {
                reposRoot = findReposRoot(dir);
                if (reposRoot) {
                    break;
                }
            }

            if (reposRoot) {
                this.debugLogger?.log('RecursiveSkilledAgent:reposRoot', { reposRoot });
                collectSkillsDescending(reposRoot);
                return roots;
            }

            this.logger?.warn?.('[RecursiveSkilledAgent] No "repos" directory found during downward discovery.');
            return roots;
        }

        startDirs.forEach((dir) => collectAscending(dir));
        return roots;
    }

    registerSkillsFromRoot(rootDir) {
        let entries = [];
        try {
            entries = fs.readdirSync(rootDir, { withFileTypes: true });
        } catch (error) {
            this.logger.warn(`[RecursiveSkilledAgent] Failed to read skills directory ${rootDir}: ${error.message}`);
            return;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            const skillDir = path.join(rootDir, entry.name);
            this.registerSkillFromDirectory(skillDir);
        }
    }

    registerSkillFromDirectory(skillDir) {
        let descriptorFound = false;
        for (const [filename, descriptor] of Object.entries(SKILL_FILE_TYPES)) {
            const filePath = path.join(skillDir, filename);
            if (!isReadableFile(filePath)) {
                continue;
            }

            descriptorFound = true;
            this.registerSkillFromFile({
                filePath,
                type: descriptor.type,
                skillDir,
            });
        }

        if (descriptorFound) {
            return;
        }

        let entries = [];
        try {
            entries = fs.readdirSync(skillDir, { withFileTypes: true });
        } catch (error) {
            this.logger.warn(`[RecursiveSkilledAgent] Failed to inspect nested skill folder ${skillDir}: ${error.message}`);
            return;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            const nestedDir = path.join(skillDir, entry.name);
            this.registerSkillFromDirectory(nestedDir);
        }
    }

    registerSkillFromFile({ filePath, type, skillDir }) {
        const descriptor = parseSkillDocument(filePath);
        const shortName = path.basename(skillDir);
        const baseName = sanitiseName(descriptor?.title || shortName);
        const canonicalName = sanitiseName(`${baseName}-${type}`) || sanitiseName(`${shortName}-${type}`);

        const shouldInclude = this.skillFilter({
            type,
            filePath,
            skillDir,
            title: descriptor?.title,
            summary: descriptor?.summary,
            sections: descriptor?.sections,
        });
        if (!shouldInclude) {
            return;
        }

        const skillRecord = {
            name: canonicalName,
            type,
            descriptor,
            filePath,
            skillDir,
            shortName,
            metadata: null,
        };

        const aliases = new Set([
            canonicalName,
            sanitiseName(canonicalName),
            shortName,
            sanitiseName(shortName),
            baseName,
        ].filter(Boolean));

        this.debugLogger?.log('RecursiveSkilledAgent:registerSkill', {
            name: canonicalName,
            type,
            aliases: Array.from(aliases),
        });

        const subsystem = this.ensureSubsystem(type);
        if (subsystem && typeof subsystem.prepareSkill === 'function') {
            try {
                const prep = subsystem.prepareSkill(skillRecord, this);
                if (prep instanceof Promise) {
                    this.pendingPreparations.push(
                        prep.catch(error => {
                            this.logger.warn(`[RecursiveSkilledAgent] Failed to prepare skill ${canonicalName}: ${error.message}`);
                        })
                    );
                }
            } catch (error) {
                this.logger.warn(`[RecursiveSkilledAgent] Failed to prepare skill ${canonicalName}: ${error.message}`);
            }
        }

        this.skillCatalog.set(canonicalName, skillRecord);

        aliases.forEach((alias) => {
            this.skillAliases.set(alias, skillRecord);
            this.skillToSubsystem.set(alias, type);
        });
    }

    _invokeProcessingBegin() {
        if (this.onProcessingBegin) {
            try {
                this.onProcessingBegin();
            } catch (error) {
                this.logger?.warn?.(`[RecursiveSkilledAgent] onProcessingBegin callback error: ${error.message}`);
            }
        }
    }

    _invokeProcessingProgress() {
        if (this.onProcessingProgress) {
            try {
                this.onProcessingProgress();
            } catch (error) {
                this.logger?.warn?.(`[RecursiveSkilledAgent] onProcessingProgress callback error: ${error.message}`);
            }
        }
    }

    _invokeProcessingEnd() {
        if (this.onProcessingEnd) {
            try {
                this.onProcessingEnd();
            } catch (error) {
                this.logger?.warn?.(`[RecursiveSkilledAgent] onProcessingEnd callback error: ${error.message}`);
            }
        }
    }

    getSkillRecord(identifier) {
        if (!identifier || typeof identifier !== 'string') {
            return null;
        }
        const normalized = sanitiseName(identifier);
        const record = this.skillAliases.get(normalized) || null;
        this.debugLogger?.log('RecursiveSkilledAgent:getSkillRecord', {
            identifier,
            normalized,
            resolved: record?.name || null,
        });
        return record;
    }

    listSkillsByType(type) {
        return Array.from(this.skillCatalog.values()).filter((record) => record.type === type);
    }

    /**
     * Get all registered skills
     * @returns {Array} Array of skill records
     */
    getSkills() {
        return Array.from(this.skillCatalog.values());
    }

    /**
     * Get the starting directory for this agent
     * @returns {string} The start directory path
     */
    getStartDir() {
        return this.startDir;
    }

    /**
     * Get the skills directory path (.AchillesSkills folder)
     * @returns {string} The skills directory path
     */
    getSkillsDir() {
        return path.join(this.startDir, '.AchillesSkills');
    }

    /**
     * Get additional skill roots (e.g., built-in skills directories)
     * @returns {Array<string>} Array of additional skill root paths
     */
    getAdditionalSkillRoots() {
        return this.additionalSkillRoots;
    }

    /**
     * Find a skill file by skill name.
     * Checks the catalog first, then falls back to directory search.
     * @param {string} skillName - The skill name to find
     * @returns {{filePath: string, type: string, record: Object|null}|null} Skill file info or null
     */
    findSkillFile(skillName) {
        // Try catalog first
        const record = this.getSkillRecord(skillName);
        if (record?.filePath) {
            return { filePath: record.filePath, type: record.type, record };
        }

        // Fallback to directory search
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
     * Get user skills (excludes built-in skills from additionalSkillRoots)
     * @returns {Array} Array of user skill records
     */
    getUserSkills() {
        const builtInRoot = this.additionalSkillRoots?.[0];
        if (!builtInRoot) {
            return this.getSkills();
        }
        return this.getSkills().filter(s => !s.skillDir?.startsWith(builtInRoot));
    }

    /**
     * Check if a skill record is a built-in skill
     * @param {Object} skillRecord - The skill record to check
     * @returns {boolean} True if the skill is built-in
     */
    isBuiltInSkill(skillRecord) {
        const builtInRoot = this.additionalSkillRoots?.[0];
        if (!builtInRoot) return false;
        return skillRecord?.skillDir?.startsWith(builtInRoot) ?? false;
    }

    /**
     * Reload all skills from disk, clearing and re-discovering
     * @returns {number} The number of skills registered after reload
     */
    reloadSkills() {
        this.skillCatalog.clear();
        this.skillAliases.clear();
        this.skillToSubsystem.clear();
        this.registerDiscoveredSkills();
        return this.skillCatalog.size;
    }

    buildSearchText(record) {
        return [
            record.descriptor?.title,
            record.descriptor?.summary,
            record.descriptor?.body,
        ].filter(Boolean).join(' ');
    }

    selectOrchestratorForPrompt(taskDescription) {
        const orchestrators = this.listSkillsByType('orchestrator');
        if (!orchestrators.length) {
            return null;
        }

        const index = createFlexSearchAdapter({ tokenize: 'forward' });
        orchestrators.forEach((record, idx) => {
            try {
                index.add(String(idx), this.buildSearchText(record));
            } catch (error) {
                this.logger.warn(`[RecursiveSkilledAgent] Failed to index orchestrator ${record.name}: ${error.message}`);
            }
        });

        this.debugLogger?.log('RecursiveSkilledAgent:selectOrchestrator:start', {
            taskDescription,
            orchestratorCount: orchestrators.length,
        });

        const query = typeof taskDescription === 'string' ? taskDescription.trim() : '';
        if (query) {
            try {
                const matches = index.search(query, { limit: 1 }) || [];
            if (matches.length) {
                const [best] = matches;
                const position = Number.parseInt(typeof best === 'object' ? best.id ?? best.doc ?? best.key : best, 10);
                if (Number.isInteger(position) && orchestrators[position]) {
                    this.debugLogger?.log('RecursiveSkilledAgent:selectOrchestrator:searchMatch', {
                        method: 'index-position',
                        match: orchestrators[position].name,
                    });
                    return orchestrators[position];
                }
                const label = typeof best === 'string' ? best : String(best);
                const found = orchestrators.find((record) => sanitiseName(record.name) === sanitiseName(label) || sanitiseName(record.shortName) === sanitiseName(label));
                if (found) {
                    this.debugLogger?.log('RecursiveSkilledAgent:selectOrchestrator:searchMatch', {
                        method: 'label',
                        match: found.name,
                    });
                    return found;
                }
            }
        } catch (error) {
            this.logger.warn(`[RecursiveSkilledAgent] Orchestrator search failed: ${error.message}`);
            }
        }

        const tokens = query
            ? query.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2)
            : [];

        if (!tokens.length) {
            const selected = orchestrators[0] || null;
            if (selected) {
                this.debugLogger?.log('RecursiveSkilledAgent:selectOrchestrator:default', {
                    reason: 'no-tokens',
                    match: selected.name,
                });
            }
            return selected;
        }

        const scored = orchestrators
            .map((record) => {
                const haystack = this.buildSearchText(record).toLowerCase();
                let score = 0;
                tokens.forEach((token) => {
                    if (haystack.includes(token)) {
                        score += 1;
                    }
                });
                return { record, score };
            })
            .sort((a, b) => b.score - a.score);

        const best = scored.length && scored[0].score > 0 ? scored[0].record : orchestrators[0] || null;
        if (best) {
            this.debugLogger?.log('RecursiveSkilledAgent:selectOrchestrator:scored', {
                match: best.name,
            });
        }
        return best;
    }

    chooseSkillByHeuristic(taskDescription, candidates) {
        if (!candidates.length) {
            return null;
        }
        const query = typeof taskDescription === 'string' ? taskDescription.trim().toLowerCase() : '';
        if (!query) {
            return candidates[0];
        }
        const tokens = query.split(/[^a-z0-9]+/).filter((token) => token.length > 2);
        if (!tokens.length) {
            return candidates[0];
        }
        const scored = candidates
            .map((record) => {
                const haystack = this.buildSearchText(record).toLowerCase();
                let score = 0;
                tokens.forEach((token) => {
                    if (haystack.includes(token)) {
                        score += 1;
                    }
                });
                return { record, score };
            })
            .sort((a, b) => b.score - a.score);
        return scored.length && scored[0].score > 0 ? scored[0].record : candidates[0];
    }

    async chooseSkillWithLLM(taskDescription, candidates) {
        if (!candidates.length) {
            return null;
        }

        if (!this.llmAgent || typeof this.llmAgent.executePrompt !== 'function') {
            return this.chooseSkillByHeuristic(taskDescription, candidates);
        }

        const prompt = [
            '# Skill Selection',
            'Choose the single best skill for the request.',
            '',
            '## Request',
            taskDescription || '<empty>',
            '',
            '## Available Skills',
        ];

        candidates.forEach((record) => {
            prompt.push(`- ${record.name}: ${record.descriptor?.summary || 'No summary provided.'}`);
        });

        prompt.push(
            '',
            'Respond with either the exact skill name or the word "none".',
        );

        try {
            const response = await this.llmAgent.executePrompt(prompt.join('\n'), {
                mode: 'fast',
                context: { intent: 'recursive-skill-selection' },
            });

            if (typeof response === 'string') {
                const trimmed = response.trim();
                if (!trimmed || trimmed.toLowerCase() === 'none') {
                    return null;
                }
                const normalized = sanitiseName(trimmed.split(/[\s\r\n]+/)[0]);
                return candidates.find((record) =>
                    sanitiseName(record.name) === normalized
                    || sanitiseName(record.shortName) === normalized) || null;
            }
        } catch (error) {
            this.logger.warn(`[RecursiveSkilledAgent] Skill selection via LLM failed: ${error.message}`);
        }

        return this.chooseSkillByHeuristic(taskDescription, candidates);
    }

    async executeWithoutExplicitSkill(taskDescription, forwardOptions, reviewMode) {
        this.debugLogger?.log('RecursiveSkilledAgent:executeWithoutExplicitSkill', {
            taskDescription,
            reviewMode,
        });

        const orchestratorRecord = this.selectOrchestratorForPrompt(taskDescription);
        if (orchestratorRecord) {
            const subsystem = this.ensureSubsystem('orchestrator');
            const execution = await subsystem.executeSkillPrompt({
                skillRecord: orchestratorRecord,
                recursiveAgent: this,
                promptText: taskDescription,
                options: {
                    ...forwardOptions,
                    reviewMode,
                },
            });
            this.debugLogger?.log('RecursiveSkilledAgent:executeWithoutExplicitSkill:orchestrator', {
                selected: orchestratorRecord.name,
                reviewMode,
            });
            return {
                ...execution,
                reviewMode,
                subsystem: orchestratorRecord.type,
            };
        }

        const candidates = Array.from(this.skillCatalog.values());
        this.debugLogger?.log('RecursiveSkilledAgent:executeWithoutExplicitSkill:fallback-selection', {
            candidateCount: candidates.length,
        });
        const selected = await this.chooseSkillWithLLM(taskDescription, candidates);

        if (selected) {
            this.debugLogger?.log('RecursiveSkilledAgent:executeWithoutExplicitSkill:llm-selected', {
                selected: selected.name,
            });
            return this.executeWithReviewMode(taskDescription, {
                ...forwardOptions,
                skillName: selected.name,
            }, reviewMode);
        }

        throw new Error('Unable to determine an appropriate skill for the request.');
    }

    async executeWithReviewMode(taskDescription, options = {}, reviewMode = 'none') {
        // Only invoke callbacks at the top level, not for nested calls
        const isTopLevel = !this._isProcessing;
        if (isTopLevel) {
            this._isProcessing = true;
            this._invokeProcessingBegin();
        }

        // Get action reporter for real-time feedback
        const actionReporter = this.getActionReporter();
        let skillAction = null;

        try {
            if (this.pendingPreparations && this.pendingPreparations.length) {
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
                const result = await this.executeWithoutExplicitSkill(taskDescription, forward, reviewMode);
                if (actionReporter && isTopLevel) {
                    actionReporter.completeAction();
                }
                return result;
            }

            const skillRecord = this.getSkillRecord(skillName);
            if (!skillRecord) {
                throw new Error(`Skill "${skillName}" is not registered.`);
            }

            // Report skill execution start
            if (actionReporter) {
                const displayName = skillRecord.shortName || skillRecord.name || skillName;
                skillAction = actionReporter.executingSkill(displayName, taskDescription?.slice(0, 50));
            }

            const subsystem = this.ensureSubsystem(skillRecord.type);

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

            if (skillRecord.type === 'interactive') {
                const requiredList = Array.isArray(skillRecord.requiredArguments)
                    ? skillRecord.requiredArguments
                    : [];
                requiredList.forEach(injectArg);
            }

            if (!Object.keys(args).length) {
                args.input = taskDescription;
            }

            const execution = await subsystem.executeSkillPrompt({
                skillRecord,
                recursiveAgent: this,
                promptText: taskDescription,
                options: {
                    ...forward,
                    args,
                    promptReader: promptReader || this.promptReader,
                },
            });

            // Report skill completion
            if (skillAction && actionReporter) {
                actionReporter.completeAction({ skill: skillName });
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
                this._invokeProcessingEnd();
                this._isProcessing = false;
            }
        }
    }

    async executePrompt(promptDescription, options = {}) {
        return this.executeWithReviewMode(promptDescription, options, 'none');
    }

    async executePromptWithReview(taskDescription, options = {}) {
        return this.executeWithReviewMode(taskDescription, options, 'llm');
    }

    async executePromptWithHumanReview(taskDescription, options = {}) {
        return this.executeWithReviewMode(taskDescription, options, 'human');
    }

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
}
