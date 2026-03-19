import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.resolve(__dirname, '../../skills');

let tempDir = '';

const loadSkill = async (skillName) => {
    const skillPath = path.join(skillsDir, skillName, 'src/index.mjs');
    const module = await import(skillPath);
    return module.action;
};

const writeFile = async (filePath, content) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
};

const createMockLLMAgent = (responseText = 'ok') => ({
    executePrompt: async () => responseText,
});

before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'internal-skills-'));
});

after(async () => {
    if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('read skill: reads full file', async () => {
    const readAction = await loadSkill('read');
    const filePath = path.join(tempDir, 'read-full.txt');
    await writeFile(filePath, 'line1\nline2');

    const result = await readAction({ promptText: `file_path: ${filePath}` });
    assert.ok(result.includes('\tline1'));
    assert.ok(result.includes('\tline2'));
});

test('read skill: supports offset and limit', async () => {
    const readAction = await loadSkill('read');
    const filePath = path.join(tempDir, 'read-offset.txt');
    await writeFile(filePath, 'a\nb\nc\nd');

    const result = await readAction({ promptText: `file_path: ${filePath}\noffset: 2\nlimit: 2` });
    assert.ok(result.includes('     2\tb'));
    assert.ok(result.includes('     3\tc'));
    assert.ok(!result.includes('\ta'));
});

test('read skill: returns base64 for binary', async () => {
    const readAction = await loadSkill('read');
    const filePath = path.join(tempDir, 'read-bin.bin');
    const buffer = Buffer.from([0, 1, 2, 3]);
    await writeFile(filePath, buffer);

    const result = await readAction({ promptText: `file_path: ${filePath}` });
    assert.equal(result, buffer.toString('base64'));
});

test('write skill: creates file', async () => {
    const writeAction = await loadSkill('write');
    const filePath = path.join(tempDir, 'write-create.txt');
    const content = 'hello';

    await writeAction({ promptText: `file_path: ${filePath}\ncontent: ${content}` });
    const saved = await fs.readFile(filePath, 'utf8');
    assert.equal(saved, content);
});

test('write skill: overwrites file', async () => {
    const writeAction = await loadSkill('write');
    const filePath = path.join(tempDir, 'write-overwrite.txt');
    await writeFile(filePath, 'first');

    await writeAction({ promptText: `file_path: ${filePath}\ncontent: second` });
    const saved = await fs.readFile(filePath, 'utf8');
    assert.equal(saved, 'second');
});

test('write skill: writes JSON payload', async () => {
    const writeAction = await loadSkill('write');
    const filePath = path.join(tempDir, 'write-json.json');
    const content = '{"a":1}';

    await writeAction({ promptText: `file_path: ${filePath}\ncontent: ${content}` });
    const saved = await fs.readFile(filePath, 'utf8');
    assert.equal(saved, content);
});

test('edit skill: replaces single occurrence', async () => {
    const editAction = await loadSkill('edit');
    const filePath = path.join(tempDir, 'edit-single.txt');
    await writeFile(filePath, 'foo bar');

    await editAction({ promptText: `file_path: ${filePath}\nold_string: foo\nnew_string: baz` });
    const saved = await fs.readFile(filePath, 'utf8');
    assert.equal(saved, 'baz bar');
});

test('edit skill: replaces all occurrences', async () => {
    const editAction = await loadSkill('edit');
    const filePath = path.join(tempDir, 'edit-all.txt');
    await writeFile(filePath, 'x x x');

    await editAction({ promptText: `file_path: ${filePath}\nold_string: x\nnew_string: y\nreplace_all: true` });
    const saved = await fs.readFile(filePath, 'utf8');
    assert.equal(saved, 'y y y');
});

test('edit skill: errors on missing string', async () => {
    const editAction = await loadSkill('edit');
    const filePath = path.join(tempDir, 'edit-missing.txt');
    await writeFile(filePath, 'hello');

    await assert.rejects(
        () => editAction({ promptText: `file_path: ${filePath}\nold_string: nope\nnew_string: ok` }),
        /old_string not found/
    );
});

test('glob skill: matches direct files', async () => {
    const globAction = await loadSkill('glob');
    const fileA = path.join(tempDir, 'glob-a.txt');
    const fileB = path.join(tempDir, 'glob-b.md');
    await writeFile(fileA, 'a');
    await writeFile(fileB, 'b');

    const result = await globAction({ promptText: `pattern: *.txt\npath: ${tempDir}` });
    const files = JSON.parse(result);
    assert.ok(files.includes(fileA));
    assert.ok(!files.includes(fileB));
});

test('glob skill: matches nested files', async () => {
    const globAction = await loadSkill('glob');
    const nested = path.join(tempDir, 'nested', 'file.js');
    await writeFile(nested, 'console.log(1);');

    const result = await globAction({ promptText: `pattern: **/*.js\npath: ${tempDir}` });
    const files = JSON.parse(result);
    assert.ok(files.includes(nested));
});

test('glob skill: supports brace patterns', async () => {
    const globAction = await loadSkill('glob');
    const fileA = path.join(tempDir, 'glob-a.md');
    const fileB = path.join(tempDir, 'glob-b.txt');
    await writeFile(fileA, 'a');
    await writeFile(fileB, 'b');

    const result = await globAction({ promptText: `pattern: *.{md,txt}\npath: ${tempDir}` });
    const files = JSON.parse(result);
    assert.ok(files.includes(fileA));
    assert.ok(files.includes(fileB));
});

test('grep skill: files_with_matches', async () => {
    const grepAction = await loadSkill('grep');
    const filePath = path.join(tempDir, 'grep-file.txt');
    await writeFile(filePath, 'TODO: test');

    const result = await grepAction({ promptText: `pattern: TODO\npath: ${tempDir}\noutput_mode: files_with_matches` });
    assert.ok(result.includes(filePath));
});

test('grep skill: content with line numbers', async () => {
    const grepAction = await loadSkill('grep');
    const filePath = path.join(tempDir, 'grep-lines.txt');
    await writeFile(filePath, 'alpha\nbeta');

    const result = await grepAction({ promptText: `pattern: beta\npath: ${tempDir}\noutput_mode: content\n-n: true` });
    assert.ok(result.includes('2:beta'));
});

test('grep skill: no matches returns empty', async () => {
    const grepAction = await loadSkill('grep');
    const filePath = path.join(tempDir, 'grep-none.txt');
    await writeFile(filePath, 'alpha');

    const result = await grepAction({ promptText: `pattern: missing\npath: ${tempDir}\noutput_mode: files_with_matches` });
    assert.equal(result, '');
});

test('bash skill: runs command', async () => {
    const bashAction = await loadSkill('bash');
    const result = await bashAction({ promptText: 'command: printf "ok"' });
    assert.equal(result, 'ok');
});

test('bash skill: captures stderr', async () => {
    const bashAction = await loadSkill('bash');
    const result = await bashAction({ promptText: 'command: printf "err" 1>&2' });
    assert.ok(result.includes('[stderr]'));
    assert.ok(result.includes('err'));
});

test('bash skill: includes exit code', async () => {
    const bashAction = await loadSkill('bash');
    const result = await bashAction({ promptText: 'command: exit 2' });
    assert.ok(result.includes('[exitCode] 2'));
});

test('webfetch skill: strips HTML', async () => {
    const webfetchAction = await loadSkill('webfetch');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
        headers: { get: () => 'text/html' },
        text: async () => '<html><body><h1>Hello</h1><p>World</p></body></html>',
    });
    try {
        const llmAgent = createMockLLMAgent('Hello World');
        const result = await webfetchAction({
            promptText: 'url: https://example.com\nprompt: summarize',
            llmAgent,
        });
        assert.ok(result.includes('Hello'));
        assert.ok(result.includes('World'));
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('webfetch skill: returns plain text', async () => {
    const webfetchAction = await loadSkill('webfetch');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
        headers: { get: () => 'text/plain' },
        text: async () => 'plain text',
    });
    try {
        const llmAgent = createMockLLMAgent('Hello World');

        const result = await webfetchAction({
            promptText: 'url: https://example.com\nprompt: summarize',
            llmAgent });
        assert.equal(result, 'Hello World');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('webfetch skill: errors without prompt', async () => {
    const webfetchAction = await loadSkill('webfetch');
    await assert.rejects(
        () => webfetchAction({ promptText: 'url: https://example.com' }),
        /prompt/
    );
});
