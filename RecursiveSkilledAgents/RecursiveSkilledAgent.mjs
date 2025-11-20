import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { createSkilledAgent, SkilledAgent } from '../SkilledAgents/index.mjs';
import { CodeSkillsSubsystem } from '../CodeSkillsSubsystem/CodeSkillsSubsystem.mjs';
import { InteractiveSkillsSubsystem } from '../InteractiveSkillsSubsystem/InteractiveSkillsSubsystem.mjs';
import { CloudeSkillsSubsystem } from '../CloudeSkillsSubsystem/CloudeSkillsSubsystem.mjs';
import { MCPSkillsSubsystem } from '../MCPSkillsSubsystem/MCPSkillsSubsystem.mjs';
import { OrchestratorSkillsSubsystem } from '../OrchestratorSkillsSubsystem/OrchestratorSkillsSubsystem.mjs';
import { DBTableSkillsSubsystem } from '../DBTableSkillsSubsystem/DBTableSkillsSubsystem.mjs';
import { Sanitiser } from '../utils/Sanitiser.mjs';
import { createFlexSearchAdapter } from '../SkilledAgents/search/flexsearchAdapter.mjs';
import { getDebugLogger, DEBUG_ACTIVE } from '../utils/DebugLogger.mjs';

const SKILL_FILE_TYPES = {
    'skill.md': { type: 'claude' },
    'iskill.md': { type: 'interactive' },
    'cskill.md': { type: 'code' },
    'mskill.md': { type: 'mcp' },
    'oskill.md': { type: 'orchestrator' },
    'tskill.md': { type: 'dbtable' },
};

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
        skilledAgent = null,
        skilledAgentOptions = {},
        startDir = process.cwd(),
        skillFilter = null,
        logger = console,
        dbAdapter = null,
    } = {}) {
        if (skilledAgent && !(skilledAgent instanceof SkilledAgent)) {
            throw new TypeError('RecursiveSkilledAgent requires a SkilledAgent instance.');
        }

        this.logger = logger || console;
        this.startDir = startDir;
        this.skillFilter = typeof skillFilter === 'function' ? skillFilter : (() => true);
        this.dbAdapter = dbAdapter;

        this.aggregatorAgent = skilledAgent
            || createSkilledAgent({ ...skilledAgentOptions });

        this.subsystems = new Map();
        this.skillToSubsystem = new Map();
        this.skillCatalog = new Map();
        this.skillAliases = new Map();
        this.promptReader = this.aggregatorAgent?.promptReader || null;
        this.pendingPreparations = [];

        this.debugLogger = DEBUG_ACTIVE ? getDebugLogger() : null;
        this.debugLogger?.log('RecursiveSkilledAgent:init', {
            startDir: this.startDir,
            hasSkilledAgent: Boolean(skilledAgent),
            skilledAgentOptions: Object.keys(skilledAgentOptions || {}),
        });

        this.registerDiscoveredSkills();
    }

    ensureSubsystem(type) {
        if (this.subsystems.has(type)) {
            return this.subsystems.get(type);
        }

        let subsystem;
        if (type === 'code') {
            subsystem = new CodeSkillsSubsystem({ llmAgent: this.aggregatorAgent.llmAgent });
        } else if (type === 'interactive') {
            subsystem = new InteractiveSkillsSubsystem({ llmAgent: this.aggregatorAgent.llmAgent });
        } else if (type === 'mcp') {
            subsystem = new MCPSkillsSubsystem({ llmAgent: this.aggregatorAgent.llmAgent });
        } else if (type === 'orchestrator') {
            subsystem = new OrchestratorSkillsSubsystem({ llmAgent: this.aggregatorAgent.llmAgent });
        } else if (type === 'dbtable') {
            subsystem = new DBTableSkillsSubsystem({
                llmAgent: this.aggregatorAgent.llmAgent,
                dbAdapter: this.dbAdapter
            });
        } else {
            subsystem = new CloudeSkillsSubsystem();
        }

        this.subsystems.set(type, subsystem);
        return subsystem;
    }

    registerDiscoveredSkills() {
        const roots = this.findAchillesSkillRoots([
            this.startDir,
            process.cwd(),
        ]);
        for (const root of roots) {
            this.registerSkillsFromRoot(root);
        }
    }

    findAchillesSkillRoots(startDirs = []) {
        const visited = new Set();
        const roots = [];

        const collect = (startDir) => {
            if (!startDir) {
                return;
            }
            let current = path.resolve(startDir);
            const { root } = path.parse(current);

            while (!visited.has(current)) {
                visited.add(current);
                const candidate = path.join(current, '.AchillesSkills');
                if (isDirectory(candidate)) {
                    this.debugLogger?.log('RecursiveSkilledAgent:discoveredRoot', { candidate });
                    roots.push(candidate);
                }
                if (current === root) {
                    break;
                }
                current = path.dirname(current);
            }
        };

        startDirs.forEach((dir) => collect(dir));
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

        const llmAgent = this.aggregatorAgent?.llmAgent;
        if (!llmAgent || typeof llmAgent.executePrompt !== 'function') {
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
            const response = await llmAgent.executePrompt(prompt.join('\n'), {
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
            return this.executeWithoutExplicitSkill(taskDescription, forward, reviewMode);
        }

        const skillRecord = this.getSkillRecord(skillName);
        if (!skillRecord) {
            throw new Error(`Skill "${skillName}" is not registered.`);
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

        return {
            ...execution,
            reviewMode,
            subsystem: skillRecord.type,
        };
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
