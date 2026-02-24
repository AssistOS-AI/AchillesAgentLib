export function ensureLeadingSlash(value) {
    if (value.startsWith('/')) {
        return value;
    }
    return `/${value}`;
}
