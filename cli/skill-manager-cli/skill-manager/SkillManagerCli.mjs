import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { LLMAgent } from '../../../LLMAgents/LLMAgent.mjs';
import { RecursiveSkilledAgent } from '../../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';
import { createSpinner } from './spinner.mjs';
import { ActionReporter } from '../../../utils/ActionReporter.mjs';
import { HistoryManager } from './HistoryManager.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * SkillManagerCli - A CLI wrapper for managing skill definition files.
 *
 * This CLI uses the RecursiveSkilledAgent infrastructure to discover and execute
 * skills from two locations:
 * 1. Built-in skills from the module's .AchillesSkills directory
 * 2. User skills from the working directory's .AchillesSkills directory
 *
 * All operations (list, read, write, validate, generate, test, refine) are
 * implemented as skills, with the 'skill-manager' orchestrator routing requests.
 */
export class SkillManagerCli {
    constructor({
        workingDir = process.cwd(),
        llmAgent = null,
        llmAgentOptions = {},
        logger = console,
    } = {}) {
        this.workingDir = path.resolve(workingDir);
        this.skillsDir = path.join(this.workingDir, '.AchillesSkills');
        this.logger = logger;

        // Path to built-in skills bundled with this module
        this.builtInSkillsDir = path.join(__dirname, '.AchillesSkills');

        // Ensure user's .AchillesSkills directory exists
        if (!fs.existsSync(this.skillsDir)) {
            fs.mkdirSync(this.skillsDir, { recursive: true });
            this.logger.log?.(`Created .AchillesSkills directory at ${this.skillsDir}`);
        }

        // Initialize LLM Agent
        this.llmAgent = llmAgent || new LLMAgent({
            name: 'skill-manager-agent',
            ...llmAgentOptions,
        });

        // Initialize RecursiveSkilledAgent for skill discovery and execution
        // Start with the working directory to discover user skills
        this.skilledAgent = new RecursiveSkilledAgent({
            llmAgent: this.llmAgent,
            startDir: this.workingDir,
            logger: this.logger,
        });

        // Also register built-in skills from the module directory
        if (fs.existsSync(this.builtInSkillsDir)) {
            this.skilledAgent.registerSkillsFromRoot(this.builtInSkillsDir);
            this.logger.log?.(`Registered built-in skills from ${this.builtInSkillsDir}`);
        }

        // Context object passed to all skills
        this.context = {
            workingDir: this.workingDir,
            skillsDir: this.skillsDir,
            skilledAgent: this.skilledAgent,
            llmAgent: this.llmAgent,
            logger: this.logger,
        };

        // Initialize history manager for command history persistence
        this.historyManager = new HistoryManager({
            workingDir: this.workingDir,
        });
    }

    /**
     * Get list of all registered skills
     */
    getSkills() {
        return Array.from(this.skilledAgent.skillCatalog.values());
    }

    /**
     * Reload skills from disk
     */
    reloadSkills() {
        // Clear existing catalogs
        this.skilledAgent.skillCatalog.clear();
        this.skilledAgent.skillAliases.clear();
        this.skilledAgent.skillToSubsystem.clear();

        // Re-discover from working directory
        this.skilledAgent.registerDiscoveredSkills();

        // Re-register built-in skills
        if (fs.existsSync(this.builtInSkillsDir)) {
            this.skilledAgent.registerSkillsFromRoot(this.builtInSkillsDir);
        }

        const count = this.skilledAgent.skillCatalog.size;
        this.logger.log?.(`Reloaded ${count} skill(s)`);
        return count;
    }

    /**
     * Process a user prompt by delegating to the skill-manager orchestrator
     */
    async processPrompt(userPrompt, options = {}) {
        const { skillName = 'skill-manager', ...restOptions } = options;

        try {
            const result = await this.skilledAgent.executePrompt(userPrompt, {
                skillName,
                context: this.context,
                ...restOptions,
            });

            // Extract result from various response shapes
            if (typeof result === 'string') {
                return result;
            }
            if (result?.result) {
                return typeof result.result === 'string'
                    ? result.result
                    : JSON.stringify(result.result, null, 2);
            }
            if (result?.output) {
                return result.output;
            }
            return JSON.stringify(result, null, 2);
        } catch (error) {
            this.logger.error?.(`Skill execution failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Execute a specific skill directly
     */
    async executeSkill(skillName, input, options = {}) {
        return this.skilledAgent.executePrompt(input, {
            skillName,
            context: this.context,
            ...options,
        });
    }

    /**
     * Get only user skills (exclude built-in skills)
     */
    getUserSkills() {
        return this.getSkills().filter(s => !s.skillDir?.startsWith(this.builtInSkillsDir));
    }

    /**
     * Set an ActionReporter for real-time feedback
     * @param {ActionReporter} reporter - The reporter instance (or null to disable)
     */
    setActionReporter(reporter) {
        this.skilledAgent.setActionReporter(reporter);
    }

    /**
     * Create and return an ActionReporter configured for this agent
     * @param {Object} options - Reporter options
     * @returns {ActionReporter}
     */
    createActionReporter(options = {}) {
        const reporter = new ActionReporter(options);
        this.setActionReporter(reporter);
        return reporter;
    }

    /**
     * Start interactive REPL
     */
    async startREPL() {
        const userSkills = this.getUserSkills();

        console.log('\n╔══════════════════════════════════════════════════════════╗');
        console.log('║           Skill Manager Agent - Interactive CLI          ║');
        console.log('╚══════════════════════════════════════════════════════════╝\n');
        console.log(`Working directory: ${this.workingDir}`);
        console.log(`Skills directory: ${this.skillsDir}`);

        // Show LLM model info
        try {
            const description = this.llmAgent.invokerStrategy?.describe?.();
            if (description) {
                const orchestratorMode = process.env.ACHILLES_ORCHESTRATOR_MODE || 'fast';
                const models = orchestratorMode === 'deep' ? description.deepModels : description.fastModels;
                const primaryModel = models?.[0]?.name || 'unknown';
                const fallbacks = models?.slice(1, 3).map(m => m.name).join(', ');
                const fallbackInfo = fallbacks ? ` (fallbacks: ${fallbacks})` : '';
                console.log(`LLM: ${primaryModel}${fallbackInfo} [${orchestratorMode} mode]`);
            }
        } catch (e) {
            // Ignore errors getting model info
        }

        if (userSkills.length > 0) {
            console.log(`Loaded ${userSkills.length} skill(s):`);
            userSkills.forEach(s => console.log(`  • [${s.type}] ${s.shortName || s.name}`));
        } else {
            console.log('No user skills found. Create one with "create a skill" to get started.');
        }

        // Show history info
        if (this.historyManager.length > 0) {
            console.log(`Command history: ${this.historyManager.length} entries (use ↑/↓ to navigate, "history" to view)`);
        }

        console.log('\nCommands: "exit" to quit, "reload" to refresh skills, "history" to view past commands.\n');

        // Create readline interface with history support
        // Note: readline expects history in reverse order (newest first)
        const promptOnce = () => {
            return new Promise((resolve) => {
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout,
                    history: this.historyManager.getAll().reverse(),
                    historySize: this.historyManager.maxEntries,
                    terminal: true,
                });
                rl.question('SkillManager> ', (answer) => {
                    rl.close();
                    resolve(answer);
                });
            });
        };

        while (true) {
            const input = (await promptOnce()).trim();

            if (!input) continue;

            if (['exit', 'quit', 'q'].includes(input.toLowerCase())) {
                console.log('\nGoodbye!\n');
                break;
            }

            // Quick commands (no LLM needed)
            if (input.toLowerCase() === 'help') {
                this._printHelp();
                continue;
            }

            if (input.toLowerCase() === 'reload') {
                const spinner = createSpinner('Reloading skills');
                const count = this.reloadSkills();
                spinner.succeed(`Reloaded ${count} skill(s)`);
                continue;
            }

            if (input.toLowerCase() === 'list' || input.toLowerCase() === 'ls') {
                const userSkills = this.getUserSkills();
                if (userSkills.length === 0) {
                    console.log('\nNo user skills found.\n');
                } else {
                    console.log('\nUser skills:');
                    userSkills.forEach(s => console.log(`  • [${s.type}] ${s.shortName || s.name}`));
                    console.log('');
                }
                continue;
            }

            if (input.toLowerCase() === 'list all' || input.toLowerCase() === 'ls -a') {
                const skills = this.getSkills();
                const builtIn = skills.filter(s => s.skillDir?.startsWith(this.builtInSkillsDir));
                const user = skills.filter(s => !s.skillDir?.startsWith(this.builtInSkillsDir));

                console.log('\nAll skills:');
                if (user.length > 0) {
                    console.log('  User:');
                    user.forEach(s => console.log(`    • [${s.type}] ${s.shortName || s.name}`));
                }
                if (builtIn.length > 0) {
                    console.log('  Built-in:');
                    builtIn.forEach(s => console.log(`    • [${s.type}] ${s.shortName || s.name}`));
                }
                console.log('');
                continue;
            }

            // History commands
            if (input.toLowerCase() === 'history' || input.toLowerCase() === 'hist') {
                this._showHistory();
                continue;
            }

            if (input.toLowerCase().startsWith('history ') || input.toLowerCase().startsWith('hist ')) {
                const arg = input.split(/\s+/).slice(1).join(' ');
                if (arg === 'clear') {
                    this.historyManager.clear();
                    console.log('\nHistory cleared.\n');
                } else if (arg.match(/^\d+$/)) {
                    this._showHistory(parseInt(arg, 10));
                } else {
                    // Search history
                    this._searchHistory(arg);
                }
                continue;
            }

            // Create AbortController for ESC cancellation
            const abortController = new AbortController();
            let wasInterrupted = false;

            // Create ActionReporter for real-time feedback (Claude Code style)
            const actionReporter = new ActionReporter({
                mode: 'spinner',
                showInterruptHint: true,
            });
            this.skilledAgent.setActionReporter(actionReporter);

            // Set up ESC key listener
            const handleKeypress = (key) => {
                // ESC key
                if (key === '\x1b' || key === '\u001b') {
                    wasInterrupted = true;
                    abortController.abort();
                }
            };

            // Enable raw mode to capture individual keypresses
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(true);
                process.stdin.resume();
                process.stdin.on('data', handleKeypress);
            }

            // Set up a prompt reader that pauses the reporter during user input
            this.skilledAgent.promptReader = async (prompt) => {
                // Pause the action reporter while waiting for user input
                actionReporter.pause();

                // Temporarily disable raw mode for readline
                if (process.stdin.isTTY) {
                    process.stdin.setRawMode(false);
                    process.stdin.removeListener('data', handleKeypress);
                }

                return new Promise((resolve) => {
                    const rl = readline.createInterface({
                        input: process.stdin,
                        output: process.stdout,
                    });
                    rl.question(prompt, (answer) => {
                        rl.close();
                        // Re-enable raw mode and ESC listener
                        if (process.stdin.isTTY) {
                            process.stdin.setRawMode(true);
                            process.stdin.on('data', handleKeypress);
                        }
                        // Resume the action reporter after user responds
                        actionReporter.resume();
                        resolve(answer);
                    });
                });
            };

            // Start with initial "Thinking" action
            actionReporter.thinking();

            try {
                const result = await this.processPrompt(input, {
                    signal: abortController.signal,
                });

                // Show actual model used
                const lastInvocation = this.llmAgent.invokerStrategy?.getLastInvocationDetails?.();
                const modelInfo = lastInvocation?.model ? ` [${lastInvocation.model}]` : '';

                // Complete any remaining actions and show final status
                actionReporter.reset();
                const elapsed = actionReporter.history.length > 0
                    ? actionReporter.history[actionReporter.history.length - 1]?.duration
                    : null;
                const durationInfo = elapsed ? ` (${(elapsed / 1000).toFixed(1)}s)` : '';
                console.log(`✓ Done${modelInfo}${durationInfo}`);

                console.log('-'.repeat(60));
                console.log(result);
                console.log('-'.repeat(60) + '\n');
            } catch (error) {
                if (wasInterrupted || error.name === 'AbortError') {
                    actionReporter.interrupted('Operation cancelled');
                    console.log('');
                } else {
                    const lastInvocation = this.llmAgent.invokerStrategy?.getLastInvocationDetails?.();
                    const modelInfo = lastInvocation?.model ? ` [${lastInvocation.model}]` : '';
                    actionReporter.failAction(error);
                    console.error(`\n${error.message}\n`);
                }
            } finally {
                // Clean up ESC listener
                if (process.stdin.isTTY) {
                    process.stdin.setRawMode(false);
                    process.stdin.removeListener('data', handleKeypress);
                }

                // Clean up reporter and prompt reader
                this.skilledAgent.setActionReporter(null);
                this.skilledAgent.promptReader = null;

                // Save command to history (unless interrupted)
                if (!wasInterrupted) {
                    this.historyManager.add(input);
                }
            }
        }
    }

    _printHelp() {
        console.log(`
+----------------------------------------------------------+
|                     Quick Reference                       |
+----------------------------------------------------------+

Quick Commands (no LLM):
  list, ls          List user skills
  list all, ls -a   List all skills (including built-in)
  reload            Refresh skills from disk
  history, hist     Show recent command history
  history <n>       Show last n commands
  history <query>   Search history for query
  history clear     Clear command history
  help              Show this help
  exit, quit, q     Exit the CLI
  Esc               Cancel running operation

Natural Language Examples:
  "list all skills"
  "read the equipment skill"
  "create a new tskill called inventory"
  "show me the template for cskill"
  "update the Summary section of myskill"
  "validate the area skill"
  "generate code for equipment"
  "test the generated code for equipment"
  "refine equipment until tests pass"
  "delete the old-skill"

Skill Types:
  tskill - Database table (fields, validators, etc.)
  cskill - Code skill (LLM generates code)
  iskill - Interactive (commands, user input)
  oskill - Orchestrator (routes to other skills)
  mskill - MCP tool integration
`);
    }

    /**
     * Show recent command history
     * @param {number} count - Number of recent commands to show (default: 20)
     */
    _showHistory(count = 20) {
        const recent = this.historyManager.getRecent(count);
        if (recent.length === 0) {
            console.log('\nNo command history yet.\n');
            return;
        }

        console.log(`\nCommand history (last ${recent.length} of ${this.historyManager.length}):`);
        recent.forEach(({ index, command }) => {
            console.log(`  ${index.toString().padStart(4)}  ${command}`);
        });
        console.log(`\nHistory stored at: ${this.historyManager.getHistoryPath()}\n`);
    }

    /**
     * Search command history
     * @param {string} query - Search query
     */
    _searchHistory(query) {
        const results = this.historyManager.search(query, 20);
        if (results.length === 0) {
            console.log(`\nNo history entries matching "${query}".\n`);
            return;
        }

        console.log(`\nHistory entries matching "${query}":`);
        results.forEach(({ index, command }) => {
            console.log(`  ${index.toString().padStart(4)}  ${command}`);
        });
        console.log('');
    }

    /**
     * Get the history manager instance
     * @returns {HistoryManager}
     */
    getHistoryManager() {
        return this.historyManager;
    }
}

export default SkillManagerCli;
