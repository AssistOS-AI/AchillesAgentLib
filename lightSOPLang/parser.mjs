import { tokenize } from './tokenizer.mjs';

function normalizeLineStart(line) {
    return String(line ?? '').replace(/^[\uFEFF\u200B\u200C\u200D]+/, '');
}

function splitInlineComment(line) {
    line = normalizeLineStart(line);
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
            return {
                code: line.slice(0, index),
                comment: line.slice(index + 1).trim(),
            };
        }
    }
    return { code: line, comment: '' };
}

function stripComments(line) {
    return splitInlineComment(line).code;
}

function isDeclarationLine(line) {
    return normalizeLineStart(line).trimStart().startsWith('@');
}

function isCommentLine(line) {
    return normalizeLineStart(line).trimStart().startsWith('#');
}

function parseCommentLine(line) {
    return normalizeLineStart(line).trimStart().slice(1).trim();
}

function buildAssociatedCommentMap(lines) {
    const commentByDeclarationLine = new Map();
    const associatedCommentLines = new Set();

    for (let index = 0; index < lines.length; index += 1) {
        if (!isCommentLine(lines[index])) {
            continue;
        }

        const start = index;
        const comments = [];
        while (index < lines.length && isCommentLine(lines[index])) {
            comments.push(parseCommentLine(lines[index]));
            index += 1;
        }

        if (index < lines.length && isDeclarationLine(lines[index])) {
            commentByDeclarationLine.set(index + 1, comments);
            for (let commentIndex = start; commentIndex < index; commentIndex += 1) {
                associatedCommentLines.add(commentIndex);
            }
        }

        index -= 1;
    }

    return {
        commentByDeclarationLine,
        associatedCommentLines,
    };
}

function splitDeclarationBlocks(lines) {
    const blocks = [];
    let currentBlock = null;
    const {
        commentByDeclarationLine,
        associatedCommentLines,
    } = buildAssociatedCommentMap(lines);

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (associatedCommentLines.has(index)) {
            continue;
        }
        if (isDeclarationLine(line)) {
            if (currentBlock) {
                blocks.push(currentBlock);
            }
            const lineNumber = index + 1;
            currentBlock = {
                lineNumber,
                headerLine: line,
                continuationLines: [],
                commentLines: commentByDeclarationLine.get(lineNumber) || [],
            };
            continue;
        }

        if (!currentBlock) {
            const stripped = stripComments(line);
            if (stripped.trim()) {
                throw new Error(`Line ${index + 1}: declaration must start with @`);
            }
            continue;
        }

        currentBlock.continuationLines.push(line);
    }

    if (currentBlock) {
        blocks.push(currentBlock);
    }

    return blocks;
}

function trimBlankEdges(lines) {
    let start = 0;
    let end = lines.length;

    while (start < end && !lines[start].trim()) {
        start += 1;
    }
    while (end > start && !lines[end - 1].trim()) {
        end -= 1;
    }

    return lines.slice(start, end);
}

function buildContinuationArgument(continuationLines) {
    const contentLines = trimBlankEdges(continuationLines);
    if (!contentLines.length) {
        return null;
    }
    return {
        type: 'literal',
        value: contentLines.join('\n'),
    };
}

function parseAssignHereDoc(continuationLines, lineNumber) {
    const contentLines = trimBlankEdges(continuationLines);
    const beginMatch = contentLines[0]?.trim().match(/^--begin-(.+)--$/);
    if (!beginMatch) {
        return null;
    }

    const token = beginMatch[1];
    const endMarker = `--end-${token}--`;
    const bodyLines = [];
    let endIndex = -1;

    for (let index = 1; index < contentLines.length; index += 1) {
        if (contentLines[index].trim() === endMarker) {
            endIndex = index;
            break;
        }
        bodyLines.push(contentLines[index]);
    }

    if (endIndex === -1) {
        throw new Error(`Line ${lineNumber + 1}: missing ${endMarker} for here-doc`);
    }

    const trailingContent = contentLines.slice(endIndex + 1).some(line => line.trim());
    if (trailingContent) {
        throw new Error(`Line ${lineNumber + endIndex + 2}: unexpected content after ${endMarker}`);
    }

    return {
        type: 'literal',
        value: bodyLines.join('\n'),
    };
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
    const blocks = splitDeclarationBlocks(lines);

    for (const block of blocks) {
        const splitHeader = splitInlineComment(block.headerLine);
        const stripped = splitHeader.code;
        const trimmed = stripped.trim();
        if (!trimmed) {
            continue;
        }
        const commentLines = block.commentLines.slice();
        if (splitHeader.comment) {
            commentLines.push(splitHeader.comment);
        }
        const declarationLine = block.lineNumber;
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
        let usedHereDoc = false;
        if (commandName === 'assign' && argumentDescriptors.length === 0) {
            const hereDocArgument = parseAssignHereDoc(block.continuationLines, declarationLine);
            if (hereDocArgument) {
                argumentDescriptors = [hereDocArgument];
                usedHereDoc = true;
            }
        }
        const continuationArgument = usedHereDoc
            ? null
            : buildContinuationArgument(block.continuationLines);
        if (continuationArgument) {
            argumentDescriptors.push(continuationArgument);
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
            comment: commentLines.join('\n').trim(),
            commentLines,
        });
    }

    return declarations;
}
