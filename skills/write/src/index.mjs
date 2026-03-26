import fs from 'node:fs';
import path from 'node:path';
import { parseKeyValueInput, resolvePathFromContext, stripDependsOn, unwrapBacktickLiteral } from '../../../utils/internalSkillsUtils.mjs';

function extractMultilineAfterKey(promptText, key) {
    const lines = String(promptText ?? '').split(/\r?\n/);
    const pattern = new RegExp(`^${key}\\s*:\\s*(.*)$`);
    for (let i = 0; i < lines.length; i += 1) {
        const match = lines[i].match(pattern);
        if (!match) {
            continue;
        }
        const firstLine = match[1] ?? '';
        const rest = lines.slice(i + 1).join('\n');
        return rest ? `${firstLine}\n${rest}` : firstLine;
    }
    return null;
}

export async function action(context) {
    const { promptText } = context;
    const sanitizedPrompt = stripDependsOn(promptText);
    const { data } = parseKeyValueInput(sanitizedPrompt);
    if (!data || typeof data !== 'object' || !Object.keys(data).length) {
        throw new Error('Write requires input with file_path and content.');
    }
    const filePath = resolvePathFromContext(data.file_path, 'file_path', context);
    const multilineContent = extractMultilineAfterKey(sanitizedPrompt, 'content');
    const content = typeof multilineContent === 'string'
        ? unwrapBacktickLiteral(multilineContent)
        : data.content;
    if (typeof content !== 'string') {
        throw new Error('Write requires string content.');
    }

    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmpPath = path.join(dir, `.tmp-${process.pid}-${Date.now()}-${path.basename(filePath)}`);
    await fs.promises.writeFile(tmpPath, content, 'utf8');
    await fs.promises.rename(tmpPath, filePath);
    return `Wrote ${content.length} characters to ${filePath}.`;
}
