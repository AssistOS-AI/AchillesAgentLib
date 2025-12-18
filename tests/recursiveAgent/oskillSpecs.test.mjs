import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { RecursiveSkilledAgent } from '../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';

const INDEX_MJS_CONTENT = `import { DiskManager } from './DiskManager.js';

export async function action(context) {
    const { prompt } = context;
    const manager = new DiskManager();
    const [command, ...args] = prompt.split(' ');

    try {
        switch (command) {
            case 'createFile':
                return await manager.createFile(args[0], args.slice(1).join(' '));
            case 'deleteFile':
                return await manager.deleteFile(args[0]);
            case 'createDir':
                return await manager.createDir(args[0]);
            case 'deleteDir':
                return await manager.deleteDir(args[0]);
            default:
                return { status: 'error', message: 'Unknown command: ' + command };
        }
    } catch (e) {
        return { status: 'error', message: e.message };
    }
}`;

const DISKMANAGER_JS_CONTENT = `import fs from 'node:fs/promises';
import path from 'node:path';

export class DiskManager {
    async createFile(filePath, content) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content || '');
        return { status: 'success', operation: 'createFile', path: filePath };
    }

    async deleteFile(filePath) {
        await fs.unlink(filePath);
        return { status: 'success', operation: 'deleteFile', path: filePath };
    }

    async createDir(dirPath) {
        await fs.mkdir(dirPath, { recursive: true });
        return { status: 'success', operation: 'createDir', path: dirPath };
    }

    async deleteDir(dirPath) {
        await fs.rm(dirPath, { recursive: true, force: true });
        return { status: 'success', operation: 'deleteDir', path: dirPath };
    }
}`;

class StubLLMAgent extends LLMAgent {
    constructor() {
        super({});
    }

    executePrompt(prompt, options = {}) {
        const context = options.context || {};
        if (context.intent === 'generate-multi-file-code-from-specs' && context.skillName === undefined) {
            const multiFileResponse =
                '## file-path: index.mjs\n\n' + '```javascript\n' +
                INDEX_MJS_CONTENT + '\n' + '```\n\n' +
                '## file-path: DiskManager.js\n\n' + '```javascript\n' +
                DISKMANAGER_JS_CONTENT + '\n' + '```';
            return multiFileResponse;
        }
        // This will be logged by the generateCode function if it fails
        throw new Error(`StubLLMAgent received unhandled request for intent \"${context.intent}\" and skill \"${context.skillName}\".`);
    }
    complete() { return ''; }
}

const FIXTURE_ROOT = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'oskillSpecsFixtures',
);

test('oskill with specs folder prioritizes generated code', async (t) => {
    const testDir = path.join(FIXTURE_ROOT, 'test-temp-dir');
    const skillSrcDir = path.join(FIXTURE_ROOT, '.AchillesSkills', 'disk-manager', 'src');

    // Cleanup function to run after the test
    t.after(async () => {
        await fs.rm(testDir, { recursive: true, force: true });
        await fs.rm(skillSrcDir, { recursive: true, force: true });
    });

    await fs.rm(testDir, { recursive: true, force: true });
    await fs.mkdir(testDir, { recursive: true });

    const agent = new RecursiveSkilledAgent({
        llmAgent: new StubLLMAgent(),
        additionalSkillRoots: [FIXTURE_ROOT],
    });
    
    // The agent's constructor is synchronous, but preparations (like code-gen) are async.
    // We need to wait for them to complete.
    await Promise.all(agent.pendingPreparations);

    await t.test('it creates a file', async () => {
        const filePath = path.join(testDir, 'test.txt');
        const response = await agent.executePrompt(`createFile ${filePath} hello-world`, { skillName: 'disk-manager' });
        
        assert.deepStrictEqual(response.result.output, { status: 'success', operation: 'createFile', path: filePath });
        
        const content = await fs.readFile(filePath, 'utf-8');
        assert.strictEqual(content, 'hello-world');
    });

    await t.test('it creates a directory', async () => {
        const newDirPath = path.join(testDir, 'new-dir');
        const response = await agent.executePrompt(`createDir ${newDirPath}`, { skillName: 'disk-manager' });

        assert.deepStrictEqual(response.result.output, { status: 'success', operation: 'createDir', path: newDirPath });

        const stats = await fs.stat(newDirPath);
        assert.ok(stats.isDirectory());
    });

    await t.test('it deletes a file', async () => {
        const filePath = path.join(testDir, 'test.txt');
        const response = await agent.executePrompt(`deleteFile ${filePath}`, { skillName: 'disk-manager' });

        assert.deepStrictEqual(response.result.output, { status: 'success', operation: 'deleteFile', path: filePath });

        await assert.rejects(
            fs.access(filePath),
            { code: 'ENOENT' },
            'File should not exist after deletion'
        );
    });

    await t.test('it deletes a directory', async () => {
        const newDirPath = path.join(testDir, 'new-dir');
        const response = await agent.executePrompt(`deleteDir ${newDirPath}`, { skillName: 'disk-manager' });

        assert.deepStrictEqual(response.result.output, { status: 'success', operation: 'deleteDir', path: newDirPath });

        await assert.rejects(
            fs.access(newDirPath),
            { code: 'ENOENT' },
            'Directory should not exist after deletion'
        );
    });
});