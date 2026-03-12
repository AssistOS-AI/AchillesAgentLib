import fs from 'node:fs';
import path from 'node:path';

import { parseKeyValueInput, resolvePath } from './utils.mjs';

export function buildWriteTool() {
    return {
        description: `Create or overwrite a file with new content.
When to use: write/create/save/overwrite a file.
How to call: pass key:value pairs (newline or comma-separated). Required: file_path, content.
Examples:
- file_path: /abs/path/file.txt\n  content: hello
- file_path: relative/path/file.txt\n  content: hello
- file_path: /abs/path/config.json\n  content: {"a":1}
Notes: always overwrites the file.`,
        handler: async (_agent, promptText) => {
            const { data } = parseKeyValueInput(promptText);
            if (!data || typeof data !== 'object' || !Object.keys(data).length) {
                throw new Error('Write requires input with file_path and content.');
            }
            const filePath = resolvePath(data.file_path, 'file_path');
            const content = data.content;
            if (typeof content !== 'string') {
                throw new Error('Write requires string content.');
            }

            const dir = path.dirname(filePath);
            await fs.promises.mkdir(dir, { recursive: true });
            const tmpPath = path.join(dir, `.tmp-${process.pid}-${Date.now()}-${path.basename(filePath)}`);
            await fs.promises.writeFile(tmpPath, content, 'utf8');
            await fs.promises.rename(tmpPath, filePath);
            return `Wrote ${content.length} characters to ${filePath}.`;
        },
    };
}
