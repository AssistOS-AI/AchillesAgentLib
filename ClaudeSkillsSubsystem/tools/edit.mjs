import fs from 'node:fs';

import { ensureAbsolutePath, isProbablyText, parseJsonInput } from './utils.mjs';

export function buildEditTool() {
    return {
        description: `Replace exact text in a file.
When to use: update a specific string or snippet in a file.
How to call: pass JSON string with file_path (absolute), old_string, new_string, optional replace_all.
Examples:
- {"file_path":"/abs/path/file.txt","old_string":"foo","new_string":"bar"}
- {"file_path":"/abs/path/app.js","old_string":"debug=true","new_string":"debug=false","replace_all":true}
Notes: exact match only; use replace_all for multiple matches.`,
        handler: async (_agent, promptText) => {
            const { json } = parseJsonInput(promptText);
            if (!json || typeof json !== 'object') {
                throw new Error('Edit requires JSON input with file_path, old_string, and new_string.');
            }
            const filePath = ensureAbsolutePath(json.file_path, 'file_path');
            const oldString = json.old_string;
            const newString = json.new_string;
            const replaceAll = Boolean(json.replace_all);

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
        },
    };
}
