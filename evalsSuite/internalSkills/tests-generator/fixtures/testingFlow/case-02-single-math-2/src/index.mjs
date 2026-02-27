export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export function median(values) {
    if (!values.length) {
        return null;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}

export function variance(values) {
    if (!values.length) {
        return 0;
    }
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    const squared = values.map(value => (value - avg) ** 2);
    return squared.reduce((sum, value) => sum + value, 0) / values.length;
}
