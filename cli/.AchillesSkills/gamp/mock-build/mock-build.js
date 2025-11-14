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

const buildCliMock = (mockDir, specsText) => {
    const target = path.join(mockDir, 'mock-cli.js');
    const content = `#!/usr/bin/env node
const report = ${JSON.stringify(specsText)};
console.log('=== Specification Snapshot ===');
console.log(report);
`;
    fs.writeFileSync(target, content);
    fs.chmodSync(target, 0o755);
    return target;
};

const buildHtmlMock = (mockDir, specsText) => {
    const target = path.join(mockDir, 'index.html');
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Specification Mock</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 2rem; }
    pre { background: #f4f4f4; padding: 1rem; white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>Specification Mock</h1>
  <pre>${specsText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
</body>
</html>`;
    fs.writeFileSync(target, html);
    return target;
};

export async function action({ context }) {
    const workspaceRoot = context.workspaceRoot || process.cwd();
    GampRSP.configure(workspaceRoot);
    const specs = GampRSP.loadSpecs('');
    const mockDir = GampRSP.getMockDir();
    const pkg = readPackageJson(workspaceRoot);
    const type = detectMockType(pkg);
    const output = type === 'web'
        ? buildHtmlMock(mockDir, specs)
        : buildCliMock(mockDir, specs);
    return {
        message: 'Mock build completed.',
        type,
        output,
    };
}

export default action;
