import fs from 'node:fs';
import path from 'node:path';
import GampRSP from '../../../GampRSP.mjs';

export async function action({ context }) {
    const workspaceRoot = context.workspaceRoot || process.cwd();
    GampRSP.configure(workspaceRoot);
    const docsDir = GampRSP.generateHtmlDocs();
    const produced = fs.readdirSync(docsDir).filter((entry) => entry.endsWith('.html')).length;
    return {
        message: 'HTML documentation generated.',
        output: docsDir,
        files: produced,
    };
}

export default action;
