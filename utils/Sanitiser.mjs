const Sanitiser = {
    sanitiseName(value) {
        if (!value || typeof value !== 'string') {
            return '';
        }
        return value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_\-]+/g, '-')
            .replace(/^-+|-+$/g, '');
    },
};

export {
    Sanitiser,
};

export default Sanitiser;
