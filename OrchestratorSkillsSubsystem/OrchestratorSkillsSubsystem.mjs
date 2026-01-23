import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Sanitiser } from '../utils/Sanitiser.mjs';
import { getDebugLogger, DEBUG_ACTIVE } from '../utils/DebugLogger.mjs';

const SECTION_KEYS = {
    instructions: ['instructions', 'guidance', 'overview', 'orchestration-guidance'],
    allowedSkills: ['allowed-skills', 'skill-allowlist', 'skill-allow-list', 'skills'],
    intents: ['intents', 'intentions', 'mappings'],
    fallback: ['fallback', 'fallback-plan', 'fallback-react', 'react-fallback'],
    sessionType: ['session', 'soplang', 'sop-lang', 'sop', 'sop-agentic-session'],
};

function normaliseBulletList(section = '') {
    return section
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*[-*+]\s*/, '').trim())
        .filter(Boolean);
}

function pickSection(sections = {}, aliases = []) {
    for (const alias of aliases) {
        const key = alias.trim().toLowerCase();
        if (sections && sections[key]) {
            return sections[key];
        }
    }
    return '';
}

function parseIntents(section = '') {
    const entries = normaliseBulletList(section);
    const intents = [];
    for (const entry of entries) {
        const [idPart, ...rest] = entry.split(':');
        if (!idPart) {
            continue;
        }
        const id = Sanitiser.sanitiseName(idPart);
        const description = rest.join(':').trim();
        intents.push({
            id,
            description: description || entry.trim(),
        });
    }
    return intents;
}

function parseFallback(section = '') {
    if (!section || typeof section !== 'string') {
        return null;
    }
    const lines = section.split(/\r?\n/);
    const instructions = [];
    const allowedTools = [];
    let intent = 'fallback';
    let mode = 'instructions';

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            if (mode === 'instructions') {
                instructions.push(rawLine);
            }
            continue;
        }

        if (/^intent\s*:/i.test(line)) {
            const [, value] = line.split(/:/, 2);
            if (value && value.trim()) {
                intent = Sanitiser.sanitiseName(value);
            }
            continue;
        }

        if (/^allowed tools?/i.test(line)) {
            mode = 'allowed';
            continue;
        }

        if (mode === 'allowed') {
            const match = rawLine.match(/^\s*[-*+]\s*(.+)$/);
            if (match && match[1]) {
                allowedTools.push(Sanitiser.sanitiseName(match[1]));
            }
            continue;
        }

        instructions.push(rawLine);
    }

    const instructionText = instructions.join('\n').trim();
    if (!instructionText && !allowedTools.length) {
        return null;
    }

    return {
        intent,
        instructions: instructionText,
        allowedTools: allowedTools.filter(Boolean),
    };
}

export class OrchestratorSkillsSubsystem {
    constructor({ llmAgent = null } = {}) {
        this.type = 'orchestrator';
        this.llmAgent = llmAgent;
        this.debugLogger = DEBUG_ACTIVE ? getDebugLogger() : null;
    }

    prepareSkill(skillRecord) {
        const sections = skillRecord.descriptor?.sections || {};

        const instructions = pickSection(sections, SECTION_KEYS.instructions);
        const allowedSkills = normaliseBulletList(pickSection(sections, SECTION_KEYS.allowedSkills))
            .map((name) => Sanitiser.sanitiseName(name))
            .filter(Boolean);
        const intents = parseIntents(pickSection(sections, SECTION_KEYS.intents));
        const fallback = parseFallback(pickSection(sections, SECTION_KEYS.fallback));
        const sessionType = pickSection(sections, SECTION_KEYS.sessionType).trim();

        skillRecord.metadata = {
            type: this.type,
            title: skillRecord.descriptor?.title || null,
            summary: skillRecord.descriptor?.summary || null,
            body: skillRecord.descriptor?.body || null,
            sections,
            instructions,
            allowedSkills,
            intents,
            fallback,
            sessionType: sessionType || null,
        };
    }

    resolveAllowedSkills(skillRecord, recursiveAgent) {
        const allSkills = Array.from(recursiveAgent.skillCatalog.values());
        const selfCanonical = Sanitiser.sanitiseName(skillRecord.name);
        const allowList = skillRecord.metadata?.allowedSkills || [];

        const filtered = allSkills.filter((record) => {
            const canonical = Sanitiser.sanitiseName(record.name);
            if (canonical === selfCanonical) {
                return false;
            }
            if (!allowList.length) {
                return true;
            }
            return allowList.includes(canonical) || allowList.includes(Sanitiser.sanitiseName(record.shortName));
        });

        return filtered;
    }

    async buildSkillsAsTools(allowedSkills, recursiveAgent, options) {
        const tools = {};

        for (const skillRecord of allowedSkills) {
            const toolName = Sanitiser.sanitiseName(skillRecord.shortName || skillRecord.name);
            // Return a standard function that calls the skill via RecursiveSkilledAgent
            // This allows each subsystem to access any skill uniformly
            tools[toolName] = async (agent, paramsPrompt) => {
                // Normalize paramsPrompt to string to handle cases where LLM returns objects
                const promptString = typeof paramsPrompt === 'string' ? paramsPrompt : JSON.stringify(paramsPrompt);
                const executionResult = await recursiveAgent.executePrompt(promptString, {
                    skillName: skillRecord.name
                });
                return executionResult.result?.output;
            };
        }

        return tools;
    }

    buildToolDescriptions(allowedSkills) {
        const descriptions = {};
        allowedSkills.forEach(skillRecord => {
            const toolName = Sanitiser.sanitiseName(skillRecord.shortName || skillRecord.name);
            descriptions[toolName] = skillRecord.descriptor?.body || skillRecord.descriptor?.summary || skillRecord.descriptor?.title || skillRecord.name;
        });
        return descriptions;
    }


    async executeLoopAgentSession({skillRecord, recursiveAgent, promptText, options}) {
        const allowedSkills = this.resolveAllowedSkills(skillRecord, recursiveAgent);
        const tools = await this.buildSkillsAsTools(allowedSkills, recursiveAgent, options);
        const descriptions = this.buildToolDescriptions(allowedSkills);
        
        // Combine tools with descriptions for LoopAgentSession
        const toolsWithDescriptions = {};
        allowedSkills.forEach(skillRecord => {
            const toolName = Sanitiser.sanitiseName(skillRecord.shortName || skillRecord.name);
            toolsWithDescriptions[toolName] = {
                handler: tools[toolName],
                description: descriptions[toolName]
            };
        });
        

        const sessionOptions = {
            systemPrompt: skillRecord.metadata?.instructions || 'Execute skills to satisfy the user request.',
            mode: options?.mode || 'fast',
            maxStepsPerTurn: 10,
        };

        const session = await this.llmAgent.startLoopAgentSession(toolsWithDescriptions, promptText, sessionOptions);
        
        const result = session.getLastResult();

        // Handle fallback if no result
        let fallbackExecution = null;
        if (!result && skillRecord.metadata?.fallback) {
            fallbackExecution = await this.executeFallbackReact({
                skillRecord,
                fallback: skillRecord.metadata.fallback,
                recursiveAgent,
                promptText,
                options,
            });
        }

        return {
            skill: skillRecord.name,
            metadata: skillRecord.metadata || null,
            result: {
                type: this.type,
                prompt: promptText,
                output: result,
                session: 'loop',
                fallbackExecution,
            },
            sessionMemory: null,
        };
    }

    async executeSOPAgentSession({skillRecord, recursiveAgent, promptText, options}) {
        const allowedSkills = this.resolveAllowedSkills(skillRecord, recursiveAgent);
        const tools = await this.buildSkillsAsTools(allowedSkills, recursiveAgent, options);
        const skillsDescription = this.buildToolDescriptions(allowedSkills);

        const sessionOptions = {
            systemPrompt: skillRecord.metadata?.instructions || 'Plan and execute skills to satisfy the user request.',
            mode: options?.mode || 'deep',
            planOnly: false,
            commandsRegistry: {
                executeCommand: async (payload, response) => {
                    const { command, args } = payload;
                    const skillAction = tools[command];
                    
                    if (!skillAction) {
                        return response.fail(`Unknown skill: ${command}`);
                    }
                    
                    try {
                        const prompt = Array.isArray(args) ? args.join(' ') : (args || promptText);
                        const result = await skillAction(this.llmAgent, prompt);
                        return response.success(result);
                    } catch (error) {
                        return response.fail(error?.message || String(error));
                    }
                },
                listCommands: () => allowedSkills.map(s => ({
                    name: Sanitiser.sanitiseName(s.shortName || s.name),
                    description: s.descriptor?.summary || s.descriptor?.title || s.name,
                })),
            },
        };

        const session = await this.llmAgent.startSOPLangAgentSession(skillsDescription, promptText, sessionOptions);
        const variables = await session.getVariables();
        const result = session.getLastResult();

        // Handle fallback if no result
        let fallbackExecution = null;
        if (!result && skillRecord.metadata?.fallback) {
            fallbackExecution = await this.executeFallbackReact({
                skillRecord,
                fallback: skillRecord.metadata.fallback,
                recursiveAgent,
                promptText,
                options,
            });
        }

        return {
            skill: skillRecord.name,
            metadata: skillRecord.metadata || null,
            result: {
                type: this.type,
                prompt: promptText,
                output: result,
                variables,
                session: 'sop',
                fallbackExecution,
            },
            sessionMemory: null,
        };
    }

    async executeSkillPrompt({
        skillRecord,
        recursiveAgent,
        promptText,
        options = {},
    }) {
        const sessionType = skillRecord.metadata?.sessionType;
        if (sessionType) {
            return this.executeSOPAgentSession({
                skillRecord,
                recursiveAgent,
                promptText,
                options,
            });
        } else {
            return this.executeLoopAgentSession({
                skillRecord,
                recursiveAgent,
                promptText,
                options,
            });
        }
    }

    buildFallbackSkillRecord({ skillRecord, fallback }) {
        const descriptor = {
            title: `${skillRecord.descriptor?.title || skillRecord.name} Fallback MCP`,
            summary: fallback.instructions.split(/\r?\n/)[0] || 'Fallback MCP plan',
            body: fallback.instructions,
            sections: {
                instructions: fallback.instructions,
            },
        };

        if (fallback.allowedTools?.length) {
            descriptor.sections['allowed-tools'] = fallback.allowedTools
                .map((tool) => `- ${tool}`)
                .join('\n');
        }

        const scriptLines = ['@prompt prompt'];
        (fallback.allowedTools || []).forEach((tool, index) => {
            const commandName = Sanitiser.sanitiseName(tool);
            scriptLines.push(`@fallback_${index} ${commandName} $prompt`);
        });
        descriptor.sections['light-sop-lang'] = scriptLines.join('\n');

        return {
            name: `${skillRecord.name}-fallback-mcp`,
            type: 'mcp',
            descriptor,
            filePath: skillRecord.filePath,
            skillDir: skillRecord.skillDir,
            shortName: `${skillRecord.shortName || skillRecord.name}-fallback`,
            metadata: null,
        };
    }

    async executeFallbackReact({
        skillRecord,
        fallback,
        recursiveAgent,
        promptText,
        options,
        logger = null,
    }) {
        if (!fallback || !fallback.instructions) {
            return null;
        }

        const log = typeof logger === 'function' ? logger : null;

        const availableTools = Array.isArray(options?.availableTools)
            ? options.availableTools.map((tool) => ({
                ...tool,
                name: tool.name || tool.id || '',
            })).filter((tool) => tool.name)
            : [];

        const filteredTools = fallback.allowedTools?.length
            ? availableTools.filter((tool) => fallback.allowedTools.includes(Sanitiser.sanitiseName(tool.name)))
            : availableTools;

        const dynamicRecord = this.buildFallbackSkillRecord({ skillRecord, fallback });
        const mcpSubsystem = recursiveAgent.ensureSubsystem('mcp');
        if (typeof mcpSubsystem.prepareSkill === 'function') {
            mcpSubsystem.prepareSkill(dynamicRecord, recursiveAgent);
        }

        log?.('[fallback] Executing fallback MCP script.');
        const outcome = await mcpSubsystem.executeSkillPrompt({
            skillRecord: dynamicRecord,
            recursiveAgent,
            promptText,
            options: {
                ...options,
                availableTools: filteredTools,
            },
        });
        log?.('[fallback] Fallback MCP execution completed.');

        return {
            intent: fallback.intent || 'fallback',
            skill: dynamicRecord.name,
            input: promptText,
            run: true,
            reason: 'Fallback MCP execution',
            skipped: false,
            outcome,
            error: null,
            fallback: true,
        };
    }
}
