import { SPEC_GUIDANCE_TEXT } from './specGuidance.mjs';

export const buildPlanPrompt = ({ task, orchestrators, languageContract = '' }) => {
    const sections = [];
    sections.push('# Achilles CLI Orchestrator Planner');
    sections.push('Produce a step-by-step plan that maps the task to orchestrator skills.');
    sections.push('Return JSON array where each entry has fields "skill" and "prompt".');
    sections.push('Guidelines:');
    sections.push('- Analyze the entire user request and break it into discrete intents; output one skill call per intent.');
    sections.push('- When the user asks to create, update, or audit specifications, include update-specs first, then any review/summary/generate-docs steps needed.');
    sections.push('- When the user only wants to read existing specs, prefer mock-build, spec-review, or spec-help rather than execution skills.');
    sections.push('- Only include build-code, run-tests, or fix-tests skills when the user explicitly asks for code or test execution.');
    sections.push('- If the user mentions multiple commands, files, or requirements, include separate plan entries (even for the same skill) with tailored prompts.');
    sections.push('- Copy skill names exactly as listed, keep prompts concise, and provide enough context so the skill knows which part of the workspace to act upon.');
    sections.push('');
    sections.push('## Task');
    sections.push(task || '<empty>');
    if (SPEC_GUIDANCE_TEXT) {
        sections.push('');
        sections.push('## Specification Expectations');
        sections.push(SPEC_GUIDANCE_TEXT);
    }
    if (languageContract) {
        sections.push('');
        sections.push(languageContract.trim());
    }
    sections.push('');
    sections.push('## Available Orchestrator Skills');
    orchestrators.forEach((record) => {
        sections.push(JSON.stringify({
            name: record.name,
            summary: record.descriptor?.summary || '',
            instructions: record.metadata?.instructions || '',
        }, null, 2));
    });
    sections.push('');
    sections.push('## Response Format');
    sections.push('[ { "skill": "skill-name", "prompt": "subset of task" } ]');
    return sections.join('\n');
};

export default {
    buildPlanPrompt,
};
