import GampRSP from '../../../GampRSP.mjs';

const MAX_SPEC_SNIPPET = 12_000;

const ensureLLM = (context) => {
    if (context?.llmAgent && typeof context.llmAgent.executePrompt === 'function') {
        return context.llmAgent;
    }
    throw new Error('spec-mentor requires context.llmAgent to provide educational guidance.');
};

const summariseSpecs = (workspaceRoot) => {
    GampRSP.configure(workspaceRoot);
    const snapshot = GampRSP.loadSpecs('');
    if (snapshot.length <= MAX_SPEC_SNIPPET) {
        return snapshot;
    }
    return `${snapshot.slice(0, MAX_SPEC_SNIPPET)}\n...\n(truncated)`;
};

const buildPrompt = ({ specs, userPrompt }) => [
    '# Specification Mentor',
    'You are guiding a developer through a GAMP-style specification stack (URS → FS/NFS → DS → Tests).',
    'Return **JSON** describing the structure and recommended next steps.',
    '',
    '## JSON shape',
    '{',
    '  "overview": "<text describing current readiness>",',
    '  "ursHighlights": ["URS-001 summary", "..."],',
    '  "fsIdeas": ["FS-001 action", "..."],',
    '  "nfsIdeas": ["NFS guidance"],',
    '  "dsCandidates": ["DS suggestions"],',
    '  "testImpacts": ["What to test"],',
    '  "approvalQuestion": "Ask the user to approve or tweak the plan."',
    '}',
    '',
    '## Current Specs (truncated)',
    specs || '<empty>',
    '',
    '## User Focus',
    userPrompt || '<empty>',
].join('\n');

const normaliseArray = (value) => {
    if (Array.isArray(value)) {
        return value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim());
    }
    if (typeof value === 'string' && value.trim()) {
        return [value.trim()];
    }
    return [];
};

const parseEducation = (raw, fallbackSpecs) => {
    if (!raw) {
        return {
            overview: 'Unable to obtain mentor guidance.',
            ursHighlights: [],
            fsIdeas: [],
            nfsIdeas: [],
            dsCandidates: [],
            testImpacts: [],
            approvalQuestion: 'Would you like to proceed with any updates?',
            fallbackSpecs,
        };
    }
    const payload = typeof raw === 'string' ? (() => {
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    })() : raw;
    if (!payload || typeof payload !== 'object') {
        return {
            overview: 'Mentor provided free-form notes.',
            raw: raw.toString(),
            ursHighlights: [],
            fsIdeas: [],
            nfsIdeas: [],
            dsCandidates: [],
            testImpacts: [],
            approvalQuestion: 'Would you like to proceed with any updates?',
            fallbackSpecs,
        };
    }
    return {
        overview: typeof payload.overview === 'string' ? payload.overview : 'Mentor overview pending.',
        ursHighlights: normaliseArray(payload.ursHighlights),
        fsIdeas: normaliseArray(payload.fsIdeas),
        nfsIdeas: normaliseArray(payload.nfsIdeas),
        dsCandidates: normaliseArray(payload.dsCandidates),
        testImpacts: normaliseArray(payload.testImpacts),
        approvalQuestion: typeof payload.approvalQuestion === 'string'
            ? payload.approvalQuestion
            : 'Does this guidance look correct?',
    };
};

export async function action({ prompt = '', context = {} }) {
    const workspaceRoot = context.workspaceRoot || process.cwd();
    const llmAgent = ensureLLM(context);
    const specsSnippet = summariseSpecs(workspaceRoot);
    let mentorResponse = null;

    try {
        mentorResponse = await llmAgent.executePrompt(buildPrompt({
            specs: specsSnippet,
            userPrompt: prompt,
        }), {
            responseShape: 'json',
            context: { intent: 'spec-mentor-education' },
        });
    } catch (error) {
        if (process.env.ACHILES_DEBUG === 'true') {
            console.warn(`[spec-mentor] LLM failed: ${error.message}`);
        }
    }

    const education = parseEducation(mentorResponse, specsSnippet);
    return {
        message: 'Specification mentoring guidance prepared.',
        requiresApproval: true,
        education,
    };
}

export default action;
