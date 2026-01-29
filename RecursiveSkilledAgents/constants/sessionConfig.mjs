/**
 * Session memory configuration constants for RecursiveSkilledAgent.
 */

/**
 * Default session ID used when no sessionId is specified.
 * Enables single-session mode (CLI) while supporting multi-session (webchat).
 */
export const DEFAULT_SESSION_ID = '__default__';

/**
 * Default session configuration for memory management.
 */
export const DEFAULT_SESSION_CONFIG = {
    /** Maximum number of sessions to keep (0 = unlimited) */
    maxSessions: 1000,
    /** Session TTL in milliseconds (0 = never expire, default 2 hours) */
    sessionTTL: 2 * 60 * 60 * 1000,
    /** How often to run cleanup in milliseconds (default 5 minutes) */
    cleanupInterval: 5 * 60 * 1000,
};

/**
 * Session TTL presets in milliseconds.
 */
export const SESSION_TTL_PRESETS = {
    /** No expiration */
    NEVER: 0,
    /** 15 minutes */
    SHORT: 15 * 60 * 1000,
    /** 1 hour */
    MEDIUM: 60 * 60 * 1000,
    /** 2 hours (default) */
    LONG: 2 * 60 * 60 * 1000,
    /** 24 hours */
    DAY: 24 * 60 * 60 * 1000,
};

/**
 * Cleanup interval presets in milliseconds.
 */
export const CLEANUP_INTERVAL_PRESETS = {
    /** No automatic cleanup */
    DISABLED: 0,
    /** Every minute */
    FREQUENT: 60 * 1000,
    /** Every 5 minutes (default) */
    NORMAL: 5 * 60 * 1000,
    /** Every 15 minutes */
    INFREQUENT: 15 * 60 * 1000,
};
