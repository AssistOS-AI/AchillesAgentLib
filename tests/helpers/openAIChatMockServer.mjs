import http from 'node:http';
import { once } from 'node:events';

async function createOpenAIChatMockServer(responses = []) {
    const queuedResponses = responses.slice();
    const requests = [];
    const server = http.createServer(async (request, response) => {
        try {
            const chunks = [];
            for await (const chunk of request) {
                chunks.push(chunk);
            }
            const rawBody = Buffer.concat(chunks).toString('utf8');
            const body = rawBody ? JSON.parse(rawBody) : null;
            requests.push({
                method: request.method,
                url: request.url,
                headers: { ...request.headers },
                body,
            });

            if (!queuedResponses.length) {
                response.writeHead(500, { 'Content-Type': 'application/json' });
                response.end(JSON.stringify({ error: { message: 'No mock response queued.' } }));
                return;
            }

            const content = queuedResponses.shift();
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({
                id: `chatcmpl-mock-${requests.length}`,
                object: 'chat.completion',
                model: body?.model || 'mock-model',
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content,
                    },
                    finish_reason: 'stop',
                }],
                usage: {
                    prompt_tokens: 1,
                    completion_tokens: 1,
                    total_tokens: 2,
                },
            }));
        } catch (error) {
            response.writeHead(500, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: { message: error.message } }));
        }
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();

    return {
        baseURL: `http://127.0.0.1:${address.port}`,
        requests,
        close: async () => {
            server.close();
            await once(server, 'close');
        },
    };
}

export { createOpenAIChatMockServer };
