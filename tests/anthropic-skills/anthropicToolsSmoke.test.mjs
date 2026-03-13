import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { buildAnthropicTools } from '../../AnthropicSkillsSubsystem/buildTools.mjs';

let tempDir = '';

const createTools = ({ executePrompt, internalSkills = [] } = {}) => {
    const recursiveAgent = {
        executePrompt: executePrompt || (async () => ({ result: 'ok' })),
    };
    return buildAnthropicTools({
        skillRecord: { skillDir: tempDir },
        recursiveAgent,
        options: { context: {} },
        sessionMemory: new Map(),
        internalSkills,
    });
};

const writeFile = async (filePath, content) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
};

before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anthropic-tools-'));
});

after(async () => {
    if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('read tool: reads full file', async () => {
    const tools = createTools();
    const filePath = path.join(tempDir, 'read-full.txt');
    await writeFile(filePath, 'line1\nline2');

    const result = await tools.read.handler(null, `file_path: ${filePath}`);
    assert.ok(result.includes('\tline1'));
    assert.ok(result.includes('\tline2'));
});

test('read tool: supports offset and limit', async () => {
    const tools = createTools();
    const filePath = path.join(tempDir, 'read-offset.txt');
    await writeFile(filePath, 'a\nb\nc\nd');

    const result = await tools.read.handler(null, `file_path: ${filePath}\noffset: 2\nlimit: 2`);
    assert.ok(result.includes('     2\tb'));
    assert.ok(result.includes('     3\tc'));
    assert.ok(!result.includes('\ta'));
});

test('read tool: returns base64 for binary', async () => {
    const tools = createTools();
    const filePath = path.join(tempDir, 'read-bin.bin');
    const buffer = Buffer.from([0, 1, 2, 3]);
    await writeFile(filePath, buffer);

    const result = await tools.read.handler(null, `file_path: ${filePath}`);
    assert.equal(result, buffer.toString('base64'));
});

test('write tool: creates file', async () => {
    const tools = createTools();
    const filePath = path.join(tempDir, 'write-create.txt');
    const content = 'hello';

    await tools.write.handler(null, `file_path: ${filePath}\ncontent: ${content}`);
    const saved = await fs.readFile(filePath, 'utf8');
    assert.equal(saved, content);
});

test('write tool: overwrites file', async () => {
    const tools = createTools();
    const filePath = path.join(tempDir, 'write-overwrite.txt');
    await writeFile(filePath, 'first');

    await tools.write.handler(null, `file_path: ${filePath}\ncontent: second`);
    const saved = await fs.readFile(filePath, 'utf8');
    assert.equal(saved, 'second');
});

test('write tool: writes JSON payload', async () => {
    const tools = createTools();
    const filePath = path.join(tempDir, 'write-json.json');
    const content = '{"a":1}';

    await tools.write.handler(null, `file_path: ${filePath}\ncontent: ${content}`);
    const saved = await fs.readFile(filePath, 'utf8');
    assert.equal(saved, content);
});

test('edit tool: replaces single occurrence', async () => {
    const tools = createTools();
    const filePath = path.join(tempDir, 'edit-single.txt');
    await writeFile(filePath, 'foo bar');

    await tools.edit.handler(null, `file_path: ${filePath}\nold_string: foo\nnew_string: baz`);
    const saved = await fs.readFile(filePath, 'utf8');
    assert.equal(saved, 'baz bar');
});

test('edit tool: replaces all occurrences', async () => {
    const tools = createTools();
    const filePath = path.join(tempDir, 'edit-all.txt');
    await writeFile(filePath, 'x x x');

    await tools.edit.handler(null, `file_path: ${filePath}\nold_string: x\nnew_string: y\nreplace_all: true`);
    const saved = await fs.readFile(filePath, 'utf8');
    assert.equal(saved, 'y y y');
});

test('edit tool: errors on missing string', async () => {
    const tools = createTools();
    const filePath = path.join(tempDir, 'edit-missing.txt');
    await writeFile(filePath, 'hello');

    await assert.rejects(
        () => tools.edit.handler(null, `file_path: ${filePath}\nold_string: nope\nnew_string: ok`),
        /old_string not found/
    );
});

test('glob tool: matches direct files', async () => {
    const tools = createTools();
    const fileA = path.join(tempDir, 'glob-a.txt');
    const fileB = path.join(tempDir, 'glob-b.md');
    await writeFile(fileA, 'a');
    await writeFile(fileB, 'b');

    const result = await tools.glob.handler(null, `pattern: *.txt\npath: ${tempDir}`);
    const files = JSON.parse(result);
    assert.ok(files.includes(fileA));
    assert.ok(!files.includes(fileB));
});

test('glob tool: matches nested files', async () => {
    const tools = createTools();
    const nested = path.join(tempDir, 'nested', 'file.js');
    await writeFile(nested, 'console.log(1);');

    const result = await tools.glob.handler(null, `pattern: **/*.js\npath: ${tempDir}`);
    const files = JSON.parse(result);
    assert.ok(files.includes(nested));
});

test('glob tool: supports brace patterns', async () => {
    const tools = createTools();
    const fileA = path.join(tempDir, 'glob-a.md');
    const fileB = path.join(tempDir, 'glob-b.txt');
    await writeFile(fileA, 'a');
    await writeFile(fileB, 'b');

    const result = await tools.glob.handler(null, `pattern: *.{md,txt}\npath: ${tempDir}`);
    const files = JSON.parse(result);
    assert.ok(files.includes(fileA));
    assert.ok(files.includes(fileB));
});

test('grep tool: files_with_matches', async () => {
    const tools = createTools();
    const filePath = path.join(tempDir, 'grep-file.txt');
    await writeFile(filePath, 'TODO: test');

    const result = await tools.grep.handler(null, `pattern: TODO\npath: ${tempDir}\noutput_mode: files_with_matches`);
    assert.ok(result.includes(filePath));
});

test('grep tool: content with line numbers', async () => {
    const tools = createTools();
    const filePath = path.join(tempDir, 'grep-lines.txt');
    await writeFile(filePath, 'alpha\nbeta');

    const result = await tools.grep.handler(null, `pattern: beta\npath: ${tempDir}\noutput_mode: content\n-n: true`);
    assert.ok(result.includes('2:beta'));
});

test('grep tool: no matches returns empty', async () => {
    const tools = createTools();
    const filePath = path.join(tempDir, 'grep-none.txt');
    await writeFile(filePath, 'alpha');

    const result = await tools.grep.handler(null, `pattern: missing\npath: ${tempDir}\noutput_mode: files_with_matches`);
    assert.equal(result, '');
});

test('bash tool: runs command', async () => {
    const tools = createTools();
    const result = await tools.bash.handler(null, 'command: printf "ok"');
    assert.equal(result, 'ok');
});

test('bash tool: captures stderr', async () => {
    const tools = createTools();
    const result = await tools.bash.handler(null, 'command: printf "err" 1>&2');
    assert.ok(result.includes('[stderr]'));
    assert.ok(result.includes('err'));
});

test('bash tool: includes exit code', async () => {
    const tools = createTools();
    const result = await tools.bash.handler(null, 'command: exit 2');
    assert.ok(result.includes('[exitCode] 2'));
});

test('webfetch tool: strips HTML', async () => {
    const tools = createTools();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
        headers: { get: () => 'text/html' },
        text: async () => '<html><body><h1>Hello</h1><p>World</p></body></html>',
    });
    try {
        const result = await tools.webfetch.handler(null, 'url: https://example.com\nprompt: summarize');
        assert.ok(result.includes('Hello'));
        assert.ok(result.includes('World'));
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('webfetch tool: returns plain text', async () => {
    const tools = createTools();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
        headers: { get: () => 'text/plain' },
        text: async () => 'plain text',
    });
    try {
        const result = await tools.webfetch.handler(null, 'url: https://example.com\nprompt: summarize');
        assert.equal(result, 'plain text');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('webfetch tool: errors without prompt', async () => {
    const tools = createTools();
    await assert.rejects(
        () => tools.webfetch.handler(null, 'url: https://example.com'),
        /prompt/
    );
});

test('ask-user tool: description uses descriptor', async () => {
    const internalSkills = [
        { name: 'ask-user', shortName: 'ask-user', descriptor: { rawContent: 'Ask the user for info.' } },
    ];
    const tools = createTools({ internalSkills });
    assert.ok(tools['ask-user'].description.includes('Ask the user for info.'));
    assert.ok(tools['ask-user'].description.includes('How to call:'));
});

test('ask-user tool: returns string result', async () => {
    const internalSkills = [
        { name: 'ask-user', shortName: 'ask-user', descriptor: { rawContent: 'Ask the user for info.' } },
    ];
    const tools = createTools({
        internalSkills,
        executePrompt: async () => ({ result: 'answer' }),
    });
    const result = await tools['ask-user'].handler(null, 'Question?');
    assert.equal(result, 'answer');
});

test('ask-user tool: returns object result', async () => {
    const internalSkills = [
        { name: 'ask-user', shortName: 'ask-user', descriptor: { rawContent: 'Ask the user for info.' } },
    ];
    const tools = createTools({
        internalSkills,
        executePrompt: async () => ({ result: { ok: true } }),
    });
    const result = await tools['ask-user'].handler(null, 'Question?');
    assert.deepEqual(result, { ok: true });
});
