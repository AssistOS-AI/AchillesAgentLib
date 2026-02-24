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
const YES_ACTIONS = new Set(['execute', 'confirm', 'confirmed', 'approve', 'approved', 'proceed', 'run', 'apply']);
const NO_ACTIONS = new Set(['cancel', 'abort', 'reject', 'decline', 'stop', 'deny']);

function normalizeLower(value) {
    return String(value ?? '').trim().toLowerCase();
}

function parseJsonIfPossible(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!(trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"'))) return null;
    try {
        return JSON.parse(trimmed);
    } catch {
        return null;
    }
}

function actionToDecision(value) {
    const action = normalizeLower(value);
    if (!action) return null;
    if (YES_ACTIONS.has(action)) return 'yes';
    if (NO_ACTIONS.has(action)) return 'no';
    return null;
}

function extractDecisionToken(input, depth = 0) {
    if (depth > 5 || input == null) return '';

    if (typeof input === 'boolean') {
        return input ? 'yes' : 'no';
    }

    if (typeof input === 'string') {
        const trimmed = input.trim();
        if (!trimmed) return '';
        const parsed = parseJsonIfPossible(trimmed);
        if (parsed !== null) {
            const parsedToken = extractDecisionToken(parsed, depth + 1);
            if (parsedToken) return parsedToken;
        }
        const actionDecision = actionToDecision(trimmed);
        if (actionDecision) return actionDecision;
        return trimmed;
    }

    if (Array.isArray(input)) {
        for (const item of input) {
            const token = extractDecisionToken(item, depth + 1);
            if (token) return token;
        }
        return '';
    }

    if (typeof input === 'object') {
        const directKeys = ['confirmation', 'decision', 'answer', 'response', 'value'];
        for (const key of directKeys) {
            if (Object.prototype.hasOwnProperty.call(input, key)) {
                const token = extractDecisionToken(input[key], depth + 1);
                if (token) return token;
            }
        }

        const actionDecision = actionToDecision(input.action ?? input.operation ?? input.intent ?? input.command);
        if (actionDecision) return actionDecision;

        const textKeys = ['promptText', 'prompt', 'input', 'message', 'text', 'rawInput'];
        for (const key of textKeys) {
            if (Object.prototype.hasOwnProperty.call(input, key)) {
                const token = extractDecisionToken(input[key], depth + 1);
                if (token) return token;
            }
        }
    }

    return '';
}

/**
 * Quick check if a prompt is a "yes" response (regex only, no LLM).
 * @param {string} prompt - User input
 * @returns {boolean}
 */
export function isYesResponse(prompt) {
    const token = extractDecisionToken(prompt);
    return YES_PATTERN.test(token);
}

/**
 * Quick check if a prompt is a "no" response (regex only, no LLM).
 * @param {string} prompt - User input
 * @returns {boolean}
 */
export function isNoResponse(prompt) {
    const token = extractDecisionToken(prompt);
    return NO_PATTERN.test(token);
}

/**
 * Quick check if a prompt is a cancellation (regex only, no LLM).
 * @param {string} prompt - User input
 * @returns {boolean}
 */
export function isCancelResponse(prompt) {
    const direct = String(prompt ?? '').trim();
    if (CANCEL_PATTERN.test(direct)) return true;

    if (prompt && typeof prompt === 'object') {
        const action = String(
            prompt.action ?? prompt.operation ?? prompt.intent ?? prompt.command ?? '',
        ).trim();
        if (CANCEL_PATTERN.test(action)) return true;

        const confirmation = String(
            prompt.confirmation ?? prompt.decision ?? prompt.answer ?? prompt.response ?? '',
        ).trim();
        if (CANCEL_PATTERN.test(confirmation)) return true;
    }

    const token = extractDecisionToken(prompt);
    return CANCEL_PATTERN.test(token);
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
    const trimmed = extractDecisionToken(prompt);

    // Quick regex path
    if (isYesResponse(trimmed)) return 'yes';
    if (isNoResponse(trimmed)) return 'no';

    // Empty input is unclear
    if (!trimmed) return 'unclear';

    // LLM fallback for ambiguous responses
    if (llmAgent && typeof llmAgent.resolveConfirmation === 'function') {
        try {
            const result = await llmAgent.resolveConfirmation(trimmed, {
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
