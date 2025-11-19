import { intentionToSkillPlan } from '../intentionToSkill.mjs';
import { ensureBootstrap } from './bootstrapHelpers.mjs';
import {
    runSkill,
    printPlan,
    printExecutions,
    formatExecutionResult,
    printSpecActionPreview,
    printSpecificationDetails,
} from './executionHelpers.mjs';
import {
    COLOR_INFO,
    COLOR_WARN,
    COLOR_ERROR,
    COLOR_RESET,
} from './styles.mjs';

const RESUME_KEYWORDS = ['continua', 'continue', 'resume', '/continue', '/resume'];

export const parseResumeInput = (value) => {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    const normalized = trimmed.toLowerCase();
    const base = RESUME_KEYWORDS.find((keyword) => normalized === keyword || normalized.startsWith(`${keyword} `));
    if (!base) {
        return null;
    }
    const extra = trimmed.slice(base.length).trim();
    return { resume: true, extra };
};

export const detectResumeInput = async (cli, text) => {
    const direct = parseResumeInput(text);
    if (direct) {
        return direct;
    }
    if (!cli.llmAgent || typeof cli.llmAgent.executePrompt !== 'function') {
        return null;
    }
    const prompt = [
        '# Resume Intent Detector',
        'Determine whether the following user message is asking to continue or resume a paused workflow.',
        'Respond with strict JSON using the shape: { "resume": true|false, "extra": "optional instructions" }.',
        'Set "resume" to true when the intent clearly means continue/resume/pick up where we left off, even if written in another language.',
        `Message:\n${text}`,
    ].join('\n\n');
    try {
        const response = await cli.llmAgent.executePrompt(prompt, {
            responseShape: 'json',
            context: { intent: 'resume-detection' },
            mode: 'fast',
        });
        if (response && response.resume) {
            return {
                resume: true,
                extra: typeof response.extra === 'string' ? response.extra.trim() : '',
            };
        }
    } catch {
        // ignore detection errors
    }
    return null;
};

export const preparePlan = async (cli, taskText) => {
    const trimmed = typeof taskText === 'string' ? taskText.trim() : '';
    if (!trimmed) {
        return [];
    }

    await ensureBootstrap(cli, trimmed);
    const orchestrators = cli.getOrchestrators();
    const languageContract = cli.buildLanguageContract();

    const { plan, error } = await intentionToSkillPlan({
        llmAgent: cli.llmAgent,
        taskDescription: trimmed,
        orchestrators,
        languageContract,
        modelMode: cli.defaultModelMode,
    });

    if (error) {
        throw new Error(error);
    }

    if (!plan.length) {
        if (!orchestrators.length) {
            throw new Error('No orchestrator skills are available in the current catalog. Use /list to verify installed skills.');
        }
        throw new Error('Planner did not produce any steps for this request. Refine the prompt or register additional orchestrator skills.');
    }

    return plan;
};

export const executePlan = async (cli, planSteps = [], options = {}) => {
    const announceProgress = Boolean(options?.announceProgress);
    const startIndex = Number.isInteger(options?.startIndex) && options.startIndex > 0
        ? options.startIndex
        : 0;
    const executions = [];
    const total = planSteps.length;
    let cancelled = false;
    cli.planInProgress = true;
    cli.cancelRequested = false;
    if (cli.pendingPlan) {
        cli.pendingPlan.nextIndex = startIndex;
    }
    try {
        for (let index = startIndex; index < planSteps.length; index += 1) {
            if (cli.cancelRequested) {
                cancelled = true;
                break;
            }
            const step = planSteps[index];
            if (cli.pendingPlan) {
                cli.pendingPlan.nextIndex = index;
            }
            const record = cli.findSkill(step.skill);
            if (!record) {
                if (announceProgress) {
                    cli.output.write(`${COLOR_WARN}[exec] (${index + 1}/${total}) Missing skill "${step.skill}".${COLOR_RESET}\n`);
                }
                executions.push({
                    ...step,
                    status: 'failed',
                    error: `Skill "${step.skill}" not found.`,
                });
                // eslint-disable-next-line no-continue
                continue;
            }

            try {
                if (announceProgress) {
                    cli.output.write(`${COLOR_INFO}[exec] (${index + 1}/${total}) Running ${record.name} ← ${step.prompt}${COLOR_RESET}\n`);
                }
                // eslint-disable-next-line no-await-in-loop
                const result = await runSkill(cli, record, step.prompt);
                const payload = result?.result || result?.output || result;
                printSpecActionPreview(cli, record, payload);
                executions.push({
                    ...step,
                    status: 'ok',
                    result,
                });
                if (record.name && record.name.includes('update-specs')) {
                    printSpecificationDetails(cli, payload?.actions || payload?.result?.actions || []);
                }
            } catch (error) {
                executions.push({
                    ...step,
                    status: 'failed',
                    error: error.message,
                });
            }

            if (cli.pendingPlan) {
                cli.pendingPlan.nextIndex = index + 1;
            }
        }
    } finally {
        cancelled = cancelled || cli.cancelRequested;
        cli.planInProgress = false;
        cli.cancelRequested = false;
        if (!cancelled && cli.pendingPlan) {
            cli.pendingPlan = null;
        } else if (cancelled && cli.pendingPlan) {
            const remaining = Math.max(0, planSteps.length - (cli.pendingPlan.nextIndex || 0));
            cli.output.write(`${COLOR_WARN}[info] Plan paused with ${remaining} step(s) remaining. Use "continue" (/continue) to resume or provide extra instructions to replan.${COLOR_RESET}\n`);
        }
    }

    return { executions, cancelled };
};

export const processTaskInput = async (cli, taskText, options = {}) => {
    const plan = await preparePlan(cli, taskText);
    if (!plan.length) {
        return {
            plan: [],
            executions: [],
        };
    }

    if (options?.skipExecution) {
        return { plan, executions: [] };
    }

    const { executions } = await executePlan(cli, plan, {
        announceProgress: Boolean(options?.announceProgress),
    });
    return { plan, executions };
};

export const resumePendingPlan = async (cli, extraInstructions = '') => {
    const extra = typeof extraInstructions === 'string' ? extraInstructions.trim() : '';
    if (!cli.pendingPlan) {
        cli.output.write(`${COLOR_WARN}[info] No pending plan is available to continue.${COLOR_RESET}\n`);
        return;
    }
    if (extra) {
        const updatedPrompt = [cli.pendingPlan.prompt, extra].filter(Boolean).join('\n').trim();
        try {
            const updatedPlan = await preparePlan(cli, updatedPrompt);
            cli.pendingPlan = {
                plan: updatedPlan,
                prompt: updatedPrompt,
                nextIndex: 0,
            };
        } catch (error) {
            cli.output.write(`${COLOR_ERROR}[error] ${error.message}${COLOR_RESET}\n`);
            return;
        }
    }
    const { plan, prompt, nextIndex } = cli.pendingPlan;
    cli.output.write(`${COLOR_INFO}[info] Resuming plan for "${prompt}".${COLOR_RESET}\n`);
    printPlan(cli, plan);
    if (nextIndex > 0 && !extra) {
        cli.output.write(`${COLOR_INFO}[info] Continuing from step ${Math.min(nextIndex + 1, plan.length)} of ${plan.length}.${COLOR_RESET}\n`);
    }
    const { executions, cancelled } = await executePlan(cli, plan, {
        announceProgress: cli.announceStepProgress,
        startIndex: nextIndex || 0,
    });
    printExecutions(cli, executions);
    await cli.captureMemoryEntry({
        userPrompt: prompt,
        plan,
        executions,
        cancelled,
    });
};

export const summarizeExecutions = (cli, executions) => executions
    .map((execution) => {
        const detail = formatExecutionResult(cli, execution).join(' | ');
        return `[${execution.status}] ${execution.skill}: ${detail || execution.prompt || ''}`;
    })
    .filter(Boolean);

export default {
    parseResumeInput,
    detectResumeInput,
    preparePlan,
    executePlan,
    processTaskInput,
    resumePendingPlan,
    summarizeExecutions,
};
