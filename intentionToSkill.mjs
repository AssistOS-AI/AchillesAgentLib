import { buildPlanPrompt } from './cli/helpers/planHelpers.mjs';
import { parsePlan } from './cli/helpers/cliUtils.mjs';

export const PLAN_INTENT = 'achilles-cli-plan';
const FALLBACK_KEYWORDS = ['reverse', 'sync', 'mirror', 'scan'];
const DEFAULT_FALLBACK_SKILL = 'generic-skill';
const SPEC_KEYWORDS = ['specificati', 'specificatii', 'specification', 'specs', 'document', 'documente', 'cerinte', 'requirements', 'continut', 'urs', 'fs', 'nfs', 'ds', 'dfs'];
const SPEC_SUMMARY_ACTIONS = ['arata', 'aratami', 'arata-mi', 'afiseaza', 'show', 'lista', 'list', 'display', 'vezi', 'vreau sa vad', 'continut', 'continutul', 'content'];
const SPEC_CREATION_ACTIONS = ['fa', 'fa-mi', 'creeaza', 'creeaz', 'genereaza', 'scrie', 'build', 'create', 'generate', 'documenteaza', 'adauga', 'prepara'];
const CODE_KEYWORDS = ['cod', 'code', 'implementeaza', 'implement', 'build', 'scrie cod', 'generaza cod', 'generate code'];
const TEST_KEYWORDS = ['test', 'tests', 'ruleaza teste', 'run tests', 'validateaza', 'verifica'];
const DOC_KEYWORDS = ['documentatie', 'docs', 'documentation', 'publish', 'doc', 'html'];
const CODE_SKILLS = new Set(['build-code-orchestrator', 'build-code', 'fix-tests-and-code-orchestrator', 'fix-tests-and-code']);
const TEST_SKILLS = new Set(['run-tests-orchestrator', 'run-tests']);
const DOC_SKILLS = new Set(['generate-docs-orchestrator', 'generate-docs']);

const normalizeName = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const pickAvailableSkill = (availableNames, ...candidates) => {
    const hasAvailability = availableNames && availableNames.size;
    for (const candidate of candidates) {
        const normalized = normalizeName(candidate);
        if (!normalized) {
            continue;
        }
        if (!hasAvailability || availableNames.has(normalized)) {
            return candidate;
        }
    }
    const fallback = candidates.find((entry) => typeof entry === 'string' && entry.trim());
    return fallback || null;
};

const normalizePlanEntries = (plan = [], taskDescription = '') => {
    if (!plan.length) {
        return plan;
    }
    const normalized = [];
    const lowerPrompt = (taskDescription || '').toLowerCase();
    const wantsReverse = FALLBACK_KEYWORDS.some((keyword) => lowerPrompt.includes(keyword));
    let combinedUpdate = null;

    plan.forEach((step) => {
        if (!step || !step.skill) {
            return;
        }
        const skillName = step.skill.toLowerCase();
        if (skillName === 'reverse-specs-orchestrator' && !wantsReverse) {
            return;
        }
        if (skillName === 'update-specs-orchestrator') {
            if (!combinedUpdate) {
                combinedUpdate = { ...step };
                normalized.push(combinedUpdate);
            } else {
                const mergedPrompt = [combinedUpdate.prompt, step.prompt]
                    .filter(Boolean)
                    .join('\n');
                combinedUpdate.prompt = mergedPrompt;
            }
            return;
        }
        normalized.push(step);
    });

    return normalized;
};

const requestPlanFromLLM = async ({
    llmAgent,
    taskDescription,
    orchestrators,
    languageContract,
    modelMode,
}) => {
    if (!llmAgent || typeof llmAgent.executePrompt !== 'function') {
        return [];
    }
    const prompt = buildPlanPrompt({
        task: taskDescription,
        orchestrators,
        languageContract,
    });

    try {
        const rawPlan = await llmAgent.executePrompt(prompt, {
            mode: modelMode,
            context: { intent: PLAN_INTENT },
        });
        return parsePlan(rawPlan);
    } catch {
        return [];
    }
};

const buildSpecCreationPlan = (taskDescription, availableSkills) => {
    const plan = [];
    const updaterSkill = pickAvailableSkill(
        availableSkills,
        'update-specs-orchestrator',
        'update-specs',
    );
    if (updaterSkill) {
        plan.push({
            skill: updaterSkill,
            prompt: [
                'Documenteaza sau actualizeaza URS, FS, NFS si DS pentru instructiunea:',
                taskDescription,
            ].join('\n'),
        });
    }
    const summarySkill = pickAvailableSkill(
        availableSkills,
        'mock-build-orchestrator',
        'mock-build',
    );
    if (summarySkill) {
        plan.push({
            skill: summarySkill,
            prompt: [
                'Prezinta un rezumat complet (URS, FS, NFS, DS) pentru:',
                taskDescription,
            ].join('\n'),
        });
    }
    return plan;
};

const buildSpecSummaryPlan = (taskDescription, availableSkills) => {
    const summarySkill = pickAvailableSkill(
        availableSkills,
        'mock-build-orchestrator',
        'mock-build',
    );
    if (!summarySkill) {
        return [];
    }
    const prompt = [
        'Afiseaza toate specificatiile (URS, FS, NFS, DS) pentru:',
        taskDescription,
    ].join('\n');
    return [{ skill: summarySkill, prompt }];
};

const buildFallbackPlan = (taskDescription, fallbackSkillName, availableSkills) => {
    const fallbackSkill = pickAvailableSkill(
        availableSkills,
        fallbackSkillName,
        'generic-skill-orchestrator',
        'generic-skill',
    );
    if (!fallbackSkill) {
        return [];
    }
    const prompt = typeof taskDescription === 'string'
        ? taskDescription.trim()
        : '';
    if (!prompt) {
        return [];
    }
    return [{ skill: fallbackSkill, prompt }];
};

export const intentionToSkillPlan = async ({
    llmAgent,
    taskDescription,
    orchestrators = [],
    languageContract = '',
    fallbackSkillName = DEFAULT_FALLBACK_SKILL,
    modelMode = 'fast',
}) => {
    const trimmedTask = typeof taskDescription === 'string' ? taskDescription.trim() : '';
    if (!trimmedTask) {
        return { plan: [], usedFallback: false };
    }

    const availableSkillNames = new Set(
        Array.isArray(orchestrators)
            ? orchestrators
                .map((record) => normalizeName(record?.name))
                .filter(Boolean)
            : [],
    );

    let plan = [];
    if (Array.isArray(orchestrators) && orchestrators.length) {
        plan = await requestPlanFromLLM({
            llmAgent,
            taskDescription: trimmedTask,
            orchestrators,
            languageContract,
            modelMode,
        });
    }

    const normalizedTask = trimmedTask.toLowerCase();
    const mentionsSpecs = SPEC_KEYWORDS.some((keyword) => normalizedTask.includes(keyword));
    const wantsSummary = mentionsSpecs
        && SPEC_SUMMARY_ACTIONS.some((keyword) => normalizedTask.includes(keyword));
    const wantsCreation = mentionsSpecs
        && SPEC_CREATION_ACTIONS.some((keyword) => normalizedTask.includes(keyword));

    const normalized = normalizePlanEntries(plan, trimmedTask);
    if (normalized.length) {
        const filtered = filterPlanByIntent(normalized, trimmedTask);
        if (wantsSummary && !wantsCreation) {
            const planFromSummary = buildSpecSummaryPlan(trimmedTask, availableSkillNames);
            if (planFromSummary.length) {
                return {
                    plan: planFromSummary,
                    usedFallback: false,
                };
            }
        }
        if (wantsCreation) {
            const hasUpdate = filtered.some((step) => normalizeName(step.skill || '').includes('update-specs'));
            if (!hasUpdate) {
                const planFromCreation = buildSpecCreationPlan(trimmedTask, availableSkillNames);
                if (planFromCreation.length) {
                    return {
                        plan: planFromCreation,
                        usedFallback: false,
                    };
                }
            }
        }
        return {
            plan: filtered.length ? filtered : normalized,
            usedFallback: false,
        };
    }

    if (mentionsSpecs) {
        if (wantsSummary && !wantsCreation) {
            const planFromSummary = buildSpecSummaryPlan(trimmedTask, availableSkillNames);
            if (planFromSummary.length) {
                return {
                    plan: planFromSummary,
                    usedFallback: false,
                };
            }
        }
        const planFromCreation = buildSpecCreationPlan(trimmedTask, availableSkillNames);
        if (planFromCreation.length) {
            return {
                plan: planFromCreation,
                usedFallback: false,
            };
        }
    }

    const fallbackPlan = buildFallbackPlan(trimmedTask, fallbackSkillName, availableSkillNames);
    const filteredFallback = filterPlanByIntent(fallbackPlan, trimmedTask);
    return {
        plan: filteredFallback,
        usedFallback: Boolean(filteredFallback.length),
    };
};

const filterPlanByIntent = (plan = [], taskDescription = '') => {
    if (!plan.length) {
        return plan;
    }
    const normalizedTask = taskDescription.toLowerCase();
    const wantsCode = CODE_KEYWORDS.some((keyword) => normalizedTask.includes(keyword));
    const wantsTests = TEST_KEYWORDS.some((keyword) => normalizedTask.includes(keyword));
    const wantsDocs = DOC_KEYWORDS.some((keyword) => normalizedTask.includes(keyword));

    return plan.filter((step) => {
        const skillName = (step.skill || '').toLowerCase();
        if (CODE_SKILLS.has(skillName) && !wantsCode) {
            return false;
        }
        if (TEST_SKILLS.has(skillName) && !wantsTests) {
            return false;
        }
        if (DOC_SKILLS.has(skillName) && !wantsDocs) {
            return false;
        }
        return true;
    });
};

export default {
    PLAN_INTENT,
    intentionToSkillPlan,
};
