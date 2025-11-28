import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';
import { RecursiveSkilledAgent } from '../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';
import { createSpinner } from './spinner.mjs';
import { ActionReporter } from '../../utils/ActionReporter.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * SkillManagerAgent - A skill-based agent for managing skill definition files.
 *
 * This agent uses the RecursiveSkilledAgent infrastructure to discover and execute
 * skills from two locations:
 * 1. Built-in skills from the module's .AchillesSkills directory
 * 2. User skills from the working directory's .AchillesSkills directory
 *
 * All operations (list, read, write, validate, generate, test, refine) are
 * implemented as skills, with the 'skill-manager' orchestrator routing requests.
 */
export class SkillManagerAgent {
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

        console.log('\nCommands: "exit" to quit, "reload" to refresh skills, or type any instruction.\n');

        const promptOnce = () => {
            return new Promise((resolve) => {
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout,
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

            // Create ActionReporter for real-time feedback (Claude Code style)
            const actionReporter = new ActionReporter({ mode: 'spinner' });
            this.skilledAgent.setActionReporter(actionReporter);

            // Set up a prompt reader that pauses the reporter during user input
            this.skilledAgent.promptReader = async (prompt) => {
                // Pause the action reporter while waiting for user input
                actionReporter.pause();

                return new Promise((resolve) => {
                    const rl = readline.createInterface({
                        input: process.stdin,
                        output: process.stdout,
                    });
                    rl.question(prompt, (answer) => {
                        rl.close();
                        // Resume the action reporter after user responds
                        actionReporter.resume();
                        resolve(answer);
                    });
                });
            };

            // Start with initial "Thinking" action
            actionReporter.thinking();

            try {
                const result = await this.processPrompt(input);

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
                const lastInvocation = this.llmAgent.invokerStrategy?.getLastInvocationDetails?.();
                const modelInfo = lastInvocation?.model ? ` [${lastInvocation.model}]` : '';
                actionReporter.failAction(error);
                console.error(`\n${error.message}\n`);
            } finally {
                // Clean up reporter and prompt reader
                this.skilledAgent.setActionReporter(null);
                this.skilledAgent.promptReader = null;
            }
        }
    }

    _printHelp() {
        console.log(`
+----------------------------------------------------------+
|                     Quick Reference                       |
+----------------------------------------------------------+

Quick Commands (no LLM):
  list, ls        List user skills
  list all, ls -a List all skills (including built-in)
  reload          Refresh skills from disk
  help            Show this help
  exit, quit, q   Exit the CLI

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
}

export default SkillManagerAgent;
