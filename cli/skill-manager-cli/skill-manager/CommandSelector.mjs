import readline from 'node:readline';

/**
 * ANSI escape codes for terminal control
 */
const ANSI = {
    HIDE_CURSOR: '\x1b[?25l',
    SHOW_CURSOR: '\x1b[?25h',
    CLEAR_LINE: '\x1b[K',
    MOVE_UP: '\x1b[A',
    MOVE_DOWN: '\x1b[B',
    MOVE_TO_COL: (n) => `\x1b[${n}G`,
    DIM: '\x1b[2m',
    RESET: '\x1b[0m',
    CYAN: '\x1b[36m',
    YELLOW: '\x1b[33m',
    GREEN: '\x1b[32m',
    INVERSE: '\x1b[7m',
};

/**
 * CommandSelector - Interactive command picker with arrow key navigation
 *
 * Shows a filterable list of commands when activated, allowing users to
 * navigate with arrow keys and select with Enter.
 */
export class CommandSelector {
    constructor(commands, options = {}) {
        this.commands = commands; // Array of {name, description, usage}
        this.maxVisible = options.maxVisible || 8;
        this.selectedIndex = 0;
        this.scrollOffset = 0;
        this.filter = '';
        this.filteredCommands = [...commands];
    }

    /**
     * Filter commands based on current input
     */
    updateFilter(input) {
        this.filter = input.toLowerCase();
        this.filteredCommands = this.commands.filter(cmd =>
            cmd.name.toLowerCase().includes(this.filter) ||
            cmd.description.toLowerCase().includes(this.filter)
        );
        this.selectedIndex = 0;
        this.scrollOffset = 0;
    }

    /**
     * Move selection up
     */
    moveUp() {
        if (this.selectedIndex > 0) {
            this.selectedIndex--;
            if (this.selectedIndex < this.scrollOffset) {
                this.scrollOffset = this.selectedIndex;
            }
        }
    }

    /**
     * Move selection down
     */
    moveDown() {
        if (this.selectedIndex < this.filteredCommands.length - 1) {
            this.selectedIndex++;
            if (this.selectedIndex >= this.scrollOffset + this.maxVisible) {
                this.scrollOffset = this.selectedIndex - this.maxVisible + 1;
            }
        }
    }

    /**
     * Get the currently selected command
     */
    getSelected() {
        return this.filteredCommands[this.selectedIndex] || null;
    }

    /**
     * Render the command list to a string array
     */
    render() {
        const lines = [];
        const visible = this.filteredCommands.slice(
            this.scrollOffset,
            this.scrollOffset + this.maxVisible
        );

        // Show scroll indicator if needed
        if (this.scrollOffset > 0) {
            lines.push(`${ANSI.DIM}  ↑ ${this.scrollOffset} more above${ANSI.RESET}`);
        }

        visible.forEach((cmd, idx) => {
            const actualIdx = this.scrollOffset + idx;
            const isSelected = actualIdx === this.selectedIndex;
            const prefix = isSelected ? `${ANSI.CYAN}❯${ANSI.RESET}` : ' ';
            const name = isSelected
                ? `${ANSI.CYAN}${cmd.name}${ANSI.RESET}`
                : cmd.name;
            const desc = `${ANSI.DIM}${cmd.description}${ANSI.RESET}`;

            lines.push(`${prefix} ${name.padEnd(20)} ${desc}`);
        });

        // Show scroll indicator if more below
        const remaining = this.filteredCommands.length - this.scrollOffset - this.maxVisible;
        if (remaining > 0) {
            lines.push(`${ANSI.DIM}  ↓ ${remaining} more below${ANSI.RESET}`);
        }

        // Show empty state
        if (this.filteredCommands.length === 0) {
            lines.push(`${ANSI.DIM}  No matching commands${ANSI.RESET}`);
        }

        return lines;
    }

    /**
     * Get the number of lines rendered
     */
    getRenderedLineCount() {
        let count = Math.min(this.filteredCommands.length, this.maxVisible);
        if (this.scrollOffset > 0) count++; // "more above" line
        if (this.filteredCommands.length - this.scrollOffset > this.maxVisible) count++; // "more below" line
        if (this.filteredCommands.length === 0) count = 1; // "no matching" line
        return count;
    }
}

/**
 * Show an interactive command selector and return the selected command
 *
 * @param {Array} commands - Array of {name, description, usage}
 * @param {Object} options - Options
 * @returns {Promise<{name: string, args: string}|null>} - Selected command or null if cancelled
 */
export async function showCommandSelector(commands, options = {}) {
    const {
        prompt = 'SkillManager> /',
        initialFilter = '',
        maxVisible = 8,
    } = options;

    return new Promise((resolve) => {
        const selector = new CommandSelector(commands, { ...options, maxVisible });
        selector.updateFilter(initialFilter);

        let currentInput = initialFilter;
        let maxRenderedLines = 0; // Track max lines ever rendered for proper clearing

        // Hide cursor during selection
        process.stdout.write(ANSI.HIDE_CURSOR);

        const clearDisplay = () => {
            if (maxRenderedLines === 0) return;

            // We're at the prompt line - move down to clear all previously rendered content
            for (let i = 0; i < maxRenderedLines; i++) {
                process.stdout.write(`\n${ANSI.CLEAR_LINE}`);
            }
            // Move back up to prompt line
            for (let i = 0; i < maxRenderedLines; i++) {
                process.stdout.write(ANSI.MOVE_UP);
            }
            // Clear prompt line
            process.stdout.write(`\r${ANSI.CLEAR_LINE}`);
        };

        const render = () => {
            // Clear all previously rendered content
            clearDisplay();

            // Render prompt with current filter
            process.stdout.write(`${prompt}${currentInput}`);

            // Render command list below
            const lines = selector.render();
            lines.forEach(line => {
                process.stdout.write(`\n${ANSI.CLEAR_LINE}${line}`);
            });

            // Track max lines for future clearing
            if (lines.length > maxRenderedLines) {
                maxRenderedLines = lines.length;
            }

            // Move cursor back to input line
            for (let i = 0; i < lines.length; i++) {
                process.stdout.write(ANSI.MOVE_UP);
            }
            // Position cursor at end of input
            process.stdout.write(`\r${ANSI.MOVE_TO_COL(prompt.length + currentInput.length + 1)}`);
        };

        const cleanup = () => {
            clearDisplay();
            process.stdout.write(ANSI.SHOW_CURSOR);
            process.stdin.setRawMode(false);
            process.stdin.removeListener('data', handleKey);
        };

        const handleKey = (key) => {
            const keyStr = key.toString();

            // Handle special keys
            if (keyStr === '\x1b[A') {
                // Up arrow
                selector.moveUp();
                render();
                return;
            }

            if (keyStr === '\x1b[B') {
                // Down arrow
                selector.moveDown();
                render();
                return;
            }

            if (keyStr === '\r' || keyStr === '\n') {
                // Enter - select current
                const selected = selector.getSelected();
                cleanup();
                if (selected) {
                    resolve({ name: selected.name, args: '', needsSkillArg: selected.needsSkillArg });
                } else {
                    resolve(null);
                }
                return;
            }

            if (keyStr === '\x1b' || keyStr === '\x03') {
                // Escape or Ctrl+C - cancel
                cleanup();
                resolve(null);
                return;
            }

            if (keyStr === '\x7f' || keyStr === '\b') {
                // Backspace
                if (currentInput.length > 0) {
                    currentInput = currentInput.slice(0, -1);
                    selector.updateFilter(currentInput);
                    render();
                } else {
                    // Backspace with empty input - cancel
                    cleanup();
                    resolve(null);
                }
                return;
            }

            if (keyStr === '\t') {
                // Tab - complete with selected
                const selected = selector.getSelected();
                if (selected) {
                    cleanup();
                    resolve({ name: selected.name, args: '', needsSkillArg: selected.needsSkillArg });
                }
                return;
            }

            // Regular character input
            if (keyStr.length === 1 && keyStr >= ' ') {
                currentInput += keyStr;
                selector.updateFilter(currentInput);
                render();
            }
        };

        // Enable raw mode for key capture
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', handleKey);

        // Initial render
        render();
    });
}

/**
 * Build command list from SLASH_COMMANDS definition
 */
export function buildCommandList(slashCommands) {
    const commands = [];
    const seen = new Set();

    // Add unique commands (skip aliases like 'ls' and 'list' being duplicates)
    for (const [name, def] of Object.entries(slashCommands)) {
        if (!seen.has(def.skill)) {
            commands.push({
                name: `/${name}`,
                description: def.description,
                usage: def.usage,
                skill: def.skill,
                needsSkillArg: def.needsSkillArg || false,
            });
            if (def.skill) seen.add(def.skill);
        }
    }

    // Add built-in help commands
    commands.push({
        name: '/help',
        description: 'Show all slash commands',
        usage: '/help',
        skill: null,
        needsSkillArg: false,
    });

    // Sort alphabetically
    commands.sort((a, b) => a.name.localeCompare(b.name));

    return commands;
}

/**
 * Show an interactive skill selector and return the selected skill
 *
 * @param {Array} skills - Array of {name, type, description}
 * @param {Object} options - Options
 * @returns {Promise<{name: string}|null>} - Selected skill or null if cancelled
 */
export async function showSkillSelector(skills, options = {}) {
    const {
        prompt = 'Select skill> ',
        initialFilter = '',
        maxVisible = 8,
    } = options;

    // Transform skills to command-like format for CommandSelector
    const skillItems = skills.map(skill => ({
        name: skill.shortName || skill.name,
        description: `[${skill.type}] ${skill.description || ''}`.trim(),
        type: skill.type,
    }));

    return new Promise((resolve) => {
        const selector = new CommandSelector(skillItems, { maxVisible });
        selector.updateFilter(initialFilter);

        let currentInput = initialFilter;
        let maxRenderedLines = 0;

        process.stdout.write(ANSI.HIDE_CURSOR);

        const clearDisplay = () => {
            if (maxRenderedLines === 0) return;

            for (let i = 0; i < maxRenderedLines; i++) {
                process.stdout.write(`\n${ANSI.CLEAR_LINE}`);
            }
            for (let i = 0; i < maxRenderedLines; i++) {
                process.stdout.write(ANSI.MOVE_UP);
            }
            process.stdout.write(`\r${ANSI.CLEAR_LINE}`);
        };

        const render = () => {
            clearDisplay();

            process.stdout.write(`${prompt}${currentInput}`);

            const lines = selector.render();
            lines.forEach(line => {
                process.stdout.write(`\n${ANSI.CLEAR_LINE}${line}`);
            });

            if (lines.length > maxRenderedLines) {
                maxRenderedLines = lines.length;
            }

            for (let i = 0; i < lines.length; i++) {
                process.stdout.write(ANSI.MOVE_UP);
            }
            process.stdout.write(`\r${ANSI.MOVE_TO_COL(prompt.length + currentInput.length + 1)}`);
        };

        const cleanup = () => {
            clearDisplay();
            process.stdout.write(ANSI.SHOW_CURSOR);
            process.stdin.setRawMode(false);
            process.stdin.removeListener('data', handleKey);
        };

        const handleKey = (key) => {
            const keyStr = key.toString();

            if (keyStr === '\x1b[A') {
                selector.moveUp();
                render();
                return;
            }

            if (keyStr === '\x1b[B') {
                selector.moveDown();
                render();
                return;
            }

            if (keyStr === '\r' || keyStr === '\n') {
                const selected = selector.getSelected();
                cleanup();
                if (selected) {
                    resolve({ name: selected.name, type: selected.type });
                } else {
                    resolve(null);
                }
                return;
            }

            if (keyStr === '\x1b' || keyStr === '\x03') {
                cleanup();
                resolve(null);
                return;
            }

            if (keyStr === '\x7f' || keyStr === '\b') {
                if (currentInput.length > 0) {
                    currentInput = currentInput.slice(0, -1);
                    selector.updateFilter(currentInput);
                    render();
                } else {
                    cleanup();
                    resolve(null);
                }
                return;
            }

            if (keyStr === '\t') {
                const selected = selector.getSelected();
                if (selected) {
                    cleanup();
                    resolve({ name: selected.name, type: selected.type });
                }
                return;
            }

            if (keyStr.length === 1 && keyStr >= ' ') {
                currentInput += keyStr;
                selector.updateFilter(currentInput);
                render();
            }
        };

        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', handleKey);

        render();
    });
}

export default CommandSelector;
