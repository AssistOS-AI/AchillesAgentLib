import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Sanitiser } from '../utils/Sanitiser.mjs';
import { getDebugLogger, DEBUG_ACTIVE } from '../utils/DebugLogger.mjs';
import LightSOPLangInterpreter, { DefaultExecutionMonitor } from '../lightSOPLang/index.mjs';

const SECTION_KEYS = {
    instructions: ['instructions', 'guidance', 'overview', 'orchestration-guidance'],
    allowedSkills: ['allowed-skills', 'skill-allowlist', 'skill-allow-list', 'skills'],
    intents: ['intents', 'intentions', 'mappings'],
    fallback: ['fallback', 'fallback-plan', 'fallback-react', 'react-fallback'],
    script: ['light-sop-lang', 'lightsoplang', 'script', 'plan-script'],
};

const parseTimeout = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const SKILL_TIMEOUT_MS = parseTimeout(
    process.env.ACHILLES_ORCHESTRATOR_TIMEOUT
        ?? process.env.ACHILES_ORCHESTRATOR_TIMEOUT
        ?? process.env.ACHILESS_ORCHESTRATOR_TIMEOUT,
    90_000,
);

const withTimeout = (promiseLike, timeoutMs, errorFactory) => {
    let timerHandle;
    const timeoutPromise = new Promise((_, reject) => {
        timerHandle = setTimeout(() => {
            const produced = typeof errorFactory === 'function' ? errorFactory() : errorFactory;
            const error = produced instanceof Error
                ? produced
                : new Error(produced ? String(produced) : 'Operation timed out.');
            reject(error);
        }, timeoutMs);
        if (typeof timerHandle?.unref === 'function') {
            timerHandle.unref();
        }
    });

    const raceTarget = promiseLike instanceof Promise ? promiseLike : Promise.resolve(promiseLike);

    return Promise.race([raceTarget, timeoutPromise]).finally(() => {
        if (timerHandle) {
            clearTimeout(timerHandle);
        }
    });
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
    // Use shortName (without type suffix) for cleaner skill names in prompts
    const displayName = record.shortName || record.name;
    return [
        `- ${displayName}`,
        record.descriptor?.summary ? `  Summary: ${record.descriptor.summary}` : null,
    ].filter(Boolean).join('\n');
}

export class OrchestratorSkillsSubsystem {
    constructor({ llmAgent = null } = {}) {
        this.type = 'orchestrator';
        this.llmAgent = llmAgent;
        this.debugLogger = DEBUG_ACTIVE ? getDebugLogger() : null;
        this.moduleExecutors = new Map();
    }

    prepareSkill(skillRecord) {
        const sections = skillRecord.descriptor?.sections || {};

        const instructions = pickSection(sections, SECTION_KEYS.instructions);
        const allowedSkills = normaliseBulletList(pickSection(sections, SECTION_KEYS.allowedSkills))
            .map((name) => Sanitiser.sanitiseName(name))
            .filter(Boolean);
        const intents = parseIntents(pickSection(sections, SECTION_KEYS.intents));
        const fallback = parseFallback(pickSection(sections, SECTION_KEYS.fallback));

        const folderName = skillRecord.skillDir ? path.basename(skillRecord.skillDir) : null;
        let modulePath = null;
        
        if (folderName && skillRecord.skillDir) {
            const specsDir = path.join(skillRecord.skillDir, 'specs');
            // PRIORITIZE specs folder for generated code
            if (fs.existsSync(specsDir) && fs.statSync(specsDir).isDirectory()) {
                modulePath = path.join(skillRecord.skillDir, 'index.mjs');
            } else {
                // Fallback to handwritten module if no specs
                const manualModulePath = path.join(skillRecord.skillDir, `${folderName}.js`);
                if (fs.existsSync(manualModulePath)) {
                    modulePath = manualModulePath;
                }
            }
        }

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
            script: pickSection(sections, SECTION_KEYS.script) || '',
            modulePath,
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

    buildSkillCommandRegistry({
        promptText,
        allowedSkills,
        recursiveAgent,
        options,
        planEntries,
        executions,
        orchestratorName,
    }) {
        const promptCommand = 'prompt';
        const skillLookup = new Map();

        const registerSkill = (key, record) => {
            if (!key) {
                return;
            }
            skillLookup.set(Sanitiser.sanitiseName(key), record);
        };

        allowedSkills.forEach((record) => {
            registerSkill(record.name, record);
            registerSkill(record.shortName, record);
            if (record.descriptor?.title) {
                registerSkill(record.descriptor.title, record);
            }
        });

        return {
            executeCommand: async ({ command, args }, response) => {
                const normalized = Sanitiser.sanitiseName(command);
                if (normalized === promptCommand) {
                    return response.success(promptText);
                }

                const record = skillLookup.get(normalized);
                if (!record) {
                    const unavailableStep = {
                        intent: '',
                        skill: command,
                        run: false,
                        input: '',
                        reason: `Skill "${command}" is not available for orchestrator`,
                    };
                    planEntries.push(unavailableStep);
                    executions.push({
                        ...unavailableStep,
                        skipped: true,
                        outcome: null,
                        error: unavailableStep.reason,
                    });
                    return response.fail(unavailableStep.reason);
                }

                const [inputArg = promptText, reasonArg = '', intentArg = ''] = Array.isArray(args) ? args : [];
                const intent = intentArg ? Sanitiser.sanitiseName(intentArg) : '';
                const planEntry = {
                    intent,
                    skill: record.name,
                    run: true,
                    input: inputArg || promptText,
                    reason: reasonArg,
                };
                planEntries.push(planEntry);

                let outcome = null;
                let error = null;
                try {
                    outcome = await recursiveAgent.executeWithReviewMode(planEntry.input, {
                        ...options,
                        skillName: record.name,
                    }, options?.reviewMode || 'none');
                } catch (executionError) {
                    error = executionError?.message || String(executionError);
                }

                executions.push({
                    ...planEntry,
                    skipped: false,
                    outcome,
                    error,
                });

                if (error) {
                    return response.fail(error);
                }
                return response.success(`skill ${record.name} executed`);
            },
            listCommands: () => {
                const docs = [{ name: promptCommand, description: 'Return original prompt text' }];
                allowedSkills.forEach((record) => {
                    const label = Sanitiser.sanitiseName(record.shortName || record.name);
                    docs.push({
                        name: label,
                        description: record.descriptor?.summary || record.descriptor?.title || record.name,
                    });
                });
                return docs;
            },
        };
    }

    async executeScriptPlan({
        skillRecord,
        recursiveAgent,
        promptText,
        options,
    }) {
        const script = (skillRecord.metadata?.script || '').trim();
        if (!script) {
            throw new Error(`Orchestrator skill "${skillRecord.name}" is missing a LightSOPLang script section.`);
        }

        const allowedSkills = this.resolveAllowedSkills(skillRecord, recursiveAgent);
        const planEntries = [];
        const executions = [];
        const registry = this.buildSkillCommandRegistry({
            promptText,
            allowedSkills,
            recursiveAgent,
            options,
            planEntries,
            executions,
            orchestratorName: skillRecord.name,
        });

        const interpreter = new LightSOPLangInterpreter(script, registry, promptText, {
            executionMonitor: new DefaultExecutionMonitor({
                commandLimit: Math.max(10, allowedSkills.length * 4)
            }),
            llmAgent: this.llmAgent,
        });

        await interpreter.ready;

        const fallback = skillRecord.metadata?.fallback || null;
        let fallbackExecution = null;
        const allSkippedOrErrored = executions.length
            ? executions.every((entry) => entry.skipped || entry.error)
            : true;

        if (fallback && allSkippedOrErrored) {
            fallbackExecution = await this.executeFallbackReact({
                skillRecord,
                fallback,
                recursiveAgent,
                promptText,
                options,
            });
            if (fallbackExecution) {
                executions.push(fallbackExecution);
                planEntries.push({
                    intent: fallbackExecution.intent || '',
                    skill: fallbackExecution.skill,
                    run: true,
                    input: fallbackExecution.input,
                    reason: fallbackExecution.reason || 'Fallback execution',
                });
            }
        }

        if (fallback && allSkippedOrErrored && !fallbackExecution) {
            throw new Error(`Fallback execution for orchestrator skill "${skillRecord.name}" did not produce a result.`);
        }

        return {
            skill: skillRecord.name,
            metadata: skillRecord.metadata || null,
            result: {
                type: this.type,
                prompt: promptText,
                plan: planEntries,
                notes: '',
                executions,
                fallbackExecution,
                script,
            },
            sessionMemory: null,
        };
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

        this.debugLogger?.log('OrchestratorSkillsSubsystem:createPlan:start', {
            skill: skillRecord.name,
            allowedSkillCount: allowedSkills.length,
        });

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

        // DEBUG: Log the prompt being sent to LLM
        if (process.env.DEBUG_ORCHESTRATOR) {
            console.log('\n[DEBUG] ========== ORCHESTRATOR PROMPT ==========');
            console.log(prompt);
            console.log('[DEBUG] ==========================================\n');
        }

        let rawPlan;
        try {
            // Use deep mode for better reasoning, or override with env var
            const planMode = process.env.ACHILLES_ORCHESTRATOR_MODE || 'fast';
            rawPlan = await this.llmAgent.executePrompt(prompt, {
                mode: planMode,
                context: {
                    intent: 'orchestrator-plan',
                    skillName: skillRecord.name,
                },
                responseShape: 'json',
            });

            // DEBUG: Log the LLM response
            if (process.env.DEBUG_ORCHESTRATOR) {
                console.log('\n[DEBUG] ========== LLM RESPONSE ==========');
                console.log(JSON.stringify(rawPlan, null, 2));
                console.log('[DEBUG] =====================================\n');
            }
        } catch (error) {
            const message = error?.message || String(error);
            this.debugLogger?.log('OrchestratorSkillsSubsystem:createPlan:error', {
                skill: skillRecord.name,
                message,
            });
            throw new Error(`LLM failed to generate orchestration plan for skill "${skillRecord.name}": ${message}`);
        }

        if (!rawPlan || typeof rawPlan !== 'object' || !Array.isArray(rawPlan.plan)) {
            throw new Error(`LLM response for orchestration skill "${skillRecord.name}" did not include a plan array.`);
        }

        // Build lookup map with both full name and shortName for matching
        const allowedLookup = new Map();
        allowedSkills.forEach((record) => {
            // Add full name
            allowedLookup.set(Sanitiser.sanitiseName(record.name), record);
            // Also add shortName if different
            if (record.shortName) {
                allowedLookup.set(Sanitiser.sanitiseName(record.shortName), record);
            }
        });
        const orchestratorKey = Sanitiser.sanitiseName(skillRecord.name);

        // DEBUG: Log allowed skills
        if (process.env.DEBUG_ORCHESTRATOR) {
            console.log('\n[DEBUG] ========== ALLOWED SKILLS ==========');
            console.log('Allowed skill keys:', Array.from(allowedLookup.keys()));
            console.log('Orchestrator key:', orchestratorKey);
            console.log('[DEBUG] =======================================\n');
        }

        const steps = rawPlan.plan.map((step) => {
            if (!step || typeof step.skill !== 'string') {
                throw new Error(`LLM produced an invalid orchestration step for skill "${skillRecord.name}".`);
            }
            const key = Sanitiser.sanitiseName(step.skill);

            // DEBUG: Log skill selection attempt
            if (process.env.DEBUG_ORCHESTRATOR) {
                console.log(`[DEBUG] LLM selected skill: "${step.skill}" -> sanitized key: "${key}"`);
                console.log(`[DEBUG] Is in allowed list: ${allowedLookup.has(key)}`);
            }

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

        const planSummary = {
            plan: steps,
            notes: typeof rawPlan.notes === 'string' ? rawPlan.notes : '',
            allowedSkills,
            fallback: fallbackMetadata,
        };

        this.debugLogger?.log('OrchestratorSkillsSubsystem:createPlan:success', {
            skill: skillRecord.name,
            steps: steps.length,
        });

        return planSummary;
    }

    resolveSkillRecord(nameOrAlias, recursiveAgent) {
        if (!nameOrAlias) {
            return null;
        }
        const key = Sanitiser.sanitiseName(nameOrAlias);
        return recursiveAgent.getSkillRecord(key);
    }

    async executePlanSteps({ plan, recursiveAgent, options, orchestratorName, logger = null }) {
        const log = typeof logger === 'function' ? logger : null;
        const executions = [];
        const total = plan.length || 0;
        log?.(`[plan] Prepared ${total} ${total === 1 ? 'step' : 'steps'} for ${orchestratorName}.`);

        // Get action reporter for step-level feedback
        const actionReporter = recursiveAgent?.getActionReporter?.();

        for (let index = 0; index < plan.length; index += 1) {
            const step = plan[index];
            const stepNum = index + 1;

            // Report step progress
            if (actionReporter && total > 1) {
                actionReporter.reportStep(stepNum, total, `${step.skill || step.intent || 'step'}`);
            }

            if (!step.run) {
                log?.(`[step ${stepNum}/${total || 1}] Skipping ${step.skill || step.intent || '<unknown>'} – flagged as 'run: false'.`);
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
                log?.(`[step ${stepNum}/${total || 1}] Unable to locate skill "${step.skill}".`);
                executions.push({
                    ...step,
                    skipped: true,
                    outcome: null,
                    error: `Skill "${step.skill}" is not available.`,
                });
                continue;
            }

            if (Sanitiser.sanitiseName(skillRecord.name) === Sanitiser.sanitiseName(orchestratorName)) {
                log?.(`[step ${stepNum}/${total || 1}] Prevented recursive invocation of ${skillRecord.name}.`);
                executions.push({
                    ...step,
                    skipped: true,
                    outcome: null,
                    error: 'Orchestrator skills cannot invoke themselves.',
                });
                continue;
            }

            try {
                log?.(`[step ${stepNum}/${total || 1}] Running ${skillRecord.name}: ${step.input || '<no prompt>'}`);
                // Exclude 'args.input' from forwarded options - let step.input become the new input
                // but preserve any other custom args that were passed to the orchestrator
                const { args: originalArgs, ...restOptions } = options || {};
                const { input: _excludedInput, ...preservedArgs } = originalArgs || {};
                const nestedOptions = { ...restOptions, args: preservedArgs };
                const outcome = await recursiveAgent.executeWithReviewMode(step.input || '', {
                    ...nestedOptions,
                    skillName: skillRecord.name,
                }, options?.reviewMode || 'none');

                log?.(`[step ${stepNum}/${total || 1}] Completed ${skillRecord.name}.`);
                executions.push({
                    ...step,
                    skipped: false,
                    outcome,
                    error: null,
                });
            } catch (error) {
                log?.(`[step ${stepNum}/${total || 1}] ${skillRecord.name} failed: ${error?.message || error}`);
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

    async executeSkillPrompt({
        skillRecord,
        recursiveAgent,
        promptText,
        options = {},
    }) {
        if (skillRecord.metadata?.modulePath) {
            return this.executeModuleSkill({
                skillRecord,
                recursiveAgent,
                promptText,
                options,
            });
        }

        const script = (skillRecord.metadata?.script || '').trim();
        if (script) {
            return this.executeScriptPlan({
                skillRecord,
                recursiveAgent,
                promptText,
                options,
            });
        }

        const { logger, ...forwardOptions } = options || {};

        // Report planning phase via ActionReporter
        const actionReporter = recursiveAgent?.getActionReporter?.();
        if (actionReporter) {
            const skillCount = this.resolveAllowedSkills(skillRecord, recursiveAgent).length;
            actionReporter.planningSkills(skillCount);
        }

        const planData = await this.createPlan({ skillRecord, recursiveAgent, promptText });

        // Report plan created
        if (actionReporter && planData.plan?.length > 0) {
            actionReporter.updateAction(`Planned ${planData.plan.length} step(s)`);
        }

        const executions = await this.executePlanSteps({
            plan: planData.plan,
            recursiveAgent,
            options: forwardOptions,
            orchestratorName: skillRecord.name,
            logger,
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
                options: forwardOptions,
                logger,
            });
            if (fallbackExecution) {
                executions.push(fallbackExecution);
            }
        }

        this.debugLogger?.log('OrchestratorSkillsSubsystem:executeSkillPrompt', {
            skill: skillRecord.name,
            planSteps: planData.plan.length,
            executions: executions.length,
            fallbackTriggered: Boolean(planData.fallback),
        });

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

    async loadModule(skillRecord) {
        if (!skillRecord.metadata?.modulePath) {
            return null;
        }
        if (this.moduleExecutors.has(skillRecord.name)) {
            return this.moduleExecutors.get(skillRecord.name);
        }
        const moduleUrl = pathToFileURL(skillRecord.metadata.modulePath);
        const imported = await import(moduleUrl.href);
        const handler = typeof imported.action === 'function'
            ? imported.action
            : (typeof imported.default === 'function' ? imported.default : null);
        if (typeof handler !== 'function') {
            throw new Error(`Orchestrator module at ${skillRecord.metadata.modulePath} must export an action() function.`);
        }
        this.moduleExecutors.set(skillRecord.name, handler);
        return handler;
    }

    async executeModuleSkill({ skillRecord, recursiveAgent, promptText, options }) {
        const { logger, ...forwardOptions } = options || {};
        const log = typeof logger === 'function' ? logger : null;
        const action = await this.loadModule(skillRecord);
        const context = {
            prompt: promptText,
            args: forwardOptions.args || {},
            llmAgent: this.llmAgent,
            recursiveAgent,
            metadata: skillRecord.metadata,
            skillRecord,
            context: forwardOptions.context || {},
        };
        log?.('[module] Executing orchestrator module.');
        const result = await withTimeout(
            Promise.resolve(action(context)),
            SKILL_TIMEOUT_MS,
            () => new Error(`Orchestrator skill "${skillRecord.name}" timed out after ${SKILL_TIMEOUT_MS}ms.`),
        );
        log?.('[module] Orchestrator module completed.');
        return {
            skill: skillRecord.name,
            metadata: skillRecord.metadata || null,
            result: {
                type: this.type,
                prompt: promptText,
                output: result,
            },
            sessionMemory: null,
        };
    }
}
