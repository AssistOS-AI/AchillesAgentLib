export function ensureLeadingSlash(value) {
    if (value.startsWith('/') || value.match(/^https?:\/\//i)) {
        return value;
    }
    return `/${value}`;
}