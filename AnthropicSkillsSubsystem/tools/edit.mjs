import fs from 'node:fs';

import { isProbablyText, parseKeyValueInput, resolvePath } from './utils.mjs';

export function buildEditTool() {
    return {
        description: `Replace exact text in a file.
When to use: update a specific string or snippet in a file.
How to call: pass key:value pairs (newline or comma-separated). Required: file_path, old_string, new_string.
Examples:
- file_path: /abs/path/file.txt\n  old_string: foo\n  new_string: bar
- file_path: relative/path/file.txt\n  old_string: foo\n  new_string: bar
- file_path: /abs/path/app.js\n  old_string: debug=true\n  new_string: debug=false\n  replace_all: true
Notes: exact match only; use replace_all for multiple matches.`,
        handler: async (_agent, promptText) => {
            const { data } = parseKeyValueInput(promptText);
            if (!data || typeof data !== 'object' || !Object.keys(data).length) {
                throw new Error('Edit requires input with file_path, old_string, and new_string.');
            }
            const filePath = resolvePath(data.file_path, 'file_path');
            const oldString = data.old_string;
            const newString = data.new_string;
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
        },
    };
}
