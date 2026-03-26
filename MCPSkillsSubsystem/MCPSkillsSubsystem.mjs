import { Sanitiser } from '../utils/Sanitiser.mjs';
import { getDebugLogger, DEBUG_ACTIVE } from '../utils/DebugLogger.mjs';
import LightSOPLangInterpreter, { DefaultExecutionMonitor } from '../lightSOPLang/index.mjs';
import { createAgentClient } from './AgentClient.js';
import { parseSkillDocument } from '../utils/skillDocumentParser.mjs';

const DEFAULT_PLAN_LIMIT = 3;
const SECTION_ALIASES = {
    instructions: ['instructions', 'guidance', 'system-prompt', 'overview', 'mcp-guidance'],
    allowedTools: ['allowed-tools', 'tool-allowlist', 'tool-allow-list', 'tools'],
    script: ['light-sop-lang', 'lightsoplang', 'script', 'plan-script'],
};

function normaliseListSection(content = '') {
    return content
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*[-*+]\s*/, '').trim())
        .filter(Boolean);
}

function pickSection(sections = {}, aliases = []) {
    if (!sections || typeof sections !== 'object') {
        return '';
    }
    for (const alias of aliases) {
        const key = alias.trim().toLowerCase();
        if (sections[key]) {
            return sections[key];
        }
    }
    return '';
}

function buildSelectionPrompt({
    skillName,
    instructions,
    promptText,
    availableTools,
    planLimit,
}) {
    const toolLines = availableTools.length
        ? availableTools.map((tool, index) => {
            const label = tool.title || tool.name;
            const summary = tool.description || tool.summary || '';
            return `${index + 1}. ${tool.name}${summary ? ` — ${summary}` : ''}`;
        })
        : ['<no tools available>'];

    const guidance = [
        '# MCP Skill Orchestration',
        `Skill: ${skillName}`,
        instructions || 'Use the best available tools to satisfy the request.',
        '',
        '## Available Tools',
        toolLines.join('\n'),
        '',
        '## Request',
        promptText || '<empty>',
        '',
        'Respond in JSON with the shape:',
        '{',
        '  "plan": [',
        '    { "tool": "name", "arguments": "text", "why": "short reason" }',
        '  ],',
        '  "notes": "optional commentary"',
        '}',
        '',
        `Limit the plan to at most ${planLimit} tool calls.`,
        'Avoid tools that are clearly irrelevant.',
    ];

    return guidance.join('\n');
}

function parseArguments(argumentValue, fallbackPrompt = '') {
    if (argumentValue && typeof argumentValue === 'object') {
        return argumentValue;
    }

    if (typeof argumentValue === 'string') {
        const trimmed = argumentValue.trim();
        const fenceMatch = trimmed.match(/^```[a-zA-Z]*\s*([\s\S]*?)```$/);
        const body = fenceMatch ? fenceMatch[1].trim() : trimmed;
        if (!body) {
            return fallbackPrompt;
        }
        try {
            const parsed = JSON.parse(body);
            if (parsed && typeof parsed === 'object') {
                return parsed;
            }
        } catch {
            // Not JSON, fall through to return the raw text
        }
        return body;
    }

    return fallbackPrompt;
}

function normaliseTools(tools = []) {
    if (!Array.isArray(tools)) {
        return [];
    }
    return tools
        .map((tool) => ({
            ...tool,
            name: tool?.name || tool?.id || '',
        }))
        .filter((tool) => tool.name);
}

export class MCPSkillsSubsystem {
    constructor({ llmAgent = null, tierConfig = null, modelConfig = null } = {}) {
        this.type = 'mcp';
        this.llmAgent = llmAgent;
        this.tierConfig = modelConfig || tierConfig || { plan: 'plan', execution: 'fast', code: 'code' };
        this.debugLogger = DEBUG_ACTIVE ? getDebugLogger() : null;
    }

    parseSkillDescriptor({ filePath }) {
        return parseSkillDocument(filePath);
    }

    async executePlanWithClient({ client, plan = [], promptText, allowedTools = [] }) {
        if (!client || typeof client.callTool !== 'function') {
            throw new Error('MCP tool execution requested but no valid AgentClient was provided.');
        }

        let availableTools = [];
        try {
            availableTools = normaliseTools(await client.listTools());
        } catch (error) {
            const detail = error?.message || String(error);
            throw new Error(`Failed to list tools from MCP server: ${detail}`);
        }

        const filteredTools = this.filterTools(allowedTools, availableTools);
        const allowedNames = new Set(filteredTools.map((tool) => Sanitiser.sanitiseName(tool.name)));

        const executions = [];
        for (const step of plan) {
            const requestedKey = Sanitiser.sanitiseName(step.tool);
            if (!allowedNames.has(requestedKey)) {
                executions.push({
                    ...step,
                    status: 'failed',
                    arguments: null,
                    response: null,
                    error: `Tool "${step.tool}" is not available from MCP server.`,
                });
                continue;
            }

            const rawArgs = step?.args ?? step?.arguments;
            const args = parseArguments(rawArgs, promptText);
            try {
                // eslint-disable-next-line no-await-in-loop
                const response = await client.callTool(step.tool, args);
                executions.push({
                    ...step,
                    status: 'ok',
                    arguments: args,
                    response,
                    error: null,
                });
            } catch (error) {
                executions.push({
                    ...step,
                    status: 'failed',
                    arguments: args,
                    response: null,
                    error: error?.message || String(error),
                });
            }
        }

        return executions;
    }

    prepareSkill(skillRecord) {
        const { descriptor } = skillRecord;
        const sections = descriptor?.sections || {};

        const instructions = pickSection(sections, SECTION_ALIASES.instructions);
        const allowedTools = normaliseListSection(pickSection(sections, SECTION_ALIASES.allowedTools));

        skillRecord.preparedConfig = {
            type: this.type,
            name: descriptor?.name || null,
            rawContent: descriptor?.rawContent || null,
            sections,
            instructions: instructions || '',
            allowedTools: allowedTools.map((name) => Sanitiser.sanitiseName(name)),
            planLimit: DEFAULT_PLAN_LIMIT,
            script: pickSection(sections, SECTION_ALIASES.script) || '',
        };
    }

    filterTools(allowList = [], availableTools = []) {
        if (!allowList.length) {
            return availableTools.slice();
        }
        const allowedSet = new Set(allowList);
        return availableTools.filter((tool) => allowedSet.has(Sanitiser.sanitiseName(tool.name)));
    }

    buildScriptCommandRegistry({ promptText, filteredTools, planSteps, options }) {
        const promptCommand = 'prompt';
        const workspaceRootCommand = 'workspaceroot';
        const toolLookup = new Map();

        filteredTools.forEach((tool) => {
            const entry = {
                tool,
                description: tool.description || tool.summary || '',
            };
            toolLookup.set(Sanitiser.sanitiseName(tool.name), entry);
            toolLookup.set(Sanitiser.sanitiseName(tool.title || tool.name), entry);
            toolLookup.set(tool.name, entry);
        });

        return {
            executeCommand: async ({ command, args }, response) => {
                const normalized = Sanitiser.sanitiseName(command);
                if (normalized === promptCommand) {
                    return response.success(promptText);
                }
                if (normalized === workspaceRootCommand) {
                    const root = options?.context?.workspaceRoot || process.cwd();
                    return response.success(root);
                }

                const entry = toolLookup.get(normalized);
                if (!entry) {
                    throw new Error(`LightSOPLang referenced unknown tool command "${command}".`);
                }

                const argumentText = Array.isArray(args) && args.length ? args[0] : promptText;
                const reasonText = Array.isArray(args) && args.length > 1
                    ? args.slice(1).join(' ')
                    : '';

                planSteps.push({
                    tool: entry.tool.name,
                    args: argumentText,
                    arguments: argumentText, // keep legacy field for compatibility
                    why: reasonText,
                });

                return response.success(`tool ${entry.tool.name} scheduled`);
            },
            listCommands: () => [
                { name: promptCommand, description: 'Returns the original prompt text' },
                { name: workspaceRootCommand, description: 'Returns the workspace root directory path' },
                ...filteredTools.map((tool) => ({
                    name: tool.name,
                    description: tool.description || tool.summary || '',
                })),
            ],
        };
    }

    async executeScriptPlan({ skillRecord, promptText, tools, options }) {
        const allowList = skillRecord?.preparedConfig?.allowedTools || [];
        const filteredTools = this.filterTools(allowList, tools);
        if (!filteredTools.length) {
            throw new Error(`MCP skill "${skillRecord.name}" requires at least one allowed tool.`);
        }

        const script = (skillRecord.preparedConfig?.script || '').trim();
        if (!script) {
            throw new Error(`MCP skill "${skillRecord.name}" is missing a LightSOPLang script section.`);
        }

        const planSteps = [];
        const registry = this.buildScriptCommandRegistry({
            promptText,
            filteredTools,
            planSteps,
            options,
        });

        const interpreter = new LightSOPLangInterpreter(script, registry, promptText, {
            executionMonitor: new DefaultExecutionMonitor({
                commandLimit: Math.max(10, filteredTools.length * 4),
            }),
        });

        await interpreter.ready;

        return {
            skill: skillRecord.name,
            preparedConfig: skillRecord.preparedConfig || null,
            result: {
                type: this.type,
                prompt: promptText,
                script,
                plan: planSteps,
                notes: '',
                availableTools: filteredTools,
            },
            sessionMemory: null,
        };
    }

    async generatePlan({ skillRecord, promptText, tools }) {
        const allowList = skillRecord?.preparedConfig?.allowedTools || [];
        const filteredTools = this.filterTools(allowList, tools);
        const planLimit = skillRecord.preparedConfig?.planLimit || DEFAULT_PLAN_LIMIT;
        this.debugLogger?.log('MCPSkillsSubsystem:generatePlan:start', {
            skill: skillRecord.name,
            toolCount: filteredTools.length,
            planLimit,
        });

        if (!filteredTools.length) {
            throw new Error(`MCP skill "${skillRecord.name}" requires at least one allowed tool.`);
        }

        if (!this.llmAgent || typeof this.llmAgent.executePrompt !== 'function') {
            throw new Error(`MCP skill "${skillRecord.name}" requires an LLMAgent with executePrompt.`);
        }

        const prompt = buildSelectionPrompt({
            skillName: skillRecord.name,
            instructions: skillRecord.preparedConfig?.instructions,
            promptText,
            availableTools: filteredTools,
            planLimit,
        });

        let rawPlan;
        try {
            rawPlan = await this.llmAgent.executePrompt(prompt, {
                tier: this.tierConfig.plan || 'plan',
                context: {
                    intent: 'mcp-skill-plan',
                    skillName: skillRecord.name,
                },
                responseShape: 'json',
            });
        } catch (error) {
            const message = error?.message || String(error);
            throw new Error(`LLM failed to generate MCP plan for skill "${skillRecord.name}": ${message}`);
        }

        if (!rawPlan || typeof rawPlan !== 'object' || !Array.isArray(rawPlan.plan)) {
            throw new Error(`LLM response for skill "${skillRecord.name}" did not include a plan array.`);
        }

        const allowedLookup = new Map(filteredTools.map((tool) => [
            Sanitiser.sanitiseName(tool.name),
            tool.name,
        ]));

        const steps = [];
        for (const step of rawPlan.plan.slice(0, planLimit)) {
            if (!step || typeof step.tool !== 'string') {
                throw new Error(`LLM produced an invalid MCP step for skill "${skillRecord.name}".`);
            }
            const toolKey = Sanitiser.sanitiseName(step.tool);
            if (!allowedLookup.has(toolKey)) {
                throw new Error(`LLM selected tool "${step.tool}" which is not permitted for skill "${skillRecord.name}".`);
            }
            const argValue = typeof step.arguments === 'string' && step.arguments.trim()
                ? step.arguments
                : (promptText || '');
            steps.push({
                tool: allowedLookup.get(toolKey),
                args: argValue,
                arguments: argValue, // maintain legacy field for consumers expecting "arguments"
                why: typeof step.why === 'string' ? step.why : '',
            });
        }

        if (!steps.length) {
            throw new Error(`LLM did not provide any executable MCP steps for skill "${skillRecord.name}".`);
        }

        this.debugLogger?.log('MCPSkillsSubsystem:generatePlan:success', {
            skill: skillRecord.name,
            stepCount: steps.length,
        });

        return {
            plan: steps,
            notes: typeof rawPlan.notes === 'string' ? rawPlan.notes : '',
        };
    }

    async executeSkillPrompt({ skillRecord, promptText, options = {} }) {
        let tools = normaliseTools(options.availableTools);

        const clientFactoryUrl = options.agentClientBaseUrl;
        let agentClient = options.agentClient || null;
        let createdClient = false;
        const shouldExecute = Boolean(clientFactoryUrl);

        if (!agentClient && clientFactoryUrl) {
            agentClient = createAgentClient(clientFactoryUrl);
            createdClient = true;
        }

        const allowList = skillRecord.preparedConfig?.allowedTools || [];

        if (!tools.length && shouldExecute && typeof agentClient?.listTools === 'function') {
            try {
                tools = normaliseTools(await agentClient.listTools());
            } catch (error) {
                if (createdClient) {
                    try { await agentClient.close(); } catch (_) { /* ignore */ }
                }
                const detail = error?.message || String(error);
                throw new Error(`Failed to list MCP tools for skill "${skillRecord.name}": ${detail}`);
            }
        }

        tools = this.filterTools(allowList, tools);

        const script = (skillRecord.preparedConfig?.script || '').trim();
        if (script) {
            let outcome;
            try {
                outcome = await this.executeScriptPlan({
                    skillRecord,
                    promptText,
                    tools,
                    options,
                });

                if (shouldExecute) {
                    if (!agentClient) {
                        throw new Error(`MCP skill "${skillRecord.name}" requested tool execution but no agent client was provided. Set agentClientBaseUrl or pass an agentClient instance.`);
                    }
                    outcome.result.executions = await this.executePlanWithClient({
                        client: agentClient,
                        plan: outcome.result.plan || [],
                        promptText,
                        allowedTools: skillRecord.preparedConfig?.allowedTools || [],
                    });
                }
            } finally {
                if (createdClient) {
                    try { await agentClient.close(); } catch (_) { /* ignore */ }
                }
            }
            return outcome;
        }

        let plan;
        try {
            plan = await this.generatePlan({
                skillRecord,
                promptText,
                tools,
            });

            this.debugLogger?.log('MCPSkillsSubsystem:executeSkillPrompt', {
                skill: skillRecord.name,
                planSteps: plan.plan.length,
            });

            const result = {
                skill: skillRecord.name,
                preparedConfig: skillRecord.preparedConfig || null,
                result: {
                    type: this.type,
                    prompt: promptText,
                    instructions: skillRecord.preparedConfig?.instructions || '',
                    plan: plan.plan,
                    notes: plan.notes,
                    availableTools: this.filterTools(skillRecord, tools),
                },
                sessionMemory: null,
            };

            if (shouldExecute) {
                if (!agentClient) {
                    throw new Error(`MCP skill "${skillRecord.name}" requested tool execution but no agent client was provided. Set agentClientBaseUrl or pass an agentClient instance.`);
                }
                result.result.executions = await this.executePlanWithClient({
                    client: agentClient,
                    plan: plan.plan,
                    promptText,
                    allowedTools: skillRecord.preparedConfig?.allowedTools || [],
                });
            }

            return result;
        } finally {
            if (createdClient) {
                try { await agentClient.close(); } catch (_) { /* ignore */ }
            }
        }
    }
}
