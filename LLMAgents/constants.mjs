const RETURN_RESPONSE_TOOL = 'returnResponse';
const RETURN_RESPONSE_DESCRIPTION = 'Return the final response that should be shown to the user.';

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
    RETURN_RESPONSE_TOOL,
    RETURN_RESPONSE_DESCRIPTION,
    normalizeResponsePayload,
};
