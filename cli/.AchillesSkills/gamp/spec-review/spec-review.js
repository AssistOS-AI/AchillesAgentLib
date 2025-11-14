import GampRSP from '../../../GampRSP.mjs';

const MAX_SPEC_SNIPPET = 10_000;

const ensureLLM = (context) => {
    if (context?.llmAgent && typeof context.llmAgent.executePrompt === 'function') {
        return context.llmAgent;
    }
    throw new Error('spec-review requires context.llmAgent for critique generation.');
};

const loadSpecs = (workspaceRoot) => {
    GampRSP.configure(workspaceRoot);
    const snapshot = GampRSP.loadSpecs('');
    if (snapshot.length <= MAX_SPEC_SNIPPET) {
        return snapshot;
    }
    return `${snapshot.slice(0, MAX_SPEC_SNIPPET)}\n...\n(truncated)`;
};

const buildPrompt = ({ specs, userPrompt }) => [
    '# Specification Review Assistant',
    'Critically evaluate the URS/FS/NFS/DS/test set for a regulated project.',
    'Return JSON with fields summary, issues[], testGaps[].',
    '',
    'Issue shape:',
    '{ "id": "FS-001", "severity": "high|medium|low", "finding": "text", "recommendation": "text" }',
    '',
    '## Current Specifications',
    specs || '<empty>',
    '',
    '## Reviewer Focus',
    userPrompt || '<no additional focus>',
].join('\n');

const normaliseIssues = (blocks) => {
    if (!Array.isArray(blocks)) {
        return [];
    }
    return blocks
        .map((issue) => ({
            id: typeof issue.id === 'string' ? issue.id.trim().toUpperCase() : 'UNSPECIFIED',
            severity: typeof issue.severity === 'string' ? issue.severity.toLowerCase() : 'medium',
            finding: typeof issue.finding === 'string' ? issue.finding : 'Finding missing.',
            recommendation: typeof issue.recommendation === 'string' ? issue.recommendation : 'Add recommendation.',
        }))
        .filter((issue) => issue.finding && issue.recommendation);
};

const normaliseArray = (value) => {
    if (Array.isArray(value)) {
        return value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim());
    }
    if (typeof value === 'string' && value.trim()) {
        return [value.trim()];
    }
    return [];
};

const parseReview = (raw) => {
    if (!raw) {
        return {
            summary: 'LLM did not provide a review.',
            issues: [],
            testGaps: [],
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
            summary: 'Unable to parse review response.',
            issues: [],
            testGaps: [],
        };
    }
    return {
        summary: typeof payload.summary === 'string' ? payload.summary : 'Review summary unavailable.',
        issues: normaliseIssues(payload.issues),
        testGaps: normaliseArray(payload.testGaps),
    };
};

export async function action({ prompt = '', context = {} }) {
    const workspaceRoot = context.workspaceRoot || process.cwd();
    const llmAgent = ensureLLM(context);
    const specsSnippet = loadSpecs(workspaceRoot);
    let rawReview = null;
    try {
        rawReview = await llmAgent.executePrompt(buildPrompt({
            specs: specsSnippet,
            userPrompt: prompt,
        }), {
            responseShape: 'json',
            context: { intent: 'spec-review-analysis' },
        });
    } catch (error) {
        if (process.env.ACHILES_DEBUG === 'true') {
            console.warn(`[spec-review] LLM failure: ${error.message}`);
        }
    }

    const review = parseReview(rawReview);
    return {
        message: 'Specification review completed.',
        review,
    };
}

export default action;
