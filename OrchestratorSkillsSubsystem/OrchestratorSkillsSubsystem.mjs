import { Sanitiser } from '../utils/Sanitiser.mjs';
import { getDebugLogger, DEBUG_ACTIVE } from '../utils/DebugLogger.mjs';
import { SESSION_STATUS_AWAITING_INPUT, SESSION_KEY_PREFIX } from '../LLMAgents/constants.mjs';
import { parseSkillDocument } from '../utils/skillDocumentParser.mjs';

const DEBUG_ENABLED = String(process.env.ACHILLES_DEBUG ?? '').toLowerCase() === 'true';

function debugLog(...args) {
    if (DEBUG_ENABLED) console.log(...args);
}

const SECTION_KEYS = {
    instructions: ['instructions', 'guidance', 'overview', 'orchestration-guidance'],
    preparation: ['preparation', 'prep', 'context-prep'],
    allowedSkills: ['allowed-skills', 'skill-allowlist', 'skill-allow-list', 'skills'],
    allowedPrepSkills: ['allowed-prep-skills', 'allowed-preparation-skills', 'prep-skills'],
    description: ['description'],
    sessionType: ['session', 'session type', 'session-type', 'session_type'],
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

function hasSection(sections = {}, aliases = []) {
    for (const alias of aliases) {
        const key = alias.trim().toLowerCase();
        if (sections && Object.prototype.hasOwnProperty.call(sections, key)) {
            return true;
        }
    }
    return false;
}

function buildLoopSystemPrompt(skillRecord) {
    const sections = skillRecord.descriptor?.sections || skillRecord.preparedConfig?.sections || {};
    const descriptionText = pickSection(sections, SECTION_KEYS.description).trim();
    const instructionsText = skillRecord.preparedConfig?.instructions || '';
    const lines = [];
    lines.push('You must execute a skill that has the following description:');
    if (descriptionText) {
        lines.push(descriptionText);
    }
    lines.push('To do this you must respect the following instructions:');
    if (instructionsText) {
        lines.push(instructionsText);
    }
    return lines.join('\n');
}

export class OrchestratorSkillsSubsystem {
    constructor({ llmAgent = null, tierConfig = null, modelConfig = null } = {}) {
        this.type = 'orchestrator';
        this.llmAgent = llmAgent;
        this.tierConfig = modelConfig || tierConfig || { plan: 'plan', execution: 'fast', code: 'code' };
        this.debugLogger = DEBUG_ACTIVE ? getDebugLogger() : null;
    }

    parseSkillDescriptor({ filePath }) {
        return parseSkillDocument(filePath);
    }

    prepareSkill(skillRecord) {
        const sections = skillRecord.descriptor?.sections || {};

        const instructions = pickSection(sections, SECTION_KEYS.instructions);
        const preparation = pickSection(sections, SECTION_KEYS.preparation);
        const allowedSkills = normaliseBulletList(pickSection(sections, SECTION_KEYS.allowedSkills))
            .map((name) => Sanitiser.sanitiseName(name))
            .filter(Boolean);
        const allowedPrepSkillsSectionPresent = hasSection(sections, SECTION_KEYS.allowedPrepSkills);
        const allowedPrepSkills = normaliseBulletList(pickSection(sections, SECTION_KEYS.allowedPrepSkills))
            .map((name) => Sanitiser.sanitiseName(name))
            .filter(Boolean);
        const description = pickSection(sections, SECTION_KEYS.description);
        const rawSessionType = pickSection(sections, SECTION_KEYS.sessionType).trim();
        const sessionType = rawSessionType && rawSessionType.toLowerCase() === 'loop'
            ? 'loop'
            : null;

        debugLog(`[Orchestrator] prepareSkill "${skillRecord.name}" sections=${JSON.stringify(Object.keys(sections))} sessionType="${sessionType}"`);

        skillRecord.preparedConfig = {
            type: this.type,
            name: skillRecord.descriptor?.name || null,
            rawContent: skillRecord.descriptor?.rawContent || null,
            sections,
            instructions,
            preparation: preparation || null,
            allowedSkills,
            allowedPrepSkills,
            allowedPrepSkillsSectionPresent,
            description,
            sessionType: sessionType || null,
        };
    }

    resolveAllowedSkills(skillRecord, recursiveAgent) {
        const allSkills = Array.from(recursiveAgent.skillCatalog.values());
        const selfCanonical = Sanitiser.sanitiseName(skillRecord.name);
        const allowList = skillRecord.preparedConfig?.allowedSkills || [];

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

    resolveAllowedPrepSkills(skillRecord, recursiveAgent, fallbackSkills = null) {
        const allowList = skillRecord.preparedConfig?.allowedPrepSkills || [];
        const sectionPresent = Boolean(skillRecord.preparedConfig?.allowedPrepSkillsSectionPresent);

        if (!sectionPresent) {
            return Array.isArray(fallbackSkills)
                ? fallbackSkills
                : this.resolveAllowedSkills(skillRecord, recursiveAgent);
        }

        if (!allowList.length) {
            return [];
        }

        const allSkills = Array.from(recursiveAgent.skillCatalog.values());
        const selfCanonical = Sanitiser.sanitiseName(skillRecord.name);

        return allSkills.filter((record) => {
            const canonical = Sanitiser.sanitiseName(record.name);
            if (canonical === selfCanonical) {
                return false;
            }
            return allowList.includes(canonical) || allowList.includes(Sanitiser.sanitiseName(record.shortName));
        });
    }

    async buildSkillsAsTools(allowedSkills, recursiveAgent, options) {
        const tools = {};
        // Forward context (sessionMemory, user, etc.) from the orchestrator's options
        const forwardedContext = options?.context || {};
        // Use skillPlan tier for inner skill calls (falls back to execution tier)
        const skillTier = this.tierConfig?.skillPlan || this.tierConfig?.execution || options?.mode || null;

        for (const skillRecord of allowedSkills) {
            const toolName = Sanitiser.sanitiseName(skillRecord.shortName || skillRecord.name);
            // Return a standard function that calls the skill via RecursiveSkilledAgent
            // This allows each subsystem to access any skill uniformly
            tools[toolName] = async (agent, promptText) => {
                // Coerce promptText to string — planner may pass objects from previous tool results
                const safePrompt = typeof promptText === 'string'
                    ? promptText
                    : (promptText != null ? JSON.stringify(promptText) : '');

                const execOptions = {
                    skillName: skillRecord.name,
                    context: forwardedContext,
                    sessionMemory: forwardedContext.sessionMemory || null,
                };
                if (skillTier) execOptions.tier = skillTier;
                const executionResult = await recursiveAgent.executePrompt(safePrompt, execOptions);
                // Serialize non-string results so downstream tools receive valid text
                const result = executionResult?.result;
                if (result == null) return '';
                if (typeof result === 'string') return result;
                try { return JSON.stringify(result); } catch { return String(result); }
            };
        }

        return tools;
    }

    buildToolDescriptions(allowedSkills) {
        const descriptions = {};
        allowedSkills.forEach(skillRecord => {
            const toolName = Sanitiser.sanitiseName(skillRecord.shortName || skillRecord.name);
            descriptions[toolName] = skillRecord.descriptor?.rawContent || skillRecord.descriptor?.name || skillRecord.name;
        });
        return descriptions;
    }

    buildToolsWithDescriptions(allowedSkills, tools, descriptions) {
        const toolsWithDescriptions = {};
        allowedSkills.forEach(skillRecord => {
            const toolName = Sanitiser.sanitiseName(skillRecord.shortName || skillRecord.name);
            toolsWithDescriptions[toolName] = {
                handler: tools[toolName],
                description: descriptions[toolName],
            };
        });
        return toolsWithDescriptions;
    }

    buildCommandsRegistry(allowedSkills, tools) {
        return {
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
                description: s.descriptor?.name || s.name,
            })),
        };
    }



    async executeLoopAgentSession({skillRecord, recursiveAgent, promptText, options}) {
        const sessionMemory = options?.context?.sessionMemory || options?.sessionMemory || null;
        const sessionKey = `${SESSION_KEY_PREFIX}${Sanitiser.sanitiseName(skillRecord.name)}`;
        
        // Check for existing session in awaiting_input state
        let session = sessionMemory?.get?.(sessionKey) || null;
        let result;
        
        const allowedSkills = this.resolveAllowedSkills(skillRecord, recursiveAgent);
        const allowedPrepSkills = this.resolveAllowedPrepSkills(skillRecord, recursiveAgent, allowedSkills);
        const tools = await this.buildSkillsAsTools(allowedSkills, recursiveAgent, options);
        const descriptions = this.buildToolDescriptions(allowedSkills);

        const toolsWithDescriptions = this.buildToolsWithDescriptions(allowedSkills, tools, descriptions);
        const prepTools = await this.buildSkillsAsTools(allowedPrepSkills, recursiveAgent, options);
        const prepDescriptions = this.buildToolDescriptions(allowedPrepSkills);
        const prepToolsWithDescriptions = this.buildToolsWithDescriptions(allowedPrepSkills, prepTools, prepDescriptions);

        const preparation = skillRecord.preparedConfig?.preparation
            ? { text: skillRecord.preparedConfig.preparation, retries: 1, tools: prepToolsWithDescriptions }
            : null;

        if (session && session.status === SESSION_STATUS_AWAITING_INPUT) {
            // Reuse existing session - continue the conversation
            // Preparation runs internally in newPrompt() via session.preparation
            debugLog(`[Orchestrator] Resuming existing LoopSession for "${skillRecord.name}" (status: ${session.status})`);
            result = await session.newPrompt(promptText);
        } else {
            // Create new session
            const baseSystemPrompt = buildLoopSystemPrompt(skillRecord);

            const sessionOptions = {
                systemPrompt: baseSystemPrompt,
                tier: options?.tier || options?.mode || this.tierConfig.plan || 'plan',
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
            preparedConfig: skillRecord.preparedConfig || null,
            result: result,
            session: 'loop',
            sessionMemory: sessionMemory,
        };
    }

    async executeSOPAgentSession({skillRecord, recursiveAgent, promptText, options}) {
        const allowedSkills = this.resolveAllowedSkills(skillRecord, recursiveAgent);
        const allowedPrepSkills = this.resolveAllowedPrepSkills(skillRecord, recursiveAgent, allowedSkills);
        const tools = await this.buildSkillsAsTools(allowedSkills, recursiveAgent, options);
        const skillsDescription = this.buildToolDescriptions(allowedSkills);
        const commandsRegistry = this.buildCommandsRegistry(allowedSkills, tools);
        const prepTools = await this.buildSkillsAsTools(allowedPrepSkills, recursiveAgent, options);
        const prepSkillsDescription = this.buildToolDescriptions(allowedPrepSkills);
        const prepCommandsRegistry = this.buildCommandsRegistry(allowedPrepSkills, prepTools);

        const preparation = skillRecord.preparedConfig?.preparation
            ? {
                text: skillRecord.preparedConfig.preparation,
                retries: 1,
                skillsDescription: prepSkillsDescription,
                commandsRegistry: prepCommandsRegistry,
            }
            : null;

        const sessionOptions = {
            systemPrompt: skillRecord.preparedConfig?.instructions || 'Plan and execute skills to satisfy the user request.',
            tier: options?.tier || options?.mode || this.tierConfig.plan || 'plan',
            planOnly: false,
            commandsRegistry,
            preparation,
            planGeneratorOptions: {
                llmMode: options?.planTier || this.tierConfig.plan || 'plan',
            },
            interpreterOptions: {
                llmMode: options?.executionTier || this.tierConfig.execution || 'fast',
            },
        };

        const session = await this.llmAgent.startSOPLangAgentSession(skillsDescription, promptText, sessionOptions);
        const variables = await session.getVariables();
        const result = session.getLastResult();

        return {
            skill: skillRecord.name,
            preparedConfig: skillRecord.preparedConfig || null,
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
        const sessionType = String(skillRecord.preparedConfig?.sessionType || '').trim().toLowerCase();
        debugLog(`[Orchestrator] Skill "${skillRecord.name}" sessionType="${sessionType}" → ${sessionType === 'loop' ? 'LoopSession' : 'SOPSession'}`);
        if (sessionType === 'loop') {
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
