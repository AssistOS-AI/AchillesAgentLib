import { createAgentHttpClient } from './AgentHttpClient.mjs';

export class PloinkyAgentSkillsSubsystem {
    constructor({ mainAgent = null, modelConfig = null } = {}) {
        this.type = 'ploinky';
        this.mainAgent = mainAgent;
        this.modelConfig = modelConfig || { plan: 'plan', code: 'code' };
    }

    async fetchAgentCards({ agentName = null, callOptions = {}, ...clientOptions } = {}) {
        const normalizedName = typeof agentName === 'string' && agentName.trim()
            ? agentName.trim()
            : null;
        const client = createAgentHttpClient(clientOptions);
        if (normalizedName) {
            return client.agentCard(normalizedName, callOptions);
        }
        return client.agentCard(undefined, callOptions);
    }

    buildAgentAsTools(agentNames, agentCards, options = {}) {
        const tools = {};
        const timeoutMs = options?.timeoutMs || 0;

        for (const agentName of agentNames) {
            const card = agentCards?.agents?.find(a => a.name === agentName);
            const toolName = agentName;
            const description = this._buildAgentDescription(card, agentName);

            tools[toolName] = {
                description,
                handler: async (llmAgent, promptText) => {
                    const client = createAgentHttpClient({
                        timeoutMs,
                        ...(options?.routerUrl ? { routerUrl: options.routerUrl } : {}),
                        ...(options?.env ? { env: options.env } : {}),
                    });
                    const response = await client.chatCompletions(agentName, {
                        model: options?.model || null,
                        messages: [{ role: 'user', content: String(promptText ?? '') }],
                    });
                    return this._extractTextFromCompletion(response);
                },
            };
        }

        return tools;
    }

    _buildAgentDescription(card, agentName) {
        const parts = [];
        if (card?.payload?.capabilities?.summary) {
            parts.push(card.payload.capabilities.summary);
        }
        if (card?.payload?.capabilities?.description) {
            parts.push(card.payload.capabilities.description);
        }
        if (card?.payload?.capabilities?.tags?.length) {
            parts.push(`Tags: ${card.payload.capabilities.tags.join(', ')}`);
        }
        if (card?.payload?.capabilities?.whenToUse) {
            parts.push(`Use when: ${card.payload.capabilities.whenToUse}`);
        }
        if (card?.payload?.capabilities?.whenNotToUse) {
            parts.push(`Avoid when: ${card.payload.capabilities.whenNotToUse}`);
        }
        if (card?.payload?.capabilities?.inputConventions) {
            parts.push(`Input: ${card.payload.capabilities.inputConventions}`);
        }
        if (card?.payload?.capabilities?.outputConventions) {
            parts.push(`Output: ${card.payload.capabilities.outputConventions}`);
        }
        if (card?.payload?.capabilities?.usageGuidance) {
            parts.push(card.payload.capabilities.usageGuidance);
        }
        if (!parts.length) {
            parts.push(`Agent: ${agentName}`);
        }
        return parts.join('\n\n');
    }

    _extractTextFromCompletion(response) {
        if (typeof response === 'string') return response;
        if (response == null) return '';
        const choices = response?.choices;
        if (Array.isArray(choices) && choices.length > 0) {
            const content = choices[0]?.message?.content;
            if (typeof content === 'string') return content;
        }
        try {
            return JSON.stringify(response);
        } catch {
            return String(response);
        }
    }
}
