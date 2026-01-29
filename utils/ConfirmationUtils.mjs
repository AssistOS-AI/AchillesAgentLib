/**
 * ConfirmationUtils - Core yes/no resolution utilities.
 *
 * Provides quick regex-based detection and LLM-assisted fallback
 * for resolving user confirmation responses.
 *
 * Used by:
 * - ConversationalTskillController (DBTableSkillsSubsystem) for tskill confirmation flows
 * - ConfirmationHelper (agent-level) for cskill confirmation flows
 */

const YES_PATTERN = /^(yes|y|accept|confirm|ok|proceed|sure|go ahead|do it|affirmative)$/i;
const NO_PATTERN = /^(no|n|cancel|stop|abort|reject|decline|nevermind|never mind)$/i;
const CANCEL_PATTERN = /^(cancel|abort|stop|quit|exit|nevermind|never mind)$/i;

/**
 * Quick check if a prompt is a "yes" response (regex only, no LLM).
 * @param {string} prompt - User input
 * @returns {boolean}
 */
export function isYesResponse(prompt) {
    return YES_PATTERN.test((prompt || '').trim());
}

/**
 * Quick check if a prompt is a "no" response (regex only, no LLM).
 * @param {string} prompt - User input
 * @returns {boolean}
 */
export function isNoResponse(prompt) {
    return NO_PATTERN.test((prompt || '').trim());
}

/**
 * Quick check if a prompt is a cancellation (regex only, no LLM).
 * @param {string} prompt - User input
 * @returns {boolean}
 */
export function isCancelResponse(prompt) {
    return CANCEL_PATTERN.test((prompt || '').trim());
}

/**
 * Resolve a user prompt to 'yes', 'no', or 'unclear'.
 *
 * Uses quick regex patterns first, then falls back to LLM
 * for ambiguous responses (e.g., "sure thing", "nah", "I think so").
 *
 * @param {string} prompt - User input to resolve
 * @param {object} [llmAgent] - Optional LLM agent for ambiguous cases
 * @param {object} [options] - Options for LLM resolution
 * @param {string} [options.actionContext] - Description of what is being confirmed
 * @returns {Promise<'yes'|'no'|'unclear'>}
 */
export async function resolveConfirmation(prompt, llmAgent, options = {}) {
    const trimmed = (prompt || '').trim();

    // Quick regex path
    if (isYesResponse(trimmed)) return 'yes';
    if (isNoResponse(trimmed)) return 'no';

    // Empty input is unclear
    if (!trimmed) return 'unclear';

    // LLM fallback for ambiguous responses
    if (llmAgent && typeof llmAgent.resolveConfirmation === 'function') {
        try {
            const result = await llmAgent.resolveConfirmation(prompt, {
                actionContext: options.actionContext || 'confirming an operation',
            });
            if (result.decision === 'yes') return 'yes';
            if (result.decision === 'no') return 'no';
        } catch (_error) {
            // Fall through to unclear
        }
    }

    return 'unclear';
}
