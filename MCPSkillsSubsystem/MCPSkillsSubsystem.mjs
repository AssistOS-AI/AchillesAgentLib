import { Sanitiser } from '../utils/Sanitiser.mjs';
import { getDebugLogger, DEBUG_ACTIVE } from '../utils/DebugLogger.mjs';
import LightSOPLangInterpreter, { DefaultExecutionMonitor } from '../lightSOPLang/index.mjs';

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

export class MCPSkillsSubsystem {
    constructor({ llmAgent = null } = {}) {
        this.type = 'mcp';
        this.llmAgent = llmAgent;
        this.debugLogger = DEBUG_ACTIVE ? getDebugLogger() : null;
    }

    prepareSkill(skillRecord) {
        const { descriptor } = skillRecord;
        const sections = descriptor?.sections || {};

        const instructions = pickSection(sections, SECTION_ALIASES.instructions);
        const allowedTools = normaliseListSection(pickSection(sections, SECTION_ALIASES.allowedTools));

        skillRecord.metadata = {
            type: this.type,
            title: descriptor?.title || null,
            summary: descriptor?.summary || null,
            body: descriptor?.body || null,
            sections,
            instructions: instructions || '',
            allowedTools: allowedTools.map((name) => Sanitiser.sanitiseName(name)),
            planLimit: DEFAULT_PLAN_LIMIT,
            script: pickSection(sections, SECTION_ALIASES.script) || '',
        };
    }

    filterTools(skillRecord, availableTools = []) {
        const allowList = skillRecord.metadata?.allowedTools || [];
        if (!allowList.length) {
            return availableTools.slice();
        }
        const allowedSet = new Set(allowList);
        return availableTools.filter((tool) => allowedSet.has(Sanitiser.sanitiseName(tool.name)));
    }

    buildScriptCommandRegistry({ promptText, filteredTools, planSteps }) {
        const promptCommand = 'prompt';
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
                    arguments: argumentText,
                    why: reasonText,
                });

                return response.success(`tool ${entry.tool.name} scheduled`);
            },
            listCommands: () => [
                { name: promptCommand, description: 'Returns the original prompt text' },
                ...filteredTools.map((tool) => ({
                    name: tool.name,
                    description: tool.description || tool.summary || '',
                })),
            ],
        };
    }

    async executeScriptPlan({ skillRecord, promptText, tools }) {
        const filteredTools = this.filterTools(skillRecord, tools);
        if (!filteredTools.length) {
            throw new Error(`MCP skill "${skillRecord.name}" requires at least one allowed tool.`);
        }

        const script = (skillRecord.metadata?.script || '').trim();
        if (!script) {
            throw new Error(`MCP skill "${skillRecord.name}" is missing a LightSOPLang script section.`);
        }

        const planSteps = [];
        const registry = this.buildScriptCommandRegistry({
            promptText,
            filteredTools,
            planSteps,
        });

        const interpreter = new LightSOPLangInterpreter(script, registry, {
            executionMonitor: new DefaultExecutionMonitor({
                commandLimit: Math.max(10, filteredTools.length * 4),
            }),
        });

        await interpreter.ready;

        return {
            skill: skillRecord.name,
            metadata: skillRecord.metadata || null,
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
        const filteredTools = this.filterTools(skillRecord, tools);
        const planLimit = skillRecord.metadata?.planLimit || DEFAULT_PLAN_LIMIT;
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
            instructions: skillRecord.metadata?.instructions,
            promptText,
            availableTools: filteredTools,
            planLimit,
        });

        let rawPlan;
        try {
            rawPlan = await this.llmAgent.executePrompt(prompt, {
                mode: 'fast',
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
            steps.push({
                tool: allowedLookup.get(toolKey),
                arguments: typeof step.arguments === 'string' && step.arguments.trim()
                    ? step.arguments
                    : (promptText || ''),
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
        const tools = Array.isArray(options.availableTools)
            ? options.availableTools.map((tool) => ({
                ...tool,
                name: tool.name || tool.id || '',
            })).filter((tool) => tool.name)
            : [];

        const script = (skillRecord.metadata?.script || '').trim();
        if (script) {
            return this.executeScriptPlan({
                skillRecord,
                promptText,
                tools,
            });
        }

        const plan = await this.generatePlan({
            skillRecord,
            promptText,
            tools,
        });

        this.debugLogger?.log('MCPSkillsSubsystem:executeSkillPrompt', {
            skill: skillRecord.name,
            planSteps: plan.plan.length,
        });

        return {
            skill: skillRecord.name,
            metadata: skillRecord.metadata || null,
            result: {
                type: this.type,
                prompt: promptText,
                instructions: skillRecord.metadata?.instructions || '',
                plan: plan.plan,
                notes: plan.notes,
                availableTools: this.filterTools(skillRecord, tools),
            },
            sessionMemory: null,
        };
    }
}
