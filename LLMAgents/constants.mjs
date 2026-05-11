const FINAL_ANSWER_TOOL = 'final_answer';
const FINAL_ANSWER_DESCRIPTION = 'Return the final response that should be shown to the user.';
const CANNOT_COMPLETE_TOOL = 'cannot_complete';
const CANNOT_COMPLETE_DESCRIPTION = 'Signal that the task cannot be completed and include a reason.';

// Session status constants
const SESSION_STATUS_IDLE = 'idle';
const SESSION_STATUS_RUNNING = 'running';
const SESSION_STATUS_ACTIVE = 'active';
const SESSION_STATUS_AWAITING_INPUT = 'awaiting_input';
const SESSION_STATUS_INTERRUPTED = 'interrupted';
const SESSION_STATUS_DONE = 'done';
const SESSION_STATUS_FAILED = 'failed';

// Session storage key prefix for persisting sessions in sessionMemory
const SESSION_KEY_PREFIX = '__loopSession_';

const normalizeResponsePayload = (value, fallback = '') => {
    if (typeof value === 'string') {
        return value;
    }
    if (value && typeof value === 'object') {
        if (typeof value.response === 'string') {
            return value.response;
        }
        if (typeof value.text === 'string') {
            return value.text;
        }
        if (typeof value.message === 'string') {
            return value.message;
        }
    }
    if (typeof fallback === 'string') {
        return fallback;
    }
    return String(fallback ?? '');
};

export {
    FINAL_ANSWER_TOOL,
    FINAL_ANSWER_DESCRIPTION,
    CANNOT_COMPLETE_TOOL,
    CANNOT_COMPLETE_DESCRIPTION,
    SESSION_STATUS_IDLE,
    SESSION_STATUS_RUNNING,
    SESSION_STATUS_ACTIVE,
    SESSION_STATUS_AWAITING_INPUT,
    SESSION_STATUS_INTERRUPTED,
    SESSION_STATUS_DONE,
    SESSION_STATUS_FAILED,
    SESSION_KEY_PREFIX,
    normalizeResponsePayload,
};
