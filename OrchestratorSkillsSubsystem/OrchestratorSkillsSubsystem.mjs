import { Sanitiser } from '../utils/Sanitiser.mjs';
import { getDebugLogger, DEBUG_ACTIVE } from '../utils/DebugLogger.mjs';
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

function buildContextualSystemPrompt(basePrompt, context) {
    if (!context || typeof context !== 'object' || !context.parentSession || typeof context.parentSession !== 'object') {
        return basePrompt;
    }

    return [
        basePrompt,
        '',
        'Parent MainAgent conversation context follows. Use it to resolve follow-up references, confirmations, prior user messages, prior assistant replies, and prior tool calls.',
        '<parent-session-context>',
        stringifyContextValue(context.parentSession),
        '</parent-session-context>',
    ].join('\n');
}

function stringifyContextValue(value) {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

export class OrchestratorSkillsSubsystem {
    constructor({ mainAgent = null, modelConfig = null } = {}) {
        this.type = 'orchestrator';
        this.mainAgent = mainAgent;
        this.modelConfig = modelConfig || { plan: 'plan', code: 'code' };
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

    /**
     * Initialize a skill — async, heavy operations.
     *
     * No initialization needed for orchestrator skills.
     *
     * @param {Object} skillRecord - The skill record to initialize
     * @param {MainAgent} mainAgent - The main agent instance
     */
    async buildSkill(skillRecord, mainAgent) {
        // No initialization needed for orchestrator skills.
    }

    resolveAllowedSkills(skillRecord, mainAgent) {
        const allSkills = mainAgent.getSkills();
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

    resolveAllowedPrepSkills(skillRecord, mainAgent, fallbackSkills = null) {
        const allowList = skillRecord.preparedConfig?.allowedPrepSkills || [];
        const sectionPresent = Boolean(skillRecord.preparedConfig?.allowedPrepSkillsSectionPresent);

        if (!sectionPresent) {
            return Array.isArray(fallbackSkills)
                ? fallbackSkills
                : this.resolveAllowedSkills(skillRecord, mainAgent);
        }

        if (!allowList.length) {
            return [];
        }

        const allSkills = mainAgent.getSkills();
        const selfCanonical = Sanitiser.sanitiseName(skillRecord.name);

        return allSkills.filter((record) => {
            const canonical = Sanitiser.sanitiseName(record.name);
            if (canonical === selfCanonical) {
                return false;
            }
            return allowList.includes(canonical) || allowList.includes(Sanitiser.sanitiseName(record.shortName));
        });
    }

    async buildSkillsAsTools(allowedSkills, mainAgent, options) {
        const tools = {};
        const forwardedContext = options?.context || {};
        const skillModel = this.modelConfig?.plan || options?.model || null;
        const forwardedSignal = options?.signal || null;

        for (const skillRecord of allowedSkills) {
            const toolName = Sanitiser.sanitiseName(skillRecord.shortName || skillRecord.name);
            tools[toolName] = async (agent, promptText, executionOptions = {}) => {
                const safePrompt = typeof promptText === 'string'
                    ? promptText
                    : (promptText != null ? JSON.stringify(promptText) : '');

                const execOptions = {
                    context: forwardedContext,
                    signal: executionOptions?.signal || forwardedSignal,
                    supervisor: executionOptions?.session?.supervisor || options?.supervisor || mainAgent?.supervisor || null,
                };
                if (skillModel) execOptions.model = skillModel;
                const executionResult = await mainAgent.executeSkill(skillRecord.name, safePrompt, execOptions);
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

    buildCommandsRegistry(allowedSkills, tools, options = {}) {
        const llmAgent = this.mainAgent?.llmAgent || null;
        const forwardedSignal = options?.signal || null;
        return {
            executeCommand: async (payload, response) => {
                const { command, args } = payload;
                const skillAction = tools[command];

                if (!skillAction) {
                    return response.fail(`Unknown skill: ${command}`);
                }

                try {
                    const executionOptions = { signal: forwardedSignal };
                    if (Array.isArray(args)) {
                        const prompt = args.join(' ');
                        const result = await skillAction(llmAgent, prompt, executionOptions);
                        return response.success(result);
                    }
                    const result = await skillAction(llmAgent, args, executionOptions);
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

    async executeLoopAgentSession({skillRecord, promptText, options}) {
        const llmAgent = this.mainAgent?.llmAgent;
        if (!llmAgent || typeof llmAgent.startLoopAgentSession !== 'function') {
            throw new Error('OrchestratorSkillsSubsystem requires mainAgent.llmAgent.startLoopAgentSession.');
        }
        const allowedSkills = this.resolveAllowedSkills(skillRecord, this.mainAgent);
        const allowedPrepSkills = this.resolveAllowedPrepSkills(skillRecord, this.mainAgent, allowedSkills);
        const tools = await this.buildSkillsAsTools(allowedSkills, this.mainAgent, options);
        const descriptions = this.buildToolDescriptions(allowedSkills);

        const toolsWithDescriptions = this.buildToolsWithDescriptions(allowedSkills, tools, descriptions);
        const prepTools = await this.buildSkillsAsTools(allowedPrepSkills, this.mainAgent, options);
        const prepDescriptions = this.buildToolDescriptions(allowedPrepSkills);
        const prepToolsWithDescriptions = this.buildToolsWithDescriptions(allowedPrepSkills, prepTools, prepDescriptions);

        const preparation = skillRecord.preparedConfig?.preparation
            ? { text: skillRecord.preparedConfig.preparation, retries: 1, tools: prepToolsWithDescriptions }
            : null;

        const baseSystemPrompt = buildLoopSystemPrompt(skillRecord);
        const contextualSystemPrompt = buildContextualSystemPrompt(baseSystemPrompt, options?.context);

        const sessionOptions = {
            systemPrompt: contextualSystemPrompt,
            model: options?.model || this.modelConfig.plan || 'plan',
            maxStepsPerTurn: 20,
            preparation,
            supervisor: options?.supervisor || this.mainAgent?.supervisor || null,
            signal: options?.signal || null,
        };

        const session = await llmAgent.startLoopAgentSession(toolsWithDescriptions, promptText, sessionOptions);
        const result = session.getLastResult();

        return {
            skill: skillRecord.name,
            preparedConfig: skillRecord.preparedConfig || null,
            result,
            session: 'loop',
        };
    }

    async executeSOPAgentSession({skillRecord, promptText, options}) {
        const llmAgent = this.mainAgent?.llmAgent;
        if (!llmAgent || typeof llmAgent.startSOPLangAgentSession !== 'function') {
            throw new Error('OrchestratorSkillsSubsystem requires mainAgent.llmAgent.startSOPLangAgentSession.');
        }
        const allowedSkills = this.resolveAllowedSkills(skillRecord, this.mainAgent);
        const allowedPrepSkills = this.resolveAllowedPrepSkills(skillRecord, this.mainAgent, allowedSkills);
        const tools = await this.buildSkillsAsTools(allowedSkills, this.mainAgent, options);
        const skillsDescription = this.buildToolDescriptions(allowedSkills);
        const commandsRegistry = this.buildCommandsRegistry(allowedSkills, tools, options);
        const prepTools = await this.buildSkillsAsTools(allowedPrepSkills, this.mainAgent, options);
        const prepSkillsDescription = this.buildToolDescriptions(allowedPrepSkills);
        const prepCommandsRegistry = this.buildCommandsRegistry(allowedPrepSkills, prepTools, options);

        const preparation = skillRecord.preparedConfig?.preparation
            ? {
                text: skillRecord.preparedConfig.preparation,
                retries: 1,
                skillsDescription: prepSkillsDescription,
                commandsRegistry: prepCommandsRegistry,
            }
            : null;

        const baseSystemPrompt = skillRecord.preparedConfig?.instructions || 'Plan and execute skills to satisfy the user request.';
        const contextualSystemPrompt = buildContextualSystemPrompt(baseSystemPrompt, options?.context);

        const sessionOptions = {
            systemPrompt: contextualSystemPrompt,
            model: options?.model || this.modelConfig.plan || 'plan',
            planOnly: false,
            commandsRegistry,
            preparation,
            planGeneratorOptions: {
                llmModel: options?.planModel || options?.model || this.modelConfig.plan || 'plan',
            },
            interpreterOptions: {
                llmModel: options?.planModel || options?.model || this.modelConfig.plan || 'plan',
            },
            signal: options?.signal || null,
        };

        const session = await llmAgent.startSOPLangAgentSession(skillsDescription, promptText, sessionOptions);
        const variables = await session.getVariables();
        const result = session.getLastResult();

        return {
            skill: skillRecord.name,
            preparedConfig: skillRecord.preparedConfig || null,
            result,
            variables,
            session: 'sop',
        };
    }

    async executeSkillPrompt({
        skillRecord,
        promptText,
        options = {},
    }) {
        const sessionType = String(skillRecord.preparedConfig?.sessionType || '').trim().toLowerCase();
        debugLog(`[Orchestrator] Skill "${skillRecord.name}" sessionType="${sessionType}" → ${sessionType === 'loop' ? 'LoopSession' : 'SOPSession'}`);
        if (sessionType === 'loop') {
            return this.executeLoopAgentSession({
                skillRecord,
                promptText,
                options,
            });
        }
        return this.executeSOPAgentSession({
            skillRecord,
            promptText,
            options,
        });
    }

}
