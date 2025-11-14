import fs from 'node:fs';
import path from 'node:path';
import GampRSP from '../../../GampRSP.mjs';

const readPackageJson = (root) => {
    const target = path.join(root, 'package.json');
    if (!fs.existsSync(target)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch {
        return null;
    }
};

const detectMockType = (pkg) => {
    if (!pkg) {
        return 'cli';
    }
    const deps = Object.keys({
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
    }).map((name) => name.toLowerCase());
    if (deps.some((name) => ['react', 'next', 'vite', 'astro'].includes(name))) {
        return 'web';
    }
    return 'cli';
};

const extractRequirements = (docName) => {
    const content = GampRSP.readDocument(docName);
    const regex = /^##\s+((?:FS|NFS)-\d+)\s+–\s+(.*?)\n([\s\S]*?)(?=^##\s+|$)/gm;
    const entries = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
        const [, id, title, body] = match;
        const descriptionMatch = body.match(/### Description\s+([\s\S]*?)(?=\n### |\n## |$)/);
        const description = descriptionMatch
            ? descriptionMatch[1].trim()
            : body.trim().split('\n').slice(0, 4).join(' ').trim();
        entries.push({
            id,
            title: title.trim(),
            source: docName.replace('.md', ''),
            description: description || 'Description pending.',
            mockResponse: `Simulated response for ${id}: ${description.slice(0, 160) || 'No details available.'}`,
        });
    }
    return entries;
};

const collectRequirementSummaries = () => [
    ...extractRequirements('FS.md'),
    ...extractRequirements('NFS.md'),
];

const buildCliMock = (mockDir, requirements) => {
    const target = path.join(mockDir, 'mock-cli.js');
    const content = `#!/usr/bin/env node
const requirements = ${JSON.stringify(requirements, null, 2)};

const args = process.argv.slice(2);
const getArg = (flag) => {
    const name = flag.replace(/^-+/, '');
    const exactIndex = args.indexOf(flag);
    if (exactIndex !== -1) {
        return args[exactIndex + 1];
    }
    const prefixed = args.find((token) => token.startsWith(\`--\${name}=\`));
    if (prefixed) {
        return prefixed.split('=').slice(1).join('=');
    }
    return null;
};

const reqId = (getArg('--req') || getArg('--requirement') || '').toUpperCase();
const scenario = getArg('--input') || 'default scenario';

const listRequirements = () => {
    console.log('Available mock requirements:');
    requirements.forEach((entry) => {
        console.log(\` - \${entry.id} (\${entry.source}): \${entry.title}\`);
    });
    console.log('\\nUsage: node mock-cli.js --req FS-001 --input \"preview data\"');
};

if (!reqId) {
    listRequirements();
    process.exit(0);
}

const match = requirements.find((entry) => entry.id.toUpperCase() === reqId);
if (!match) {
    console.error(\`Requirement \${reqId} not found.\\n\`);
    listRequirements();
    process.exit(1);
}

console.log(\`[mock] \${match.id} – \${match.title}\`);
console.log(\`Scenario: \${scenario}\`);
console.log(\`Summary: \${match.description}\`);
console.log(\`Mock response: \${match.mockResponse}\`);
`;
    fs.writeFileSync(target, content);
    fs.chmodSync(target, 0o755);
    return target;
};

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const buildHtmlMock = (mockDir, requirements) => {
    const target = path.join(mockDir, 'index.html');
    const cards = requirements.map((entry) => `<details>
    <summary><strong>${entry.id}</strong> – ${escapeHtml(entry.title)} (${entry.source})</summary>
    <p>${escapeHtml(entry.description)}</p>
    <p><em>Mock response:</em> ${escapeHtml(entry.mockResponse)}</p>
</details>`).join('\n');
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Specification Mock</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 2rem; line-height: 1.5; }
    details { border: 1px solid #ddd; padding: 1rem; margin-bottom: 1rem; border-radius: 8px; }
    summary { cursor: pointer; font-size: 1.05rem; }
  </style>
</head>
<body>
  <h1>Specification Mock Preview</h1>
  <p>Select a requirement to view its description and mocked response.</p>
  ${cards}
</body>
</html>`;
    fs.writeFileSync(target, html);
    return target;
};

export async function action({ context }) {
    const workspaceRoot = context.workspaceRoot || process.cwd();
    GampRSP.configure(workspaceRoot);
    const mockDir = GampRSP.getMockDir();
    const requirements = collectRequirementSummaries();
    const pkg = readPackageJson(workspaceRoot);
    const type = detectMockType(pkg);
    const output = type === 'web'
        ? buildHtmlMock(mockDir, requirements)
        : buildCliMock(mockDir, requirements);
    return {
        message: 'Mock build completed.',
        type,
        output,
        requirements: requirements.length,
    };
}

export default action;
