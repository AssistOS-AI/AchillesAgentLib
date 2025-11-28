/**
 * REPLSession - Manages the interactive REPL session for SkillManagerCli.
 *
 * Extracted from SkillManagerCli to reduce file size and improve modularity.
 */

import readline from 'node:readline';
import { createSpinner } from './spinner.mjs';
import { ActionReporter } from '../../../utils/ActionReporter.mjs';
import { showCommandSelector, showSkillSelector, buildCommandList } from './CommandSelector.mjs';
import { SlashCommandHandler } from './SlashCommandHandler.mjs';
import { printHelp, showHistory, searchHistory } from './HelpPrinter.mjs';
import { summarizeResult } from './ResultFormatter.mjs';

/**
 * REPLSession class for managing interactive CLI sessions.
 */
export class REPLSession {
    /**
     * Create a new REPLSession.
     *
     * @param {SkillManagerCli} cli - The SkillManagerCli instance
     * @param {Object} options - Session options
     */
    constructor(cli, options = {}) {
        this.cli = cli;
        this.options = options;

        // Create slash command handler with callbacks to CLI
        this.slashHandler = new SlashCommandHandler({
            executeSkill: (skillName, input, opts) => cli.executeSkill(skillName, input, opts),
            getUserSkills: () => cli.getUserSkills(),
            getSkills: () => cli.getSkills(),
        });

        // Build command list for interactive selector
        this.commandList = buildCommandList(SlashCommandHandler.COMMANDS);

        // ANSI escape codes for hint display
        this.HINT_COLOR = '\x1b[90m'; // dim gray
        this.RESET_COLOR = '\x1b[0m';

        // Track current hint for cleanup
        this.currentHintLines = 0;
    }

    /**
     * Start the interactive REPL session.
     * @returns {Promise<void>}
     */
    async start() {
        const cli = this.cli;
        const userSkills = cli.getUserSkills();

        console.log('\n╔══════════════════════════════════════════════════════════╗');
        console.log('║           Skill Manager Agent - Interactive CLI          ║');
        console.log('╚══════════════════════════════════════════════════════════╝\n');
        console.log(`Working directory: ${cli.workingDir}`);
        console.log(`Skills directory: ${cli.skillsDir}`);

        // Show LLM model info
        try {
            const description = cli.llmAgent.invokerStrategy?.describe?.();
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
        if (cli.historyManager.length > 0) {
            console.log(`Command history: ${cli.historyManager.length} entries (use ↑/↓ to navigate, "history" to view)`);
        }

        console.log('\nCommands: "exit" to quit, type "/" to see all commands, or type any instruction.\n');

        // Main REPL loop
        while (true) {
            const input = (await this._getInput()).trim();

            if (!input) continue;

            if (['exit', 'quit', 'q'].includes(input.toLowerCase())) {
                console.log('\nGoodbye!\n');
                break;
            }

            // Quick commands (no LLM needed)
            if (input.toLowerCase() === 'help') {
                printHelp();
                continue;
            }

            if (input.toLowerCase() === 'reload') {
                const spinner = createSpinner('Reloading skills');
                const count = cli.reloadSkills();
                spinner.succeed(`Reloaded ${count} skill(s)`);
                continue;
            }

            if (input.toLowerCase() === 'list' || input.toLowerCase() === 'ls') {
                const skills = cli.getUserSkills();
                if (skills.length === 0) {
                    console.log('\nNo user skills found.\n');
                } else {
                    console.log('\nUser skills:');
                    skills.forEach(s => console.log(`  • [${s.type}] ${s.shortName || s.name}`));
                    console.log('');
                }
                continue;
            }

            if (input.toLowerCase() === 'list all' || input.toLowerCase() === 'ls -a') {
                const skills = cli.getSkills();
                const builtIn = skills.filter(s => s.skillDir?.startsWith(cli.builtInSkillsDir));
                const user = skills.filter(s => !s.skillDir?.startsWith(cli.builtInSkillsDir));

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
                showHistory(cli.historyManager);
                continue;
            }

            if (input.toLowerCase().startsWith('history ') || input.toLowerCase().startsWith('hist ')) {
                const arg = input.split(/\s+/).slice(1).join(' ');
                if (arg === 'clear') {
                    cli.historyManager.clear();
                    console.log('\nHistory cleared.\n');
                } else if (arg.match(/^\d+$/)) {
                    showHistory(cli.historyManager, parseInt(arg, 10));
                } else {
                    // Search history
                    searchHistory(cli.historyManager, arg);
                }
                continue;
            }

            // Slash commands (direct skill execution)
            if (this.slashHandler.isSlashCommand(input)) {
                const parsed = this.slashHandler.parseSlashCommand(input);
                if (parsed) {
                    // Create spinner for slash command execution
                    const spinner = createSpinner(`Running /${parsed.command}...`);

                    try {
                        const result = await this.slashHandler.executeSlashCommand(parsed.command, parsed.args, {
                            context: cli.context,
                        });

                        if (result.handled) {
                            if (result.error) {
                                spinner.fail(result.error);
                            } else if (result.result) {
                                spinner.succeed(`/${parsed.command} complete`);
                                console.log('-'.repeat(60));
                                console.log(result.result);
                                console.log('-'.repeat(60) + '\n');
                            } else {
                                spinner.stop();
                            }
                            // Save successful slash commands to history
                            if (!result.error) {
                                cli.historyManager.add(input);
                            }
                        } else {
                            spinner.fail(result.error || `Unknown command: /${parsed.command}`);
                        }
                    } catch (error) {
                        spinner.fail(error.message);
                    }
                    continue;
                }
            }

            // Natural language prompt - process via LLM
            await this._processNaturalLanguage(input);
        }
    }

    /**
     * Process a natural language prompt through the LLM.
     * @param {string} input - The user input
     * @private
     */
    async _processNaturalLanguage(input) {
        const cli = this.cli;

        // Create AbortController for ESC cancellation
        const abortController = new AbortController();
        let wasInterrupted = false;

        // Create ActionReporter for real-time feedback (Claude Code style)
        const actionReporter = new ActionReporter({
            mode: 'spinner',
            showInterruptHint: true,
        });
        cli.skilledAgent.setActionReporter(actionReporter);

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
        cli.skilledAgent.promptReader = async (prompt) => {
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
            const result = await cli.processPrompt(input, {
                signal: abortController.signal,
            });

            // Show actual model used
            const lastInvocation = cli.llmAgent.invokerStrategy?.getLastInvocationDetails?.();
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
                const lastInvocation = cli.llmAgent.invokerStrategy?.getLastInvocationDetails?.();
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
            cli.skilledAgent.setActionReporter(null);
            cli.skilledAgent.promptReader = null;

            // Save command to history (unless interrupted)
            if (!wasInterrupted) {
                cli.historyManager.add(input);
            }
        }
    }

    /**
     * Get input from the user (with interactive selector support).
     * @returns {Promise<string>}
     * @private
     */
    async _getInput() {
        // Use promptWithSelector which handles "/" specially
        return this._promptWithSelector();
    }

    /**
     * Prompt with interactive command selector support.
     * When user types just "/" it shows an interactive picker.
     * @returns {Promise<string>}
     * @private
     */
    async _promptWithSelector() {
        const self = this;
        const cli = this.cli;

        return new Promise((resolve) => {
            // Set up raw mode to detect "/" key immediately
            if (!process.stdin.isTTY) {
                // Fallback for non-TTY
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout,
                });
                rl.question('SkillManager> ', (answer) => {
                    rl.close();
                    resolve(answer);
                });
                return;
            }

            let buffer = '';
            let showingSelector = false;
            let savedBuffer = ''; // Save current input when navigating history
            let historyIndex = -1; // -1 means "new input", 0+ means history index from end
            const history = cli.historyManager.getAll();

            // Helper to clear current line and rewrite with new content
            const rewriteLine = (newContent) => {
                // Move cursor to start of input (after prompt), clear to end, write new content
                process.stdout.write('\r\x1b[K'); // Clear entire line
                process.stdout.write('SkillManager> ' + newContent);
                buffer = newContent;
            };

            process.stdout.write('SkillManager> ');

            process.stdin.setRawMode(true);
            process.stdin.resume();

            const cleanup = () => {
                process.stdin.setRawMode(false);
                process.stdin.removeListener('data', handleKey);
            };

            const handleKey = async (key) => {
                const keyStr = key.toString();

                // Handle Ctrl+C
                if (keyStr === '\x03') {
                    cleanup();
                    process.stdout.write('\n');
                    process.exit(0);
                }

                // Handle Enter
                if (keyStr === '\r' || keyStr === '\n') {
                    cleanup();
                    process.stdout.write('\n');
                    resolve(buffer);
                    return;
                }

                // Handle Backspace
                if (keyStr === '\x7f' || keyStr === '\b') {
                    if (buffer.length > 0) {
                        // Reset history navigation when user edits
                        if (historyIndex !== -1) {
                            historyIndex = -1;
                            savedBuffer = '';
                        }
                        buffer = buffer.slice(0, -1);
                        process.stdout.write('\b \b');
                    }
                    return;
                }

                // Handle "/" - show interactive selector
                if (keyStr === '/' && buffer === '') {
                    if (showingSelector) return;
                    showingSelector = true;

                    // Remove the raw mode listener temporarily
                    process.stdin.removeListener('data', handleKey);
                    process.stdin.setRawMode(false);

                    // Show interactive command selector
                    const selected = await showCommandSelector(self.commandList, {
                        prompt: 'SkillManager> /',
                        initialFilter: '',
                    });

                    if (selected) {
                        // Check if selected command needs a skill argument
                        if (selected.needsSkillArg) {
                            // Show skill selector
                            process.stdout.write(`${selected.name} `);

                            // Get list of skills - use user skills only for skill-operating commands
                            const userSkills = cli.getUserSkills();
                            if (userSkills.length === 0) {
                                cleanup();
                                process.stdout.write('\n');
                                console.log('\x1b[33mNo user skills found. Create one first.\x1b[0m');
                                resolve(''); // Return empty to re-prompt
                                return;
                            }

                            const selectedSkill = await showSkillSelector(userSkills, {
                                prompt: `${selected.name} `,
                                initialFilter: '',
                            });

                            if (selectedSkill) {
                                // Commands that should wait for additional input after skill selection
                                const commandsNeedingInput = ['/exec', '/refine', '/update'];
                                const commandName = selected.name;

                                if (commandsNeedingInput.includes(commandName)) {
                                    // Show hint about the skill and prompt for input
                                    const skillInfo = userSkills.find(s => (s.shortName || s.name) === selectedSkill.name);
                                    const hint = skillInfo?.description || skillInfo?.summary || '';
                                    const skillType = skillInfo?.type || 'skill';

                                    // Clear line and show skill info
                                    process.stdout.write(`${selectedSkill.name}\n`);
                                    process.stdout.write('\x1b[90m' + '─'.repeat(50) + '\x1b[0m\n');

                                    // Show skill type and description
                                    process.stdout.write(`\x1b[36m  Skill:\x1b[0m ${selectedSkill.name} \x1b[90m[${skillType}]\x1b[0m\n`);
                                    if (hint) {
                                        process.stdout.write(`\x1b[36m  About:\x1b[0m ${hint}\n`);
                                    }

                                    // Show command-specific input guidance
                                    if (commandName === '/exec') {
                                        if (skillType === 'code') {
                                            process.stdout.write(`\x1b[36m  Input:\x1b[0m Type your request in natural language\n`);
                                        } else if (skillType === 'interactive') {
                                            process.stdout.write(`\x1b[36m  Input:\x1b[0m Provide any initial context or press Enter to start\n`);
                                        } else {
                                            process.stdout.write(`\x1b[36m  Input:\x1b[0m Type your input or press Enter to execute\n`);
                                        }
                                    } else if (commandName === '/refine') {
                                        process.stdout.write(`\x1b[36m  Input:\x1b[0m Describe what to improve or requirements to meet\n`);
                                    } else if (commandName === '/update') {
                                        process.stdout.write(`\x1b[36m  Input:\x1b[0m Specify section name and new content\n`);
                                    }

                                    process.stdout.write('\x1b[90m  Ctrl+C to cancel\x1b[0m\n');
                                    process.stdout.write('\x1b[90m' + '─'.repeat(50) + '\x1b[0m\n');

                                    // Prompt for input using readline
                                    const rl = readline.createInterface({
                                        input: process.stdin,
                                        output: process.stdout,
                                    });

                                    let answered = false;

                                    // Handle Ctrl+C to cancel
                                    rl.on('SIGINT', () => {
                                        if (answered) return;
                                        answered = true;
                                        rl.close();
                                        process.stdout.write('\n\x1b[33mCancelled\x1b[0m\n');
                                        // Resolve with empty string to return to main loop
                                        resolve('');
                                    });

                                    rl.question(`${selected.name} ${selectedSkill.name} `, (input) => {
                                        if (answered) return;
                                        answered = true;
                                        rl.close();
                                        cleanup();
                                        const fullCommand = `${selected.name} ${selectedSkill.name} ${input}`.trim();
                                        resolve(fullCommand);
                                    });
                                } else {
                                    // Other commands - execute immediately with skill name
                                    cleanup();
                                    const fullCommand = `${selected.name} ${selectedSkill.name}`;
                                    process.stdout.write(`${selectedSkill.name}\n`);
                                    resolve(fullCommand);
                                }
                            } else {
                                // User cancelled skill selection - return to prompt
                                showingSelector = false;
                                buffer = '';
                                process.stdout.write('\rSkillManager> ');
                                process.stdin.setRawMode(true);
                                process.stdin.on('data', handleKey);
                            }
                        } else {
                            // Command doesn't need skill arg - execute directly
                            cleanup();
                            process.stdout.write(`${selected.name}\n`);
                            resolve(selected.name);
                        }
                    } else {
                        // User cancelled - return to normal prompt
                        showingSelector = false;
                        buffer = '';
                        process.stdout.write('SkillManager> ');
                        process.stdin.setRawMode(true);
                        process.stdin.on('data', handleKey);
                    }
                    return;
                }

                // Handle Escape
                if (keyStr === '\x1b') {
                    // Could be escape key or start of arrow sequence
                    // For now, just ignore standalone escape
                    return;
                }

                // Handle arrow keys (history navigation)
                if (keyStr === '\x1b[A') {
                    // Up arrow - go to previous (older) command
                    if (history.length === 0) return;

                    if (historyIndex === -1) {
                        // First time pressing up - save current input
                        savedBuffer = buffer;
                    }

                    if (historyIndex < history.length - 1) {
                        historyIndex++;
                        // History is stored oldest-first, so we read from the end
                        const historyEntry = history[history.length - 1 - historyIndex];
                        rewriteLine(historyEntry);
                    }
                    return;
                }

                if (keyStr === '\x1b[B') {
                    // Down arrow - go to next (newer) command
                    if (historyIndex === -1) return; // Already at newest

                    historyIndex--;
                    if (historyIndex === -1) {
                        // Back to current input
                        rewriteLine(savedBuffer);
                    } else {
                        const historyEntry = history[history.length - 1 - historyIndex];
                        rewriteLine(historyEntry);
                    }
                    return;
                }

                // Ignore other escape sequences (Left, Right, etc.)
                if (keyStr.startsWith('\x1b[')) {
                    return;
                }

                // Helper to check if buffer is a command needing skill arg
                const getCommandNeedingSkillArg = () => {
                    if (!buffer.startsWith('/')) return null;
                    const parsed = self.slashHandler.parseSlashCommand(buffer);
                    if (!parsed) return null;
                    const { command, args } = parsed;
                    // Only trigger if no args yet (just the command)
                    if (args && args.trim()) return null;
                    const cmdDef = SlashCommandHandler.COMMANDS[command];
                    if (cmdDef && cmdDef.needsSkillArg) {
                        return { command, cmdDef };
                    }
                    return null;
                };

                // Helper to show skill selector for current command
                const showSkillSelectorForCommand = async (command) => {
                    if (showingSelector) return;
                    showingSelector = true;

                    process.stdin.removeListener('data', handleKey);
                    process.stdin.setRawMode(false);

                    // Clear the line and rewrite with space
                    process.stdout.write(` `);

                    // Use user skills only for skill-operating commands
                    const userSkills = cli.getUserSkills();
                    if (userSkills.length === 0) {
                        cleanup();
                        process.stdout.write('\n');
                        console.log('\x1b[33mNo user skills found. Create one first.\x1b[0m');
                        resolve(''); // Return empty to re-prompt
                        return;
                    }

                    const selectedSkill = await showSkillSelector(userSkills, {
                        prompt: `/${command} `,
                        initialFilter: '',
                    });

                    if (selectedSkill) {
                        // Commands that should wait for additional input after skill selection
                        const commandsNeedingInput = ['exec', 'refine', 'update'];

                        if (commandsNeedingInput.includes(command)) {
                            // Show hint about the skill and prompt for input
                            const skillInfo = userSkills.find(s => (s.shortName || s.name) === selectedSkill.name);
                            const hint = skillInfo?.description || skillInfo?.summary || '';
                            const skillType = skillInfo?.type || 'skill';

                            // Clear line and show skill info
                            process.stdout.write(`${selectedSkill.name}\n`);
                            process.stdout.write('\x1b[90m' + '─'.repeat(50) + '\x1b[0m\n');

                            // Show skill type and description
                            process.stdout.write(`\x1b[36m  Skill:\x1b[0m ${selectedSkill.name} \x1b[90m[${skillType}]\x1b[0m\n`);
                            if (hint) {
                                process.stdout.write(`\x1b[36m  About:\x1b[0m ${hint}\n`);
                            }

                            // Show command-specific input guidance
                            if (command === 'exec') {
                                if (skillType === 'code') {
                                    process.stdout.write(`\x1b[36m  Input:\x1b[0m Type your request in natural language\n`);
                                } else if (skillType === 'interactive') {
                                    process.stdout.write(`\x1b[36m  Input:\x1b[0m Provide any initial context or press Enter to start\n`);
                                } else {
                                    process.stdout.write(`\x1b[36m  Input:\x1b[0m Type your input or press Enter to execute\n`);
                                }
                            } else if (command === 'refine') {
                                process.stdout.write(`\x1b[36m  Input:\x1b[0m Describe what to improve or requirements to meet\n`);
                            } else if (command === 'update') {
                                process.stdout.write(`\x1b[36m  Input:\x1b[0m Specify section name and new content\n`);
                            }

                            process.stdout.write('\x1b[90m  Ctrl+C to cancel\x1b[0m\n');
                            process.stdout.write('\x1b[90m' + '─'.repeat(50) + '\x1b[0m\n');

                            // Prompt for input using readline
                            const rl = readline.createInterface({
                                input: process.stdin,
                                output: process.stdout,
                            });

                            let answered = false;

                            // Handle Ctrl+C to cancel
                            rl.on('SIGINT', () => {
                                if (answered) return;
                                answered = true;
                                rl.close();
                                process.stdout.write('\n\x1b[33mCancelled\x1b[0m\n');
                                // Resolve with empty string to return to main loop
                                resolve('');
                            });

                            rl.question(`/${command} ${selectedSkill.name} `, (input) => {
                                if (answered) return;
                                answered = true;
                                rl.close();
                                cleanup();
                                const fullCommand = `/${command} ${selectedSkill.name} ${input}`.trim();
                                resolve(fullCommand);
                            });
                        } else {
                            // Other commands - execute immediately
                            cleanup();
                            const fullCommand = `/${command} ${selectedSkill.name}`;
                            process.stdout.write(`${selectedSkill.name}\n`);
                            resolve(fullCommand);
                        }
                    } else {
                        // User cancelled - return to prompt with buffer intact
                        showingSelector = false;
                        process.stdout.write(`\rSkillManager> ${buffer}`);
                        process.stdin.setRawMode(true);
                        process.stdin.on('data', handleKey);
                    }
                };

                // Handle Tab - show skill selector if command needs skill arg
                if (keyStr === '\t') {
                    const cmdInfo = getCommandNeedingSkillArg();
                    if (cmdInfo) {
                        await showSkillSelectorForCommand(cmdInfo.command);
                        return;
                    }
                    // Otherwise ignore Tab
                    return;
                }

                // Handle Space after command that needs skill arg
                if (keyStr === ' ') {
                    const cmdInfo = getCommandNeedingSkillArg();
                    if (cmdInfo) {
                        await showSkillSelectorForCommand(cmdInfo.command);
                        return;
                    }
                    // Regular space - add to buffer
                    buffer += keyStr;
                    process.stdout.write(keyStr);
                    return;
                }

                // Regular character
                if (keyStr.length === 1 && keyStr >= ' ') {
                    // Reset history navigation when user types
                    if (historyIndex !== -1) {
                        historyIndex = -1;
                        savedBuffer = '';
                    }
                    buffer += keyStr;
                    process.stdout.write(keyStr);
                }
            };

            process.stdin.on('data', handleKey);
        });
    }

    /**
     * Standard readline prompt (used for history support when not using selector).
     * @returns {Promise<string>}
     * @private
     */
    async _promptOnce() {
        const cli = this.cli;

        return new Promise((resolve) => {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
                history: cli.historyManager.getAll().reverse(),
                historySize: cli.historyManager.maxEntries,
                terminal: true,
                completer: (line) => this.slashHandler.getCompletions(line),
            });

            // Clear any previous hint
            const clearHint = () => {
                if (this.currentHintLines > 0) {
                    // Move down, clear line, move back up
                    process.stdout.write('\n\x1b[K\x1b[A');
                    this.currentHintLines = 0;
                }
            };

            // Display hint below the input line
            const showHint = (line) => {
                const hint = this.slashHandler.getInputHint(line);
                if (hint) {
                    // Save cursor position, move to next line, show hint, restore cursor
                    process.stdout.write('\x1b[s'); // Save cursor
                    process.stdout.write('\n\x1b[K'); // New line, clear it
                    process.stdout.write(`${this.HINT_COLOR}  ${hint}${this.RESET_COLOR}`);
                    process.stdout.write('\x1b[u'); // Restore cursor
                    this.currentHintLines = 1;
                } else {
                    clearHint();
                }
            };

            // Listen for line changes to update hints
            let lastLine = '';
            const lineHandler = () => {
                const currentLine = rl.line || '';
                if (currentLine !== lastLine) {
                    lastLine = currentLine;
                    if (currentLine.startsWith('/')) {
                        showHint(currentLine);
                    } else {
                        clearHint();
                    }
                }
            };

            // Poll for line changes (readline doesn't have a direct 'input' event)
            const hintInterval = setInterval(lineHandler, 100);

            rl.question('SkillManager> ', (answer) => {
                clearInterval(hintInterval);
                clearHint();
                rl.close();
                resolve(answer);
            });

            // Also clear hint on close
            rl.on('close', () => {
                clearInterval(hintInterval);
                clearHint();
            });
        });
    }
}

export default REPLSession;
