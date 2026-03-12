import fs from 'node:fs';
import path from 'node:path';

import { ensureAbsolutePath, parseJsonInput } from './utils.mjs';

export function buildWriteTool() {
    return {
        description: `Create or overwrite a file with new content.
When to use: write/create/save/overwrite a file.
How to call: pass JSON string with file_path (absolute) and content.
Examples:
- {"file_path":"/abs/path/file.txt","content":"hello"}
- {"file_path":"/abs/path/config.json","content":"{\\"a\\":1}"}
Notes: always overwrites the file.`,
        handler: async (_agent, promptText) => {
            const { json } = parseJsonInput(promptText);
            if (!json || typeof json !== 'object') {
                throw new Error('Write requires JSON input with file_path and content.');
            }
            const filePath = ensureAbsolutePath(json.file_path, 'file_path');
            const content = json.content;
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
