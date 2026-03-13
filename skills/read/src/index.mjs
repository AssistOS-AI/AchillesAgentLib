import fs from 'node:fs';
import { isProbablyText, parseKeyValueInput, resolvePath } from '../../../utils/internalSkillsUtils.mjs';

const DEFAULT_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;

function formatNumberedLines(lines, startLine) {
    const output = [];
    const start = Math.max(1, startLine || 1);
    for (let i = 0; i < lines.length; i += 1) {
        const lineNumber = start + i;
        const prefix = String(lineNumber).padStart(6, ' ') + '\t';
        let lineText = lines[i] ?? '';
        if (lineText.length > MAX_LINE_LENGTH) {
            lineText = lineText.slice(0, MAX_LINE_LENGTH);
        }
        output.push(`${prefix}${lineText}`);
    }
    return output.join('\n');
}

export async function action(context) {
    const { promptText } = context;
    const { data, raw, hasPairs } = parseKeyValueInput(promptText);
    const input = hasPairs ? data : { file_path: raw };
    const filePath = resolvePath(input.file_path, 'file_path');
    const offset = input.offset ? Number(input.offset) : 1;
    const limit = input.limit ? Number(input.limit) : DEFAULT_LIMIT;

    let stats;
    try {
        stats = await fs.promises.stat(filePath);
    } catch (error) {
        throw new Error(`Read failed: ${error.message}`);
    }
    if (!stats.isFile()) {
        throw new Error('Read failed: file_path must be a file.');
    }

    const buffer = await fs.promises.readFile(filePath);
    if (!isProbablyText(buffer)) {
        return buffer.toString('base64');
    }

    const text = buffer.toString('utf8');
    const lines = text.split(/\r?\n/);
    const startIndex = Math.max(0, (Number.isFinite(offset) ? offset : 1) - 1);
    const maxLines = Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMIT;
    const slice = lines.slice(startIndex, startIndex + maxLines);
    return formatNumberedLines(slice, startIndex + 1);
}
