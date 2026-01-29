/**
 * CLIEventLoop - Encapsulates CLI interaction loop with readline
 *
 * Handles:
 * - readline interface creation
 * - Webchat envelope parsing
 * - Signal handlers (SIGINT, SIGTERM, SIGHUP)
 * - Inactivity timeout
 * - Graceful shutdown
 * - IOServices configuration
 *
 * Usage:
 *   const eventLoop = new CLIEventLoop({ inactivityTimeoutMs: 30 * 60 * 1000 });
 *
 *   eventLoop.onMessage(async ({ text, attachments, user, settings, raw, isEnvelope }) => {
 *       // Handle message
 *       const result = await agent.executePrompt(text, { context: { user, attachments } });
 *       return result;
 *   });
 *
 *   eventLoop.onShutdown((reason) => {
 *       console.log(`Shutting down: ${reason}`);
 *   });
 *
 *   await eventLoop.start();
 */

import readline from 'node:readline';
import { parseWebchatEnvelope } from './WebchatEnvelope.mjs';
import { IOServices } from './IOServices.mjs';
import { CLIInputReader } from './InputReader.mjs';
import { CLIOutputWriter } from './OutputWriter.mjs';
import {
    DEFAULT_INACTIVITY_TIMEOUT_MS,
    READLINE_CLOSE_DELAY_MS,
    SHUTDOWN_REASONS,
} from './constants.mjs';

/**
 * CLI Event Loop class
 */
export class CLIEventLoop {
    /**
     * Create a new CLI event loop
     * @param {Object} options - Configuration options
     * @param {number} [options.inactivityTimeoutMs=1800000] - Inactivity timeout in ms (default 30 min)
     * @param {boolean} [options.debug=false] - Enable debug logging
     * @param {Function} [options.debugLog] - Custom debug log function
     */
    constructor(options = {}) {
        this.inactivityTimeoutMs = options.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT_MS;
        this.debug = options.debug ?? (process.env.ACHILLES_DEBUG_ENABLED === 'true');
        this.debugLog = options.debugLog ?? ((...args) => {
            if (this.debug) {
                console.log('[CLIEventLoop]', ...args);
            }
        });

        this.rl = null;
        this.inactivityTimer = null;
        this.isProcessing = false;
        this.isShuttingDown = false;
        this.isContainerMode = false;

        // Callbacks
        this._messageHandler = null;
        this._shutdownHandler = null;
        this._errorHandler = null;

        // Bound handlers for cleanup
        this._boundSignalHandler = null;
        this._boundLineHandler = null;
    }

    /**
     * Register message handler
     * Called for each line of input (after envelope parsing)
     * @param {Function} handler - async (message) => result
     *   message: { text, attachments, user, settings, raw, isEnvelope, rawInput }
     */
    onMessage(handler) {
        this._messageHandler = handler;
        return this;
    }

    /**
     * Register shutdown handler
     * @param {Function} handler - (reason) => void
     */
    onShutdown(handler) {
        this._shutdownHandler = handler;
        return this;
    }

    /**
     * Register error handler
     * @param {Function} handler - (error, context) => void
     */
    onError(handler) {
        this._errorHandler = handler;
        return this;
    }

    /**
     * Get the readline interface (for advanced use)
     * @returns {readline.Interface|null}
     */
    getReadline() {
        return this.rl;
    }

    /**
     * Get the output writer from IOServices
     * @returns {OutputWriter|null}
     */
    getOutputWriter() {
        return IOServices.getOutputWriter();
    }

    /**
     * Get the input reader from IOServices
     * @returns {InputReader|null}
     */
    getInputReader() {
        return IOServices.getInputReader();
    }

    /**
     * Write output via IOServices
     * @param {string} message - Message to write
     */
    async write(message) {
        const writer = IOServices.getOutputWriter();
        if (writer) {
            await writer.write(message);
        } else {
            console.log(message);
        }
    }

    /**
     * Write error via IOServices
     * @param {string} message - Error message
     */
    async writeError(message) {
        const writer = IOServices.getOutputWriter();
        if (writer) {
            await writer.writeError(message);
        } else {
            console.error('Error:', message);
        }
    }

    /**
     * Start the event loop
     * @returns {Promise<void>} Resolves when loop ends
     */
    async start() {
        if (this.rl) {
            throw new Error('Event loop already started');
        }

        // Detect container mode
        this.isContainerMode = !process.stdin.isTTY;
        if (this.isContainerMode) {
            this.debugLog('Running in container mode (no TTY)');
            process.stdin.resume();
        }

        // Create readline interface
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: false,
        });

        // Configure IOServices
        IOServices.setInputReader(new CLIInputReader(this.rl));
        IOServices.setOutputWriter(new CLIOutputWriter());
        this.debugLog('IOServices configured');

        // Setup signal handlers
        this._setupSignalHandlers();

        // Setup readline handlers
        this._setupReadlineHandlers();

        // Start inactivity timer
        this._resetInactivityTimer();

        this.debugLog('Event loop started');

        // Return a promise that resolves when shutdown completes
        return new Promise((resolve) => {
            this._shutdownResolve = resolve;
        });
    }

    /**
     * Request graceful shutdown
     * @param {string} [reason=SHUTDOWN_REASONS.REQUESTED] - Shutdown reason
     */
    async shutdown(reason = SHUTDOWN_REASONS.REQUESTED) {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;

        this.debugLog(`Shutting down (reason: ${reason})...`);

        // Clear inactivity timer
        if (this.inactivityTimer) {
            clearTimeout(this.inactivityTimer);
            this.inactivityTimer = null;
        }

        // Call shutdown handler
        if (this._shutdownHandler) {
            try {
                await this._shutdownHandler(reason);
            } catch (err) {
                this.debugLog('Shutdown handler error:', err.message);
            }
        }

        // Close readline
        if (this.rl) {
            try {
                this.rl.close();
            } catch (_) { }
            this.rl = null;
        }

        // Clear IOServices
        IOServices.clear();

        // Remove signal handlers
        this._removeSignalHandlers();

        // Resolve start() promise
        if (this._shutdownResolve) {
            this._shutdownResolve();
        }

        this.debugLog('Shutdown complete');
    }

    /**
     * Reset inactivity timer
     * @private
     */
    _resetInactivityTimer() {
        if (this.inactivityTimer) {
            clearTimeout(this.inactivityTimer);
        }

        if (this.inactivityTimeoutMs > 0) {
            this.inactivityTimer = setTimeout(() => {
                this.debugLog(`Inactivity timeout reached (${this.inactivityTimeoutMs / 1000}s)`);
                this.shutdown(SHUTDOWN_REASONS.INACTIVITY_TIMEOUT);
            }, this.inactivityTimeoutMs);

            // Don't keep process alive just for this timer (non-container mode)
            if (!this.isContainerMode && this.inactivityTimer.unref) {
                this.inactivityTimer.unref();
            }
        }
    }

    /**
     * Setup signal handlers
     * @private
     */
    _setupSignalHandlers() {
        this._boundSignalHandler = (signal) => this.shutdown(signal);

        process.on('SIGINT', this._boundSignalHandler);
        process.on('SIGTERM', this._boundSignalHandler);
        process.on('SIGHUP', this._boundSignalHandler);
    }

    /**
     * Remove signal handlers
     * @private
     */
    _removeSignalHandlers() {
        if (this._boundSignalHandler) {
            process.off('SIGINT', this._boundSignalHandler);
            process.off('SIGTERM', this._boundSignalHandler);
            process.off('SIGHUP', this._boundSignalHandler);
            this._boundSignalHandler = null;
        }
    }

    /**
     * Setup readline handlers
     * @private
     */
    _setupReadlineHandlers() {
        // Handle readline close
        this.rl.on('close', () => {
            if (this.isContainerMode) {
                this.debugLog('readline closed in container mode - staying alive for inactivity timeout');
                return;
            }
            this.debugLog('readline closed, waiting before shutdown...');
            setTimeout(() => {
                if (!this.isProcessing) {
                    this.shutdown(SHUTDOWN_REASONS.READLINE_CLOSE);
                }
            }, READLINE_CLOSE_DELAY_MS);
        });

        // Handle stdin errors
        process.stdin.on('error', (err) => {
            this.debugLog('stdin error:', err?.message || err);
            if (this._errorHandler) {
                this._errorHandler(err, 'stdin');
            }
        });

        process.stdin.on('end', () => {
            this.debugLog('stdin ended');
            if (this.isContainerMode) {
                this.debugLog('Container mode detected - ignoring stdin end');
            }
        });

        // Handle each line of input
        this.rl.on('line', async (line) => {
            this._resetInactivityTimer();

            const rawInput = line.trim();
            if (!rawInput) return;

            // Parse webchat envelope if present
            const envelope = parseWebchatEnvelope(rawInput);

            const message = {
                text: envelope ? (envelope.text || '').trim() : rawInput,
                attachments: envelope?.attachments || [],
                user: envelope?.user || null,
                settings: envelope?.settings || null,
                raw: envelope?.raw || null,
                isEnvelope: !!envelope,
                rawInput,
            };

            // Call message handler
            if (this._messageHandler) {
                try {
                    this.isProcessing = true;
                    await this._messageHandler(message);
                } catch (err) {
                    this.debugLog('Message handler error:', err.message);
                    if (this._errorHandler) {
                        this._errorHandler(err, 'message_handler');
                    } else {
                        await this.writeError(err.message);
                    }
                } finally {
                    this.isProcessing = false;
                }
            }
        });
    }
}

export default CLIEventLoop;
