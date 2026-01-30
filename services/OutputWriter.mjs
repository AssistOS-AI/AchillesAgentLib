/**
 * OutputWriter - Base class and implementations for writing output.
 *
 * Provides an abstraction layer for output destinations (CLI, web, etc.).
 */

/**
 * Base OutputWriter class.
 * Subclasses must implement the write() method.
 */
export class OutputWriter {
    /**
     * Write output to the destination.
     * @param {string} message - The message to write.
     * @returns {Promise<void>}
     */
    async write(message) {
        throw new Error('OutputWriter.write() must be implemented by subclass');
    }

    /**
     * Write an error message.
     * @param {string} message - The error message to write.
     * @returns {Promise<void>}
     */
    async writeError(message) {
        return this.write(`Error: ${message}`);
    }

    /**
     * Write a warning message.
     * @param {string} message - The warning message to write.
     * @returns {Promise<void>}
     */
    async writeWarning(message) {
        return this.write(`Warning: ${message}`);
    }

    /**
     * Write a success message.
     * @param {string} message - The success message to write.
     * @returns {Promise<void>}
     */
    async writeSuccess(message) {
        return this.write(message);
    }

    /**
     * Write a progress indicator or status update.
     * @param {string} message - The progress message.
     * @returns {Promise<void>}
     */
    async writeProgress(message) {
        return this.write(message);
    }

    /**
     * Clear the output (if supported).
     * @returns {Promise<void>}
     */
    async clear() {
        // Default no-op, subclasses can override
    }
}

/**
 * CLI OutputWriter implementation using console.
 */
export class CLIOutputWriter extends OutputWriter {
    /**
     * Create a CLIOutputWriter.
     * @param {object} [options] - Configuration options.
     * @param {NodeJS.WriteStream} [options.stdout=process.stdout] - Output stream.
     * @param {NodeJS.WriteStream} [options.stderr=process.stderr] - Error stream.
     * @param {boolean} [options.useColors=true] - Whether to use ANSI colors.
     */
    constructor(options = {}) {
        super();
        this.stdout = options.stdout || process.stdout;
        this.stderr = options.stderr || process.stderr;
        this.useColors = options.useColors !== false;
    }

    /**
     * Write a message to stdout.
     * @param {string} message - The message to write.
     * @returns {Promise<void>}
     */
    async write(message) {
        this.stdout.write(message + '\n');
    }

    /**
     * Write an error message to stderr with red color.
     * @param {string} message - The error message.
     * @returns {Promise<void>}
     */
    async writeError(message) {
        const formatted = this.useColors
            ? `\x1b[31mError: ${message}\x1b[0m`
            : `Error: ${message}`;
        this.stderr.write(formatted + '\n');
    }

    /**
     * Write a warning message with yellow color.
     * @param {string} message - The warning message.
     * @returns {Promise<void>}
     */
    async writeWarning(message) {
        const formatted = this.useColors
            ? `\x1b[33mWarning: ${message}\x1b[0m`
            : `Warning: ${message}`;
        this.stdout.write(formatted + '\n');
    }

    /**
     * Write a success message with green color.
     * @param {string} message - The success message.
     * @returns {Promise<void>}
     */
    async writeSuccess(message) {
        const formatted = this.useColors
            ? `\x1b[32m${message}\x1b[0m`
            : message;
        this.stdout.write(formatted + '\n');
    }

    /**
     * Write a progress message with dim/gray color.
     * @param {string} message - The progress message.
     * @returns {Promise<void>}
     */
    async writeProgress(message) {
        const formatted = this.useColors
            ? `\x1b[2m${message}\x1b[0m`
            : message;
        this.stdout.write(formatted + '\n');
    }

    /**
     * Clear the terminal screen.
     * @returns {Promise<void>}
     */
    async clear() {
        if (this.stdout.isTTY) {
            this.stdout.write('\x1b[2J\x1b[H');
        }
    }
}

/**
 * Mock OutputWriter for testing.
 * Records all output for assertions.
 */
export class MockOutputWriter extends OutputWriter {
    constructor() {
        super();
        this.messages = [];
        this.errors = [];
        this.warnings = [];
        this.successes = [];
        this.progress = [];
    }

    /**
     * Record a message.
     * @param {string} message - The message.
     * @returns {Promise<void>}
     */
    async write(message) {
        this.messages.push(message);
    }

    /**
     * Record an error.
     * @param {string} message - The error message.
     * @returns {Promise<void>}
     */
    async writeError(message) {
        this.errors.push(message);
    }

    /**
     * Record a warning.
     * @param {string} message - The warning message.
     * @returns {Promise<void>}
     */
    async writeWarning(message) {
        this.warnings.push(message);
    }

    /**
     * Record a success message.
     * @param {string} message - The success message.
     * @returns {Promise<void>}
     */
    async writeSuccess(message) {
        this.successes.push(message);
    }

    /**
     * Record a progress message.
     * @param {string} message - The progress message.
     * @returns {Promise<void>}
     */
    async writeProgress(message) {
        this.progress.push(message);
    }

    /**
     * Get all recorded output.
     * @returns {object} All recorded messages by category.
     */
    getAll() {
        return {
            messages: [...this.messages],
            errors: [...this.errors],
            warnings: [...this.warnings],
            successes: [...this.successes],
            progress: [...this.progress],
        };
    }

    /**
     * Clear all recorded output.
     */
    reset() {
        this.messages = [];
        this.errors = [];
        this.warnings = [];
        this.successes = [];
        this.progress = [];
    }
}

export default OutputWriter;
