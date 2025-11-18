import {
    COLOR_ERROR,
    COLOR_INFO,
    COLOR_WARN,
    COLOR_RESET,
} from './styles.mjs';
import { buildMemoryContext } from './memoryHelpers.mjs';
import { getSectionTextById } from './specDocumentHelpers.mjs';

export const formatSpecActionEntry = (action = {}) => {
    const parts = [];
    if (action.action) {
        parts.push(String(action.action));
    }
    if (action.id) {
        parts.push(String(action.id));
    }
    if (action.filePath) {
        parts.push(String(action.filePath));
    }
    return parts.join(' ').trim();
};

export const summarizeSpecActions = (actions = [], limit = 3) => {
    if (!Array.isArray(actions) || !actions.length) {
        return '';
    }
    const summary = actions
        .slice(0, limit)
        .map((action) => formatSpecActionEntry(action) || action.action || 'action')
        .join('; ');
    const extra = actions.length > limit
        ? ` (+${actions.length - limit} more)`
        : '';
    return `${summary}${extra}`.trim();
};

export const printSpecActionPreview = (cli, record, payload) => {
    const summary = summarizeSpecActions(payload?.actions, 3);
    if (!summary) {
        return;
    }
    cli.output.write(`${COLOR_INFO}[spec] ${record.name}: ${summary}${COLOR_RESET}\n`);
};

export const buildArgsForSkill = (record, promptText) => {
    const args = {};
    const inject = (name) => {
        if (typeof name === 'string' && name && !Object.prototype.hasOwnProperty.call(args, name)) {
            args[name] = promptText;
        }
    };

    if (record.metadata?.defaultArgument) {
        inject(record.metadata.defaultArgument);
    }

    if (record.type === 'interactive') {
        const required = Array.isArray(record.requiredArguments) ? record.requiredArguments : [];
        required.forEach(inject);
    }

    if (!Object.keys(args).length) {
        args.input = promptText;
    }

    return args;
};

export const runSkill = async (cli, record, promptText) => {
    const skillLogger = cli.createSkillLogger(record);
    const promptWithLanguage = cli.withLanguageContract(promptText, { heading: '# Language Contract' });
    const languageContract = cli.buildLanguageContract({ heading: '# Language Contract' });
    return cli.recursiveAgent.executeWithReviewMode(promptWithLanguage, {
        skillName: record.name,
        args: buildArgsForSkill(record, promptText),
            context: {
                workspaceRoot: cli.workspaceRoot,
                specsRoot: cli.specsRoot,
                llmAgent: cli.llmAgent,
                logger: skillLogger,
                specLanguage: cli.activeSpecLanguage(),
                languageContract,
                ...buildMemoryContext(cli),
            },
        logger: skillLogger,
    });
};

export const printPlan = (cli, plan) => {
    if (!plan.length) {
        cli.output.write(`${COLOR_INFO}[info] No explicit plan generated.${COLOR_RESET}\n`);
        return;
    }
    cli.output.write(`${COLOR_INFO}[plan] Generated plan:${COLOR_RESET}\n`);
    plan.forEach((step, index) => {
        cli.output.write(`  ${index + 1}. ${step.skill} ← ${step.prompt}\n`);
    });
};

const unwrapPayload = (value) => {
    let current = value;
    for (let depth = 0; depth < 2; depth += 1) {
        if (current && typeof current === 'object') {
            if (current.output && typeof current.output === 'object') {
                current = current.output;
                continue;
            }
            if (current.result && typeof current.result === 'object') {
                current = current.result;
                continue;
            }
        }
        break;
    }
    return current || {};
};

export const formatExecutionResult = (cli, execution) => {
    const lines = [];
    if (!execution?.result) {
        return lines;
    }
    const envelope = execution.result;
    const payload = unwrapPayload(envelope);
    const message = payload.message || envelope.message;
    if (message) {
        lines.push(`message: ${message}`);
    }
    if (payload.plan?.length) {
        lines.push(`plan steps: ${payload.plan.length}`);
    }
    if (Array.isArray(payload.steps)) {
        const success = payload.steps.filter((step) => step.status === 'ok').length;
        const failed = payload.steps.filter((step) => step.status === 'failed').length;
        lines.push(`steps status: ${success} succeeded, ${failed} failed`);
    }
    if (payload.education?.overview) {
        lines.push(`overview: ${payload.education.overview}`);
    }
    if (payload.education?.ursHighlights?.length) {
        lines.push(`URS: ${payload.education.ursHighlights.join('; ')}`);
    }
    if (payload.education?.fsIdeas?.length) {
        lines.push(`FS ideas: ${payload.education.fsIdeas.join('; ')}`);
    }
    if (Array.isArray(payload.actions) && payload.actions.length) {
        lines.push(`spec actions: ${summarizeSpecActions(payload.actions, 5)}`);
        lines.push('actions:');
        payload.actions.forEach((action) => {
            const parts = [];
            if (action.id) {
                parts.push(action.id);
            }
            if (action.title) {
                parts.push(action.title);
            }
            if (action.dsId) {
                parts.push(`ds=${action.dsId}`);
            }
            const extra = Object.entries(action)
                .filter(([key]) => !['action', 'id', 'title', 'dsId'].includes(key))
                .map(([key, value]) => `${key}=${value}`)
                .join(', ');
            const detail = [parts.join(' | '), extra].filter(Boolean).join(' | ');
            lines.push(`  • ${action.action || 'step'}${detail ? ` — ${detail}` : ''}`);
        });
    }
    if (payload.review?.summary) {
        lines.push(`review: ${payload.review.summary}`);
    }
    if (payload.review?.issues?.length) {
        lines.push(`issues: ${payload.review.issues.length} item(s)`);
    }
    if (Array.isArray(payload.docs) && payload.docs.length) {
        lines.push('documents:');
        payload.docs.forEach((doc) => {
            const heading = [doc.type, doc.id].filter(Boolean).join(' ').trim();
            const titleLine = heading
                ? `${heading}: ${doc.title || ''}`.trim()
                : (doc.title || doc.path || '').trim();
            lines.push(`  • ${titleLine}`);
            if (doc.description) {
                lines.push(`      ${doc.description}`);
            }
            if (Array.isArray(doc.trace) && doc.trace.length) {
                lines.push(`      Trace: ${doc.trace.join(' | ')}`);
            }
            if (doc.path) {
                lines.push(`      File: ${doc.path}`);
            }
        });
    }
    if (payload.help?.introduction && lines.length === 0) {
        lines.push(`help: ${payload.help.introduction}`);
    }
    if (payload.help && message?.includes('fallback') && lines.length === 0) {
        lines.push('note: fallback guidance used (LLM unavailable).');
    }
    if (payload.education?.fallbackSpecs && !payload.education?.ursHighlights?.length && lines.length === 0) {
        lines.push('note: mentor fell back to cached specs.');
    }
    if (payload.counts) {
        const { urs, fs, nfs, ds } = payload.counts;
        lines.push(`counts → URS:${urs || 0} FS:${fs || 0} NFS:${nfs || 0} DS:${ds || 0}`);
    }
    if (payload.recentFiles?.length) {
        lines.push(`recent specs: ${payload.recentFiles.join(', ')}`);
    }
    if (payload.notes) {
        lines.push(`notes: ${payload.notes}`);
    }
    if (payload.help && !message) {
        lines.push('help: Specification overview provided.');
    }
    if (payload.specs) {
        const specSummaryTypes = [
            ['URS', payload.specs.urs],
            ['FS', payload.specs.fs],
            ['NFS', payload.specs.nfs],
            ['DS', payload.specs.ds],
        ];
        specSummaryTypes.forEach(([label, entries]) => {
            if (Array.isArray(entries) && entries.length) {
                const preview = entries
                    .slice(0, 2)
                    .map((entry) => `${entry.id}${entry.title ? ` – ${entry.title}` : ''}`)
                    .join('; ');
                lines.push(`${label} (${entries.length}): ${preview}`);
            }
        });
        if (payload.output && payload.type === 'spec-summary') {
            lines.push(`spec summary html: ${payload.output}`);
        }
        if (payload.docsIndex) {
            lines.push(`html docs: ${payload.docsIndex}`);
        }
    }
    return lines;
};

export const printExecutions = (cli, executions) => {
    executions.forEach((execution) => {
        const statusColour = execution.status === 'ok' ? COLOR_INFO : COLOR_ERROR;
        cli.output.write(`${statusColour}[${execution.status}] ${execution.skill}: ${execution.prompt}${COLOR_RESET}\n`);
        if (execution.status === 'failed') {
            cli.output.write(`${COLOR_ERROR}  Error: ${execution.error}${COLOR_RESET}\n`);
        } else if (execution.result) {
            const lines = formatExecutionResult(cli, execution);
            lines.forEach((line) => cli.output.write(`  ${line}\n`));
        }
    });
};

export const printSpecificationDetails = (cli, actions = []) => {
    if (!Array.isArray(actions) || !actions.length) {
        return;
    }
    actions.forEach((action) => {
        const sectionId = action?.id || action?.dsId || action?.reqId;
        if (!sectionId) {
            return;
        }
        const text = getSectionTextById(cli, sectionId);
        if (text) {
            cli.output.write(`${COLOR_INFO}[spec] ${sectionId}${COLOR_RESET}\n`);
            cli.output.write(`${text}\n\n`);
        }
    });
};

export const executeSingleSkill = async (cli, skillName, promptText = '') => {
    const record = cli.findSkill(skillName);
    if (!record) {
        cli.output.write(`${COLOR_WARN}[warn] Skill "${skillName}" not found.${COLOR_RESET}\n`);
        return;
    }
    const instructions = promptText && promptText.trim()
        ? promptText.trim()
        : await cli.promptReader(`(${record.name})> `);
    await cli.ensureBootstrap(instructions);
    const executions = [];
    try {
        const result = await runSkill(cli, record, instructions);
        executions.push({
            status: 'ok',
            skill: record.name,
            prompt: instructions,
            result,
        });
    } catch (error) {
        executions.push({
            status: 'failed',
            skill: record.name,
            prompt: instructions,
            error: error?.message || String(error),
        });
    }
    printExecutions(cli, executions);
    await cli.captureMemoryEntry({
        userPrompt: `/run ${skillName}`,
        plan: [{ skill: record.name, prompt: instructions }],
        executions,
        cancelled: false,
    });
};

export default {
    buildArgsForSkill,
    runSkill,
    printPlan,
    printExecutions,
    formatExecutionResult,
    summarizeSpecActions,
    printSpecActionPreview,
    printSpecificationDetails,
    executeSingleSkill,
};
