export function tokenize(line, lineNumber) {
    const tokens = [];
    let index = 0;
    const length = line.length;

    while (index < length) {
        while (index < length && /\s/.test(line[index])) {
            index += 1;
        }
        if (index >= length) {
            break;
        }

        const quote = line[index] === '"' || line[index] === "'";
        if (quote) {
            const quoteChar = line[index];
            index += 1;
            let value = '';
            let closed = false;
            while (index < length) {
                const char = line[index];
                if (char === '\\') {
                    if (index + 1 >= length) {
                        throw new Error(`Invalid escape sequence at line ${lineNumber}`);
                    }
                    const nextChar = line[index + 1];
                    const escapeMap = {
                        n: '\n',
                        r: '\r',
                        t: '\t',
                        '\\': '\\',
                        "'": "'",
                        '"': '"',
                    };
                    value += escapeMap[nextChar] ?? nextChar;
                    index += 2;
                    continue;
                }
                if (char === quoteChar) {
                    closed = true;
                    index += 1;
                    break;
                }
                value += char;
                index += 1;
            }
            if (!closed) {
                throw new Error(`Unterminated string literal at line ${lineNumber}`);
            }
            tokens.push({ value, quoted: true });
            continue;
        }

        let value = '';
        while (index < length && !/\s/.test(line[index])) {
            value += line[index];
            index += 1;
        }
        tokens.push({ value, quoted: false });
    }

    return tokens;
}
