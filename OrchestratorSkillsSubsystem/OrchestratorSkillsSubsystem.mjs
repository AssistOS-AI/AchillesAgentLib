import { Sanitiser } from '../utils/Sanitiser.mjs';
import { getDebugLogger, DEBUG_ACTIVE } from '../utils/DebugLogger.mjs';
import { SESSION_STATUS_AWAITING_INPUT, SESSION_KEY_PREFIX } from '../LLMAgents/constants.mjs';

const DEBUG_ENABLED = String(process.env.ACHILLES_DEBUG ?? process.env.ACHILES_DEBUG ?? '').toLowerCase() === 'true';

function debugLog(...args) {
    if (DEBUG_ENABLED) console.log(...args);
}

const SECTION_KEYS = {
    instructions: ['instructions', 'guidance', 'overview', 'orchestration-guidance'],
    preparation: ['preparation', 'prep', 'context-prep'],
    allowedSkills: ['allowed-skills', 'skill-allowlist', 'skill-allow-list', 'skills'],
    intents: ['intents', 'intentions', 'mappings'],
    sessionType: ['loop'],
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
        const preparation = pickSection(sections, SECTION_KEYS.preparation);
        const allowedSkills = normaliseBulletList(pickSection(sections, SECTION_KEYS.allowedSkills))
            .map((name) => Sanitiser.sanitiseName(name))
            .filter(Boolean);
        const intents = parseIntents(pickSection(sections, SECTION_KEYS.intents));
        const sessionType = pickSection(sections, SECTION_KEYS.sessionType).trim();

        debugLog(`[Orchestrator] prepareSkill "${skillRecord.name}" sections=${JSON.stringify(Object.keys(sections))} sessionType="${sessionType}"`);

        skillRecord.metadata = {
            type: this.type,
            title: skillRecord.descriptor?.title || null,
            summary: skillRecord.descriptor?.summary || null,
            body: skillRecord.descriptor?.body || null,
            sections,
            instructions,
            preparation: preparation || null,
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
        // Forward context (sessionMemory, user, etc.) from the orchestrator's options
        const forwardedContext = options?.context || {};

        for (const skillRecord of allowedSkills) {
            const toolName = Sanitiser.sanitiseName(skillRecord.shortName || skillRecord.name);
            // Return a standard function that calls the skill via RecursiveSkilledAgent
            // This allows each subsystem to access any skill uniformly
            tools[toolName] = async (agent, promptText) => {
                const executionResult = await recursiveAgent.executePrompt(promptText, {
                    skillName: skillRecord.name,
                    context: forwardedContext,
                    sessionMemory: forwardedContext.sessionMemory || null,
                });
                return executionResult?.result;
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
        const sessionMemory = options?.context?.sessionMemory || options?.sessionMemory || null;
        const sessionKey = `${SESSION_KEY_PREFIX}${Sanitiser.sanitiseName(skillRecord.name)}`;
        
        // Check for existing session in awaiting_input state
        let session = sessionMemory?.get?.(sessionKey) || null;
        let result;
        
        const allowedSkills = this.resolveAllowedSkills(skillRecord, recursiveAgent);
        const tools = await this.buildSkillsAsTools(allowedSkills, recursiveAgent, options);
        const descriptions = this.buildToolDescriptions(allowedSkills);

        const toolsWithDescriptions = {};
        allowedSkills.forEach(skillRecord => {
            const toolName = Sanitiser.sanitiseName(skillRecord.shortName || skillRecord.name);
            toolsWithDescriptions[toolName] = {
                handler: tools[toolName],
                description: descriptions[toolName],
            };
        });

        const preparation = skillRecord.metadata?.preparation
            ? { text: skillRecord.metadata.preparation, retries: 1 }
            : null;

        if (session && session.status === SESSION_STATUS_AWAITING_INPUT) {
            // Reuse existing session - continue the conversation
            // Preparation runs internally in newPrompt() via session.preparation
            debugLog(`[Orchestrator] Resuming existing LoopSession for "${skillRecord.name}" (status: ${session.status})`);
            result = await session.newPrompt(promptText);
        } else {
            // Create new session
            const baseSystemPrompt = skillRecord.metadata?.instructions || 'Execute skills to satisfy the user request.';

            const sessionOptions = {
                systemPrompt: baseSystemPrompt,
                mode: options?.mode || 'deep',
                maxStepsPerTurn: 20,
                preparation,
            };

            session = await this.llmAgent.startLoopAgentSession(toolsWithDescriptions, promptText, sessionOptions);
            result = session.getLastResult();
        }

        // Store or clear session based on status
        if (session.status === SESSION_STATUS_AWAITING_INPUT && sessionMemory?.set) {
            // Session is waiting for user input - store it for next call
            debugLog(`[Orchestrator] Storing LoopSession for "${skillRecord.name}" (${SESSION_STATUS_AWAITING_INPUT})`);
            sessionMemory.set(sessionKey, session);
        } else if (sessionMemory?.delete) {
            // Session completed - clean up
            sessionMemory.delete(sessionKey);
        }

        return {
            skill: skillRecord.name,
            metadata: skillRecord.metadata || null,
            result: result,
            session: 'loop',
            sessionMemory: sessionMemory,
        };
    }

    async executeSOPAgentSession({skillRecord, recursiveAgent, promptText, options}) {
        const allowedSkills = this.resolveAllowedSkills(skillRecord, recursiveAgent);
        const tools = await this.buildSkillsAsTools(allowedSkills, recursiveAgent, options);
        const skillsDescription = this.buildToolDescriptions(allowedSkills);

        const commandsRegistry = {
            executeCommand: async (payload, response) => {
                const { command, args } = payload;
                const skillAction = tools[command];

                if (!skillAction) {
                    return response.fail(`Unknown skill: ${command}`);
                }

                try {
                    if (Array.isArray(args)) {
                        const prompt = args.join(' ');
                        const result = await skillAction(this.llmAgent, prompt);
                        return response.success(result);
                    }
                    const result = await skillAction(this.llmAgent, args);
                    return response.success(result);
                } catch (error) {
                    return response.fail(error?.message || String(error));
                }
            },
            listCommands: () => allowedSkills.map(s => ({
                name: Sanitiser.sanitiseName(s.shortName || s.name),
                description: s.descriptor?.summary || s.descriptor?.title || s.name,
            })),
        };

        const preparation = skillRecord.metadata?.preparation
            ? { text: skillRecord.metadata.preparation, retries: 1 }
            : null;

        const sessionOptions = {
            systemPrompt: skillRecord.metadata?.instructions || 'Plan and execute skills to satisfy the user request.',
            mode: options?.mode || 'deep',
            planOnly: false,
            commandsRegistry,
            preparation,
        };

        const session = await this.llmAgent.startSOPLangAgentSession(skillsDescription, promptText, sessionOptions);
        const variables = await session.getVariables();
        const result = session.getLastResult();

        return {
            skill: skillRecord.name,
            metadata: skillRecord.metadata || null,
            result: result,
            variables,
            session: 'sop',
            sessionMemory: options?.context?.sessionMemory || options?.sessionMemory || null,
        };
    }

    async executeSkillPrompt({
        skillRecord,
        recursiveAgent,
        promptText,
        options = {},
    }) {
        const sessionType = String(skillRecord.metadata?.sessionType || '').trim().toLowerCase();
        debugLog(`[Orchestrator] Skill "${skillRecord.name}" sessionType="${sessionType}" → ${sessionType ? 'LoopSession' : 'SOPSession'}`);
        if (sessionType) {
            return this.executeLoopAgentSession({
                skillRecord,
                recursiveAgent,
                promptText,
                options,
            });
        }
        return this.executeSOPAgentSession({
            skillRecord,
            recursiveAgent,
            promptText,
            options,
        });
    }

}
