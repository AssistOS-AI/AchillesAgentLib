import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { createSkilledAgent, SkilledAgent } from '../SkilledAgents/index.mjs';
import { CodeSkillsSubsystem } from '../CodeSkillsSubsystem/CodeSkillsSubsystem.mjs';
import { SimpleSkillsSubsystem } from '../SimpleSkillsSubsystem/SimpleSkillsSubsystem.mjs';

const SKILL_FILE_TYPES = {
    'skill.md': { type: 'claude' },
    'iskill.md': { type: 'interactive' },
    'cskill.md': { type: 'code' },
    'mskill.md': { type: 'mcp' },
    'oskill.md': { type: 'orchestrator' },
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
    return value
        .toLowerCase()
        .replace(/[^a-z0-9_\-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export class RecursiveSkilledAgent {
    constructor({
        skilledAgent = null,
        skilledAgentOptions = {},
        startDir = process.cwd(),
        skillFilter = null,
        logger = console,
    } = {}) {
        if (skilledAgent && !(skilledAgent instanceof SkilledAgent)) {
            throw new TypeError('RecursiveSkilledAgent requires a SkilledAgent instance.');
        }

        this.logger = logger || console;
        this.startDir = startDir;
        this.skillFilter = typeof skillFilter === 'function' ? skillFilter : (() => true);

        this.aggregatorAgent = skilledAgent
            || createSkilledAgent({ ...skilledAgentOptions });

        this.subsystems = new Map();
        this.skillToSubsystem = new Map();

        this.registerDiscoveredSkills();
    }

    ensureSubsystem(type) {
        if (this.subsystems.has(type)) {
            return this.subsystems.get(type);
        }

        let subsystem;
        if (type === 'code') {
            subsystem = new CodeSkillsSubsystem({ skilledAgent: this.aggregatorAgent });
        } else {
            subsystem = new SimpleSkillsSubsystem({ type, skilledAgent: this.aggregatorAgent });
        }

        this.subsystems.set(type, subsystem);
        return subsystem;
    }

    registerDiscoveredSkills() {
        const roots = this.findAchillesSkillRoots();
        for (const root of roots) {
            this.registerSkillsFromRoot(root);
        }
    }

    findAchillesSkillRoots() {
        const roots = [];
        let current = path.resolve(this.startDir);
        const { root } = path.parse(current);

        while (true) {
            const candidate = path.join(current, '.AchillesSkills');
            if (isDirectory(candidate)) {
                roots.push(candidate);
            }
            if (current === root) {
                break;
            }
            current = path.dirname(current);
        }

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
        const { title, summary, body, sections } = parseSkillDocument(filePath);
        const baseName = sanitiseName(title || path.basename(skillDir));
        const skillName = sanitiseName(`${baseName}-${type}`) || sanitiseName(`${path.basename(skillDir)}-${type}`);

        const shouldInclude = this.skillFilter({
            type,
            filePath,
            skillDir,
            title,
            summary,
            sections,
        });
        if (!shouldInclude) {
            return;
        }

        const subsystem = this.ensureSubsystem(type);
        let canonicalName;
        try {
            canonicalName = subsystem.registerSkillDescriptor({
                skillName,
                summary,
                filePath,
                skillDir,
                sections,
                body,
                title,
                type,
            });
        } catch (error) {
            this.logger.warn(`[RecursiveSkilledAgent] Failed to register skill from ${filePath}: ${error.message}`);
            return;
        }

        if (canonicalName) {
            const normalized = sanitiseName(canonicalName);
            this.skillToSubsystem.set(canonicalName, type);
            this.skillToSubsystem.set(normalized, type);
        }
    }

    async getSubsystemCandidate(subsystem, taskDescription, rankOptions = {}) {
        try {
            return await subsystem.chooseSkill(taskDescription, rankOptions);
        } catch (error) {
            this.logger.warn(`[RecursiveSkilledAgent] Failed to rank skills in subsystem: ${error.message}`);
            return null;
        }
    }

    async resolveSubsystemTie(taskDescription, candidates) {
        const llmAgent = this.aggregatorAgent?.llmAgent;
        if (!llmAgent) {
            return candidates[0];
        }

        const descriptionLines = candidates.map(({ subsystemType, skillName, metadata }, index) => {
            const summary = metadata?.summary || metadata?.title || 'No description';
            return `${index + 1}. Subsystem: ${subsystemType} | Skill: ${skillName} | Summary: ${summary}`;
        });

        const prompt = [
            '# Choose the Best Skill',
            'You are helping select the most suitable skill to handle the user request.',
            `User request: ${taskDescription}`,
            '',
            'Candidates:',
            ...descriptionLines,
            '',
            'Respond with the skill name that should be used. If none seem appropriate, reply with "none".',
        ].join('\n');

        try {
            const response = await llmAgent.complete({
                prompt,
                mode: 'fast',
                context: { intent: 'skill-subsystem-selection' },
            });
            const normalized = String(response || '').toLowerCase();
            for (const candidate of candidates) {
                const names = [candidate.skillName, candidate.metadata?.title].filter(Boolean);
                if (names.some((name) => normalized.includes(String(name).toLowerCase()))) {
                    return candidate;
                }
            }
        } catch (error) {
            this.logger.warn(`[RecursiveSkilledAgent] Tie-break prompt failed: ${error.message}`);
        }

        return candidates[0];
    }

    async selectSkill(taskDescription, options = {}) {
        const rankOptions = options.rankOptions || {};
        const candidates = [];

        for (const [type, subsystem] of this.subsystems.entries()) {
            const candidate = await this.getSubsystemCandidate(subsystem, taskDescription, rankOptions);
            if (candidate && candidate.name) {
                candidates.push({
                    subsystem,
                    subsystemType: type,
                    skillName: candidate.name,
                    score: candidate.score,
                    metadata: candidate.metadata,
                });
            }
        }

        if (!candidates.length) {
            return null;
        }

        candidates.sort((a, b) => a.score - b.score);
        const bestScore = candidates[0].score;
        const bestCandidates = candidates.filter((item) => item.score === bestScore);

        if (bestCandidates.length === 1) {
            return bestCandidates[0];
        }

        return this.resolveSubsystemTie(taskDescription, bestCandidates);
    }

    findSubsystemForSkill(skillName) {
        const type = this.skillToSubsystem.get(skillName);
        if (!type) {
            return null;
        }
        return this.subsystems.get(type) || null;
    }

    async executeWithReviewMode(taskDescription, options = {}, reviewMode = 'none') {
        let { skillName = null, subsystemType = null } = options || {};
        const contextManager = options.contextManager || null;
        const args = { ...(options.args || {}) };
        const securityContext = options.securityContext || null;
        const rankOptions = options.rankOptions || {};

        let subsystem = null;

        if (skillName) {
            skillName = sanitiseName(skillName);
            subsystem = subsystemType ? this.subsystems.get(subsystemType) : this.findSubsystemForSkill(skillName);
            if (!subsystem) {
                throw new Error(`Skill "${skillName}" is not registered.`);
            }
        } else if (subsystemType) {
            subsystem = this.subsystems.get(subsystemType);
            if (!subsystem) {
                throw new Error(`Subsystem "${subsystemType}" is not registered.`);
            }
        }

        if (subsystem && !skillName) {
            const chosen = await subsystem.chooseSkill(taskDescription, rankOptions);
            if (!chosen || !chosen.name) {
                throw new Error('No skill available to handle the request.');
            }
            skillName = chosen.name;
            if (!options.args && chosen.metadata?.defaultArgument) {
                args[chosen.metadata.defaultArgument] = taskDescription;
            }
        }

        if (!subsystem) {
            const selection = await this.selectSkill(taskDescription, options);
            if (!selection) {
                throw new Error('No skill available to handle the request.');
            }
            subsystem = selection.subsystem;
            subsystemType = selection.subsystemType;
            skillName = selection.skillName;
            if (!options.args && selection.metadata?.defaultArgument) {
                args[selection.metadata.defaultArgument] = taskDescription;
            }
        }

        const metadata = subsystem.getMetadata ? subsystem.getMetadata(skillName) : null;
        if (!options.args && metadata?.defaultArgument && !Object.prototype.hasOwnProperty.call(args, metadata.defaultArgument)) {
            args[metadata.defaultArgument] = taskDescription;
        }

        const execution = await subsystem.executePrompt(taskDescription, {
            skillName,
            args,
            securityContext,
            contextManager,
            rankOptions,
        });

        return {
            ...execution,
            reviewMode,
            subsystem: subsystemType || this.skillToSubsystem.get(skillName) || null,
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
