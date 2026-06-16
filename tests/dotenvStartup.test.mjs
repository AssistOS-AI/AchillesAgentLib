import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const loaderURL = pathToFileURL(
    path.resolve(__dirname, '../utils/LLMProviders/providers/modelsConfigLoader.mjs')
).href;

test('auto-loads the nearest parent .env from the CLI --dir target before model config initializes', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-dotenv-start-'));
    try {
        const launchCwd = path.join(tempRoot, 'launch-cwd');
        const workspaceRoot = path.join(tempRoot, 'workspace');
        const selectedDir = path.join(workspaceRoot, 'nested', 'project');
        fs.mkdirSync(launchCwd, { recursive: true });
        fs.mkdirSync(selectedDir, { recursive: true });
        fs.writeFileSync(path.join(workspaceRoot, '.env'), [
            'SOUL_GATEWAY_API_KEY=sk-parent-soul-key',
            '',
        ].join('\n'));

        const probePath = path.join(tempRoot, 'probe.mjs');
        fs.writeFileSync(probePath, [
            "global.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });",
            `const { loadModelsConfiguration } = await import(${JSON.stringify(loaderURL)});`,
            'const config = await loadModelsConfiguration();',
            "const provider = config.providers.get('soul_gateway');",
            'console.log(JSON.stringify({',
            '  soulKey: process.env.SOUL_GATEWAY_API_KEY,',
            '  soulSource: process.env.PLOINKY_ENV_SOURCE_SOUL_GATEWAY_API_KEY || null,',
            '  providerApiKeyEnv: provider?.apiKeyEnv || null,',
            '  providerBaseURL: provider?.baseURL || null,',
            '}));',
        ].join('\n'));

        const result = spawnSync(process.execPath, [probePath, '--dir', selectedDir], {
            cwd: launchCwd,
            encoding: 'utf8',
            env: {
                PATH: process.env.PATH,
                HOME: process.env.HOME,
                PLOINKY_AGENT_API_KEY: 'generated-local-key',
                SOUL_GATEWAY_API_KEY: 'generated-local-key',
                PLOINKY_ENV_SOURCE_PLOINKY_AGENT_API_KEY: 'generated',
                PLOINKY_ENV_SOURCE_SOUL_GATEWAY_API_KEY: 'generated',
                PLOINKY_ROUTER_URL: 'http://127.0.0.1:8088',
            },
        });

        assert.strictEqual(result.status, 0, result.stderr || result.stdout);
        const line = result.stdout.trim().split(/\r?\n/).at(-1);
        const observed = JSON.parse(line);
        assert.strictEqual(observed.soulKey, 'sk-parent-soul-key');
        assert.strictEqual(observed.soulSource, 'explicit');
        assert.strictEqual(observed.providerApiKeyEnv, 'SOUL_GATEWAY_API_KEY');
        assert.strictEqual(observed.providerBaseURL, 'https://soul.axiologic.dev/v1/chat/completions');
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});
