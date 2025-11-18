import { SPEC_GUIDANCE_TEXT } from './specGuidance.mjs';

export const buildPlanPrompt = ({ task, orchestrators, languageContract = '' }) => {
    const sections = [];
    sections.push('# Achilles CLI Orchestrator Planner');
    sections.push('Produce a step-by-step plan that maps the task to orchestrator skills.');
    sections.push('Return JSON array where each entry has fields "skill" and "prompt".');
    sections.push('You may reuse the same skill multiple times with different prompts.');
    sections.push('Only use skills from the catalog and copy their names exactly.');
    sections.push('Keep prompts concise and specific to the sub-task each skill should solve.');
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
