import fs from 'node:fs';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import { stripDependsOn } from '../../../utils/internalSkillsUtils.mjs';

export async function action(context) {
    const { promptText } = context;
    const pattern = stripDependsOn(promptText).trim();
    if (!pattern) {
        throw new Error('Glob requires a pattern.');
    }

    const baseDir = process.cwd();
    const matches = [];

    for await (const match of glob(pattern, { cwd: baseDir })) {
        const fullPath = path.isAbsolute(match)
            ? match
            : path.resolve(baseDir, match);
        let stat;
        try {
            stat = await fs.promises.stat(fullPath);
        } catch {
            continue;
        }
        if (!stat.isFile()) {
            continue;
        }
        matches.push({ path: fullPath, mtimeMs: stat.mtimeMs });
    }

    matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return JSON.stringify(matches.map((match) => match.path));
}
