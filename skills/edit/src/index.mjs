import fs from 'node:fs';
import { isProbablyText, parseKeyValueInput, resolvePathFromContext, stripDependsOn, unwrapBacktickLiteral } from '../../../utils/internalSkillsUtils.mjs';

function extractMultilineBlock(promptText, key, stopKeys) {
    const lines = String(promptText ?? '').split(/\r?\n/);
    const startPattern = new RegExp(`^${key}\\s*:\\s*(.*)$`);
    const stopPattern = new RegExp(`^(${stopKeys.join('|')})\\s*:`);
    for (let i = 0; i < lines.length; i += 1) {
        const match = lines[i].match(startPattern);
        if (!match) {
            continue;
        }
        const collected = [match[1] ?? ''];
        for (let j = i + 1; j < lines.length; j += 1) {
            if (stopPattern.test(lines[j])) {
                break;
            }
            collected.push(lines[j]);
        }
        return collected.join('\n');
    }
    return null;
}

export async function action(context) {
    const { promptText } = context;
    const sanitizedPrompt = stripDependsOn(promptText);
    const { data } = parseKeyValueInput(sanitizedPrompt);
    if (!data || typeof data !== 'object' || !Object.keys(data).length) {
        throw new Error('Edit requires input with file_path, old_string, and new_string.');
    }
    const filePath = resolvePathFromContext(data.file_path, 'file_path', context);
    const stopKeys = ['file_path', 'old_string', 'new_string', 'replace_all'];
    const multilineOld = extractMultilineBlock(sanitizedPrompt, 'old_string', stopKeys);
    const multilineNew = extractMultilineBlock(sanitizedPrompt, 'new_string', stopKeys);
    const oldString = typeof multilineOld === 'string'
        ? unwrapBacktickLiteral(multilineOld)
        : data.old_string;
    const newString = typeof multilineNew === 'string'
        ? unwrapBacktickLiteral(multilineNew)
        : data.new_string;
    const replaceAll = Boolean(data.replace_all);

    if (typeof oldString !== 'string' || typeof newString !== 'string') {
        throw new Error('Edit requires old_string and new_string as strings.');
    }
    if (oldString === newString) {
        throw new Error('Edit requires new_string to differ from old_string.');
    }

    const buffer = await fs.promises.readFile(filePath);
    if (!isProbablyText(buffer)) {
        throw new Error('Edit supports text files only.');
    }
    const content = buffer.toString('utf8');
    const occurrences = content.split(oldString).length - 1;
    if (occurrences === 0) {
        throw new Error('Edit failed: old_string not found.');
    }
    if (!replaceAll && occurrences > 1) {
        throw new Error('Edit failed: old_string is not unique; set replace_all to true.');
    }

    const updated = replaceAll
        ? content.split(oldString).join(newString)
        : content.replace(oldString, newString);

    await fs.promises.writeFile(filePath, updated, 'utf8');
    return `Updated ${filePath}.`;
}
