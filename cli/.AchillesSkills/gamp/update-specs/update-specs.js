import path from 'node:path';

import GampRSP from '../../../GampRSP.mjs';
import {
    ensureLLM,
    summariseSpecs,
    parsePlan,
    executePlan,
} from '../utils/specPlanner.mjs';

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

export async function action({ prompt, context }) {
    const workspaceRoot = context.workspaceRoot || process.cwd();
    GampRSP.configure(workspaceRoot);
    const llm = ensureLLM(context);
    const specsSnapshot = summariseSpecs();
    let plan = [];

    try {
        const rawPlan = await llm.executePrompt(buildPlannerPrompt({ task: prompt, specs: specsSnapshot }), {
            responseShape: 'json',
            context: { intent: 'update-specs-plan' },
        });
        plan = parsePlan(rawPlan);
    } catch (error) {
        throw new Error(`Unable to obtain specification plan from the LLM: ${error.message}`);
    }

    if (!plan.length) {
        throw new Error('The LLM did not return any specification actions. Refine the prompt or rerun when the LLM is available.');
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
