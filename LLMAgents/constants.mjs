const FINAL_ANSWER_TOOL = 'final_answer';
const FINAL_ANSWER_DESCRIPTION = 'Return the final response that should be shown to the user.';
const CANNOT_COMPLETE_TOOL = 'cannot_complete';
const CANNOT_COMPLETE_DESCRIPTION = 'Signal that the task cannot be completed and include a reason.';

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
    normalizeResponsePayload,
};
