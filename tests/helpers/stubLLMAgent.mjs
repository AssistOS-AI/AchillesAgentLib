import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';

class StubLLMAgent extends LLMAgent {
    constructor({ onExecutePrompt = null } = {}) {
        super({ name: 'StubLLMAgent' });
        this.onExecutePrompt = onExecutePrompt;
    }

    executePrompt(prompt, options = {}) {
        if (typeof this.onExecutePrompt === 'function') {
            const override = this.onExecutePrompt(prompt, options);
            if (override !== undefined) {
                return override;
            }
        }

        const context = options.context || {};
        const intent = context.intent || '';
        const skillName = context.skillName || '';

        if (intent === 'orchestrator-plan') {
            if (skillName === 'planner-orchestrator-orchestrator') {
                return {
                    plan: [
                        { intent: 'reporting', skill: 'llm-reporter-claude', run: true, input: prompt, reason: 'Primary reporting path' },
                        { intent: 'data-fetch', skill: 'inventory-data-retrieval-mcp', run: true, input: prompt, reason: 'Retrieve supporting data' },
                    ],
                    notes: '',
                };
            }
            if (skillName === 'fallback-planner-orchestrator') {
                return { plan: [], notes: '' };
            }
            if (skillName === 'llm-planner-orchestrator') {
                return {
                    plan: [
                        { intent: 'summary', skill: 'llm-reporter-claude', run: true, input: prompt, reason: 'Summarise findings' },
                        { intent: 'data-fetch', skill: 'llm-data-lookup-mcp', run: true, input: prompt, reason: 'Gather data for summary' },
                    ],
                    notes: 'Default stub plan',
                };
            }
        }

        if (intent === 'mcp-skill-plan') {
            if (skillName === 'inventory-data-retrieval-mcp') {
                return {
                    plan: [
                        { tool: 'inventoryLookup', arguments: prompt, why: 'Default stub selection' },
                    ],
                    notes: '',
                };
            }
            if (skillName === 'fallback-planner-orchestrator-fallback-mcp') {
                return {
                    plan: [
                        { tool: 'invoiceLookup', arguments: prompt, why: 'Fallback lookup' },
                    ],
                    notes: '',
                };
            }
            if (skillName === 'llm-data-lookup-mcp') {
                return {
                    plan: [
                        { tool: 'metricScanner', arguments: prompt, why: 'Collect metrics for reporting' },
                    ],
                    notes: '',
                };
            }
        }

        if (intent === 'agentic-session-planner') {
            const userPrompt = context?.userPrompt || '';

            if (userPrompt.includes('daily warehouse report')) {
                return {
                    action: 'call_tool',
                    tool: 'llm-reporter-claude',
                    toolPrompt: 'Prepare daily warehouse report',
                };
            }

            if (userPrompt.includes('invoice mismatches')) {
                return {
                    action: 'final_answer',
                    text: '',
                };
            }

            if (userPrompt.includes('recursive loop')) {
                return {
                    action: 'call_tool',
                    tool: 'llm-planner-orchestrator',
                    toolPrompt: 'Loop forever',
                };
            }

            return {
                action: 'final_answer',
                text: 'Test completed',
            };
        }

        return {
            action: 'final_answer',
            text: 'Unhandled request',
        };
    }

    async startSOPLangAgentSession(skillsDescription, promptText) {
        return {
            getVariables: async () => ({}),
            getLastResult: () => {
                if (String(promptText || '').includes('Trigger recursive loop')) {
                    return 'Too many planner errors';
                }
                return 'SOP session completed';
            },
        };
    }

    complete(prompt, options = {}) {
        return this.executePrompt(prompt, options);
    }
}

export { StubLLMAgent };
