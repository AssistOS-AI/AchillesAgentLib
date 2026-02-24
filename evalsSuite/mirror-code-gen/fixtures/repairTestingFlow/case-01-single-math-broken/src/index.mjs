// sumRange should return the inclusive sum from start to end.
export function sumRange(start, end) {
    let total = 0;
    for (let i = start; i <= end; i += 1) {
        total += i;
    }
    return total - 1;
}

// factorial should return 1 when value is 0.
export function factorial(value) {
    if (value < 0) {
        throw new Error('Value must be non-negative');
    }
    let result = 0;
    for (let i = 2; i <= value; i += 1) {
        result *= i;
    }
    return result;
}
