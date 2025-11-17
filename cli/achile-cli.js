import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { Writable } from 'node:stream';

import { LLMAgent } from '../LLMAgents/index.mjs';
import { SkilledAgent } from '../SkilledAgents/index.mjs';
import { RecursiveSkilledAgent } from '../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';
import GampRSP from './GampRSP.mjs';
import { configureLLMLogger, getLLMStats } from '../utils/LLMLogger.mjs';
import { MemoryContainer } from '../MemoryContainer/MemoryContainer.mjs';

const COLOR_RESET = '\x1b[0m';
const COLOR_INFO = '\x1b[36m';
const COLOR_WARN = '\x1b[33m';
const COLOR_ERROR = '\x1b[31m';
const COLOR_DEBUG = '\x1b[35m';
const COLOR_DEBUG_REQUEST = '\x1b[93m';
const COLOR_DEBUG_RESPONSE = '\x1b[33m';
const DEBUG_PREFIX = 'LLM_DEBUG:';

const DEFAULT_LIST_COLUMNS = ['name', 'type', 'summary', 'implementation'];
const AUTO_BOOTSTRAP_SKILLS = [
    {
        name: 'ignore-files',
        prompt: 'Automatic bootstrap: ensure default ignore list is applied.',
    },
    {
        name: 'reverse-specs',
        prompt: 'Automatic bootstrap: synchronise specifications with current workspace files.',
    },
];
const BOOTSTRAP_MODES = new Set(['auto', 'ask', 'manual']);
const looksLikeEnvelope = (text) => {
    if (typeof text !== 'string') {
        return false;
    }
    const trimmed = text.trim();
    return trimmed.includes('"__webchatMessage"')
        && trimmed.includes('"version"')
        && trimmed.includes('"text"')
        && trimmed.includes('"attachments"');
};

const isTruthy = (value) => {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value !== 'string') {
        return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

const ensureArray = (value) => {
    if (Array.isArray(value)) {
        return value.filter(Boolean);
    }
    if (!value) {
        return [];
    }
    return String(value)
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
};

const detectImplementation = (skillRecord) => {
    const directory = skillRecord.skillDir;
    if (!directory || !fs.existsSync(directory)) {
        return 'unknown';
    }
    const entries = fs.readdirSync(directory);

    const hasJs = entries.some((entry) => entry.toLowerCase().endsWith('.js'));
    const sopEntries = entries.filter((entry) => entry.toLowerCase().endsWith('.sop'));

    if (hasJs && sopEntries.length) {
        return 'javascript + soplang';
    }
    if (hasJs) {
        return 'javascript';
    }
    if (sopEntries.length) {
        return 'soplang';
    }

    const descriptorBody = skillRecord.descriptor?.body || '';
    if (/^#!english/m.test(descriptorBody)) {
        return 'english';
    }
    return 'descriptor-only';
};

const buildPlanPrompt = ({ task, orchestrators, languageContract = '' }) => {
    const sections = [];
    sections.push('# Achiles CLI Orchestrator Planner');
    sections.push('Produce a step-by-step plan that maps the task to orchestrator skills.');
    sections.push('Return JSON array where each entry has fields "skill" and "prompt".');
    sections.push('You may reuse the same skill multiple times with different prompts.');
    sections.push('Only use skills from the catalog and copy their names exactly.');
    sections.push('Keep prompts concise and specific to the sub-task each skill should solve.');
    sections.push('');
    sections.push('## Task');
    sections.push(task || '<empty>');
    if (languageContract) {
        sections.push('');
        sections.push(languageContract.trim());
    }
    sections.push('');
    sections.push('## Available Orchestrator Skills');
    orchestrators.forEach((record) => {
        sections.push(JSON.stringify({
            name: record.name,
            summary: record.descriptor?.summary || '',
            instructions: record.metadata?.instructions || '',
        }, null, 2));
    });
    sections.push('');
    sections.push('## Response Format');
    sections.push('[ { "skill": "skill-name", "prompt": "subset of task" } ]');

    return sections.join('\n');
};

const parsePlan = (raw) => {
    const tryParse = (payload) => {
        if (!payload) {
            return null;
        }
        if (typeof payload === 'object') {
            if (Array.isArray(payload)) {
                return payload;
            }
            if (Array.isArray(payload.steps)) {
                return payload.steps;
            }
            if (Array.isArray(payload.plan)) {
                return payload.plan;
            }
        }
        if (typeof payload === 'string') {
            try {
                return tryParse(JSON.parse(payload));
            } catch {
                return null;
            }
        }
        return null;
    };

    const parsed = tryParse(raw);
    if (parsed && parsed.length) {
        return parsed
            .map((entry) => ({
                skill: typeof entry.skill === 'string' ? entry.skill.trim() : '',
                prompt: typeof entry.prompt === 'string' ? entry.prompt.trim() : '',
            }))
            .filter((entry) => entry.skill && entry.prompt);
    }
    return [];
};

class AchilesCLI {
    constructor({
        startDirs = [],
        workspaceRoot = process.cwd(),
        llmAgent = null,
        promptReader = null,
        output = process.stdout,
        listTimeoutMs = 1500,
        autoBootstrapMode = null,
        interactive = false,
        requirePlanConfirmation = null,
        announceStepProgress = null,
    } = {}) {
        const skillDirs = ensureArray(startDirs);
        this._customPromptReader = typeof promptReader === 'function' ? promptReader : null;
        this.promptReader = this._customPromptReader || ((message) => this._askUser(message));
        this.output = output || process.stdout;
        this.listTimeoutMs = Number.isFinite(listTimeoutMs) && listTimeoutMs > 0
            ? listTimeoutMs
            : 1500;

        this.workspaceRoot = path.resolve(workspaceRoot || process.cwd());
        this.specsRoot = path.join(this.workspaceRoot, '.specs');
        this._bootstrapRequired = !fs.existsSync(this.specsRoot);
        GampRSP.configure(this.workspaceRoot);
        this.specsRoot = GampRSP.getSpecsDirectory();
        this.llmLogsPath = path.join(this.specsRoot, '.llm_logs');
        this.llmStatsPath = path.join(this.specsRoot, '.llm_stats');
        configureLLMLogger({
            logsFile: this.llmLogsPath,
            statsFile: this.llmStatsPath,
        });
        this.historyEntries = [];
        this.readline = null;
        this.historyFile = null;
        this._initHistory();
        this.globalMemory = new MemoryContainer({
            baseDir: this.specsRoot,
            initialHistory: this._loadMemoryHistory('global_memory'),
        });
        this.userMemory = new MemoryContainer({
            baseDir: this.specsRoot,
            initialHistory: this._loadMemoryHistory('user_memory'),
        });
        this.sessionMemory = new MemoryContainer({
            baseDir: this.specsRoot,
            initialHistory: [],
        });
        this.defaultModelMode = process.env.DEFAULT_MODEL_TYPE === 'deep' ? 'deep' : 'fast';
        this.specLanguage = this._normalizeSpecLanguageInput(process.env.DEFAULT_SPEC_LANGUAGE) || 'english';
        this.bootstrapCompleted = false;
        this.interactive = Boolean(interactive);
        const defaultBootstrapMode = this.interactive ? 'ask' : 'auto';
        this.autoBootstrapMode = this._normalizeBootstrapMode(autoBootstrapMode, defaultBootstrapMode);
        this.requirePlanConfirmation = typeof requirePlanConfirmation === 'boolean'
            ? requirePlanConfirmation
            : false;
        this.announceStepProgress = typeof announceStepProgress === 'boolean'
            ? announceStepProgress
            : this.interactive;
        this.pendingPlan = null;
        this._keypressHandlerInitialized = false;
        this.planInProgress = false;
        this.cancelRequested = false;
        this._handleKeypressBound = (str, key) => this._handleGlobalKeypress(str, key);
        this._rawModeWasEnabled = false;
        this.debugMode = isTruthy(process.env.ACHILES_LLM_DEBUG);
        this.llmAgent = llmAgent instanceof LLMAgent
            ? llmAgent
            : new LLMAgent();
        this._llmDebugSupported = typeof this.llmAgent?.setDebugLogger === 'function'
            && typeof this.llmAgent?.setDebugEnabled === 'function';
        if (this._llmDebugSupported) {
            this.llmAgent.setDebugLogger((event) => this._handleLLMDebugEvent(event));
            this.llmAgent.setDebugEnabled(this.debugMode);
        }
        this._wrapLLMCompleteHook();

        const cliSkillRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '.AchillesSkills');
        this.skillSearchRoots = [
            cliSkillRoot,
            ...(skillDirs.length ? skillDirs : [this.workspaceRoot]),
        ]
            .map((dir) => path.resolve(dir));

        this.skilledAgent = new SkilledAgent({
            llmAgent: this.llmAgent,
            promptReader: this.promptReader,
        });

        this.recursiveAgent = new RecursiveSkilledAgent({
            skilledAgent: this.skilledAgent,
            startDir: this.skillSearchRoots[0],
        });

        this._registerLocalSkills();
        if (this.interactive) {
            this._setupGlobalKeypressHandler();
        }
    }

    _normalizeBootstrapMode(mode, fallback = 'auto') {
        const candidate = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
        if (BOOTSTRAP_MODES.has(candidate)) {
            return candidate;
        }
        const normalizedFallback = typeof fallback === 'string' ? fallback.trim().toLowerCase() : '';
        if (BOOTSTRAP_MODES.has(normalizedFallback)) {
            return normalizedFallback;
        }
        return 'auto';
    }
    
    _initHistory() {
        const baseSpecs = this.specsRoot || path.join(this.workspaceRoot, '.specs');
        try {
            fs.mkdirSync(baseSpecs, { recursive: true });
        } catch {
            // ignore directory creation issues
        }
        this.historyFile = path.join(baseSpecs, '.prompts_history');
        if (fs.existsSync(this.historyFile)) {
            try {
                const raw = fs.readFileSync(this.historyFile, 'utf8');
                this.historyEntries = raw
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter(Boolean);
            } catch {
                this.historyEntries = [];
            }
        } else {
            this.historyEntries = [];
        }
    }
    
    _loadMemoryHistory(key) {
        if (!this.specsRoot) {
            return [];
        }
        const filePath = path.join(this.specsRoot, `.history_${key}`);
        if (!fs.existsSync(filePath)) {
            return [];
        }
        try {
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (Array.isArray(raw?.history)) {
                return raw.history;
            }
        } catch {
            // ignore parse errors
        }
        return [];
    }
    
    _persistMemory(container, key) {
        if (!container || typeof container.saveContext !== 'function') {
            return;
        }
        try {
            container.saveContext(key);
        } catch {
            // ignore persistence errors
        }
    }
    
    _setupGlobalKeypressHandler() {
        if (!process.stdin || typeof process.stdin.on !== 'function') {
            return;
        }
        if (this._keypressHandlerInitialized) {
            return;
        }
        if (typeof readline.emitKeypressEvents === 'function') {
            readline.emitKeypressEvents(process.stdin);
        }
        if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
            try {
                process.stdin.setRawMode(true);
                this._rawModeWasEnabled = true;
            } catch {
                // ignore raw mode errors
            }
        }
        process.stdin.on('keypress', this._handleKeypressBound);
        this._keypressHandlerInitialized = true;
    }

    _restoreInputMode() {
        if (this._keypressHandlerInitialized && process.stdin && typeof process.stdin.off === 'function') {
            process.stdin.off('keypress', this._handleKeypressBound);
        }
        if (this._rawModeWasEnabled && process.stdin && typeof process.stdin.setRawMode === 'function') {
            try {
                process.stdin.setRawMode(false);
            } catch {
                // ignore restore issues
            }
        }
        this._keypressHandlerInitialized = false;
        this._rawModeWasEnabled = false;
    }

    _resolveSkillRoot(dir) {
        const absolute = path.resolve(dir);
        if (fs.existsSync(absolute)) {
            const stats = fs.statSync(absolute);
            if (stats.isDirectory() && path.basename(absolute) === '.AchillesSkills') {
                return absolute;
            }
        }
        const candidate = path.join(absolute, '.AchillesSkills');
        if (!fs.existsSync(candidate)) {
            return null;
        }
        const stats = fs.statSync(candidate);
        return stats.isDirectory() ? candidate : null;
    }

    _registerLocalSkills() {
        const skillRoots = this.skillSearchRoots
            .map((dir) => this._resolveSkillRoot(dir))
            .filter(Boolean);

        this.recursiveAgent.skillCatalog.clear();
        this.recursiveAgent.skillAliases.clear();
        this.recursiveAgent.skillToSubsystem.clear();

        const seenSubsystems = new Set();
        for (const [key] of this.recursiveAgent.subsystems) {
            seenSubsystems.add(key);
        }
        this.recursiveAgent.subsystems.clear();
        seenSubsystems.forEach((key) => this.recursiveAgent.ensureSubsystem(key));

        skillRoots.forEach((root) => {
            try {
                this.recursiveAgent.registerSkillsFromRoot(root);
            } catch (error) {
                    this.output.write(`${COLOR_WARN}[warn] Failed to register skills from ${root}: ${error.message}${COLOR_RESET}\n`);
            }
        });
    }

    _looksLikeSpecCreationRequest(text = '') {
        const normalized = text.toLowerCase();
        if (!normalized) {
            return false;
        }
        const verbs = [
            'adauga',
            'adaugă',
            'creeaza',
            'creează',
            'creaza',
            'initializeaza',
            'documenteaza',
            'descrie',
            'genereaza',
            'generate',
            'create',
            'add',
            'update',
            'extend',
            'include',
            'configur',
            'introdu',
        ];
        return verbs.some((verb) => normalized.includes(verb));
    }

    async _looksLikeSpecStatusQuestion(text = '') {
        if (this._looksLikeSpecCreationRequest(text)) {
            return false;
        }
        const normalized = text.toLowerCase();
        if (normalized) {
            const keywords = ['stare', 'status', 'cerinte', 'spec', 'requirement', 'specification'];
            if (keywords.some((token) => normalized.includes(token))) {
                return true;
            }
        }
        if (!this.llmAgent || typeof this.llmAgent.executePrompt !== 'function') {
            return false;
        }
        const prompt = [
            '# Spec Intent Detector',
            'Decide whether the following message is asking for a specification status/summary (as opposed to requesting new specifications).',
            'Respond with JSON: { "status": true|false }',
            `Message:\n${text}`,
        ].join('\n\n');
        try {
            const response = await this.llmAgent.executePrompt(prompt, {
                responseShape: 'json',
                context: { intent: 'spec-status-detection' },
            });
            return Boolean(response?.status);
        } catch {
            return false;
        }
    }

    _normalizeSpecLanguageInput(value) {
        if (typeof value !== 'string') {
            return '';
        }
        return value.trim().toLowerCase();
    }

    _activeSpecLanguage() {
        return this._normalizeSpecLanguageInput(this.specLanguage) || 'english';
    }

    setSpecLanguage(language) {
        const normalized = this._normalizeSpecLanguageInput(language);
        if (!normalized || normalized.length < 2) {
            throw new Error('Specification language requires at least two characters.');
        }
        this.specLanguage = normalized;
        process.env.DEFAULT_SPEC_LANGUAGE = normalized;
        return normalized;
    }

    _languageContractBlock({ heading = '## Language Requirements' } = {}) {
        const sectionHeading = typeof heading === 'string' && heading.trim()
            ? heading.trim()
            : '## Language Requirements';
        const language = this._activeSpecLanguage();
        return [
            sectionHeading,
            `- Output language: ${language}.`,
            '- Always respond in this language even when prompts use another language.',
            '- Translate and restate user instructions before generating specifications.',
            '- Remind the operator they can run "/lang <code>" to change this preference.',
            '- Reject placeholder values such as "your_value".',
        ].join('\n');
    }

    _withLanguageContract(promptText = '', options = {}) {
        const contract = this._languageContractBlock(options);
        const trimmed = typeof promptText === 'string' ? promptText.trim() : '';
        if (!trimmed) {
            return contract;
        }
        return `${trimmed}\n\n${contract}`;
    }

    _countMarkdownFiles(dirPath) {
        if (!fs.existsSync(dirPath)) {
            return 0;
        }
        let total = 0;
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            entries.forEach((entry) => {
                const entryPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    total += this._countMarkdownFiles(entryPath);
                } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
                    total += 1;
                }
            });
        } catch {
            // ignore traversal errors
        }
        return total;
    }

    _collectRecentSpecFiles(limit = 5) {
        if (!this.specsRoot || !fs.existsSync(this.specsRoot)) {
            return [];
        }
        const files = [];
        const walk = (dirPath) => {
            try {
                const entries = fs.readdirSync(dirPath, { withFileTypes: true });
                entries.forEach((entry) => {
                    const entryPath = path.join(dirPath, entry.name);
                    if (entry.isDirectory()) {
                        walk(entryPath);
                    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
                        const stats = fs.statSync(entryPath);
                        files.push({
                            path: path.relative(this.specsRoot, entryPath),
                            mtime: stats.mtimeMs,
                        });
                    }
                });
            } catch {
                // ignore
            }
        };
        walk(this.specsRoot);
        return files
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, limit)
            .map((entry) => entry.path);
    }

    _resolveSpecTargets(query = '') {
        const normalized = (query || '').toLowerCase();
        const wantAll = !normalized || /toate/.test(normalized);
        const matchIds = (prefix) => Array.from(new Set(
            (query.match(new RegExp(`${prefix}-\\d+`, 'gi')) || [])
                .map((id) => id.toUpperCase()),
        ));
        const dsIds = Array.from(new Set(
            (query.match(/ds-\d+/gi) || []).map((id) => id.toUpperCase()),
        ));
        return {
            wantURS: wantAll || normalized.includes('urs') || matchIds('URS').length > 0,
            wantFS: wantAll || normalized.includes('fs') || matchIds('FS').length > 0,
            wantNFS: wantAll || normalized.includes('nfs') || matchIds('NFS').length > 0,
            wantDS: wantAll || normalized.includes('ds') || dsIds.length > 0,
            dsIds,
            ids: {
                urs: matchIds('URS'),
                fs: matchIds('FS'),
                nfs: matchIds('NFS'),
            },
            listAll: wantAll,
        };
    }

    _parseSpecSections(content) {
        const lines = content.split(/\r?\n/);
        const sections = [];
        let current = null;
        lines.forEach((line) => {
            if (line.startsWith('## ')) {
                if (current) {
                    sections.push(current);
                }
                current = {
                    heading: line.replace(/^##\s+/, '').trim(),
                    body: [],
                };
            } else if (current) {
                current.body.push(line);
            }
        });
        if (current) {
            sections.push(current);
        }
        return sections;
    }

    _extractSectionDescription(bodyLines = []) {
        const text = bodyLines.join('\n');
        const match = text.match(/###\s+Description([\s\S]+?)(?:\n###|\n$)/i);
        if (match) {
            return match[1].trim().replace(/\n+/g, ' ');
        }
        const firstSentence = bodyLines.find((line) => line && !line.startsWith('#'));
        return firstSentence ? firstSentence.trim() : '';
    }

    _summarizeSpecDocument(fileName, type, filterIds = []) {
        const filePath = path.join(this.specsRoot, fileName);
        if (!fs.existsSync(filePath)) {
            return [];
        }
        const content = fs.readFileSync(filePath, 'utf8');
        const sections = this._parseSpecSections(content);
        const filterSet = new Set(filterIds);
        const entries = [];

        sections.forEach((section) => {
            const idMatch = section.heading.match(/(URS|FS|NFS)-\d+/i);
            const sectionId = idMatch ? idMatch[0].toUpperCase() : null;
            if (!sectionId) {
                return;
            }
            if (filterSet.size && !filterSet.has(sectionId)) {
                return;
            }
            const title = section.heading.includes('–')
                ? section.heading.split('–')[1].trim()
                : section.heading;
            const trace = section.body
                .filter((line) => /^-\s+(Source|Linked)/i.test(line.trim()))
                .map((line) => line.trim());
            const description = this._extractSectionDescription(section.body);
            entries.push({
                type,
                id: sectionId || `${type} section`,
                title,
                description: description && description !== title ? description : '',
                trace,
                path: filePath,
            });
        });

        if (!entries.length && !filterSet.size) {
            entries.push({
                type,
                id: `${type} summary`,
                title: fileName,
                description: (content.split('\n')[0] || '').trim(),
                path: filePath,
            });
        }

        return entries;
    }

    _listRecentDSIds(limit = 5) {
        const dsDir = path.join(this.specsRoot, 'DS');
        if (!fs.existsSync(dsDir)) {
            return [];
        }
        return fs.readdirSync(dsDir, { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
            .map((entry) => ({
                name: entry.name,
                mtime: fs.statSync(path.join(dsDir, entry.name)).mtimeMs,
            }))
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, Number.isFinite(limit) ? limit : undefined)
            .map((item) => {
                const match = item.name.match(/(DS-\d+)/i);
                return match ? match[1].toUpperCase() : null;
            })
            .filter(Boolean);
    }

    _extractBlock(lines, marker) {
        const index = lines.findIndex((line) => line.trim().toLowerCase() === marker.toLowerCase());
        if (index === -1) {
            return '';
        }
        const body = [];
        for (let i = index + 1; i < lines.length; i += 1) {
            if (lines[i].startsWith('## ')) {
                break;
            }
            body.push(lines[i]);
        }
        return body.join('\n').trim();
    }

    _summarizeDesignSpecs(dsIds = []) {
        const entries = [];
        dsIds.forEach((dsId) => {
            try {
                const filePath = GampRSP.getDSFilePath(dsId);
                const content = fs.readFileSync(filePath, 'utf8');
                const lines = content.split(/\r?\n/);
                const heading = lines.find((line) => line.startsWith('# ')) || `${dsId}`;
                const title = heading.includes('–') ? heading.split('–')[1].trim() : heading.replace(/^#\s+/, '').trim();
                const scope = this._extractBlock(lines, '## Scope & Intent') || this._extractBlock(lines, '## Description');
                const architecture = this._extractBlock(lines, '## Architecture');
                const traceInfo = lines
                    .filter((line) => /^-\s+(URS|Requirement)/i.test(line.trim()))
                    .map((line) => line.trim());
                entries.push({
                    type: 'DS',
                    id: dsId,
                    title,
                    description: [scope, architecture].filter(Boolean).join(' | ') || '',
                    path: filePath,
                    trace: traceInfo,
                });
            } catch {
                // ignore DS read errors
            }
        });
        return entries;
    }


    summarizeSpecifications(taskText = '') {
        if (!this.specsRoot || !fs.existsSync(this.specsRoot)) {
            return {
                message: 'No `.specs` directory found in the current workspace.',
                docs: [],
            };
        }
        const targets = this._resolveSpecTargets(taskText);
        const docs = [];
        const pushEntries = (entries) => entries.forEach((entry) => docs.push(entry));

        if (targets.wantURS) {
            pushEntries(this._summarizeSpecDocument('URS.md', 'URS', targets.ids.urs));
        }
        if (targets.wantFS) {
            pushEntries(this._summarizeSpecDocument('FS.md', 'FS', targets.ids.fs));
        }
        if (targets.wantNFS) {
            pushEntries(this._summarizeSpecDocument('NFS.md', 'NFS', targets.ids.nfs));
        }

        const recentDs = this._listRecentDSIds(targets.listAll ? Number.MAX_SAFE_INTEGER : 5);
        if (targets.dsIds.length) {
            pushEntries(this._summarizeDesignSpecs(targets.dsIds));
        } else if (targets.wantDS) {
            pushEntries(this._summarizeDesignSpecs(recentDs));
        }

        return {
            message: docs.length
                ? 'Specification summary ready.'
                : 'No specification entries matched the request.',
            docs,
        };
    }

    async maybeHandleStatusQuestion(taskText) {
        if (!(await this._looksLikeSpecStatusQuestion(taskText))) {
            return false;
        }
        const summary = this.summarizeSpecifications(taskText);
        this.printExecutions([{
            status: 'ok',
            skill: 'spec-status',
            prompt: taskText,
            result: {
                result: summary,
            },
        }]);
        await this.captureMemoryEntry({
            userPrompt: taskText,
            plan: null,
            executions: [{
                status: 'ok',
                skill: 'spec-status',
                prompt: taskText,
                result: { result: summary },
            }],
            cancelled: false,
        });
        return true;
    }
    
    _memoryContext() {
        return {
            globalMemory: this.globalMemory?.getFullContext() || [],
            userMemory: this.userMemory?.getFullContext() || [],
            sessionMemory: this.sessionMemory?.getFullContext() || [],
        };
    }

    requestCancel(reason = 'User requested cancellation.') {
        if (!this.planInProgress) {
            this.output.write(`${COLOR_WARN}[info] No active plan to cancel.${COLOR_RESET}\n`);
            return false;
        }
        if (this.cancelRequested) {
            return false;
        }
        this.cancelRequested = true;
        this.output.write(`${COLOR_WARN}[info] Cancelling current plan: ${reason}${COLOR_RESET}\n`);
        try {
            if (this.skilledAgent && typeof this.skilledAgent.cancelTasks === 'function') {
                this.skilledAgent.cancelTasks();
            }
        } catch {
            // ignore cancellation errors
        }
        return true;
    }

    _handleGlobalKeypress(_, key = {}) {
        const ctrlC = key?.ctrl && key?.name === 'c';
        if (this.planInProgress) {
            if (ctrlC) {
                this.requestCancel('Ctrl+C pressed.');
                return;
            }
            if (key?.name === 'escape') {
                this.requestCancel('Escape pressed.');
                return;
            }
        } else if (ctrlC) {
            this._restoreInputMode();
            process.exit(0);
        }
    }
    
    _recordHistory(entry) {
        if (!entry || !this.historyFile) {
            return;
        }
        const trimmed = entry.trim();
        if (!trimmed) {
            return;
        }
        const last = this.historyEntries[this.historyEntries.length - 1];
        if (last === trimmed) {
            return;
        }
        this.historyEntries.push(trimmed);
        const maxEntries = 200;
        if (this.historyEntries.length > maxEntries) {
            this.historyEntries.splice(0, this.historyEntries.length - maxEntries);
        }
        try {
            fs.mkdirSync(path.dirname(this.historyFile), { recursive: true });
            fs.writeFileSync(this.historyFile, `${this.historyEntries.join('\n')}\n`);
        } catch {
            // ignore persistence errors
        }
        if (this.readline) {
            this.readline.history = this.historyEntries.slice().reverse();
        }
    }
    
    _createPromptFilterStream() {
        return new Writable({
            write: (chunk, encoding, callback) => {
                const text = typeof chunk === 'string' ? chunk : (chunk ? chunk.toString() : '');
                if (text && !looksLikeEnvelope(text)) {
                    process.stdout.write(chunk, encoding, callback);
                } else if (typeof callback === 'function') {
                    callback();
                }
            },
        });
    }
    
    _buildCompleter() {
        const commandList = [
            '/help',
            '/list',
            '/debug',
            '/continue',
            '/resume',
            '/status',
            '/cancel',
            '/run',
            '/exit',
            '/quit',
        ];
        const skillCommands = this.getSkillCatalog()
            .map((record) => `/run ${record.name}`);
        const completions = commandList.concat(skillCommands);
        return (line) => {
            const hits = completions.filter((entry) => entry.toLowerCase().startsWith(line.toLowerCase()));
            return [hits.length ? hits : completions, line];
        };
    }

    _ensureReadline() {
        if (this.readline) {
            return this.readline;
        }
        const filterStream = this._createPromptFilterStream();
        const historySnapshot = this.historyEntries.slice().reverse();
        this.readline = readline.createInterface({
            input: process.stdin,
            output: filterStream,
            terminal: true,
            history: historySnapshot,
            completer: this._buildCompleter(),
            removeHistoryDuplicates: true,
        });
        this.readline.history = historySnapshot;
        this.readline.on('close', () => {
            this.readline = null;
        });
        return this.readline;
    }
    
    async _askUser(message) {
        const rl = this._ensureReadline();
        rl.history = this.historyEntries.slice().reverse();
        return new Promise((resolve) => {
            rl.question(message, (answer) => {
                resolve(answer.replace(/\x01/g, '\n'));
            });
        });
    }

    getSkillCatalog() {
        return Array.from(this.recursiveAgent.skillCatalog.values());
    }

    async listSkills(columns = DEFAULT_LIST_COLUMNS) {
        const compute = () => {
        const rows = this.getSkillCatalog()
            .map((record) => ({
                name: record.name,
                type: record.type,
                summary: record.descriptor?.summary || '',
                implementation: detectImplementation(record),
            }))
            .sort((a, b) => {
                if (a.type === b.type) {
                    return a.name.localeCompare(b.name);
                }
                return a.type.localeCompare(b.type);
            });

        const selectedColumns = columns.length ? columns : DEFAULT_LIST_COLUMNS;

        return rows.map((row) => selectedColumns
            .map((column) => row[column] || '')
            .join(' | '));
        };

        let timeoutHandle;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => {
                reject(new Error('Skill listing timed out.'));
            }, this.listTimeoutMs);
            if (typeof timeoutHandle.unref === 'function') {
                timeoutHandle.unref();
            }
        });

        try {
            return await Promise.race([
                Promise.resolve().then(compute),
                timeoutPromise,
            ]);
        } finally {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
        }
    }

    findSkill(name) {
        if (!name) {
            return null;
        }
        const normalized = name.trim().toLowerCase();
        return this.getSkillCatalog().find((record) => {
            const names = [
                record.name,
                record.shortName,
                record.descriptor?.title,
            ].filter(Boolean).map((entry) => entry.toLowerCase());
            return names.includes(normalized);
        }) || null;
    }

    getOrchestrators() {
        return this.getSkillCatalog().filter((record) => record.type === 'orchestrator');
    }

    async createPlan(taskDescription) {
        const orchestrators = this.getOrchestrators();
        if (!orchestrators.length) {
            return [];
        }

        const prompt = buildPlanPrompt({
            task: taskDescription,
            orchestrators,
            languageContract: this._languageContractBlock({ heading: '## Language Requirements' }),
        });

        let rawPlan = null;
        try {
            rawPlan = await this.llmAgent.executePrompt(prompt, {
                mode: 'fast',
                context: { intent: 'achiles-cli-plan' },
            });
        } catch (error) {
            this.output.write(`${COLOR_WARN}[warn] Failed to obtain plan from LLM: ${error.message}${COLOR_RESET}\n`);
        }

        const parsed = parsePlan(rawPlan);
        return this._postProcessPlan(parsed, taskDescription);
    }

    _buildArgsForSkill(record, promptText) {
        const args = {};
        const inject = (name) => {
            if (typeof name === 'string' && name && !Object.prototype.hasOwnProperty.call(args, name)) {
                args[name] = promptText;
            }
        };

        if (record.metadata?.defaultArgument) {
            inject(record.metadata.defaultArgument);
        }

        if (record.type === 'interactive') {
            const required = Array.isArray(record.requiredArguments) ? record.requiredArguments : [];
            required.forEach(inject);
        }

        if (!Object.keys(args).length) {
            args.input = promptText;
        }

        return args;
    }

    _postProcessPlan(plan = [], taskDescription = '') {
        if (!plan.length) {
            return plan;
        }
        const normalized = [];
        const lowerPrompt = (taskDescription || '').toLowerCase();
        const wantsReverse = ['reverse', 'sync', 'mirror', 'scan'].some((keyword) => lowerPrompt.includes(keyword));
        let combinedUpdate = null;

        plan.forEach((step) => {
            if (!step || !step.skill) {
                return;
            }
            const skillName = step.skill.toLowerCase();
            if (skillName === 'reverse-specs-orchestrator' && !wantsReverse) {
                return;
            }
            if (skillName === 'update-specs-orchestrator') {
                if (!combinedUpdate) {
                    combinedUpdate = { ...step };
                    normalized.push(combinedUpdate);
                } else {
                    const mergedPrompt = [combinedUpdate.prompt, step.prompt]
                        .filter(Boolean)
                        .join('\n');
                    combinedUpdate.prompt = mergedPrompt;
                }
                return;
            }
            normalized.push(step);
        });

        return normalized;
    }

    createSkillLogger(record) {
        const prefix = `[skill:${record.shortName || record.name}]`;
        return (message) => {
            if (!message || !this.output) {
                return;
            }
            const text = typeof message === 'string'
                ? message
                : (() => {
                    try {
                        return JSON.stringify(message);
                    } catch {
                        return String(message);
                    }
                })();
            this.output.write(`${COLOR_INFO}${prefix} ${text}${COLOR_RESET}\n`);
        };
    }

    setDebugMode(enabled) {
        const newValue = Boolean(enabled);
        if (this.debugMode === newValue) {
            return this.debugMode;
        }
        this.debugMode = newValue;
        if (this._llmDebugSupported) {
            this.llmAgent.setDebugEnabled(this.debugMode);
        }
        const status = this.debugMode ? 'enabled' : 'disabled';
        this.output.write(`${COLOR_DEBUG}[debug] LLM debug logging ${status}.${COLOR_RESET}\n`);
        return this.debugMode;
    }

    _handleLLMDebugEvent(event = {}) {
        if (!this.debugMode || !this.output) {
            return;
        }
        const phase = event.phase || 'event';
        const id = event.id ? `#${event.id}` : '';
        const method = event.method || 'complete';
        const metadata = [];
        if (event.mode) {
            metadata.push(`mode=${event.mode}`);
        }
        if (event.model) {
            metadata.push(`model=${event.model}`);
        }
        const color = phase === 'request'
            ? COLOR_DEBUG_REQUEST
            : (phase === 'response' ? COLOR_DEBUG_RESPONSE : COLOR_DEBUG);
        const header = `${color}${DEBUG_PREFIX} ${method}${id} ${phase}${metadata.length ? ` | ${metadata.join(' ')}` : ''}${COLOR_RESET}`;
        this.output.write(`${header}\n`);
        if (phase === 'request') {
            const history = Array.isArray(event.history) ? event.history.length : 0;
            if (history) {
                this.output.write(`${color}${DEBUG_PREFIX} history: ${history} message(s)${COLOR_RESET}\n`);
            }
            if (event.prompt) {
                this.output.write(`${color}${DEBUG_PREFIX} prompt:\n${event.prompt}\n${COLOR_RESET}`);
            }
        } else if (phase === 'response') {
            if (event.output) {
                this.output.write(`${color}${DEBUG_PREFIX} response:\n${event.output}\n${COLOR_RESET}`);
            }
        } else if (phase === 'error' && event.error) {
            this.output.write(`${COLOR_ERROR}${DEBUG_PREFIX} error: ${event.error}${COLOR_RESET}\n`);
        }
    }

    _wrapLLMCompleteHook() {
        if (this._llmCompleteWrapped || !this.llmAgent || typeof this.llmAgent.complete !== 'function') {
            return;
        }
        const originalComplete = this.llmAgent.complete.bind(this.llmAgent);
        this.llmAgent.complete = async (...args) => {
            const [optionsArg] = args;
            const promptText = optionsArg?.prompt || '';
            const modeValue = optionsArg?.mode || 'fast';
            const modelValue = optionsArg?.model || null;
            this._handleLLMDebugEvent({
                method: 'complete',
                phase: 'request',
                prompt: promptText,
                mode: modeValue,
                model: modelValue,
            });
            try {
                const response = await originalComplete(...args);
                this._handleLLMDebugEvent({
                    method: 'complete',
                    phase: 'response',
                    output: typeof response === 'string' ? response : JSON.stringify(response),
                });
                return response;
            } catch (error) {
                this._handleLLMDebugEvent({
                    method: 'complete',
                    phase: 'error',
                    error: error?.message || String(error),
                });
                throw error;
            }
        };
        this._llmCompleteWrapped = true;
    }

    async _runSkill(record, promptText) {
        const skillLogger = this.createSkillLogger(record);
        const promptWithLanguage = this._withLanguageContract(promptText, { heading: '# Language Contract' });
        const languageContract = this._languageContractBlock({ heading: '# Language Contract' });
        return this.recursiveAgent.executeWithReviewMode(promptWithLanguage, {
            skillName: record.name,
            args: this._buildArgsForSkill(record, promptText),
            context: {
                workspaceRoot: this.workspaceRoot,
                specsRoot: this.specsRoot,
                llmAgent: this.llmAgent,
                logger: skillLogger,
                specLanguage: this._activeSpecLanguage(),
                languageContract,
                ...this._memoryContext(),
            },
            logger: skillLogger,
        });
    }

    async executePlan(planSteps = [], options = {}) {
        const announceProgress = Boolean(options?.announceProgress);
        const startIndex = Number.isInteger(options?.startIndex) && options.startIndex > 0
            ? options.startIndex
            : 0;
        const executions = [];
        const total = planSteps.length;
        let cancelled = false;
        this.planInProgress = true;
        this.cancelRequested = false;
        if (this.pendingPlan) {
            this.pendingPlan.nextIndex = startIndex;
        }
        try {
            for (let index = startIndex; index < planSteps.length; index += 1) {
                if (this.cancelRequested) {
                    cancelled = true;
                    break;
                }
                const step = planSteps[index];
                if (this.pendingPlan) {
                    this.pendingPlan.nextIndex = index;
                }
                const record = this.findSkill(step.skill);
                if (!record) {
                    if (announceProgress) {
                        this.output.write(`${COLOR_WARN}[exec] (${index + 1}/${total}) Missing skill "${step.skill}".${COLOR_RESET}\n`);
                    }
                    executions.push({
                        ...step,
                        status: 'failed',
                        error: `Skill "${step.skill}" not found.`,
                    });
                    continue;
                }

                try {
                    if (announceProgress) {
                        this.output.write(`${COLOR_INFO}[exec] (${index + 1}/${total}) Running ${record.name} ← ${step.prompt}${COLOR_RESET}\n`);
                    }
                    const result = await this._runSkill(record, step.prompt);
                    executions.push({
                        ...step,
                        status: 'ok',
                        result,
                    });
                } catch (error) {
                    executions.push({
                        ...step,
                        status: 'failed',
                        error: error.message,
                    });
                }

                if (this.pendingPlan) {
                    this.pendingPlan.nextIndex = index + 1;
                }
            }
        } finally {
            cancelled = cancelled || this.cancelRequested;
            this.planInProgress = false;
            this.cancelRequested = false;
            if (!cancelled && this.pendingPlan) {
                this.pendingPlan = null;
            } else if (cancelled && this.pendingPlan) {
                const remaining = Math.max(0, planSteps.length - (this.pendingPlan.nextIndex || 0));
                this.output.write(`${COLOR_WARN}[info] Plan paused with ${remaining} step(s) remaining. Use "continue" (/continue) to resume or provide extra instructions to replan.${COLOR_RESET}\n`);
            }
        }

        return { executions, cancelled };
    }

    async ensureBootstrap(taskDescription) {
        if (this.bootstrapCompleted) {
            return;
        }
        if (!this._bootstrapRequired) {
            this.bootstrapCompleted = true;
            return;
        }

        const effectiveMode = this.autoBootstrapMode === 'ask' && !this.interactive
            ? 'auto'
            : this.autoBootstrapMode;
        if (effectiveMode === 'manual') {
            this.bootstrapCompleted = true;
            return;
        }

        const promptText = taskDescription || 'Workspace bootstrap';

        for (const step of AUTO_BOOTSTRAP_SKILLS) {
            const record = this.findSkill(step.name);
            if (!record) {
                this.output.write(`${COLOR_WARN}[auto] Skill "${step.name}" not found; skipping bootstrap step.${COLOR_RESET}\n`);
                continue;
            }

            const plannedPrompt = step.prompt || promptText;

            if (effectiveMode === 'ask') {
                const approve = await this.promptYesNo(
                    `[auto] ${record.name} – ${plannedPrompt}\nRun this bootstrap step?`,
                    true,
                );
                if (!approve) {
                    this.output.write(`${COLOR_WARN}[auto] Skipping ${record.name} at user request.${COLOR_RESET}\n`);
                    continue;
                }
            }

            this.output.write(`${COLOR_INFO}[auto] Running ${record.name} – ${plannedPrompt}${COLOR_RESET}\n`);
            try {
                // eslint-disable-next-line no-await-in-loop
                await this._runSkill(record, plannedPrompt);
                this.output.write(`${COLOR_INFO}[auto] Completed ${record.name}${COLOR_RESET}\n`);
            } catch (error) {
                this.output.write(`${COLOR_WARN}[auto] ${record.name} failed: ${error.message}${COLOR_RESET}\n`);
            }
        }

        this.bootstrapCompleted = true;
        this._bootstrapRequired = false;
    }

    async preparePlan(taskText) {
        const trimmed = typeof taskText === 'string' ? taskText.trim() : '';
        if (!trimmed) {
            return [];
        }
        await this.ensureBootstrap(trimmed);
        const plan = await this.createPlan(trimmed);
        if (!plan.length) {
            if (!this.getOrchestrators().length) {
                throw new Error('No orchestrator skills are available in the current catalog. Use /list to verify installed skills.');
            }
            throw new Error('Planner did not produce any steps for this request. Refine the prompt or register additional orchestrator skills.');
        }
        return plan;
    }

    async processTaskInput(taskText, options = {}) {
        const plan = await this.preparePlan(taskText);
        if (!plan.length) {
            return {
                plan: [],
                executions: [],
            };
        }

        const announceProgress = Boolean(options?.announceProgress);
        if (options?.skipExecution) {
            return { plan, executions: [] };
        }

        const { executions } = await this.executePlan(plan, { announceProgress });
        return { plan, executions };
    }

    async readMultiline(initialPrompt = 'achiles> ', continuationPrompt = '... ') {
        const lines = [];
        let expectingContinuation = false;

        while (true) {
            // eslint-disable-next-line no-await-in-loop
            const value = await this.promptReader(expectingContinuation ? continuationPrompt : initialPrompt);
            const trimmed = value.trim();

            if (!expectingContinuation && trimmed.startsWith('/')) {
                this._recordHistory(trimmed);
                return { command: trimmed };
            }

            if (!expectingContinuation && !trimmed) {
                continue;
            }

            const continuationMatch = value.match(/\\\s*$/);
            const hasContinuation = Boolean(continuationMatch);
            const lineValue = hasContinuation
                ? value.slice(0, value.length - continuationMatch[0].length)
                : value;

            if (lineValue || lines.length || hasContinuation) {
                lines.push(lineValue);
            }

            if (hasContinuation) {
                expectingContinuation = true;
                continue;
            }

            break;
        }

        const finalText = lines.join('\n').trim();
        if (finalText) {
            this._recordHistory(finalText);
        }
        return { text: finalText };
    }

    async promptYesNo(message, defaultValue = true) {
        if (!this.interactive || typeof this.promptReader !== 'function') {
            return defaultValue;
        }
        const suffix = defaultValue ? ' [Y/n] ' : ' [y/N] ';
        try {
            const response = await this.promptReader(`${message}${suffix}`);
            const normalized = typeof response === 'string' ? response.trim().toLowerCase() : '';
            if (!normalized) {
                return defaultValue;
            }
            return normalized === 'y' || normalized === 'yes';
        } catch {
            return defaultValue;
        }
    }

    extractInlinePrompt(text = '') {
        if (!text) {
            return '';
        }
        const trimmed = text.trim();
        if (!trimmed) {
            return '';
        }
        if (
            (trimmed.startsWith('<<') && trimmed.endsWith('>>'))
            || (trimmed.startsWith('«') && trimmed.endsWith('»'))
        ) {
            return trimmed.slice(2, -2).trim();
        }
        return trimmed;
    }

    parseResumeInput(value) {
        if (typeof value !== 'string') {
            return null;
        }
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }
        const normalized = trimmed.toLowerCase();
        const keywords = ['continua', 'continue', 'resume', '/continue', '/resume'];
        const base = keywords.find((keyword) => normalized === keyword || normalized.startsWith(`${keyword} `));
        if (!base) {
            return null;
        }
        const extra = trimmed.slice(base.length).trim();
        return { resume: true, extra };
    }

    async detectResumeInput(text) {
        const direct = this.parseResumeInput(text);
        if (direct) {
            return direct;
        }
        if (!this.llmAgent || typeof this.llmAgent.executePrompt !== 'function') {
            return null;
        }
        const prompt = [
            '# Resume Intent Detector',
            'Determine whether the following user message is asking to continue or resume a paused workflow.',
            'Respond with strict JSON using the shape: { "resume": true|false, "extra": "optional instructions" }.',
            'Set "resume" to true when the intent clearly means continue/resume/pick up where we left off, even if written in another language.',
            `Message:\n${text}`,
        ].join('\n\n');
        try {
            const response = await this.llmAgent.executePrompt(prompt, {
                responseShape: 'json',
                context: { intent: 'resume-detection' },
                mode: 'fast',
            });
            if (response && response.resume) {
                return {
                    resume: true,
                    extra: typeof response.extra === 'string' ? response.extra.trim() : '',
                };
            }
        } catch {
            // ignore detection errors
        }
        return null;
    }

    printPlan(plan) {
        if (!plan.length) {
            this.output.write(`${COLOR_INFO}[info] No explicit plan generated.${COLOR_RESET}\n`);
            return;
        }
        this.output.write(`${COLOR_INFO}[plan] Generated plan:${COLOR_RESET}\n`);
        plan.forEach((step, index) => {
            this.output.write(`  ${index + 1}. ${step.skill} ← ${step.prompt}\n`);
        });
    }

    printExecutions(executions) {
        executions.forEach((execution) => {
            const statusColour = execution.status === 'ok' ? COLOR_INFO : COLOR_ERROR;
            this.output.write(`${statusColour}[${execution.status}] ${execution.skill}: ${execution.prompt}${COLOR_RESET}\n`);
            if (execution.status === 'failed') {
                this.output.write(`${COLOR_ERROR}  Error: ${execution.error}${COLOR_RESET}\n`);
            } else if (execution.result) {
                const lines = this.formatExecutionResult(execution);
                lines.forEach((line) => this.output.write(`  ${line}\n`));
            }
        });
    }

    async resumePendingPlan(extraInstructions = '') {
        const extra = typeof extraInstructions === 'string' ? extraInstructions.trim() : '';
        if (!this.pendingPlan) {
            this.output.write(`${COLOR_WARN}[info] No pending plan is available to continue.${COLOR_RESET}\n`);
            return;
        }
        if (extra) {
            const updatedPrompt = [this.pendingPlan.prompt, extra].filter(Boolean).join('\n').trim();
            try {
                const updatedPlan = await this.preparePlan(updatedPrompt);
                this.pendingPlan = {
                    plan: updatedPlan,
                    prompt: updatedPrompt,
                    nextIndex: 0,
                };
            } catch (error) {
                this.output.write(`${COLOR_ERROR}[error] ${error.message}${COLOR_RESET}\n`);
                return;
            }
        }
        const { plan, prompt, nextIndex } = this.pendingPlan;
        this.output.write(`${COLOR_INFO}[info] Resuming plan for "${prompt}".${COLOR_RESET}\n`);
        this.printPlan(plan);
        if (nextIndex > 0 && !extra) {
            this.output.write(`${COLOR_INFO}[info] Continuing from step ${Math.min(nextIndex + 1, plan.length)} of ${plan.length}.${COLOR_RESET}\n`);
        }
        const { executions, cancelled } = await this.executePlan(plan, {
            announceProgress: this.announceStepProgress,
            startIndex: nextIndex || 0,
        });
        this.printExecutions(executions);
        await this.captureMemoryEntry({
            userPrompt: prompt,
            plan,
            executions,
            cancelled,
        });
    }

    printHelp() {
        const items = [
            { command: '/help', description: 'Show this help.' },
            { command: '/list', description: 'List registered skills with type and implementation.' },
            { command: '/debug [on|off]', description: 'Toggle verbose LLM request/response logging.' },
            { command: '/model fast|deep', description: 'Switch default LLM mode used by planners.' },
            { command: '/lang <language>', description: 'Set specification language (default: english).' },
            { command: '/run <skill> <<prompt>>', description: 'Invoke a specific skill directly with inline instructions.' },
            { command: '/continue [extra]', description: 'Resume pending plan; add extra text to replan with new instructions.' },
            { command: '/status', description: 'Show LLM request statistics, token counts, and log file locations.' },
            { command: '/exit or /quit', description: 'Exit the CLI.' },
        ];
        this.output.write(`${COLOR_INFO}Achiles CLI Commands:${COLOR_RESET}\n`);
        items.forEach((item) => {
            this.output.write(`  ${item.command.padEnd(18)} ${item.description}\n`);
        });
        this.output.write('General input:\n');
        this.output.write("  End a line with '\\' to continue typing multi-line prompts.\n");
        this.output.write('  Press Esc or Ctrl+C during execution to cancel the active plan.\n');
        this.output.write("  Use ↑/↓ to recall previous prompts (stored in .specs/.prompts_history).\n");
        this.output.write("  Type 'continue' (any language variant) or use /continue to resume after cancelling.\n");
    }

    formatExecutionResult(execution) {
        const lines = [];
        if (!execution?.result) {
            return lines;
        }
        const envelope = execution.result;
        const payload = envelope.result || envelope.output || envelope;
        const message = payload.message || envelope.message;
        if (message) {
            lines.push(`message: ${message}`);
        }
        if (payload.plan?.length) {
            lines.push(`plan steps: ${payload.plan.length}`);
        }
        if (Array.isArray(payload.steps)) {
            const success = payload.steps.filter((step) => step.status === 'ok').length;
            const failed = payload.steps.filter((step) => step.status === 'failed').length;
            lines.push(`steps status: ${success} succeeded, ${failed} failed`);
        }
        if (payload.education?.overview) {
            lines.push(`overview: ${payload.education.overview}`);
        }
        if (payload.education?.ursHighlights?.length) {
            lines.push(`URS: ${payload.education.ursHighlights.join('; ')}`);
        }
        if (payload.education?.fsIdeas?.length) {
            lines.push(`FS ideas: ${payload.education.fsIdeas.join('; ')}`);
        }
        if (payload.education?.dsCandidates?.length) {
            lines.push(`DS ideas: ${payload.education.dsCandidates.join('; ')}`);
        }
        if (payload.review?.summary) {
            lines.push(`review: ${payload.review.summary}`);
        }
        if (payload.review?.issues?.length) {
            lines.push(`issues: ${payload.review.issues.length} item(s)`);
        }
        if (Array.isArray(payload.docs) && payload.docs.length) {
            lines.push('documents:');
            payload.docs.forEach((doc) => {
                const heading = [doc.type, doc.id].filter(Boolean).join(' ').trim();
                const titleLine = heading
                    ? `${heading}: ${doc.title || ''}`.trim()
                    : (doc.title || doc.path || '').trim();
                lines.push(`  • ${titleLine}`);
                if (doc.description) {
                    lines.push(`      ${doc.description}`);
                }
                if (Array.isArray(doc.trace) && doc.trace.length) {
                    lines.push(`      Trace: ${doc.trace.join(' | ')}`);
                }
                if (doc.path) {
                    lines.push(`      File: ${doc.path}`);
                }
            });
        }
        if (Array.isArray(payload.actions) && payload.actions.length) {
            lines.push('actions:');
            payload.actions.forEach((action) => {
                const parts = [];
                if (action.id) {
                    parts.push(action.id);
                }
                if (action.title) {
                    parts.push(action.title);
                }
                if (action.dsId) {
                    parts.push(`ds=${action.dsId}`);
                }
                const extra = Object.entries(action)
                    .filter(([key]) => !['action', 'id', 'title', 'dsId'].includes(key))
                    .map(([key, value]) => `${key}=${value}`)
                    .join(', ');
                const detail = [parts.join(' | '), extra].filter(Boolean).join(' | ');
                lines.push(`  • ${action.action || 'step'}${detail ? ` — ${detail}` : ''}`);
            });
        }
        if (payload.help?.introduction && lines.length === 0) {
            lines.push(`help: ${payload.help.introduction}`);
        }
        if (payload.help && message?.includes('fallback') && lines.length === 0) {
            lines.push('note: fallback guidance used (LLM unavailable).');
        }
        if (payload.education?.fallbackSpecs && !payload.education?.ursHighlights?.length && lines.length === 0) {
            lines.push('note: mentor fell back to cached specs.');
        }
        if (payload.counts) {
            const { urs, fs, nfs, ds } = payload.counts;
            lines.push(`counts → URS:${urs || 0} FS:${fs || 0} NFS:${nfs || 0} DS:${ds || 0}`);
        }
        if (payload.recentFiles?.length) {
            lines.push(`recent specs: ${payload.recentFiles.join(', ')}`);
        }
        if (payload.notes) {
            lines.push(`notes: ${payload.notes}`);
        }
        if (payload.help && !message) {
            lines.push('help: Specification overview provided.');
        }
        return lines;
    }

    async executeSingleSkill(skillName, promptText = '') {
        const record = this.findSkill(skillName);
        if (!record) {
            this.output.write(`${COLOR_WARN}[warn] Skill "${skillName}" not found.${COLOR_RESET}\n`);
            return;
        }
        const instructions = promptText && promptText.trim()
            ? promptText.trim()
            : await this.promptReader(`(${record.name})> `);
        await this.ensureBootstrap(instructions);
        const executions = [];
        try {
            const result = await this._runSkill(record, instructions);
            executions.push({
                status: 'ok',
                skill: record.name,
                prompt: instructions,
                result,
            });
        } catch (error) {
            executions.push({
                status: 'failed',
                skill: record.name,
                prompt: instructions,
                error: error?.message || String(error),
            });
        }
        this.printExecutions(executions);
        await this.captureMemoryEntry({
            userPrompt: `/run ${skillName}`,
            plan: [{ skill: record.name, prompt: instructions }],
            executions,
            cancelled: false,
        });
    }

    printStatus() {
        const stats = getLLMStats();
        this.output.write(`${COLOR_INFO}[status] LLM requests: ${stats.totalRequests || 0}${COLOR_RESET}\n`);
        this.output.write(`  Tokens sent: ${stats.tokensSent || 0}, received: ${stats.tokensReceived || 0}\n`);
        this.output.write(`  Last model: ${stats.lastModel || 'n/a'} (updated ${stats.lastUpdated || 'n/a'})\n`);
        if (stats.models && Object.keys(stats.models).length) {
            this.output.write('  Models:\n');
            Object.entries(stats.models).forEach(([model, data]) => {
                this.output.write(`    - ${model}: ${data.requests} req, sent ${data.tokensSent || 0}, received ${data.tokensReceived || 0}\n`);
            });
        }
        this.output.write(`  Log file: ${this.llmLogsPath}\n`);
        this.output.write(`  Stats file: ${this.llmStatsPath}\n`);
        if (stats.buckets) {
            this.output.write('  Response buckets:\n');
            Object.entries(stats.buckets).forEach(([label, data]) => {
                if (!data.requests) {
                    return;
                }
                const avg = data.requests ? (data.totalMs / data.requests).toFixed(1) : 'n/a';
                const min = data.minMs === null ? 'n/a' : data.minMs.toFixed(1);
                const max = data.maxMs === null ? 'n/a' : data.maxMs.toFixed(1);
                this.output.write(`    ${label}: ${data.requests} req, avg ${avg}ms (min ${min} / max ${max}), tokens sent ${data.tokensSent}, received ${data.tokensReceived}\n`);
            });
        }
    }

    async _classifyMemoryEntry({ userPrompt, summary }) {
        if (!this.llmAgent || typeof this.llmAgent.executePrompt !== 'function') {
            return null;
        }
        const prompt = [
            '# Memory Router',
            'Decide whether to store the interaction below in long-term memory.',
            'Memory types:',
            '- global: enduring workspace or project facts, constraints, or architecture decisions.',
            '- user: operator preferences, style, or working agreements.',
            '- session: temporary context helpful only during this CLI session.',
            'Respond with JSON using this schema:',
            '{',
            '  "global": { "store": true|false, "note": "short summary" },',
            '  "user": { "store": true|false, "note": "short summary" },',
            '  "session": { "store": true|false, "note": "short summary" }',
            '}',
            'Always include all three keys. Notes should be under 200 characters.',
            `User prompt:\n${userPrompt || '<empty>'}`,
            `Summary of system activity:\n${summary || '<none>'}`,
        ].join('\n\n');

        try {
            const response = await this.llmAgent.executePrompt(prompt, {
                responseShape: 'json',
                context: { intent: 'memory-routing' },
                mode: 'fast',
            });
            if (typeof response === 'string') {
                return JSON.parse(response);
            }
            return response;
        } catch {
            return null;
        }
    }

    async captureMemoryEntry({ userPrompt = '', plan = [], executions = [], cancelled = false }) {
        const cleanedPrompt = (userPrompt || '').trim();
        const summaryLines = [];
        if (plan?.length) {
            summaryLines.push(`Plan steps: ${plan.map((step) => step.skill).join(', ')}`);
        }
        executions.forEach((execution) => {
            const detail = this.formatExecutionResult(execution).join(' | ');
            summaryLines.push(`[${execution.status}] ${execution.skill}: ${detail || execution.prompt || ''}`);
        });
        if (cancelled) {
            summaryLines.push('Plan did not finish (user cancelled).');
        }
        const summary = summaryLines.filter(Boolean).join('\n');
        if (!cleanedPrompt && !summary) {
            return;
        }

        let classification = null;
        try {
            classification = await this._classifyMemoryEntry({ userPrompt: cleanedPrompt, summary });
        } catch {
            classification = null;
        }

        const storeEntry = (container, key, note, persist = true) => {
            try {
                container.appendToHistory({
                    user: cleanedPrompt || null,
                    ai: note || summary || cleanedPrompt || null,
                });
                if (persist) {
                    this._persistMemory(container, key);
                }
            } catch {
                // ignore memory errors
            }
        };

        if (!classification) {
            storeEntry(this.sessionMemory, 'session_memory', summary, false);
            return;
        }

        const globalNote = classification.global?.note || summary;
        const userNote = classification.user?.note || summary;
        const sessionNote = classification.session?.note || summary;

        if (classification.global?.store) {
            storeEntry(this.globalMemory, 'global_memory', globalNote, true);
        }
        if (classification.user?.store) {
            storeEntry(this.userMemory, 'user_memory', userNote, true);
        }
        if (classification.session?.store !== false) {
            storeEntry(this.sessionMemory, 'session_memory', sessionNote, false);
        }
    }

    async runInteractive() {
        this.output.write(`${COLOR_INFO}Achiles CLI ready. Commands: /list, /exit. End lines with '\\' to continue typing.${COLOR_RESET}\n`);
        if (this.debugMode) {
            this.output.write(`${COLOR_DEBUG}[debug] LLM debug logging enabled.${COLOR_RESET}\n`);
        }
        try {
            while (true) {
        const { command, text } = await this.readMultiline();
                if (command) {
                    const trimmedCommand = command.trim();
                    const [base, ...commandArgs] = trimmedCommand.split(/\s+/);
                    const normalized = base.toLowerCase();
                    if (normalized === '/exit' || normalized === '/quit') {
                        this.output.write('Exiting Achiles CLI.\n');
                        if (this.readline) {
                            this.readline.close();
                        }
                        break;
                    }
                    if (normalized === '/list') {
                        try {
                            const lines = await this.listSkills();
                            lines.forEach((line) => this.output.write(`${line}\n`));
                        } catch (error) {
                            this.output.write(`${COLOR_WARN}[warn] ${error.message}${COLOR_RESET}\n`);
                        }
                        continue;
                    }
                    if (normalized === '/continue' || normalized === '/resume') {
                        await this.resumePendingPlan(commandArgs.join(' ').trim());
                        continue;
                    }
                if (normalized === '/help') {
                    this.printHelp();
                    continue;
                }
                if (normalized === '/status') {
                    this.printStatus();
                    continue;
                }
                if (normalized === '/debug') {
                    const desired = (commandArgs[0] || '').toLowerCase();
                    if (desired === 'on' || desired === 'enable' || desired === 'true') {
                        this.setDebugMode(true);
                    } else if (desired === 'off' || desired === 'disable' || desired === 'false') {
                        this.setDebugMode(false);
                    } else {
                        const toggled = this.setDebugMode(!this.debugMode);
                        if (desired && desired !== '') {
                            this.output.write(`${COLOR_WARN}[debug] Unknown argument "${commandArgs[0]}". Toggled debug to ${toggled ? 'on' : 'off'}.${COLOR_RESET}\n`);
                        }
                    }
                    continue;
                }
                if (normalized === '/model') {
                    const desired = (commandArgs[0] || '').toLowerCase();
                    if (desired === 'fast' || desired === 'deep') {
                        this.defaultModelMode = desired;
                        process.env.DEFAULT_MODEL_TYPE = desired;
                        this.output.write(`${COLOR_INFO}[info] Default LLM mode set to ${desired}.${COLOR_RESET}\n`);
                    } else {
                        this.output.write(`${COLOR_WARN}[warn] Usage: /model fast|deep${COLOR_RESET}\n`);
                    }
                    continue;
                }
                if (normalized === '/lang') {
                    const desired = commandArgs.join(' ').trim();
                    if (desired && desired.length >= 2) {
                        try {
                            const updatedLanguage = this.setSpecLanguage(desired);
                            this.output.write(`${COLOR_INFO}[info] Default specification language set to ${updatedLanguage}.${COLOR_RESET}\n`);
                        } catch (error) {
                            this.output.write(`${COLOR_WARN}[warn] ${error.message}${COLOR_RESET}\n`);
                        }
                    } else {
                        this.output.write(`${COLOR_WARN}[warn] Usage: /lang <language> (e.g., english, spanish)${COLOR_RESET}\n`);
                    }
                    continue;
                }
                if (normalized === '/run') {
                    const skillName = commandArgs.shift();
                    if (!skillName) {
                        this.output.write(`${COLOR_WARN}[warn] Usage: /run &lt;skill&gt; &lt;&lt;instructions&gt;&gt;${COLOR_RESET}\n`);
                        continue;
                    }
                    const paddingStart = trimmedCommand.indexOf(skillName) + skillName.length;
                    const inlinePrompt = trimmedCommand.slice(paddingStart + 1).trim();
                    const explicitPrompt = this.extractInlinePrompt(inlinePrompt);
                    const instructionText = explicitPrompt || await this.promptReader(`(${skillName})> `);
                    await this.executeSingleSkill(skillName, instructionText);
                    continue;
                }
                if (normalized === '/cancel') {
                    if (!this.requestCancel('User typed /cancel.')) {
                        this.output.write(`${COLOR_WARN}[info] No plan was running.${COLOR_RESET}\n`);
                    }
                    continue;
                    }
                    this.output.write(`${COLOR_WARN}Unknown command: ${command}${COLOR_RESET}\n`);
                    continue;
                }

                if (!text) {
                    continue;
                }

                let trimmedTask = text.trim();
                if (!trimmedTask) {
                    continue;
                }

                if (await this.maybeHandleStatusQuestion(trimmedTask)) {
                    continue;
                }

                const resumeInfo = await this.detectResumeInput(trimmedTask);
                if (resumeInfo) {
                    await this.resumePendingPlan(resumeInfo.extra);
                    continue;
                }

                let plan = [];
                try {
                    plan = await this.preparePlan(trimmedTask);
                    this.pendingPlan = { plan, prompt: trimmedTask, nextIndex: 0 };
                } catch (error) {
                    this.output.write(`${COLOR_ERROR}[error] ${error.message}${COLOR_RESET}\n`);
                    continue;
                }

                if (!plan.length) {
                    continue;
                }

                this.printPlan(plan);
                if (this.requirePlanConfirmation) {
                    const confirmMessage = `[plan] Execute ${plan.length} ${plan.length === 1 ? 'step' : 'steps'}?`;
                    const approved = await this.promptYesNo(confirmMessage, true);
                    if (!approved) {
                        this.output.write(`${COLOR_WARN}[info] Plan execution cancelled by user.${COLOR_RESET}\n`);
                        continue;
                    }
                }

                const { executions, cancelled } = await this.executePlan(plan, {
                    announceProgress: this.announceStepProgress,
                    startIndex: this.pendingPlan?.nextIndex ?? 0,
                });
                this.printExecutions(executions);
                await this.captureMemoryEntry({
                    userPrompt: trimmedTask,
                    plan,
                    executions,
                    cancelled,
                });
            }
        } finally {
            this._restoreInputMode();
        }
    }
}

const parseArgs = (argv) => {
    const options = {
        startDirs: [],
        autoBootstrapMode: null,
        requirePlanConfirmation: null,
        announceStepProgress: null,
        interactive: true,
    };

    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--skills' || arg === '-s') {
            const value = argv[i + 1];
            if (value) {
                options.startDirs = ensureArray(value);
                i += 1;
            }
            continue;
        }
        if (arg === '--bootstrap-mode' || arg === '-b') {
            const value = argv[i + 1];
            if (value) {
                options.autoBootstrapMode = value;
                i += 1;
            }
            continue;
        }
        if (arg === '--assume-yes' || arg === '--yes' || arg === '-y') {
            options.requirePlanConfirmation = false;
            continue;
        }
        if (arg === '--confirm-plan') {
            options.requirePlanConfirmation = true;
            continue;
        }
        if (arg === '--no-progress') {
            options.announceStepProgress = false;
            continue;
        }
        if (arg === '--progress') {
            options.announceStepProgress = true;
            continue;
        }
        if (arg === '--non-interactive') {
            options.interactive = false;
            continue;
        }
    }

    if (!options.startDirs.length && process.env.ACHILES_CLI_SKILLS) {
        options.startDirs = ensureArray(process.env.ACHILES_CLI_SKILLS);
    }

    return options;
};

const runFromCommandLine = async () => {
    const options = parseArgs(process.argv);
    const cli = new AchilesCLI({
        startDirs: options.startDirs,
        autoBootstrapMode: options.autoBootstrapMode ?? 'ask',
        requirePlanConfirmation: typeof options.requirePlanConfirmation === 'boolean'
            ? options.requirePlanConfirmation
            : false,
        announceStepProgress: typeof options.announceStepProgress === 'boolean'
            ? options.announceStepProgress
            : true,
        interactive: options.interactive,
    });
    await cli.runInteractive();
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runFromCommandLine().catch((error) => {
        console.error(`${COLOR_ERROR}Achiles CLI failed: ${error.message}${COLOR_RESET}`);
        process.exitCode = 1;
    });
}

export { AchilesCLI, runFromCommandLine };
export default AchilesCLI;
