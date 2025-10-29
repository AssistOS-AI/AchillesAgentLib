import { createSkilledAgent, SkilledAgent } from '../SkilledAgents/index.mjs';

function normalizeRanking(results) {
    if (!results || typeof results !== 'object') {
        return [];
    }
    return Object.entries(results)
        .filter(([name, score]) => typeof name === 'string' && Number.isFinite(Number(score)))
        .map(([name, score]) => [name, Number(score)])
        .sort((a, b) => a[1] - b[1]);
}

export class BaseSkillsSubsystem {
    constructor({ skilledAgent = null, skilledAgentOptions = {} } = {}) {
        if (skilledAgent && !(skilledAgent instanceof SkilledAgent)) {
            throw new TypeError('BaseSkillsSubsystem expects a SkilledAgent instance.');
        }

        this.skilledAgent = skilledAgent
            || createSkilledAgent(skilledAgentOptions);
        this.metadata = new Map();
    }

    registerSkillDescriptor(_descriptor) {
        throw new Error('registerSkillDescriptor must be implemented by subclasses.');
    }

    recordMetadata(skillName, info) {
        this.metadata.set(skillName, info || null);
    }

    getMetadata(skillName) {
        return this.metadata.get(skillName) || null;
    }

    rankSkills(taskDescription, rankOptions = {}) {
        try {
            return this.skilledAgent.rankSkill(taskDescription, rankOptions);
        } catch (error) {
            return {};
        }
    }

    async chooseSkill(taskDescription, rankOptions = {}) {
        const ranked = this.rankSkills(taskDescription, rankOptions);
        const normalized = normalizeRanking(ranked);
        if (!normalized.length) {
            return null;
        }

        const bestScore = normalized[0][1];
        const bestCandidates = normalized.filter(([, score]) => score === bestScore);

        let selectedName = bestCandidates[0][0];
        if (bestCandidates.length > 1) {
            try {
                const choice = await this.skilledAgent.chooseSkillWithLLM(ranked, {
                    query: taskDescription,
                });
                if (choice && choice !== 'none' && ranked[choice] !== undefined) {
                    selectedName = choice;
                }
            } catch (error) {
                // Fall back to first candidate on failure.
            }
        }

        return {
            name: selectedName,
            score: ranked[selectedName],
            metadata: this.getMetadata(selectedName),
        };
    }

    async executeSkill(skillName, { args = {}, taskDescription = '', securityContext = null, contextManager = null } = {}) {
        return this.skilledAgent.executeSkill(skillName, {
            args,
            taskDescription,
            securityContext,
            contextManager,
        });
    }

    async executePrompt(promptText, options = {}) {
        const {
            skillName = null,
            args = {},
            securityContext = null,
            contextManager = null,
            rankOptions = {},
        } = options || {};

        let chosen = skillName;
        if (!chosen) {
            const candidate = await this.chooseSkill(promptText, rankOptions);
            if (!candidate || !candidate.name) {
                throw new Error('No skill available to handle the request.');
            }
            chosen = candidate.name;
        }

        const result = await this.executeSkill(chosen, {
            args,
            taskDescription: promptText,
            securityContext,
            contextManager,
        });

        return {
            skill: chosen,
            metadata: this.getMetadata(chosen),
            result,
        };
    }

    listSkills() {
        return Array.from(this.metadata.keys());
    }
}
