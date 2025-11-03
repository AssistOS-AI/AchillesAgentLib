import test from 'node:test';
import assert from 'node:assert/strict';

import LightSOPLangInterpreter from '../../lightSOPLang/index.mjs';

test('LightSOPLang detects cycles in dependency graph', async () => {
    const code = [
        '@a echo $b',
        '@b echo $a',
    ].join('\n');

    const interpreter = new LightSOPLangInterpreter(code, {
        executeCommand: async () => null,
        listCommands: () => [{ name: 'echo', description: 'Echo argument' }],
    });

    await assert.rejects(interpreter.ready, /Cycle detected/);
});

test('LightSOPLang rejects dependencies on unknown variables', async () => {
    const code = '@a echo $missing';

    const interpreter = new LightSOPLangInterpreter(code, {
        executeCommand: async () => null,
        listCommands: () => [{ name: 'echo', description: 'Echo argument' }],
    });

    await assert.rejects(interpreter.ready, /depends on undefined variable missing/);
});
