import readline from 'node:readline';

const looksLikeEnvelope = (text) => {
    if (typeof text !== 'string') {
        return false;
    }
    const trimmed = text.trim();
    return trimmed.includes('"__webchatMessage"') &&
        trimmed.includes('"version"') &&
        trimmed.includes('"text"') &&
        trimmed.includes('"attachments"');
};

const defaultPromptReader = (message) => {
    const filterStream = new (class {
        write(chunk, encoding, callback) {
            const text = typeof chunk === 'string' ? chunk : (chunk ? chunk.toString() : '');
            if (text && !looksLikeEnvelope(text)) {
                process.stdout.write(chunk, encoding, callback);
            } else if (typeof callback === 'function') {
                callback();
            }
            return true;
        }

        end(...args) {
            return process.stdout.end(...args);
        }

        get writable() {
            return process.stdout.writable;
        }
    })();

    const rl = readline.createInterface({
        input: process.stdin,
        output: filterStream,
        terminal: false,
    });

    return new Promise((resolve) => {
        rl.question(message, (answer) => {
            rl.close();
            resolve(answer.replace(/\x01/g, '\n'));
        });
    });
};

export { defaultPromptReader };
export default defaultPromptReader;
