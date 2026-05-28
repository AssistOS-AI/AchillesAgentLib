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
        const ac = card?.payload?.['agent-card'];
        if (ac?.summary) {
            parts.push(ac.summary);
        }
        if (ac?.description) {
            parts.push(ac.description);
        }
        if (ac?.tags?.length) {
            parts.push(`Tags: ${ac.tags.join(', ')}`);
        }
        if (ac?.whenToUse) {
            parts.push(`Use when: ${ac.whenToUse}`);
        }
        if (ac?.whenNotToUse) {
            parts.push(`Avoid when: ${ac.whenNotToUse}`);
        }
        if (ac?.inputConventions) {
            parts.push(`Input: ${ac.inputConventions}`);
        }
        if (ac?.outputConventions) {
            parts.push(`Output: ${ac.outputConventions}`);
        }
        if (ac?.usageGuidance) {
            parts.push(ac.usageGuidance);
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
