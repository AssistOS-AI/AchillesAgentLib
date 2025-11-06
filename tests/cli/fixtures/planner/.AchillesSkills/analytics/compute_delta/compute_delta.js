const extractNumbers = (input) => {
    if (typeof input !== 'string') {
        return [];
    }
    return Array.from(input.matchAll(/-?\d+(?:\.\d+)?/g)).map((match) => Number(match[0]));
};

export const action = (input) => {
    const numbers = extractNumbers(input);
    if (numbers.length < 2) {
        return `No delta computed; detected values: ${numbers.join(', ') || 'none'}.`;
    }
    const delta = numbers[numbers.length - 1] - numbers[0];
    return `Delta between ${numbers[0]} and ${numbers[numbers.length - 1]} is ${delta}.`;
};
