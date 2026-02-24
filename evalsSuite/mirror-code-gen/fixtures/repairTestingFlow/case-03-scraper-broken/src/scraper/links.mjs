export function filterUnique(links) {
    const seen = new Set();
    const output = [];
    for (const link of links) {
        if (!seen.has(link)) {
            seen.add(link);
            output.push(link);
        }
    }
    return output;
}
