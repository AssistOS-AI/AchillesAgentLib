import path from 'node:path';
import GampRSP from '../../../GampRSP.mjs';
import {
    ensureLLM,
    summariseSpecs,
    parsePlan,
    executePlan,
} from '../utils/specPlanner.mjs';
import { SPEC_GUIDANCE_TEXT } from '../../../helpers/specGuidance.mjs';

const buildPlannerPrompt = ({ task, specs }) => {
    const instructions = [
        '# Specification Update Planner',
        'Act as a senior regulated-software architect. Produce concrete specification text, not reminders to “create” specs.',
        '- URS: articulate business intent, regulatory drivers, constraints, and traceability toward FS/NFS.',
        '- FS: describe observable behaviour (actors, flows, data validation, error handling, audit trail expectations) and forward-link to DS.',
        '- NFS: quantify quality envelopes (performance, security, availability, operability) with explicit metrics.',
        '- DS: for each requirement, provide architecture notes (components, data flows, telemetry, rollout), and include a “File Impact” chapter listing each touched file (path, exports, dependencies, side effects, concurrency).',
        '- For every impacted file, emit a describeFile action that includes why/how/what details and export/dependency arrays.',
        '- When a file already has DS coverage, mention the related DS identifiers and summarise their responsibilities before describing the new behaviour so generators have full context.',
        '- Detail the semantics of every function/class expected inside the file so downstream builders know exactly what to emit.',
        '- For every DS, emit createTest actions describing folder layout, env var expectations (.env discovery), temporary-folder conventions, runAlltests suite names, and clean-up policy — limit yourself to at most 3 tests per request and only when traceability needs them.',
        '- Never trigger reverse-specs, build-code, or run-tests from this skill; focus strictly on documentation updates.',
        '- Only act on the instructions supplied in the Change Request; do not perform reverse engineering unless the user explicitly requests it.',
        '- Never delete specs; mark them inactive via retire/update actions if needed.',
        '- Reuse existing IDs when possible; only create new URS/FS/DS when a new requirement is introduced.',
        '',
        'Allowed actions:',
        '- createURS { "title", "description" }',
        '- updateURS { "id", "title", "description" }',
        '- retireURS { "id" }',
        '- createFS { "title", "description", "ursId", "reqId?" }',
        '- updateFS { "id", "title", "description", "ursId" }',
        '- createNFS { "title", "description", "ursId", "reqId?" }',
        '- updateNFS { "id", "title", "description", "ursId" }',
        '- createDS { "title", "description", "architecture", "ursId", "reqId" }',
        '- updateDS { "id", "description", "architecture" }',
        '- createTest { "dsId", "title", "description" }',
        '- describeFile { "dsId", "filePath", "why", "how", "what", "description", "exports":[], "dependencies":[], "sideEffects", "concurrency" }',
        '',
        '## Current Specs Snapshot',
        specs || '<empty>',
        '',
        '## Change Request',
        task || '<empty>',
        '',
        '## Response Format',
        '[{"action":"createURS","title":"Demo requirement","description":"..."}]',
    ];
    return instructions.join('\n');
};

const normalizeCommands = (text = '') => {
    const match = text.match(/[a-z0-9_-]+/gi) || [];
    const lower = match.map((token) => token.toLowerCase());
    const candidates = ['help', 'status', 'echo', 'ask', 'plan', 'list', 'specs', 'run'];
    const detected = candidates.filter((cmd) => lower.includes(cmd));
    return detected.length ? detected : ['help', 'status', 'echo'];
};

const buildCommandDescription = (commands) => commands
    .map((cmd) => `- ${cmd.toUpperCase()}: Describe expected input/output, validation, error messaging, and how results surface within the CLI.`)
    .join('\n');

const sanitizeCommand = (cmd) => {
    const cleaned = cmd.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
    return cleaned || cmd;
};

const describeCommandFileMeta = (cmd, safeName) => {
    const basePath = `src/cli/commands/${safeName}.mjs`;
    if (cmd === 'ask') {
        return {
            filePath: basePath,
            description: 'Routes /ask prompts to the configured LLM provider using AchillesAgentLib.',
            exports: [`run${safeName.charAt(0).toUpperCase()}${safeName.slice(1)}Command`],
            dependencies: ['achillesAgentLib', 'node:readline/promises'],
            why: 'Expose the conversational bridge to the LLM.',
            how: 'Loads API keys from .env ancestors, instantiates AchillesAgentLib, streams answers.',
            what: 'Normalizes questions, sanitizes output, and logs trace IDs.',
            sideEffects: 'Invokes remote LLM endpoints and writes audit logs.',
            concurrency: 'Serial per invocation; uses async/await on the request pipeline.',
        };
    }
    if (cmd === 'echo') {
        return {
            filePath: basePath,
            description: 'Implements /echo by writing the user-provided arguments back to stdout.',
            exports: ['runEchoCommand'],
            dependencies: ['node:readline/promises'],
            why: 'Provide round-trip validation for prompt capture.',
            how: 'Parses flags, writes formatted output, and records telemetry.',
            what: 'Supports plaintext echo and JSON echo modes.',
            sideEffects: 'Writes to stdout/stderr only.',
            concurrency: 'Stateless.',
        };
    }
    if (cmd === 'status') {
        return {
            filePath: basePath,
            description: 'Handles /status by reading .specs/.llm_stats and summarizing usage.',
            exports: ['runStatusCommand'],
            dependencies: ['node:fs', 'node:path'],
            why: 'Expose diagnostics for operators.',
            how: 'Loads stats, formats response, warns on missing files.',
            what: 'Displays request counts, latency buckets, and log locations.',
            sideEffects: 'Reads files under .specs/.',
            concurrency: 'Serial, minimal contention.',
        };
    }
    return {
        filePath: basePath,
        description: `Implements /${cmd} command.`,
        exports: [`run${safeName.charAt(0).toUpperCase()}${safeName.slice(1)}Command`],
        dependencies: [],
        why: `Provide the /${cmd} CLI capability.`,
        how: 'Parses arguments, performs the requested action, emits telemetry, and surfaces human-friendly errors.',
        what: `Command-specific logic for /${cmd}.`,
        sideEffects: 'Limited to workspace state described in DS.',
        concurrency: 'Stateless.',
    };
};

const buildCommandTestDescription = (cmd, safeName) => [
    `Folder: tests/cli/${safeName}`,
    `Main Script: ${safeName}.test.mjs`,
    '',
    `Covers the /${cmd} command using node:test.`,
    '- Each test runs inside a dedicated temp folder created via testUtil (retained between runs).',
    '- Configuration is sourced from the nearest .env file (search parent directories).',
    '- Fail fast with a clear message when mandatory env vars are missing.',
    '- Expose suite entry points via runAlltests.js (one suite per FS/NFS identifier).',
].join('\n');

const createHeuristicSpecs = (taskDescription) => {
    const commands = normalizeCommands(taskDescription);
    const actions = [];
    const cliPurpose = `Operators need a regulated CLI assistant that exposes commands: ${commands.join(', ')}. Input summary: ${taskDescription.trim()}.`;
    const ursId = GampRSP.createURS('URS – CLI assistant', `${cliPurpose}\n\n${SPEC_GUIDANCE_TEXT}`);
    actions.push({ action: 'createurs', id: ursId });

    const fsDescription = [
        'Functional envelope for the CLI:',
        buildCommandDescription(commands),
        '',
        'Each command must log intent, validate arguments, surface human friendly errors, and trace actions to downstream DS/test identifiers.',
    ].join('\n');
    const fsId = GampRSP.createFS('FS – CLI command orchestration', fsDescription, ursId);
    actions.push({ action: 'createfs', id: fsId, ursId });

    const nfsDescription = [
        'Operational qualities:',
        '- Performance: responses under 1s for local prompts, with percentile targets captured in telemetry.',
        '- Security: enforce environment-variable sourced credentials, redact sensitive tokens in logs.',
        '- Observability: emit structured logs, metrics for command latency, success/failure counts.',
        '- Operability: commands honor cancellation, support dry-run, and document recovery steps.',
    ].join('\n');
    const nfsId = GampRSP.createNFS('NFS – CLI quality envelope', nfsDescription, ursId);
    actions.push({ action: 'createnfs', id: nfsId, ursId });

    const architecture = [
        'Architecture: Node.js ES module CLI built on Achilles agents. Layers:',
        '- Input router that parses commands and forwards to orchestrator skills.',
        '- Spec-only workflow ensuring update-specs/mocked summary steps run before any code generation.',
        '- Telemetry hooks (logging + metrics) and .env discovery (scan parent folders).',
        '- Test harness integration via runAlltests.js per FS/NFS suite.',
    ].join('\n');
    const dsId = GampRSP.createDS(
        'DS – CLI orchestrator shell',
        'Design for the CLI entrypoint that wires Achilles skills, prompt evaluation, and reporting.',
        architecture,
        ursId,
        fsId,
    );
    actions.push({ action: 'createds', id: dsId, ursId, reqId: fsId });

    const indexFileMeta = {
        filePath: 'src/cli/index.mjs',
        description: 'CLI entrypoint that wires prompts to the registered command handlers.',
        exports: ['runCli'],
        dependencies: ['node:readline/promises'],
        why: 'Allow operators to interact with the CLI entrypoint.',
        how: 'Initialises GampRSP/.specs, selects orchestrator steps, logs telemetry.',
        what: 'Orchestrates command parsing and dispatch to per-command modules.',
        sideEffects: 'Initialises .specs folder and log files.',
        concurrency: 'Single process with cancellation guards.',
    };
    GampRSP.describeFile(
        dsId,
        indexFileMeta.filePath,
        indexFileMeta.description,
        indexFileMeta.exports,
        indexFileMeta.dependencies,
        {
            why: indexFileMeta.why,
            how: indexFileMeta.how,
            what: indexFileMeta.what,
            sideEffects: indexFileMeta.sideEffects,
            concurrency: indexFileMeta.concurrency,
        },
    );
    actions.push({ action: 'describefile', id: dsId, filePath: indexFileMeta.filePath });

    commands.forEach((cmd) => {
        const safeName = sanitizeCommand(cmd);
        const dsTitle = `DS – ${cmd.toUpperCase()} command`;
        const dsDescription = `Design for the /${cmd} CLI command including argument handling, telemetry, and error responses.`;
        const architectureParts = [
            `Command responsibilities for /${cmd}:`,
            '- Parse user input and validate mandatory arguments.',
            '- Enforce spec-first workflow (no code execution until URS/FS/NFS/DS are approved).',
            '- Emit structured logs and metrics with trace IDs.',
        ];
        if (cmd === 'ask') {
            architectureParts.push('- Auto-configure AchillesAgentLib clients (.env discovery, key rotation).');
            architectureParts.push('- Stream answers and redact sensitive tokens before printing.');
        } else if (cmd === 'echo') {
            architectureParts.push('- Support plaintext and JSON echo formats for rapid feedback.');
        } else if (cmd === 'help') {
            architectureParts.push('- List registered commands and indicate which specs they map to.');
        }
        const commandDsId = GampRSP.createDS(
            dsTitle,
            dsDescription,
            architectureParts.join('\n'),
            ursId,
            fsId,
        );
        actions.push({ action: 'createds', id: commandDsId, ursId, reqId: fsId });

        const fileMeta = describeCommandFileMeta(cmd, safeName);
        GampRSP.describeFile(
            commandDsId,
            fileMeta.filePath,
            fileMeta.description,
            fileMeta.exports,
            fileMeta.dependencies,
            {
                why: fileMeta.why,
                how: fileMeta.how,
                what: fileMeta.what,
                sideEffects: fileMeta.sideEffects,
                concurrency: fileMeta.concurrency,
            },
        );
        actions.push({ action: 'describefile', id: commandDsId, filePath: fileMeta.filePath });

        const testId = GampRSP.createTest(
            commandDsId,
            `${cmd.toUpperCase()} command tests`,
            buildCommandTestDescription(cmd, safeName),
        );
        actions.push({ action: 'createtest', id: testId, dsId: commandDsId });
    });

    return actions;
};

export async function action({ prompt, context }) {
    const workspaceRoot = context.workspaceRoot || process.cwd();
    GampRSP.configure(workspaceRoot);
    const llm = context?.llmAgent ? ensureLLM(context) : null;
    const specsSnapshot = summariseSpecs();
    let plan = [];

    if (llm) {
        try {
            const rawPlan = await llm.executePrompt(buildPlannerPrompt({ task: prompt, specs: specsSnapshot }), {
                responseShape: 'json',
                context: { intent: 'update-specs-plan' },
            });
            plan = parsePlan(rawPlan);
        } catch (error) {
            if (process.env.ACHILES_DEBUG === 'true') {
                console.warn(`[update-specs] planner failed: ${error.message}`);
            }
        }
    }

    if (!plan.length) {
        const fallbackActions = createHeuristicSpecs(prompt || '');
        const docsDir = GampRSP.generateHtmlDocs();
        return {
            message: 'Specifications updated via heuristic fallback.',
            actions: fallbackActions,
            guidance: SPEC_GUIDANCE_TEXT,
            docsIndex: path.join(docsDir, 'index.html'),
        };
    }

    const outcomes = executePlan(plan);
    const docsDir = GampRSP.generateHtmlDocs();
    return {
        message: 'Specifications updated via planner.',
        actions: outcomes,
        docsIndex: path.join(docsDir, 'index.html'),
    };
}

export default action;
