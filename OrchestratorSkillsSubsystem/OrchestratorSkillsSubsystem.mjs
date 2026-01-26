import { Sanitiser } from '../utils/Sanitiser.mjs';
import { getDebugLogger, DEBUG_ACTIVE } from '../utils/DebugLogger.mjs';

const SECTION_KEYS = {
    instructions: ['instructions', 'guidance', 'overview', 'orchestration-guidance'],
    allowedSkills: ['allowed-skills', 'skill-allowlist', 'skill-allow-list', 'skills'],
    intents: ['intents', 'intentions', 'mappings'],
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
                // Handle different subsystem result shapes:
                // 1. OrchestratorSubsystem: { result: { output: ... } }
                // 2. InteractiveSubsystem: { result: ..., skill: ... }
                // 3. CodeSkillsSubsystem: primitives wrapped by SkillExecutor as { result: ... }
                const output = executionResult?.result?.output
                    ?? executionResult?.result
                    ?? executionResult;
                return output;
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

        return {
            skill: skillRecord.name,
            metadata: skillRecord.metadata || null,
            result: {
                type: this.type,
                prompt: promptText,
                output: result,
                session: 'loop',
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

        return {
            skill: skillRecord.name,
            metadata: skillRecord.metadata || null,
            result: {
                type: this.type,
                prompt: promptText,
                output: result,
                variables,
                session: 'sop',
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

}
