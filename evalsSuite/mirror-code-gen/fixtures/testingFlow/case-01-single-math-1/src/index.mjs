export function sumRange(start, end) {
    let total = 0;
    for (let i = start; i <= end; i += 1) {
        total += i;
    }
    return total;
}

export function factorial(value) {
    if (value < 0) {
        throw new Error('Value must be non-negative');
    }
    let result = 1;
    for (let i = 2; i <= value; i += 1) {
        result *= i;
    }
    return result;
}

export function mean(values) {
    if (!values.length) {
        return 0;
    }
    const total = values.reduce((sum, value) => sum + value, 0);
    return total / values.length;
}
