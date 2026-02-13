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

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const stripped = stripComments(line);
        const trimmed = stripped.trim();
        if (!trimmed) {
            continue;
        }
        const declarationLine = index + 1;
        const tokens = tokenize(trimmed, declarationLine);
        if (!tokens.length) {
            continue;
        }
        const [firstToken, ...restTokens] = tokens;
        if (!firstToken.value.startsWith('@')) {
            throw new Error(`Line ${declarationLine}: declaration must start with @`);
        }
        const variableName = firstToken.value.slice(1);
        if (!variableName) {
            throw new Error(`Line ${declarationLine}: variable name missing`);
        }
        if (declarations.has(variableName)) {
            throw new Error(`Variable ${variableName} declared multiple times`);
        }
        if (!restTokens.length) {
            throw new Error(`Line ${declarationLine}: command name missing for @${variableName}`);
        }
        const [commandToken, ...argumentTokens] = restTokens;
        const commandName = commandToken.value;
        if (!commandName) {
            throw new Error(`Line ${declarationLine}: command name missing for @${variableName}`);
        }
        let argumentDescriptors = argumentTokens.map(buildArgumentDescriptor);
        if (commandName === 'assign' && argumentDescriptors.length === 0) {
            const nextLine = lines[index + 1];
            if (typeof nextLine === 'string') {
                const beginMatch = nextLine.trim().match(/^--begin-(.+)--$/);
                if (beginMatch) {
                    const token = beginMatch[1];
                    const endMarker = `--end-${token}--`;
                    const contentLines = [];
                    let endIndex = -1;
                    for (let scan = index + 2; scan < lines.length; scan += 1) {
                        if (lines[scan].trim() === endMarker) {
                            endIndex = scan;
                            break;
                        }
                        contentLines.push(lines[scan]);
                    }
                    if (endIndex === -1) {
                        throw new Error(`Line ${index + 2}: missing ${endMarker} for here-doc`);
                    }
                    argumentDescriptors = [{ type: 'literal', value: contentLines.join('\n') }];
                    index = endIndex;
                }
            }
        }
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
            lineNumber: declarationLine,
        });
    }

    return declarations;
}
