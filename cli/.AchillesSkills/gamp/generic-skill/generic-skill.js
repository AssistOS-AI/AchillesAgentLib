import fs from 'node:fs';
import path from 'node:path';

const TOOL_DESCRIPTIONS = [
    { tool: 'list-files', description: 'Inspect directory contents. Fields: target (folder).' },
    { tool: 'read-file', description: 'Read a file and report snippet. Fields: target (file).' },
    { tool: 'rewrite-file', description: 'Produce full replacement for a file using the LLM. Fields: target (file), instructions (optional).' },
    { tool: 'replace-text', description: 'Simple search/replace. Fields: target (file), search, replace.' },
    { tool: 'create-file', description: 'Create/overwrite a file with provided content. Fields: target (file), content.' },
    { tool: 'append-file', description: 'Append content to an existing file. Fields: target (file), content.' },
    { tool: 'delete-path', description: 'Delete a file or empty directory. Fields: target (path).' },
];

const MAX_LIST_ENTRIES = 50;
const MAX_READ_BYTES = 8_192;
const DEFAULT_PLAN = [{ tool: 'list-files', target: '.' }];

const safeResolve = (root, target = '.') => {
    const resolved = path.resolve(root, target || '.');
    if (!resolved.startsWith(root)) {
        throw new Error(`Path "${target}" escapes the workspace root.`);
    }
    return resolved;
};

const normalisePlan = (entries = []) => entries
    .map((entry) => {
        const tool = typeof entry.tool === 'string' ? entry.tool.trim().toLowerCase() : '';
        if (!tool) {
            return null;
        }
        return {
            tool,
            target: entry.target ?? entry.path ?? '.',
            instructions: entry.instructions ?? entry.note ?? '',
            search: entry.search ?? null,
            replace: entry.replace ?? null,
            content: entry.content ?? entry.body ?? entry.text ?? null,
        };
    })
    .filter(Boolean);

const buildPlanPrompt = (taskPrompt) => {
    const instructions = [
        '# Generic Skill Planner',
        'You receive a task and must respond with a JSON array of steps.',
        'Each step must include a "tool" field that matches one of the available tools and any required arguments.',
        '',
        '## Available tools',
        ...TOOL_DESCRIPTIONS.map((entry) => `- ${entry.tool}: ${entry.description}`),
        '',
        '## Task',
        taskPrompt || '<empty>',
        '',
        '## Response format',
        '[{"tool":"list-files","target":"src"}, {"tool":"read-file","target":"README.md"}]',
    ];
    return instructions.join('\n');
};

const readPlanFromLLM = async (llmAgent, prompt) => {
    if (!llmAgent || typeof llmAgent.executePrompt !== 'function') {
        return null;
    }
    try {
        const response = await llmAgent.executePrompt(buildPlanPrompt(prompt), {
            responseShape: 'json',
            context: { intent: 'generic-skill-plan' },
        });
        if (Array.isArray(response) && response.length) {
            return response;
        }
    } catch (error) {
        // Fall back to heuristic plan
        if (process.env.ACHILES_DEBUG === 'true') {
            console.warn(`[generic-skill] plan generation failed: ${error.message}`);
        }
    }
    return null;
};

const listFiles = ({ workspaceRoot, target }) => {
    const dirPath = safeResolve(workspaceRoot, target || '.');
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith('.'))
        .slice(0, MAX_LIST_ENTRIES)
        .map((entry) => ({
            name: entry.name,
            type: entry.isDirectory() ? 'dir' : 'file',
        }));
    return { entries };
};

const readFileSnippet = ({ workspaceRoot, target }) => {
    if (!target) {
        throw new Error('read-file requires a target path.');
    }
    const filePath = safeResolve(workspaceRoot, target);
    const content = fs.readFileSync(filePath, 'utf8');
    return {
        bytes: Buffer.byteLength(content),
        snippet: content.slice(0, MAX_READ_BYTES),
    };
};

const rewriteFile = async ({
    workspaceRoot,
    target,
    instructions,
    llmAgent,
    taskPrompt,
}) => {
    if (!target) {
        throw new Error('rewrite-file requires a target path.');
    }
    if (!llmAgent || typeof llmAgent.executePrompt !== 'function') {
        throw new Error('rewrite-file requires an LLMAgent.');
    }
    const filePath = safeResolve(workspaceRoot, target);
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    const rewritePrompt = [
        '# Rewrite File',
        `Task prompt: ${taskPrompt || '<empty>'}`,
        `Target file: ${target}`,
        instructions ? `Extra constraints: ${instructions}` : null,
        '',
        'Existing content:',
        '```',
        existing,
        '```',
        '',
        'Return ONLY the full new file content inside a code fence.',
    ].filter(Boolean).join('\n');
    const updated = await llmAgent.executePrompt(rewritePrompt, {
        responseShape: 'code',
        context: { intent: 'generic-skill-rewrite', filePath: target },
    });
    if (!updated || !updated.trim()) {
        throw new Error('LLM did not return replacement text.');
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${updated.trim()}\n`);
    return { bytes: Buffer.byteLength(updated) };
};

const replaceText = ({ workspaceRoot, target, search, replace }) => {
    if (!target) {
        throw new Error('replace-text requires a target path.');
    }
    if (!search) {
        throw new Error('replace-text requires a "search" value.');
    }
    const filePath = safeResolve(workspaceRoot, target);
    const original = fs.readFileSync(filePath, 'utf8');
    if (!original.includes(search)) {
        throw new Error(`Pattern "${search}" not found in ${target}.`);
    }
    const updated = original.replace(search, replace ?? '');
    fs.writeFileSync(filePath, updated);
    return { replacements: 1 };
};

const writeFileContent = ({ workspaceRoot, target, content }) => {
    if (!target) {
        throw new Error('create-file requires a target path.');
    }
    const filePath = safeResolve(workspaceRoot, target);
    const text = typeof content === 'string' ? content : '';
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${text}${text.endsWith('\n') ? '' : '\n'}`);
    return { bytes: Buffer.byteLength(text) };
};

const appendFileContent = ({ workspaceRoot, target, content }) => {
    if (!target) {
        throw new Error('append-file requires a target path.');
    }
    if (typeof content !== 'string' || !content) {
        throw new Error('append-file requires non-empty content.');
    }
    const filePath = safeResolve(workspaceRoot, target);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${content}${content.endsWith('\n') ? '' : '\n'}`);
    return { bytes: Buffer.byteLength(content) };
};

const deletePath = ({ workspaceRoot, target }) => {
    if (!target) {
        throw new Error('delete-path requires a target path.');
    }
    const filePath = safeResolve(workspaceRoot, target);
    if (!fs.existsSync(filePath)) {
        return { deleted: false };
    }
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
    } else {
        fs.unlinkSync(filePath);
    }
    return { deleted: true };
};

const TOOL_EXECUTORS = {
    'list-files': ({ workspaceRoot, step }) => listFiles({ workspaceRoot, target: step.target }),
    'read-file': ({ workspaceRoot, step }) => readFileSnippet({ workspaceRoot, target: step.target }),
    'rewrite-file': (params) => rewriteFile(params),
    'replace-text': ({ workspaceRoot, step }) => replaceText({
        workspaceRoot,
        target: step.target,
        search: step.search,
        replace: step.replace,
    }),
    'create-file': ({ workspaceRoot, step }) => writeFileContent({
        workspaceRoot,
        target: step.target,
        content: step.content ?? step.instructions,
    }),
    'append-file': ({ workspaceRoot, step }) => appendFileContent({
        workspaceRoot,
        target: step.target,
        content: step.content ?? step.instructions,
    }),
    'delete-path': ({ workspaceRoot, step }) => deletePath({
        workspaceRoot,
        target: step.target,
    }),
};

const executeStep = async ({ step, workspaceRoot, llmAgent, taskPrompt }) => {
    const handler = TOOL_EXECUTORS[step.tool];
    if (!handler) {
        throw new Error(`Unknown tool "${step.tool}".`);
    }
    if (step.tool === 'rewrite-file') {
        return handler({
            workspaceRoot,
            step,
            llmAgent,
            taskPrompt,
            target: step.target,
            instructions: step.instructions,
        });
    }
    return handler({
        workspaceRoot,
        step,
    });
};

export async function action({ prompt = '', context = {}, llmAgent = null }) {
    const workspaceRoot = context.workspaceRoot
        ? path.resolve(context.workspaceRoot)
        : process.cwd();
    const log = typeof context.logger === 'function' ? context.logger : null;

    const effectiveLLM = llmAgent || context.llmAgent || null;
    const planFromLLM = await readPlanFromLLM(effectiveLLM, prompt);
    const planSource = planFromLLM && planFromLLM.length ? planFromLLM : DEFAULT_PLAN;
    const plan = normalisePlan(planSource);
    log?.(`[plan] Prepared ${plan.length} ${plan.length === 1 ? 'step' : 'steps'} for generic operations.`);

    const steps = [];
    for (let index = 0; index < plan.length; index += 1) {
        const step = plan[index];
        log?.(`[step ${index + 1}/${plan.length || 1}] ${step.tool} ${step.target || ''}`.trim());
        try {
            // eslint-disable-next-line no-await-in-loop
            const result = await executeStep({
                step,
                workspaceRoot,
                llmAgent: effectiveLLM,
                taskPrompt: prompt,
            });
            log?.(`[step ${index + 1}/${plan.length || 1}] ${step.tool} succeeded.`);
            steps.push({
                ...step,
                status: 'ok',
                result,
            });
        } catch (error) {
            log?.(`[step ${index + 1}/${plan.length || 1}] ${step.tool} failed: ${error.message}`);
            steps.push({
                ...step,
                status: 'failed',
                error: error.message,
            });
        }
    }

    return {
        message: 'Generic operations completed.',
        plan: plan.map((step) => ({ ...step })),
        steps,
    };
}

export default action;
