/**
 * InputReader - Base class and implementations for reading user input.
 *
 * Provides an abstraction layer for input sources (CLI, web, etc.).
 */

/**
 * Base InputReader class.
 * Subclasses must implement the read() method.
 */
export class InputReader {
    /**
     * Read input from the user.
     * @param {string} [prompt] - Optional prompt to display.
     * @returns {Promise<string>} The user's input.
     */
    async read(prompt) {
        throw new Error('InputReader.read() must be implemented by subclass');
    }

    /**
     * Read a yes/no confirmation from the user.
     * @param {string} [prompt] - Optional prompt to display.
     * @returns {Promise<boolean>} True if confirmed, false otherwise.
     */
    async confirm(prompt) {
        const response = await this.read(prompt);
        const normalized = response.trim().toLowerCase();
        return normalized === 'yes' || normalized === 'y';
    }

    /**
     * Close the input reader and release resources.
     */
    close() {
        // Default no-op, subclasses can override
    }
}

/**
 * CLI InputReader implementation using Node.js readline.
 */
export class CLIInputReader extends InputReader {
    /**
     * Create a CLIInputReader.
     * @param {readline.Interface} rl - The readline interface to use.
     */
    constructor(rl) {
        super();
        this.rl = rl;
    }

    /**
     * Read a line of input from the CLI.
     * @param {string} [prompt=''] - Optional prompt to display.
     * @returns {Promise<string>} The user's input.
     */
    async read(prompt = '') {
        return new Promise((resolve) => {
            this.rl.question(prompt, (answer) => {
                resolve(answer);
            });
        });
    }

    /**
     * Close the readline interface.
     */
    close() {
        if (this.rl && typeof this.rl.close === 'function') {
            this.rl.close();
        }
    }
}

/**
 * Mock InputReader for testing.
 * Returns predefined responses in sequence.
 */
export class MockInputReader extends InputReader {
    /**
     * Create a MockInputReader.
     * @param {string[]} responses - Array of responses to return in order.
     */
    constructor(responses = []) {
        super();
        this.responses = [...responses];
        this.index = 0;
        this.prompts = []; // Track prompts for assertions
    }

    /**
     * Read the next predefined response.
     * @param {string} [prompt=''] - The prompt (recorded for testing).
     * @returns {Promise<string>} The next predefined response.
     */
    async read(prompt = '') {
        this.prompts.push(prompt);
        if (this.index >= this.responses.length) {
            throw new Error('MockInputReader: No more responses available');
        }
        return this.responses[this.index++];
    }

    /**
     * Add more responses to the queue.
     * @param {...string} responses - Responses to add.
     */
    addResponses(...responses) {
        this.responses.push(...responses);
    }

    /**
     * Reset the mock reader to initial state.
     */
    reset() {
        this.index = 0;
        this.prompts = [];
    }
}

export default InputReader;
