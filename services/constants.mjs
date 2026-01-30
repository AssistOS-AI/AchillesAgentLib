/**
 * Constants for CLI services
 */

/**
 * Default inactivity timeout in milliseconds (30 minutes).
 * Used by CLIEventLoop to auto-shutdown after idle period.
 */
export const DEFAULT_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Delay before shutdown after readline close (5 seconds).
 * Allows pending operations to complete.
 */
export const READLINE_CLOSE_DELAY_MS = 5000;

/**
 * Signal names handled by CLIEventLoop for graceful shutdown.
 */
export const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * Shutdown reasons used by CLIEventLoop.
 */
export const SHUTDOWN_REASONS = {
    REQUESTED: 'requested',
    INACTIVITY_TIMEOUT: 'inactivity_timeout',
    READLINE_CLOSE: 'readline_close',
    SIGNAL: 'signal',
};
