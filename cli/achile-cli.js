import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { LLMAgent } from '../LLMAgents/index.mjs';
import { SkilledAgent } from '../SkilledAgents/index.mjs';
import { RecursiveSkilledAgent } from '../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';
import defaultPromptReader from '../utils/defaultPromptReader.mjs';
import GampRSP from './GampRSP.mjs';

const COLOR_RESET = '\x1b[0m';
const COLOR_INFO = '\x1b[36m';
const COLOR_WARN = '\x1b[33m';
const COLOR_ERROR = '\x1b[31m';

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

const buildPlanPrompt = ({ task, orchestrators }) => {
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

const parsePlan = (raw, fallbackSkill) => {
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

    if (!fallbackSkill) {
        return [];
    }
    return [{
        skill: fallbackSkill.name,
        prompt: typeof raw === 'string' && raw.trim()
            ? raw.trim()
            : 'Handle the complete task described earlier.',
    }];
};

class AchilesCLI {
    constructor({
        startDirs = [],
        workspaceRoot = process.cwd(),
        llmAgent = null,
        promptReader = null,
        output = process.stdout,
        listTimeoutMs = 1500,
    } = {}) {
        const skillDirs = ensureArray(startDirs);
        this.promptReader = typeof promptReader === 'function' ? promptReader : defaultPromptReader;
        this.output = output || process.stdout;
        this.listTimeoutMs = Number.isFinite(listTimeoutMs) && listTimeoutMs > 0
            ? listTimeoutMs
            : 1500;

        this.workspaceRoot = path.resolve(workspaceRoot || process.cwd());
        GampRSP.configure(this.workspaceRoot);
        this.specsRoot = GampRSP.getSpecsDirectory();
        this.bootstrapCompleted = false;

        this.llmAgent = llmAgent instanceof LLMAgent
            ? llmAgent
            : new LLMAgent();

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

        const parsed = parsePlan(rawPlan, null);
        if (parsed.length) {
            return parsed;
        }

        if (!rawPlan && orchestrators.length) {
            return parsePlan(rawPlan, orchestrators[0]);
        }

        return [];
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

    async _runSkill(record, promptText) {
        return this.recursiveAgent.executeWithReviewMode(promptText, {
            skillName: record.name,
            args: this._buildArgsForSkill(record, promptText),
            context: {
                workspaceRoot: this.workspaceRoot,
                specsRoot: this.specsRoot,
                llmAgent: this.llmAgent,
            },
        });
    }

    async executePlan(planSteps = []) {
        const executions = [];
        for (const step of planSteps) {
            const record = this.findSkill(step.skill);
            if (!record) {
                executions.push({
                    ...step,
                    status: 'failed',
                    error: `Skill "${step.skill}" not found.`,
                });
                continue;
            }

            try {
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
        }

        return executions;
    }

    async ensureBootstrap(taskDescription) {
        if (this.bootstrapCompleted) {
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
    }

    async executeGenericFallback(promptText) {
        const record = this.findSkill('generic-skill');
        if (!record) {
            const fallback = await this.recursiveAgent.executePrompt(promptText, {
                context: {
                    workspaceRoot: this.workspaceRoot,
                    specsRoot: this.specsRoot,
                },
            });
            return {
                skill: 'auto',
                prompt: promptText,
                status: 'ok',
                result: fallback,
            };
        }

        try {
            const result = await this._runSkill(record, promptText);
            return {
                skill: record.shortName || record.name,
                prompt: promptText,
                status: 'ok',
                result,
            };
        } catch (error) {
            return {
                skill: record.shortName || record.name,
                prompt: promptText,
                status: 'failed',
                error: error.message,
            };
        }
    }

    async processTaskInput(taskText) {
        const trimmed = taskText.trim();
        if (!trimmed) {
            return {
                plan: [],
                executions: [],
            };
        }

        await this.ensureBootstrap(trimmed);
        const plan = await this.createPlan(trimmed);
        if (!plan.length) {
            return {
                plan: [],
                executions: [await this.executeGenericFallback(trimmed)],
            };
        }

        const executions = await this.executePlan(plan);
        return { plan, executions };
    }

    async readMultiline(initialPrompt = 'achiles> ', continuationPrompt = '... ') {
        const lines = [];
        let first = true;

        while (true) {
            // eslint-disable-next-line no-await-in-loop
            const value = await this.promptReader(first ? initialPrompt : continuationPrompt);
            if (first && value.trim().startsWith('/')) {
                return { command: value.trim() };
            }
            if (!first && !value.trim()) {
                break;
            }
            if (!first || value.trim()) {
                lines.push(value);
            }
            first = false;
        }

        return { text: lines.join('\n').trim() };
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
                this.output.write(`  Result: ${JSON.stringify(execution.result)}\n`);
            }
        });
    }

    async runInteractive() {
        this.output.write(`${COLOR_INFO}Achiles CLI ready. Commands: /list, /exit${COLOR_RESET}\n`);
        while (true) {
            const { command, text } = await this.readMultiline();
            if (command) {
                const normalized = command.trim().toLowerCase();
                if (normalized === '/exit' || normalized === '/quit') {
                    this.output.write('Exiting Achiles CLI.\n');
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
                this.output.write(`${COLOR_WARN}Unknown command: ${command}${COLOR_RESET}\n`);
                continue;
            }

            if (!text) {
                continue;
            }

            const { plan, executions } = await this.processTaskInput(text);
            this.printPlan(plan);
            this.printExecutions(executions);
        }
    }
}

const parseArgs = (argv) => {
    const options = {
        startDirs: [],
    };

    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--skills' || arg === '-s') {
            const value = argv[i + 1];
            if (value) {
                options.startDirs = ensureArray(value);
                i += 1;
            }
        }
    }

    if (!options.startDirs.length && process.env.ACHILES_CLI_SKILLS) {
        options.startDirs = ensureArray(process.env.ACHILES_CLI_SKILLS);
    }

    return options;
};

const runFromCommandLine = async () => {
    const options = parseArgs(process.argv);
    const cli = new AchilesCLI(options);
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
