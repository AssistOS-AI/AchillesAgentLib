import GampRSP from '../../../GampRSP.mjs';

const ensureLLM = (context) => (context?.llmAgent && typeof context.llmAgent.executePrompt === 'function'
    ? context.llmAgent
    : null);

const defaultHelp = () => ({
    introduction: 'GAMP specifications cascade from business needs (URS) to functional and quality requirements (FS/NFS), then to design specs (DS) and embedded tests.',
    keyConcepts: [
        'URS defines regulated/business intent without implementation',
        'FS covers user-visible behavior; NFS covers qualities like performance/security',
        'Each FS/NFS item must trace to at least one DS and one test',
        'DS includes file-level impacts, exports, dependencies, and operational notes',
        'Tests are defined in DS documents and implemented per requirement (TEST-###)',
    ],
    lifecycleSteps: [
        'Capture URS with justification and verification criteria',
        'Translate to FS/NFS that remain testable and measurable',
        'Create DS per requirement including traceability, design, and file impacts',
        'Generate code/tests from DS, then update traceability matrix',
    ],
    bestPractices: [
        'Keep documents in `.specs` and update traceability after every change',
        'Embed test plans inside DS to make verification inseparable from design',
        'Use orchestrator skills (update-specs, build-code, mock-build) to stay in sync',
    ],
    closingThoughts: 'Treat specs as the single source of truth; code and tests are regenerated from approved DS entries.',
});

const buildPrompt = () => [
    '# Spec Help Assistant',
    'Explain how GAMP-styled specs flow (URS → FS/NFS → DS → Tests).',
    'Return JSON with introduction, keyConcepts[], lifecycleSteps[], bestPractices[], closingThoughts.',
    'Keep wording concise and actionable.',
].join('\n');

export async function action({ context = {} }) {
    const workspaceRoot = context.workspaceRoot || process.cwd();
    GampRSP.configure(workspaceRoot);
    const llmAgent = ensureLLM(context);
    if (!llmAgent) {
        return {
            message: 'Specification help provided (static).',
            help: defaultHelp(),
        };
    }

    try {
        const raw = await llmAgent.executePrompt(buildPrompt(), {
            responseShape: 'json',
            context: { intent: 'spec-help-overview' },
        });
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return {
            message: 'Specification help provided.',
            help: {
                introduction: parsed?.introduction || defaultHelp().introduction,
                keyConcepts: Array.isArray(parsed?.keyConcepts) ? parsed.keyConcepts : defaultHelp().keyConcepts,
                lifecycleSteps: Array.isArray(parsed?.lifecycleSteps) ? parsed.lifecycleSteps : defaultHelp().lifecycleSteps,
                bestPractices: Array.isArray(parsed?.bestPractices) ? parsed.bestPractices : defaultHelp().bestPractices,
                closingThoughts: parsed?.closingThoughts || defaultHelp().closingThoughts,
            },
        };
    } catch (error) {
        if (process.env.ACHILES_DEBUG === 'true') {
            console.warn(`[spec-help] LLM failed: ${error.message}`);
        }
        return {
            message: 'Specification help provided (fallback).',
            help: defaultHelp(),
        };
    }
}

export default action;
