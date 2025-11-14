import fs from 'node:fs';
import path from 'node:path';
import GampRSP from '../../../GampRSP.mjs';

const COMMENT_PREFIX = (ext) => {
    if (['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'].includes(ext)) {
        return '//';
    }
    if (ext === '.json') {
        return '//';
    }
    if (ext === '.py') {
        return '#';
    }
    return '#';
};

const extractFileImpacts = (dsPath, dsId) => {
    const content = fs.readFileSync(dsPath, 'utf8');
    const regex = /###\s+File:\s+(.+?)\n([\s\S]*?)(?=\n###\s+File:|\n##\s+|$)/g;
    const impacts = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
        const [, filePath, block] = match;
        const timestampMatch = block.match(/Timestamp:\s*(\d+)/i);
        const descriptionMatch = block.match(/#### Description([\s\S]*?)(?:####|$)/i);
        impacts.push({
            dsId,
            filePath: filePath.trim(),
            timestamp: timestampMatch ? Number(timestampMatch[1]) : Date.now(),
            description: descriptionMatch ? descriptionMatch[1].trim() : '',
        });
    }
    return impacts;
};

const ensureBanner = (targetPath, impact) => {
    const ext = path.extname(targetPath).toLowerCase();
    const prefix = COMMENT_PREFIX(ext);
    const banner = `${prefix} Managed by ${impact.dsId} (timestamp ${impact.timestamp})`;
    const existed = fs.existsSync(targetPath);
    if (existed) {
        const existing = fs.readFileSync(targetPath, 'utf8');
        if (existing.includes(banner)) {
            return 'skipped';
        }
    }
    const descriptionLine = impact.description.split('\n')[0] || 'Automated build stub.';
    const body = `${banner}\n${prefix} ${descriptionLine}\n`;
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, `${body}\n`);
    return existed ? 'updated' : 'created';
};

export async function action({ context }) {
    const workspaceRoot = context.workspaceRoot || process.cwd();
    GampRSP.configure(workspaceRoot);
    const dsDir = GampRSP.getDSDir();
    const entries = fs.readdirSync(dsDir)
        .filter((entry) => entry.toUpperCase().startsWith('DS-') && entry.endsWith('.md'));
    const manifest = {
        created: [],
        updated: [],
        skipped: [],
    };
    entries.forEach((entry) => {
        const dsId = entry.replace('.md', '');
        const dsPath = path.join(dsDir, entry);
        const impacts = extractFileImpacts(dsPath, dsId);
        impacts.forEach((impact) => {
            const absolute = path.join(workspaceRoot, impact.filePath);
            const outcome = ensureBanner(absolute, impact);
            manifest[outcome].push(impact.filePath);
        });
    });
    return {
        message: 'Build code completed.',
        manifest,
    };
}

export default action;
