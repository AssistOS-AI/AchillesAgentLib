/**
 * SlashCommandHandler - Manages slash command definitions and execution.
 *
 * Extracted from SkillManagerCli to reduce file size and improve modularity.
 */

import { formatSlashResult } from './ResultFormatter.mjs';

/**
 * SlashCommandHandler class for managing slash commands in the CLI.
 */
export class SlashCommandHandler {
    /**
     * Slash command definitions.
     * Maps command names to skill names and provides help text.
     */
    static COMMANDS = {
        'ls': {
            skill: 'list-skills',
            usage: '/ls [all]',
            description: 'List skills (add "all" to include built-in)',
            args: 'optional',
            needsSkillArg: false,
        },
        'list': {
            skill: 'list-skills',
            usage: '/list [all]',
            description: 'List skills (add "all" to include built-in)',
            args: 'optional',
            needsSkillArg: false,
        },
        'read': {
            skill: 'read-skill',
            usage: '/read <skill-name>',
            description: 'Read a skill definition file',
            args: 'required',
            needsSkillArg: true,
        },
        'write': {
            skill: 'write-skill',
            usage: '/write <skill-name> [type]',
            description: 'Create or update a skill file',
            args: 'required',
            needsSkillArg: true,
        },
        'delete': {
            skill: 'delete-skill',
            usage: '/delete <skill-name>',
            description: 'Delete a skill directory',
            args: 'required',
            needsSkillArg: true,
        },
        'validate': {
            skill: 'validate-skill',
            usage: '/validate <skill-name>',
            description: 'Validate skill against schema',
            args: 'required',
            needsSkillArg: true,
        },
        'template': {
            skill: 'get-template',
            usage: '/template <type>',
            description: 'Get blank template (tskill, cskill, etc.)',
            args: 'required',
            needsSkillArg: false, // Takes type, not skill name
        },
        'generate': {
            skill: 'generate-code',
            usage: '/generate <skill-name>',
            description: 'Generate .mjs code from tskill',
            args: 'required',
            needsSkillArg: true,
        },
        'test': {
            skill: 'test-code',
            usage: '/test <skill-name>',
            description: 'Test generated code for a skill',
            args: 'required',
            needsSkillArg: true,
        },
        'refine': {
            skill: 'skill-refiner',
            usage: '/refine <skill-name>',
            description: 'Iteratively improve skill until tests pass',
            args: 'required',
            needsSkillArg: true,
        },
        'update': {
            skill: 'update-section',
            usage: '/update <skill-name> <section>',
            description: 'Update a specific section of a skill',
            args: 'required',
            needsSkillArg: true,
        },
        'preview': {
            skill: 'preview-changes',
            usage: '/preview <skill-name>',
            description: 'Preview changes before applying',
            args: 'required',
            needsSkillArg: true,
        },
        'exec': {
            skill: null, // Dynamic - uses the argument as skill name
            usage: '/exec <skill-name> [input]',
            description: 'Execute any skill directly',
            args: 'required',
            needsSkillArg: true,
        },
    };

    /**
     * Create a new SlashCommandHandler.
     *
     * @param {Object} options
     * @param {Function} options.executeSkill - Function to execute a skill: (skillName, input, options) => Promise
     * @param {Function} options.getUserSkills - Function to get user skills: () => Array
     * @param {Function} options.getSkills - Function to get all skills: () => Array
     */
    constructor({ executeSkill, getUserSkills, getSkills }) {
        this.executeSkill = executeSkill;
        this.getUserSkills = getUserSkills;
        this.getSkills = getSkills;
    }

    /**
     * Check if input is a slash command.
     * @param {string} input - User input
     * @returns {boolean}
     */
    isSlashCommand(input) {
        return input.startsWith('/');
    }

    /**
     * Parse a slash command into command name and arguments.
     * @param {string} input - User input starting with /
     * @returns {{command: string, args: string}|null}
     */
    parseSlashCommand(input) {
        const match = input.match(/^\/(\S+)(?:\s+(.*))?$/);
        if (!match) return null;
        return {
            command: match[1].toLowerCase(),
            args: match[2]?.trim() || '',
        };
    }

    /**
     * Execute a slash command.
     * @param {string} command - Command name (without /)
     * @param {string} args - Command arguments
     * @param {Object} options - Execution options
     * @returns {Promise<{handled: boolean, result?: string, error?: string}>}
     */
    async executeSlashCommand(command, args, options = {}) {
        // Handle /help specially
        if (command === 'help' || command === '?') {
            this.printHelp();
            return { handled: true };
        }

        // Handle /commands to list all available commands
        if (command === 'commands') {
            this.printHelp();
            return { handled: true };
        }

        const cmdDef = SlashCommandHandler.COMMANDS[command];
        if (!cmdDef) {
            return {
                handled: false,
                error: `Unknown command: /${command}. Type /help for available commands.`,
            };
        }

        // Check required args
        if (cmdDef.args === 'required' && !args) {
            return {
                handled: true,
                error: `Usage: ${cmdDef.usage}\n  ${cmdDef.description}`,
            };
        }

        // Handle /exec specially - it executes any skill
        if (command === 'exec') {
            const parts = args.split(/\s+/);
            const skillName = parts[0];
            const skillInput = parts.slice(1).join(' ') || skillName;

            try {
                const result = await this.executeSkill(skillName, skillInput, options);
                return {
                    handled: true,
                    result: formatSlashResult(result),
                };
            } catch (error) {
                return {
                    handled: true,
                    error: error.message,
                };
            }
        }

        // Execute the mapped skill
        try {
            const result = await this.executeSkill(cmdDef.skill, args || '', options);
            return {
                handled: true,
                result: formatSlashResult(result),
            };
        } catch (error) {
            return {
                handled: true,
                error: error.message,
            };
        }
    }

    /**
     * Get autocomplete suggestions for slash commands.
     * @param {string} line - Current input line
     * @returns {[string[], string]} - [completions, original line]
     */
    getCompletions(line) {
        const completions = [];

        // If line starts with /, provide slash command completions
        if (line.startsWith('/')) {
            const parsed = this.parseSlashCommand(line);
            if (!parsed) {
                // Just "/" typed - show all commands
                const allCmds = Object.keys(SlashCommandHandler.COMMANDS)
                    .filter((cmd, idx, arr) => arr.indexOf(cmd) === idx) // unique
                    .map(cmd => `/${cmd}`);
                allCmds.push('/help', '/commands');
                return [allCmds, line];
            }

            const { command, args } = parsed;

            // Check if we're completing the command name or arguments
            if (!args && !line.includes(' ')) {
                // Completing command name
                const cmdPrefix = command.toLowerCase();
                const matchingCmds = Object.keys(SlashCommandHandler.COMMANDS)
                    .filter(cmd => cmd.startsWith(cmdPrefix))
                    .map(cmd => `/${cmd}`);

                // Add built-in commands
                if ('help'.startsWith(cmdPrefix)) matchingCmds.push('/help');
                if ('commands'.startsWith(cmdPrefix)) matchingCmds.push('/commands');

                return [matchingCmds, line];
            }

            // Completing arguments - suggest skill names for relevant commands
            const cmdDef = SlashCommandHandler.COMMANDS[command];
            if (cmdDef) {
                const argPrefix = args.toLowerCase();

                // For commands that take skill names, suggest user skills
                if (['read', 'delete', 'validate', 'generate', 'test', 'refine', 'update', 'preview'].includes(command)) {
                    const skills = this.getUserSkills();
                    const matchingSkills = skills
                        .map(s => s.shortName || s.name)
                        .filter(name => name.toLowerCase().startsWith(argPrefix))
                        .map(name => `/${command} ${name}`);
                    return [matchingSkills, line];
                }

                // For /template, suggest skill types
                if (command === 'template') {
                    const types = ['tskill', 'cskill', 'iskill', 'oskill', 'mskill'];
                    const matchingTypes = types
                        .filter(t => t.startsWith(argPrefix))
                        .map(t => `/${command} ${t}`);
                    return [matchingTypes, line];
                }

                // For /exec, suggest all skills including built-in
                if (command === 'exec') {
                    const skills = this.getSkills();
                    const matchingSkills = skills
                        .map(s => s.shortName || s.name)
                        .filter(name => name.toLowerCase().startsWith(argPrefix))
                        .map(name => `/${command} ${name}`);
                    return [matchingSkills, line];
                }

                // For /write, suggest skill types as second argument
                if (command === 'write' && args.includes(' ')) {
                    const parts = args.split(/\s+/);
                    const typePrefix = parts[1]?.toLowerCase() || '';
                    const types = ['tskill', 'cskill', 'iskill', 'oskill', 'mskill'];
                    const matchingTypes = types
                        .filter(t => t.startsWith(typePrefix))
                        .map(t => `/${command} ${parts[0]} ${t}`);
                    return [matchingTypes, line];
                }
            }
        }

        // For non-slash commands, provide basic command completions
        const basicCmds = ['help', 'reload', 'list', 'list all', 'history', 'exit'];
        const matches = basicCmds.filter(cmd => cmd.startsWith(line.toLowerCase()));
        return [matches, line];
    }

    /**
     * Get hint text for current input.
     * @param {string} line - Current input line
     * @returns {string|null} - Hint text or null
     */
    getInputHint(line) {
        if (!line.startsWith('/')) return null;

        const parsed = this.parseSlashCommand(line);
        if (!parsed) {
            return 'Type a command name (Tab to complete)';
        }

        const { command, args } = parsed;

        // Check for built-in help commands
        if (command === 'help' || command === '?' || command === 'commands') {
            return 'Show available slash commands';
        }

        const cmdDef = SlashCommandHandler.COMMANDS[command];
        if (!cmdDef) {
            // Check for partial matches
            const partialMatches = Object.keys(SlashCommandHandler.COMMANDS)
                .filter(cmd => cmd.startsWith(command));
            if (partialMatches.length > 0) {
                return `Did you mean: ${partialMatches.map(c => '/' + c).join(', ')}?`;
            }
            return 'Unknown command. Type /help for available commands.';
        }

        // Show usage hint if no args provided for required args command
        if (cmdDef.args === 'required' && !args) {
            return `${cmdDef.description} — ${cmdDef.usage}`;
        }

        // Show description when args are provided
        return cmdDef.description;
    }

    /**
     * Print slash command help.
     */
    printHelp() {
        console.log(`
┌──────────────────────────────────────────────────────────┐
│                    Slash Commands                        │
└──────────────────────────────────────────────────────────┘

Skill Management:
  /ls [all]              List skills (add "all" for built-in)
  /read <skill>          Read skill definition
  /write <skill> [type]  Create/update skill (type: tskill, cskill, etc.)
  /delete <skill>        Delete a skill
  /validate <skill>      Validate against schema
  /template <type>       Get blank template

Code Generation:
  /generate <skill>      Generate .mjs from tskill.md
  /test <skill>          Test generated code
  /refine <skill>        Iteratively improve until tests pass

Editing:
  /update <skill> <section>  Update a specific section
  /preview <skill>           Preview pending changes

Advanced:
  /exec <skill> [input]  Execute any skill directly

Help:
  /help, /?              Show this help
  /commands              List all commands

Examples:
  /ls                    List user skills
  /read my-skill         Read my-skill definition
  /write inventory tskill Create new tskill called inventory
  /generate equipment    Generate code for equipment tskill
  /exec list-skills      Execute list-skills directly
`);
    }
}

export default SlashCommandHandler;
