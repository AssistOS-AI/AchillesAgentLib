const stripCodeFence = (value) => {
    if (typeof value === 'string') {
        return value;
    }
    if (!value || typeof value !== 'object') {
        return '';
    }
    try {
        return JSON.stringify(value, null, 2);
    } catch (error) {
        return String(value);
    }
};

const serializeContext = (context) => {
    if (typeof context === 'string') {
        return context;
    }
    if (!context || typeof context !== 'object') {
        return '';
    }
    try {
        return JSON.stringify(context, null, 2);
    } catch (error) {
        return String(context);
    }
};

export {
    stripCodeFence,
    serializeContext,
};
