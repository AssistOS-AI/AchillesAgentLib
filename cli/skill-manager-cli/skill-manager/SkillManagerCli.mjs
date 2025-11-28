import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLMAgent } from '../../../LLMAgents/LLMAgent.mjs';
import { RecursiveSkilledAgent } from '../../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';
import { ActionReporter } from '../../../utils/ActionReporter.mjs';
import { HistoryManager } from './HistoryManager.mjs';
import { REPLSession } from './REPLSession.mjs';
import { SlashCommandHandler } from './SlashCommandHandler.mjs';
import { summarizeResult, formatSlashResult } from './ResultFormatter.mjs';

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
        debug = false,
    } = {}) {
        this.workingDir = path.resolve(workingDir);
        this.skillsDir = path.join(this.workingDir, '.AchillesSkills');
        this.logger = logger;
        this.debug = debug;

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

        // Initialize slash command handler for backward compatibility
        this._slashHandler = new SlashCommandHandler({
            executeSkill: (skillName, input, opts) => this.executeSkill(skillName, input, opts),
            getUserSkills: () => this.getUserSkills(),
            getSkills: () => this.getSkills(),
        });
    }

    /**
     * Slash command definitions (backward compatibility).
     * @see SlashCommandHandler.COMMANDS
     */
    static SLASH_COMMANDS = SlashCommandHandler.COMMANDS;

    /**
     * Check if input is a slash command (backward compatibility).
     * @param {string} input - User input
     * @returns {boolean}
     */
    isSlashCommand(input) {
        return this._slashHandler.isSlashCommand(input);
    }

    /**
     * Parse a slash command (backward compatibility).
     * @param {string} input - User input starting with /
     * @returns {{command: string, args: string}|null}
     */
    parseSlashCommand(input) {
        return this._slashHandler.parseSlashCommand(input);
    }

    /**
     * Execute a slash command (backward compatibility).
     * @param {string} command - Command name (without /)
     * @param {string} args - Command arguments
     * @param {Object} options - Execution options
     * @returns {Promise<{handled: boolean, result?: string, error?: string}>}
     */
    async executeSlashCommand(command, args, options = {}) {
        return this._slashHandler.executeSlashCommand(command, args, options);
    }

    /**
     * Get autocomplete suggestions for slash commands (backward compatibility).
     * @param {string} line - Current input line
     * @returns {[string[], string]}
     */
    _getSlashCompletions(line) {
        return this._slashHandler.getCompletions(line);
    }

    /**
     * Get hint text for current input (backward compatibility).
     * @param {string} line - Current input line
     * @returns {string|null}
     */
    _getInputHint(line) {
        return this._slashHandler.getInputHint(line);
    }

    /**
     * Print slash command help (backward compatibility).
     */
    _printSlashHelp() {
        this._slashHandler.printHelp();
    }

    /**
     * Format slash command result (backward compatibility).
     * @param {*} result - Result to format
     * @returns {string}
     */
    _formatSlashResult(result) {
        return formatSlashResult(result);
    }

    /**
     * Summarize an orchestrator result (backward compatibility).
     * @param {*} result - Result to summarize
     * @returns {string}
     */
    _summarizeResult(result) {
        return summarizeResult(result);
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
            let result = await this.skilledAgent.executePrompt(userPrompt, {
                skillName,
                context: this.context,
                ...restOptions,
            });

            // If result is a JSON string, parse it to get the object
            if (typeof result === 'string') {
                try {
                    const parsed = JSON.parse(result);
                    // If it parses and looks like an orchestrator result, use the parsed object
                    if (parsed && (parsed.executions || parsed.type === 'orchestrator')) {
                        result = parsed;
                    } else {
                        // It's a simple string result (not orchestrator JSON)
                        return result;
                    }
                } catch {
                    // Not JSON, return as-is
                    return result;
                }
            }

            // In debug mode, show full JSON
            if (this.debug) {
                if (result?.result) {
                    return typeof result.result === 'string'
                        ? result.result
                        : JSON.stringify(result.result, null, 2);
                }
                if (result?.output) {
                    return result.output;
                }
                return JSON.stringify(result, null, 2);
            }

            // Non-debug mode: show summarized output
            return summarizeResult(result);
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
        const session = new REPLSession(this);
        return session.start();
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
