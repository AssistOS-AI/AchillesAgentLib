/**
 * ResultFormatter - Stateless utility functions for formatting skill execution results.
 *
 * Extracted from SkillManagerCli to reduce file size and improve modularity.
 */

/**
 * Summarize an orchestrator result for non-debug output.
 * Handles orchestrator results with executions, simple results, and fallbacks.
 *
 * @param {*} result - The result to summarize
 * @returns {string} - Human-readable summary
 */
export function summarizeResult(result) {
    if (!result || typeof result !== 'object') {
        return String(result);
    }

    const lines = [];

    // If it's an orchestrator result with executions
    if (result.executions && Array.isArray(result.executions)) {
        for (const exec of result.executions) {
            if (exec.skipped) continue;

            const skillName = exec.skill?.replace(/-code$/, '').replace(/-orchestrator$/, '') || 'unknown';
            const status = exec.error ? '✗' : '✓';

            if (exec.outcome?.result) {
                // Show the actual result from the skill execution
                const outcomeResult = exec.outcome.result;
                if (typeof outcomeResult === 'string') {
                    lines.push(outcomeResult);
                } else {
                    lines.push(JSON.stringify(outcomeResult, null, 2));
                }
            } else if (exec.error) {
                lines.push(`${status} ${skillName}: ${exec.error}`);
            }
        }

        // Add notes if present
        if (result.notes && lines.length === 0) {
            lines.push(result.notes);
        }

        return lines.length > 0 ? lines.join('\n\n') : JSON.stringify(result, null, 2);
    }

    // Fallback for non-orchestrator results
    if (result.result) {
        return typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2);
    }
    if (result.output) {
        return result.output;
    }

    return JSON.stringify(result, null, 2);
}

/**
 * Format slash command result for display.
 * Extracts the most relevant content from various result shapes.
 *
 * @param {*} result - The result to format
 * @returns {string} - Formatted result string
 */
export function formatSlashResult(result) {
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
}

export default {
    summarizeResult,
    formatSlashResult,
};
