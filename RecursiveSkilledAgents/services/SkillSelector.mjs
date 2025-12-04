import { createFlexSearchAdapter } from '../../utils/flexsearchAdapter.mjs';
import { Sanitiser } from '../../utils/Sanitiser.mjs';

/**
 * Normalize a skill identifier using the Sanitiser utility.
 * @param {string} value - The value to sanitize
 * @returns {string} Sanitized name
 */
function sanitiseName(value) {
    return Sanitiser.sanitiseName(value);
}

/**
 * Service for selecting the appropriate skill for a given task.
 * Provides orchestrator selection, LLM-based selection, and heuristic fallback.
 */
export class SkillSelector {
    /**
     * Create a new SkillSelector.
     * @param {Object} options - Selector options
     * @param {Object} [options.llmAgent] - LLM agent for intelligent selection
     * @param {Object} [options.logger] - Logger instance (defaults to console)
     * @param {Object} [options.debugLogger] - Debug logger instance
     */
    constructor({ llmAgent = null, logger = console, debugLogger = null } = {}) {
        this.llmAgent = llmAgent;
        this.logger = logger;
        this.debugLogger = debugLogger;
    }

    /**
     * Build searchable text from a skill record.
     * Combines title, summary, and body for full-text search.
     * @param {Object} record - The skill record
     * @returns {string} Combined searchable text
     */
    buildSearchText(record) {
        return [
            record.descriptor?.title,
            record.descriptor?.summary,
            record.descriptor?.body,
        ].filter(Boolean).join(' ');
    }

    /**
     * Select the best orchestrator for a given task description.
     * Uses FlexSearch for text matching, falls back to heuristic scoring.
     * @param {string} taskDescription - The task to match
     * @param {Object[]} orchestrators - Available orchestrator skills
     * @returns {Object|null} The best matching orchestrator, or null
     */
    selectOrchestrator(taskDescription, orchestrators) {
        if (!orchestrators.length) {
            return null;
        }

        const index = createFlexSearchAdapter({ tokenize: 'forward' });
        orchestrators.forEach((record, idx) => {
            try {
                index.add(String(idx), this.buildSearchText(record));
            } catch (error) {
                this.logger?.warn?.(`[SkillSelector] Failed to index orchestrator ${record.name}: ${error.message}`);
            }
        });

        this.debugLogger?.log('SkillSelector:selectOrchestrator:start', {
            taskDescription,
            orchestratorCount: orchestrators.length,
        });

        const query = typeof taskDescription === 'string' ? taskDescription.trim() : '';
        if (query) {
            try {
                const matches = index.search(query, { limit: 1 }) || [];
                if (matches.length) {
                    const [best] = matches;
                    const position = Number.parseInt(typeof best === 'object' ? best.id ?? best.doc ?? best.key : best, 10);
                    if (Number.isInteger(position) && orchestrators[position]) {
                        this.debugLogger?.log('SkillSelector:selectOrchestrator:searchMatch', {
                            method: 'index-position',
                            match: orchestrators[position].name,
                        });
                        return orchestrators[position];
                    }
                    const label = typeof best === 'string' ? best : String(best);
                    const found = orchestrators.find((record) =>
                        sanitiseName(record.name) === sanitiseName(label) ||
                        sanitiseName(record.shortName) === sanitiseName(label)
                    );
                    if (found) {
                        this.debugLogger?.log('SkillSelector:selectOrchestrator:searchMatch', {
                            method: 'label',
                            match: found.name,
                        });
                        return found;
                    }
                }
            } catch (error) {
                this.logger?.warn?.(`[SkillSelector] Orchestrator search failed: ${error.message}`);
            }
        }

        // Fallback to token-based scoring
        const tokens = query
            ? query.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2)
            : [];

        if (!tokens.length) {
            const selected = orchestrators[0] || null;
            if (selected) {
                this.debugLogger?.log('SkillSelector:selectOrchestrator:default', {
                    reason: 'no-tokens',
                    match: selected.name,
                });
            }
            return selected;
        }

        const scored = orchestrators
            .map((record) => {
                const haystack = this.buildSearchText(record).toLowerCase();
                let score = 0;
                tokens.forEach((token) => {
                    if (haystack.includes(token)) {
                        score += 1;
                    }
                });
                return { record, score };
            })
            .sort((a, b) => b.score - a.score);

        const best = scored.length && scored[0].score > 0 ? scored[0].record : orchestrators[0] || null;
        if (best) {
            this.debugLogger?.log('SkillSelector:selectOrchestrator:scored', {
                match: best.name,
            });
        }
        return best;
    }

    /**
     * Choose a skill using heuristic token matching.
     * @param {string} taskDescription - The task description
     * @param {Object[]} candidates - Available skill candidates
     * @returns {Object|null} The best matching skill, or first candidate
     */
    chooseByHeuristic(taskDescription, candidates) {
        if (!candidates.length) {
            return null;
        }
        const query = typeof taskDescription === 'string' ? taskDescription.trim().toLowerCase() : '';
        if (!query) {
            return candidates[0];
        }
        const tokens = query.split(/[^a-z0-9]+/).filter((token) => token.length > 2);
        if (!tokens.length) {
            return candidates[0];
        }
        const scored = candidates
            .map((record) => {
                const haystack = this.buildSearchText(record).toLowerCase();
                let score = 0;
                tokens.forEach((token) => {
                    if (haystack.includes(token)) {
                        score += 1;
                    }
                });
                return { record, score };
            })
            .sort((a, b) => b.score - a.score);
        return scored.length && scored[0].score > 0 ? scored[0].record : candidates[0];
    }

    /**
     * Choose a skill using LLM-based selection.
     * Falls back to heuristic if LLM is unavailable or fails.
     * @param {string} taskDescription - The task description
     * @param {Object[]} candidates - Available skill candidates
     * @returns {Promise<Object|null>} The selected skill, or null
     */
    async chooseWithLLM(taskDescription, candidates) {
        if (!candidates.length) {
            return null;
        }

        if (!this.llmAgent || typeof this.llmAgent.executePrompt !== 'function') {
            return this.chooseByHeuristic(taskDescription, candidates);
        }

        const prompt = [
            '# Skill Selection',
            'Choose the single best skill for the request.',
            '',
            '## Request',
            taskDescription || '<empty>',
            '',
            '## Available Skills',
        ];

        candidates.forEach((record) => {
            prompt.push(`- ${record.name}: ${record.descriptor?.summary || 'No summary provided.'}`);
        });

        prompt.push(
            '',
            'Respond with either the exact skill name or the word "none".',
        );

        try {
            const response = await this.llmAgent.executePrompt(prompt.join('\n'), {
                mode: 'fast',
                context: { intent: 'recursive-skill-selection' },
            });

            if (typeof response === 'string') {
                const trimmed = response.trim();
                if (!trimmed || trimmed.toLowerCase() === 'none') {
                    return null;
                }
                const normalized = sanitiseName(trimmed.split(/[\s\r\n]+/)[0]);
                return candidates.find((record) =>
                    sanitiseName(record.name) === normalized ||
                    sanitiseName(record.shortName) === normalized
                ) || null;
            }
        } catch (error) {
            this.logger?.warn?.(`[SkillSelector] Skill selection via LLM failed: ${error.message}`);
        }

        return this.chooseByHeuristic(taskDescription, candidates);
    }

    /**
     * Update the LLM agent.
     * @param {Object} llmAgent - The new LLM agent
     */
    setLLMAgent(llmAgent) {
        this.llmAgent = llmAgent;
    }
}
