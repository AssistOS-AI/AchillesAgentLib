import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { PloinkyAgentSkillsSubsystem } from '../../PloinkyAgentSkillsSubsystem/PloinkyAgentSkillsSubsystem.mjs';

describe('PloinkyAgentSkillsSubsystem', () => {
    let subsystem;

    beforeEach(() => {
        subsystem = new PloinkyAgentSkillsSubsystem({
            modelConfig: { plan: 'plan', code: 'code' },
        });
    });

    describe('type', () => {
        it('reports type as ploinky', () => {
            assert.strictEqual(subsystem.type, 'ploinky');
        });
    });

    describe('fetchAgentCards', () => {
        let server;
        let serverUrl;

        beforeEach(async () => {
            server = http.createServer((req, res) => {
                if (req.url === '/agent-card') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        agents: [
                            { name: 'agent1', payload: { capabilities: { tags: ['fast'], summary: 'Fast agent' } } },
                            { name: 'agent2', payload: { capabilities: { tags: ['deep'], summary: 'Deep agent' } } },
                        ],
                    }));
                } else if (req.url === '/agent-card/agent1') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        agent: 'agent1',
                        capabilities: { tags: ['fast'], summary: 'Fast agent' },
                    }));
                } else {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'not found' }));
                }
            });

            await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
            const address = server.address();
            serverUrl = `http://127.0.0.1:${address.port}`;
        });

        afterEach(async () => {
            server.close();
        });

        it('fetches all agent cards from /agent-card', async () => {
            const result = await subsystem.fetchAgentCards({ routerUrl: serverUrl });

            assert.ok(Array.isArray(result.agents));
            assert.strictEqual(result.agents.length, 2);
            assert.strictEqual(result.agents[0].name, 'agent1');
        });

        it('fetches a specific agent card from /agent-card/<name>', async () => {
            const result = await subsystem.fetchAgentCards({
                agentName: 'agent1',
                routerUrl: serverUrl,
            });

            assert.strictEqual(result.agent, 'agent1');
            assert.deepStrictEqual(result.capabilities.tags, ['fast']);
        });
    });

    describe('buildAgentAsTools', () => {
        let server;
        let serverUrl;
        let receivedRequests;

        beforeEach(async () => {
            receivedRequests = [];
            server = http.createServer((req, res) => {
                const chunks = [];
                req.on('data', c => chunks.push(c));
                req.on('end', () => {
                    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
                    receivedRequests.push({ url: req.url, body });

                    if (req.url === '/v1/chat/completions/agent1') {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            choices: [{ message: { content: 'Hello from agent1' } }],
                        }));
                    } else if (req.url === '/v1/chat/completions/agent2') {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            choices: [{ message: { content: 'Hello from agent2' } }],
                        }));
                    } else if (req.url === '/agent-card') {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            agents: [
                                { name: 'agent1', payload: { capabilities: { summary: 'Fast agent', tags: ['fast'] } } },
                                { name: 'agent2', payload: { capabilities: { summary: 'Deep agent', tags: ['deep'] } } },
                            ],
                        }));
                    } else {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'not found' }));
                    }
                });
            });

            await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
            const address = server.address();
            serverUrl = `http://127.0.0.1:${address.port}`;
        });

        afterEach(async () => {
            server.close();
        });

        it('creates tools for each agent name', () => {
            const agentCards = {
                agents: [
                    { name: 'agent1', payload: { capabilities: { summary: 'Fast agent' } } },
                    { name: 'agent2', payload: { capabilities: { summary: 'Deep agent' } } },
                ],
            };
            const tools = subsystem.buildAgentAsTools(['agent1', 'agent2'], agentCards);

            assert.ok(tools['agent1']);
            assert.ok(tools['agent2']);
            assert.ok(typeof tools['agent1'].handler === 'function');
            assert.ok(typeof tools['agent2'].handler === 'function');
        });

        it('uses agent-card summary as tool description', () => {
            const agentCards = {
                agents: [
                    { name: 'agent1', payload: { capabilities: { summary: 'Fast agent', tags: ['fast'] } } },
                ],
            };
            const tools = subsystem.buildAgentAsTools(['agent1'], agentCards);

            assert.ok(tools['agent1'].description.includes('Fast agent'));
            assert.ok(tools['agent1'].description.includes('fast'));
        });

        it('falls back to agent name when no card data', () => {
            const tools = subsystem.buildAgentAsTools(['unknown-agent'], { agents: [] });

            assert.strictEqual(tools['unknown-agent'].description, 'Agent: unknown-agent');
        });

        it('handler sends chat completions and returns text', async () => {
            const agentCards = {
                agents: [
                    { name: 'agent1', payload: { capabilities: { summary: 'Fast agent' } } },
                ],
            };
            const tools = subsystem.buildAgentAsTools(['agent1'], agentCards, {
                routerUrl: serverUrl,
            });

            const result = await tools['agent1'].handler(null, 'test prompt');

            assert.strictEqual(result, 'Hello from agent1');
            assert.strictEqual(receivedRequests.length, 1);
            assert.strictEqual(receivedRequests[0].url, '/v1/chat/completions/agent1');
            assert.deepStrictEqual(receivedRequests[0].body.messages, [
                { role: 'user', content: 'test prompt' },
            ]);
        });

        it('handler handles non-string prompt', async () => {
            const agentCards = {
                agents: [
                    { name: 'agent1', payload: { capabilities: { summary: 'Fast agent' } } },
                ],
            };
            const tools = subsystem.buildAgentAsTools(['agent1'], agentCards, {
                routerUrl: serverUrl,
            });

            const result = await tools['agent1'].handler(null, null);

            assert.strictEqual(result, 'Hello from agent1');
            assert.deepStrictEqual(receivedRequests[0].body.messages, [
                { role: 'user', content: '' },
            ]);
        });

        it('handler handles unexpected response shape', async () => {
            const agentCards = {
                agents: [
                    { name: 'agent1', payload: { capabilities: { summary: 'Fast agent' } } },
                ],
            };
            const tools = subsystem.buildAgentAsTools(['agent1'], agentCards, {
                routerUrl: serverUrl,
            });

            const result = await tools['agent1'].handler(null, 'test');

            assert.ok(typeof result === 'string');
        });
    });

    describe('_extractTextFromCompletion', () => {
        it('returns string input directly', () => {
            assert.strictEqual(subsystem._extractTextFromCompletion('hello'), 'hello');
        });

        it('returns empty string for null', () => {
            assert.strictEqual(subsystem._extractTextFromCompletion(null), '');
        });

        it('extracts content from OpenAI choices', () => {
            const response = {
                choices: [{ message: { content: 'test response' } }],
            };
            assert.strictEqual(subsystem._extractTextFromCompletion(response), 'test response');
        });

        it('stringifies non-standard response', () => {
            const response = { result: 'ok' };
            assert.strictEqual(subsystem._extractTextFromCompletion(response), '{"result":"ok"}');
        });
    });
});
