import { client as mcpClient, inMemory, mcp as mcpServer, zod as z } from '../../../../mcp-sdk/index.mjs';

function normaliseToolDefinition(definition = {}) {
    const {
        name,
        title = '',
        description = '',
        input = {},
        output = null,
        handler = async () => ({ content: [] }),
    } = definition;

    if (!name) {
        throw new Error('MiniMCP tool requires a name.');
    }

    const shape = {};
    for (const [key, schema] of Object.entries(input || {})) {
        if (schema && typeof schema === 'object' && typeof schema.parse === 'function') {
            shape[key] = schema;
        } else {
            shape[key] = z.string();
        }
    }

    return {
        name,
        title,
        description,
        inputSchema: shape,
        outputSchema: output,
        handler,
    };
}

export async function createMiniMCPServer({ tools = [] } = {}) {
    const [clientTransport, serverTransport] = inMemory.InMemoryTransport.createLinkedPair();

    const server = new mcpServer.McpServer({
        name: 'mini-mcp-server',
        version: '0.0.1',
    });

    const normalisedTools = tools.map(normaliseToolDefinition);
    for (const tool of normalisedTools) {
        server.registerTool(
            tool.name,
            {
                title: tool.title,
                description: tool.description,
                inputSchema: tool.inputSchema,
            },
            async ({ arguments: args = {} }) => {
                const result = await tool.handler(args);
                return {
                    content: Array.isArray(result?.content) ? result.content : [],
                };
            },
        );
    }

    await server.connect(serverTransport);
    await serverTransport.start();

    const client = new mcpClient.Client({
        name: 'mini-mcp-client',
        version: '0.0.1',
    });

    client.registerCapabilities({ tools: {} });
    await client.connect(clientTransport);
    await clientTransport.start();

    return {
        client,
        server,
        async shutdown() {
            await client.close();
            await server.close();
        },
    };
}
