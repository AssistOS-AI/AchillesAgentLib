import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { LLMAgent } from 'achillesAgentLib/LLMAgents';
import { SkilledAgent } from 'achillesAgentLib/SkilledAgents';
import { RecursiveSkilledAgent } from '../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';
import GampRSP from './GampRSP.mjs';
import { configureLLMLogger } from '../../utils/LLMLogger.mjs';
import MemoryManager from './helpers/MemoryManager.mjs';
import {
    initHistory,
    askUser,
    readMultiline as readMultilineHelper,
    setupGlobalKeypressHandler,
    restoreInputMode as restoreInputModeHelper,
    handleGlobalKeypress,
} from './helpers/inputHelpers.mjs';
import {
    ensureArray,
    isTruthy,
} from './helpers/cliUtils.mjs';
import {
    normalizeBootstrapMode,
    ensureBootstrap as ensureBootstrapHelper,
} from './helpers/bootstrapHelpers.mjs';
import {
    registerLocalSkills,
    getSkillCatalog as getSkillCatalogHelper,
    listSkills as listSkillsHelper,
    findSkill as findSkillHelper,
    getOrchestrators as getOrchestratorsHelper,
} from './helpers/skillCatalog.mjs';
import {
    processTaskInput as processTaskInputHelper,
    preparePlan as preparePlanHelper,
    executePlan as executePlanHelper,
    detectResumeInput as detectResumeInputHelper,
    resumePendingPlan as resumePendingPlanHelper,
    summarizeExecutions,
} from './helpers/planService.mjs';
import {
    executeSingleSkill as executeSingleSkillHelper,
} from './helpers/executionHelpers.mjs';
import { runInteractiveLoop } from './helpers/interactiveLoop.mjs';
import { setupLLMDebugging } from './helpers/debugHelpers.mjs';
import {
    printHelp as printHelpHelper,
    printStatus as printStatusHelper,
} from './helpers/outputHelpers.mjs';
import {
    COLOR_RESET,
    COLOR_INFO,
    COLOR_WARN,
    COLOR_ERROR,
    COLOR_DEBUG,
} from './helpers/styles.mjs';
import {
    resolveSpecTargets,
    describeSpecs,
} from './helpers/specDocumentHelpers.mjs';

const DEFAULT_LIST_COLUMNS = ['name', 'type', 'summary', 'implementation'];
const DEFAULT_INITIAL_PROMPT = 'achilles> ';
const DEFAULT_CONTINUATION_PROMPT = '... ';

class AchillesCLI {
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
        this.output = output || process.stdout;
        this.inputStream = process.stdin;
        this.promptReader = this._customPromptReader || ((message) => askUser(this, message));
        this.listTimeoutMs = Number.isFinite(listTimeoutMs) && listTimeoutMs > 0
            ? listTimeoutMs
            : 1500;
        this.colors = {
            info: COLOR_INFO,
            warn: COLOR_WARN,
            error: COLOR_ERROR,
            debug: COLOR_DEBUG,
            reset: COLOR_RESET,
        };

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
        initHistory(this);

        const debugEnv = process.env.ACHILLES_LLM_DEBUG ?? process.env.ACHILES_LLM_DEBUG;
        this.debugMode = isTruthy(debugEnv);
        this.llmAgent = llmAgent instanceof LLMAgent
            ? llmAgent
            : new LLMAgent();
        setupLLMDebugging(this);

        this.defaultModelMode = process.env.ACHILLES_DEFAULT_MODEL_TYPE === 'deep' ? 'deep' : 'fast';
        this.specLanguage = this.normalizeLanguageInput(process.env.DEFAULT_SPEC_LANGUAGE) || 'english';
        this.bootstrapCompleted = false;
        this.interactive = Boolean(interactive);
        const defaultBootstrapMode = 'auto';
        this.autoBootstrapMode = normalizeBootstrapMode(autoBootstrapMode, defaultBootstrapMode);
        this.requirePlanConfirmation = typeof requirePlanConfirmation === 'boolean'
            ? requirePlanConfirmation
            : false;
        this.announceStepProgress = typeof announceStepProgress === 'boolean'
            ? announceStepProgress
            : this.interactive;
        this.pendingPlan = null;
        this.planInProgress = false;
        this.cancelRequested = false;
        this._handleKeypressBound = null;
        this._rawModeWasEnabled = false;
        this._keypressHandlerInitialized = false;
        this._llmCompleteWrapped = false;
        this._bootstrapPromise = null;

        const cliSkillRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '.AchillesSkills');
        this.skillSearchRoots = [
            cliSkillRoot,
            ...(skillDirs.length ? skillDirs : [this.workspaceRoot]),
        ].map((dir) => path.resolve(dir));

        this.skilledAgent = new SkilledAgent({
            llmAgent: this.llmAgent,
            promptReader: this.promptReader,
        });

        this.recursiveAgent = new RecursiveSkilledAgent({
            skilledAgent: this.skilledAgent,
            startDir: this.skillSearchRoots[0],
        });

        registerLocalSkills(this);

        this.memoryManager = new MemoryManager({
            specsRoot: this.specsRoot,
            workspaceRoot: this.workspaceRoot,
            llmAgent: this.llmAgent,
            summarizeExecutions: (executions) => summarizeExecutions(this, executions),
        });
        this.globalMemory = this.memoryManager.globalMemory;
        this.userMemory = this.memoryManager.userMemory;
        this.sessionMemory = this.memoryManager.sessionMemory;

        this.bootstrapInitialization = this.ensureBootstrap('Initial workspace bootstrap')
            .catch((error) => {
                this.output.write(`${this.colors.warn}[auto] Bootstrap failed: ${error.message}${this.colors.reset}\n`);
            });

        if (this.interactive) {
            setupGlobalKeypressHandler(this, (str, key) => handleGlobalKeypress(this, str, key));
        }
    }

    normalizeLanguageInput(value) {
        if (typeof value !== 'string') {
            return '';
        }
        return value.trim().toLowerCase();
    }

    activeSpecLanguage() {
        return this.normalizeLanguageInput(this.specLanguage) || 'english';
    }

    setSpecLanguage(language) {
        const normalized = this.normalizeLanguageInput(language);
        if (!normalized || normalized.length < 2) {
            throw new Error('Specification language requires at least two characters.');
        }
        this.specLanguage = normalized;
        process.env.DEFAULT_SPEC_LANGUAGE = normalized;
        return normalized;
    }

    buildLanguageContract({ heading = '## Language Requirements' } = {}) {
        const sectionHeading = typeof heading === 'string' && heading.trim()
            ? heading.trim()
            : '## Language Requirements';
        const language = this.activeSpecLanguage();
        return [
            sectionHeading,
            `- Output language: ${language}.`,
            '- Always respond in this language even when prompts use another language.',
            '- Translate and restate user instructions before generating specifications.',
            '- Remind the operator they can run "/lang <code>" to change this preference.',
            '- Reject placeholder values such as "your_value".',
        ].join('\n');
    }

    withLanguageContract(promptText = '', options = {}) {
        const contract = this.buildLanguageContract(options);
        const trimmed = typeof promptText === 'string' ? promptText.trim() : '';
        if (!trimmed) {
            return contract;
        }
        return `${trimmed}\n\n${contract}`;
    }

    ensureBootstrap(taskDescription) {
        return ensureBootstrapHelper(this, taskDescription);
    }

    getSkillCatalog() {
        return getSkillCatalogHelper(this);
    }

    async listSkills(columns = DEFAULT_LIST_COLUMNS) {
        return listSkillsHelper(this, columns, this.listTimeoutMs);
    }

    findSkill(name) {
        return findSkillHelper(this, name);
    }

    getOrchestrators() {
        return getOrchestratorsHelper(this);
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
            this.output.write(`${this.colors.info}${prefix} ${text}${this.colors.reset}\n`);
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
        this.output.write(`${this.colors.debug}[debug] LLM debug logging ${status}.${this.colors.reset}\n`);
        return this.debugMode;
    }

    requestCancel(reason = 'User requested cancellation.') {
        if (!this.planInProgress) {
            this.output.write(`${this.colors.warn}[info] No active plan to cancel.${this.colors.reset}\n`);
            return false;
        }
        if (this.cancelRequested) {
            return false;
        }
        this.cancelRequested = true;
        this.output.write(`${this.colors.warn}[info] Cancelling current plan: ${reason}${this.colors.reset}\n`);
        try {
            if (this.skilledAgent && typeof this.skilledAgent.cancelTasks === 'function') {
                this.skilledAgent.cancelTasks();
            }
        } catch {
            // ignore cancellation errors
        }
        return true;
    }

    readMultiline(initialPrompt = DEFAULT_INITIAL_PROMPT, continuationPrompt = DEFAULT_CONTINUATION_PROMPT) {
        return readMultilineHelper(this, initialPrompt, continuationPrompt);
    }

    restoreInputMode() {
        restoreInputModeHelper(this);
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

    async executeSingleSkill(skillName, promptText = '') {
        await executeSingleSkillHelper(this, skillName, promptText);
    }

    async preparePlan(taskText) {
        return preparePlanHelper(this, taskText);
    }

    async executePlan(planSteps, options = {}) {
        return executePlanHelper(this, planSteps, options);
    }

    async processTaskInput(taskText, options = {}) {
        return processTaskInputHelper(this, taskText, options);
    }

    async detectResumeInput(text) {
        return detectResumeInputHelper(this, text);
    }

    async showSpecifications(filterText = '') {
        await this.ensureBootstrap('spec display');
        const targets = resolveSpecTargets(this, filterText);
        const entries = describeSpecs(this, targets);
        if (!entries.length) {
            this.output.write(`${this.colors.warn}[specs] No specification entries matched the request.${this.colors.reset}\n`);
            return;
        }
        entries.forEach((entry) => {
            this.output.write(`${this.colors.info}[specs] ${entry.id}${entry.title ? ` – ${entry.title}` : ''}${this.colors.reset}\n`);
            if (entry.text) {
                this.output.write(`${entry.text}\n\n`);
            }
        });
    }

    async resumePendingPlan(extraInstructions = '') {
        return resumePendingPlanHelper(this, extraInstructions);
    }

    async captureMemoryEntry(entry) {
        await this.memoryManager.capture(entry);
    }

    printHelp() {
        printHelpHelper(this);
    }

    printStatus() {
        printStatusHelper(this);
    }

    async runInteractive() {
        if (this.bootstrapInitialization) {
            await this.bootstrapInitialization;
        }
        await runInteractiveLoop(this);
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

    if (!options.startDirs.length) {
        const envSkills = process.env.ACHILLES_CLI_SKILLS ?? process.env.ACHILES_CLI_SKILLS;
        if (envSkills) {
            options.startDirs = ensureArray(envSkills);
        }
    }

    return options;
};

const runFromCommandLine = async () => {
    const options = parseArgs(process.argv);
    const cli = new AchillesCLI({
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
        console.error(`${COLOR_ERROR}Achilles CLI failed: ${error.message}${COLOR_RESET}`);
        process.exitCode = 1;
    });
}

export { AchillesCLI, runFromCommandLine };
export default AchillesCLI;
