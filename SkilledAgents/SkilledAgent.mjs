import readline from 'node:readline';

import SkillRegistry from './SkillRegistry.mjs';
import { createExecutionContext } from './executor/context.mjs';
import { mainLoop } from './executor/mainLoop.mjs';

function normalizeRankedSkills(rankScores) {
    if (!rankScores || typeof rankScores !== 'object') {
        return [];
    }
    return Object.entries(rankScores)
        .filter(([name, score]) => typeof name === 'string' && Number.isFinite(Number(score)))
        .map(([name, score]) => [name, Number(score)])
        .sort((a, b) => a[1] - b[1]);
}

function collectMissingApiKeyEnvVars(llmAgent, mode = 'fast') {
    if (!llmAgent || typeof llmAgent.invokerStrategy !== 'function') {
        return [];
    }

    const { invokerStrategy } = llmAgent;
    if (typeof invokerStrategy.listAvailableModels !== 'function') {
        return [];
    }

    let catalog;
    try {
        catalog = invokerStrategy.listAvailableModels();
    } catch (error) {
        return [];
    }

    const requiredKeys = new Set();
    const prioritized = Array.isArray(catalog?.[mode]) ? catalog[mode] : [];
    if (!prioritized.length) {
        return [];
    }

    const satisfied = new Set();
    for (const record of prioritized) {
        const key = record && typeof record.apiKeyEnv === 'string' ? record.apiKeyEnv.trim() : '';
        if (!key) {
            return [];
        }
        requiredKeys.add(key);
        if (process.env[key]) {
            satisfied.add(key);
        }
    }

    if (satisfied.size) {
        return [];
    }

    return Array.from(requiredKeys);
}

function summariseSkill(skillName, score, skillRegistry) {
    if (!skillRegistry || typeof skillRegistry.getSkill !== 'function') {
        return `- ${skillName} (score: ${score})`;
    }
    try {
        const skill = skillRegistry.getSkill(skillName);
        const description = skill?.specs?.description || skill?.description || '';
        return description
            ? `- ${skillName} (score: ${score})\n  Description: ${description}`
            : `- ${skillName} (score: ${score})`;
    } catch (error) {
        return `- ${skillName} (score: ${score})`;
    }
}

function buildSkillSelectionPrompt({ query, ranked, skillRegistry }) {
    const lines = [
        'You select the most appropriate skill for the user request.',
        'Choose exactly one skill name from the candidate list or reply with "none" if no skill fits.',
    ];
    if (query) {
        lines.push(`User query: ${query}`);
    }
    lines.push('Candidate skills:');
    const summaries = ranked.map(([name, score]) => summariseSkill(name, score, skillRegistry));
    lines.push(summaries.join('\n'));
    lines.push('Respond with the chosen skill name or "none".');
    return lines.join('\n\n');
}

function interpretSelection(response, ranked) {
    const fallback = ranked.length ? ranked[0][0] : 'none';
    if (typeof response !== 'string') {
        return fallback;
    }
    const trimmed = response.trim();
    if (!trimmed) {
        return fallback;
    }

    const normalized = trimmed.toLowerCase();
    if (normalized === 'none' || normalized === 'no' || normalized === 'n/a') {
        return 'none';
    }

    const firstToken = trimmed.split(/[\s\r\n]+/)[0];
    if (!firstToken) {
        return fallback;
    }

    for (const [name] of ranked) {
        if (name === firstToken) {
            return name;
        }
    }

    for (const [name] of ranked) {
        if (name.toLowerCase() === firstToken.toLowerCase()) {
            return name;
        }
    }

    return fallback;
}

/**
 * Check if a string looks like a webchat envelope JSON
 * @param {string} text - The text to check
 * @returns {boolean} True if it looks like an envelope
 */
function looksLikeEnvelope(text) {
    if (typeof text !== 'string') {
        return false;
    }
    const trimmed = text.trim();
    // Check for envelope markers - don't assume opening/closing characters
    // as they can vary depending on how the envelope is echoed
    return trimmed.includes('"__webchatMessage"') &&
        trimmed.includes('"version"') &&
        trimmed.includes('"text"') &&
        trimmed.includes('"attachments"');
}

function defaultPromptReader(message) {
    // Create a custom writable stream that filters out envelope echoes
    const filterStream = new (class {
        write(chunk, encoding, callback) {
            const text = typeof chunk === 'string' ? chunk : (chunk ? chunk.toString() : '');
            // Only write to stdout if it doesn't look like an envelope echo
            if (text && !looksLikeEnvelope(text)) {
                process.stdout.write(chunk, encoding, callback);
            } else if (typeof callback === 'function') {
                // Call callback even if we filtered to maintain stream flow
                callback();
            }
            return true;
        }

        // Delegate other methods to stdout
        end(...args) {
            return process.stdout.end(...args);
        }

        get writable() {
            return process.stdout.writable;
        }
    })();

    const rl = readline.createInterface({
        input: process.stdin,
        output: filterStream,  // Use filter stream instead of stdout directly
        terminal: false  // Disable echo - critical for PTY environments like webchat
    });

    return new Promise((resolve) => {
        rl.question(message, (answer) => {
            rl.close();
            // Unescape newline placeholders (\x01 SOH) back to actual newlines
            const result = answer.replace(/\x01/g, '\n');
            resolve(result);
        });
    });
}

class SkilledAgent {
    constructor({ llmAgent, skillRegistry = null, promptReader = null, onProcessingStart = null, onProcessingEnd = null } = {}) {
        if (!llmAgent) {
            throw new Error('SkilledAgent requires an LLMAgent instance.');
        }
        this.llmAgent = llmAgent;
        this.skillRegistry = skillRegistry instanceof SkillRegistry ? skillRegistry : new SkillRegistry();
        this.promptReader = typeof promptReader === 'function' ? promptReader : defaultPromptReader;
        this.onProcessingStart = typeof onProcessingStart === 'function' ? onProcessingStart : null;
        this.onProcessingEnd = typeof onProcessingEnd === 'function' ? onProcessingEnd : null;

        // Pass processing callbacks to LLMAgent
        if (this.llmAgent) {
            this.llmAgent._processingCallbacks = {
                onStart: this.onProcessingStart,
                onEnd: this.onProcessingEnd
            };
        }
    }

    async readUserPrompt(prompt) {
        return this.promptReader(prompt);
    }

    registerSkill(config) {
        return this.skillRegistry.registerSkill(config);
    }

    rankSkill(taskDescription, options = {}) {
        return this.skillRegistry.rankSkill(taskDescription, options);
    }

    listSkillsForRole(role) {
        return this.skillRegistry.listSkillsForRole(role);
    }

    getSkill(name) {
        return this.skillRegistry.getSkill(name);
    }

    getSkillAction(name) {
        return this.skillRegistry.getSkillAction(name);
    }

    clearSkills() {
        this.skillRegistry.clear();
    }

    async executeSkill(skillName, { args = {}, taskDescription = '', securityContext = null, contextManager = null } = {}) {
        if (!skillName || typeof skillName !== 'string') {
            throw new Error('executeSkill requires a non-empty skill name.');
        }

        const skill = this.skillRegistry.getSkill(skillName);
        if (!skill) {
            throw new Error(`Skill "${skillName}" is not registered.`);
        }

        const action = this.skillRegistry.getSkillAction(skillName);
        if (typeof action !== 'function') {
            throw new Error(`No executable action found for skill "${skillName}".`);
        }

        const context = await createExecutionContext({
            skill,
            action,
            providedArgs: args,
            llmAgent: this.llmAgent,
            securityContext,
        });

        const finalArgs = await mainLoop(context, {
            readUserPrompt: (prompt) => this.readUserPrompt(prompt),
            taskDescription,
        });

        const argumentDefinitions = context.argumentDefinitions;
        const requiredArguments = context.requiredArguments;

        const orderedNames = argumentDefinitions.length
            ? argumentDefinitions.map((def) => def.name)
            : requiredArguments.slice();

        const executionOptions = { contextManager };

        if (!orderedNames.length) {
            return action({ ...finalArgs }, executionOptions);
        }

        const positionalValues = orderedNames.map((name) => finalArgs[name]);
        const wantsPositional = action.length > 1 && orderedNames.length === action.length;

        if (wantsPositional) {
            return action(...positionalValues, executionOptions);
        }

        return action({ ...finalArgs }, executionOptions);
    }

    async doTask(agentContext, description, options = {}) {
        return this.llmAgent.doTask(agentContext, description, options);
    }

    async doTaskWithReview(agentContext, description, options = {}) {
        return this.llmAgent.doTaskWithReview(agentContext, description, options);
    }

    async doTaskWithHumanReview(agentContext, description, options = {}) {
        return this.llmAgent.doTaskWithHumanReview(agentContext, description, options);
    }

    cancelTasks() {
        if (typeof this.llmAgent.cancel === 'function') {
            this.llmAgent.cancel();
        }
    }

    async brainstormQuestion(question, { generationCount = 5, mode = 'fast' } = {}) {
        const prompt = [
            'Generate concise ideas for the following question.',
            `Question: ${question}`,
            `List ${generationCount} distinct ideas as a numbered list.`,
            'Response:',
        ].join('\n\n');

        return this.llmAgent.complete({ prompt, mode, context: { intent: 'brainstorm' } });
    }

    async useSkill(skillName, { args = {}, taskDescription = '' } = {}) {
        return this.executeSkill(skillName, { args, taskDescription });
    }

    async chooseSkillWithLLM(rankScores, { query = '', mode = 'fast' } = {}) {
        const ranked = normalizeRankedSkills(rankScores);
        if (!ranked.length) {
            return 'none';
        }

        if (!this.llmAgent) {
            throw new Error('No LLMAgent configured for skill selection.');
        }

        const missingKeys = collectMissingApiKeyEnvVars(this.llmAgent, mode);
        if (missingKeys.length) {
            throw new Error(`Missing required API key environment variable(s) for mode "${mode}". Set at least one of: ${missingKeys.join(', ')}`);
        }

        const prompt = buildSkillSelectionPrompt({
            query,
            ranked,
            skillRegistry: this.skillRegistry,
        });

        const response = await this.llmAgent.complete({
            prompt,
            mode,
            context: {
                intent: 'skill-selection',
                rankedSkills: ranked.map(([name, score]) => ({ name, score })),
            },
        });

        return interpretSelection(response, ranked);
    }
}

export {
    SkilledAgent,
};
