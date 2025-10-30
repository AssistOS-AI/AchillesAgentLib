import { Sanitiser } from '../utils/Sanitiser.mjs';

const SECTION_KEYS = {
    instructions: ['instructions', 'guidance', 'overview', 'orchestration-guidance'],
    allowedSkills: ['allowed-skills', 'skill-allowlist', 'skill-allow-list', 'skills'],
    intents: ['intents', 'intentions', 'mappings'],
    fallback: ['fallback', 'fallback-plan', 'fallback-react', 'react-fallback'],
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

function buildSkillSummary(record) {
    return [
        `- ${record.name}`,
        record.descriptor?.summary ? `  Summary: ${record.descriptor.summary}` : null,
    ].filter(Boolean).join('\n');
}

export class OrchestratorSkillsSubsystem {
    constructor({ llmAgent = null } = {}) {
        this.type = 'orchestrator';
        this.llmAgent = llmAgent;
    }

    prepareSkill(skillRecord) {
        const sections = skillRecord.descriptor?.sections || {};

        const instructions = pickSection(sections, SECTION_KEYS.instructions);
        const allowedSkills = normaliseBulletList(pickSection(sections, SECTION_KEYS.allowedSkills))
            .map((name) => Sanitiser.sanitiseName(name))
            .filter(Boolean);
        const intents = parseIntents(pickSection(sections, SECTION_KEYS.intents));
        const fallback = parseFallback(pickSection(sections, SECTION_KEYS.fallback));

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

    buildSelectionPrompt({
        skillRecord,
        promptText,
        intents,
        allowedSkillSummaries,
    }) {
        const header = [
            '# Orchestration Planner',
            skillRecord.metadata?.instructions || 'Plan skill invocations to satisfy the user request.',
            '',
            '## User Request',
            promptText || '<empty>',
            '',
        ];

        const intentLines = intents.length
            ? ['## Known Intents', ...intents.map((intent) => `- ${intent.id}: ${intent.description || 'n/a'}`), '']
            : [];

        const skillsSection = [
            '## Available Skills',
            allowedSkillSummaries.length ? allowedSkillSummaries.join('\n') : '- <none>',
            '',
            'Respond in JSON with the following structure:',
            '{',
            '  "plan": [',
            '    { "intent": "string", "skill": "skill-name", "input": "text", "run": true, "reason": "short" }',
            '  ],',
            '  "notes": "optional summary"',
            '}',
            '',
            'Every "skill" must match one of the allowed skills.',
            'Set "run": false when a step should be skipped after evaluation.',
        ];

        return [...header, ...intentLines, ...skillsSection].join('\n');
    }

    async createPlan({ skillRecord, recursiveAgent, promptText }) {
        const allowedSkills = this.resolveAllowedSkills(skillRecord, recursiveAgent);
        const allowedSkillSummaries = allowedSkills.map(buildSkillSummary);
        const fallbackMetadata = skillRecord.metadata?.fallback || null;

        if (!this.llmAgent || typeof this.llmAgent.executePrompt !== 'function') {
            throw new Error(`Orchestrator skill "${skillRecord.name}" requires an LLMAgent with executePrompt.`);
        }

        if (!allowedSkills.length) {
            if (fallbackMetadata) {
                return {
                    plan: [],
                    notes: 'No eligible skills available; using fallback instructions.',
                    allowedSkills,
                    fallback: fallbackMetadata,
                };
            }
            throw new Error(`Orchestrator skill "${skillRecord.name}" has no eligible downstream skills.`);
        }

        const prompt = this.buildSelectionPrompt({
            skillRecord,
            promptText,
            intents: skillRecord.metadata?.intents || [],
            allowedSkillSummaries,
        });

        let rawPlan;
        try {
            rawPlan = await this.llmAgent.executePrompt(prompt, {
                mode: 'fast',
                context: {
                    intent: 'orchestrator-plan',
                    skillName: skillRecord.name,
                },
                responseShape: 'json',
            });
        } catch (error) {
            const message = error?.message || String(error);
            throw new Error(`LLM failed to generate orchestration plan for skill "${skillRecord.name}": ${message}`);
        }

        if (!rawPlan || typeof rawPlan !== 'object' || !Array.isArray(rawPlan.plan)) {
            throw new Error(`LLM response for orchestration skill "${skillRecord.name}" did not include a plan array.`);
        }

        const allowedLookup = new Map(allowedSkills.map((record) => [
            Sanitiser.sanitiseName(record.name),
            record,
        ]));
        const orchestratorKey = Sanitiser.sanitiseName(skillRecord.name);

        const steps = rawPlan.plan.map((step) => {
            if (!step || typeof step.skill !== 'string') {
                throw new Error(`LLM produced an invalid orchestration step for skill "${skillRecord.name}".`);
            }
            const key = Sanitiser.sanitiseName(step.skill);
            let record = allowedLookup.get(key);
            if (!record && key === orchestratorKey) {
                record = skillRecord;
            }
            if (!record) {
                throw new Error(`LLM selected skill "${step.skill}" which is not permitted for orchestrator "${skillRecord.name}".`);
            }
            return {
                intent: typeof step.intent === 'string' ? Sanitiser.sanitiseName(step.intent) : '',
                skill: record.name,
                run: step.run !== false,
                input: typeof step.input === 'string' && step.input.trim() ? step.input : promptText,
                reason: typeof step.reason === 'string' ? step.reason : '',
            };
        });

        if (!steps.length && !fallbackMetadata) {
            throw new Error(`LLM did not provide any executable orchestration steps for skill "${skillRecord.name}".`);
        }

        return {
            plan: steps,
            notes: typeof rawPlan.notes === 'string' ? rawPlan.notes : '',
            allowedSkills,
            fallback: fallbackMetadata,
        };
    }

    resolveSkillRecord(nameOrAlias, recursiveAgent) {
        if (!nameOrAlias) {
            return null;
        }
        const key = Sanitiser.sanitiseName(nameOrAlias);
        return recursiveAgent.getSkillRecord(key);
    }

    async executePlanSteps({ plan, recursiveAgent, options, orchestratorName }) {
        const executions = [];

        for (const step of plan) {
            if (!step.run) {
                executions.push({
                    ...step,
                    skipped: true,
                    outcome: null,
                    error: null,
                });
                continue;
            }

            const skillRecord = this.resolveSkillRecord(step.skill, recursiveAgent);
            if (!skillRecord) {
                executions.push({
                    ...step,
                    skipped: true,
                    outcome: null,
                    error: `Skill "${step.skill}" is not available.`,
                });
                continue;
            }

            if (Sanitiser.sanitiseName(skillRecord.name) === Sanitiser.sanitiseName(orchestratorName)) {
                executions.push({
                    ...step,
                    skipped: true,
                    outcome: null,
                    error: 'Orchestrator skills cannot invoke themselves.',
                });
                continue;
            }

            try {
                const outcome = await recursiveAgent.executeWithReviewMode(step.input || '', {
                    ...options,
                    skillName: skillRecord.name,
                }, options?.reviewMode || 'none');

                executions.push({
                    ...step,
                    skipped: false,
                    outcome,
                    error: null,
                });
            } catch (error) {
                executions.push({
                    ...step,
                    skipped: false,
                    outcome: null,
                    error: error?.message || String(error),
                });
            }
        }

        return executions;
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
    }) {
        if (!fallback || !fallback.instructions) {
            return null;
        }

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

        const outcome = await mcpSubsystem.executeSkillPrompt({
            skillRecord: dynamicRecord,
            recursiveAgent,
            promptText,
            options: {
                ...options,
                availableTools: filteredTools,
            },
        });

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

    async executeSkillPrompt({
        skillRecord,
        recursiveAgent,
        promptText,
        options = {},
    }) {
        const planData = await this.createPlan({ skillRecord, recursiveAgent, promptText });
        const executions = await this.executePlanSteps({
            plan: planData.plan,
            recursiveAgent,
            options,
            orchestratorName: skillRecord.name,
        });

        let fallbackExecution = null;
        const allSkippedOrErrored = executions.length
            ? executions.every((entry) => entry.skipped || entry.error)
            : true;
        if (planData.fallback && allSkippedOrErrored) {
            fallbackExecution = await this.executeFallbackReact({
                skillRecord,
                fallback: planData.fallback,
                recursiveAgent,
                promptText,
                options,
            });
            if (fallbackExecution) {
                executions.push(fallbackExecution);
            }
        }

        if (planData.fallback && allSkippedOrErrored && !fallbackExecution) {
            throw new Error(`Fallback execution for orchestrator skill "${skillRecord.name}" did not produce a result.`);
        }

        return {
            skill: skillRecord.name,
            metadata: skillRecord.metadata || null,
            result: {
                type: this.type,
                prompt: promptText,
                plan: planData.plan,
                notes: planData.notes,
                executions,
                fallbackExecution,
            },
            sessionMemory: null,
        };
    }
}
