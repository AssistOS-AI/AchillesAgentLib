import { tokenize } from './tokenizer.mjs';

function stripComments(line) {
    let inSingle = false;
    let inDouble = false;
    let escaped = false;

    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = true;
            continue;
        }
        if (char === "'" && !inDouble) {
            inSingle = !inSingle;
            continue;
        }
        if (char === '"' && !inSingle) {
            inDouble = !inDouble;
            continue;
        }
        if (char === '#' && !inSingle && !inDouble) {
            return line.slice(0, index);
        }
    }
    return line;
}

export function buildArgumentDescriptor(token) {
    if (!token.quoted && token.value.startsWith('$')) {
        return {
            type: 'variable',
            name: token.value.slice(1),
        };
    }
    return {
        type: 'literal',
        value: token.value,
    };
}

function buildSignature(commandName, argumentDescriptors) {
    const parts = [commandName];
    for (const descriptor of argumentDescriptors) {
        if (descriptor.type === 'variable') {
            parts.push(`$${descriptor.name}`);
        } else {
            parts.push(`#${descriptor.value}`);
        }
    }
    return parts.join('\u0001');
}

export function parseCode(code) {
    if (typeof code !== 'string') {
        throw new Error('LightSOPLang code must be a string');
    }

    const declarations = new Map();
    const lines = code.split(/\r?\n/);

    lines.forEach((line, index) => {
        const stripped = stripComments(line);
        const trimmed = stripped.trim();
        if (!trimmed) {
            return;
        }
        const tokens = tokenize(trimmed, index + 1);
        if (!tokens.length) {
            return;
        }
        const [firstToken, ...restTokens] = tokens;
        if (!firstToken.value.startsWith('@')) {
            throw new Error(`Line ${index + 1}: declaration must start with @`);
        }
        const variableName = firstToken.value.slice(1);
        if (!variableName) {
            throw new Error(`Line ${index + 1}: variable name missing`);
        }
        if (declarations.has(variableName)) {
            throw new Error(`Variable ${variableName} declared multiple times`);
        }
        if (!restTokens.length) {
            throw new Error(`Line ${index + 1}: command name missing for @${variableName}`);
        }
        const [commandToken, ...argumentTokens] = restTokens;
        const commandName = commandToken.value;
        if (!commandName) {
            throw new Error(`Line ${index + 1}: command name missing for @${variableName}`);
        }

        const argumentDescriptors = argumentTokens.map(buildArgumentDescriptor);
        const dependencies = new Set(
            argumentDescriptors
                .filter(descriptor => descriptor.type === 'variable')
                .map(descriptor => descriptor.name),
        );

        declarations.set(variableName, {
            name: variableName,
            command: commandName,
            arguments: argumentDescriptors,
            dependencies,
            signature: buildSignature(commandName, argumentDescriptors),
            lineNumber: index + 1,
        });
    });

    return declarations;
}
