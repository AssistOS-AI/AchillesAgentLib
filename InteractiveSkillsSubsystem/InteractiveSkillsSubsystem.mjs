import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { MemoryContainer } from '../MemoryContainer/MemoryContainer.mjs';
import { runInteractiveSkill } from './executor/runInteractiveSkill.mjs';

function ensureMemoryContainer(candidate) {
    if (!candidate) {
        return new MemoryContainer();
    }
    if (candidate instanceof MemoryContainer) {
        return candidate;
    }
    if (typeof candidate === 'object') {
        const initialHistory = Array.isArray(candidate.history) ? candidate.history : [];
        return new MemoryContainer({ initialHistory });
    }
    return new MemoryContainer();
}

function recordHistoryEntry(container, entry) {
    if (!container || typeof container.appendToHistory !== 'function') {
        return;
    }
    try {
        container.appendToHistory(entry);
    } catch (error) {
        // History persistence must never block execution
    }
}

async function loadInteractiveModule(skillDir, shortName) {
    const candidateFiles = [
        `${shortName}.mjs`,
        `${shortName}.js`,
    ];

    for (const fileName of candidateFiles) {
        const fullPath = path.join(skillDir, fileName);
        try {
            const moduleUrl = pathToFileURL(fullPath);
            const imported = await import(moduleUrl.href);
            const specs = imported.specs || imported.default?.specs;
            const action = imported.action || imported.default?.action;
            const roles = imported.roles || imported.default?.roles || ['interactive'];
            if (!specs || typeof specs !== 'object') {
                throw new Error(`Interactive skill module at ${fullPath} does not export "specs".`);
            }
            if (typeof action !== 'function') {
                throw new Error(`Interactive skill module at ${fullPath} does not export an "action" function.`);
            }
            return { specs, action, roles };
        } catch (error) {
            if (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'ENOENT') {
                continue;
            }
            throw error;
        }
    }

    throw new Error(`Interactive skill module missing for skill folder ${skillDir}. Expected ${candidateFiles.join(' or ')}.`);
}

function buildHistoryFromMemory(memory) {
    if (!memory || typeof memory.getFullContext !== 'function') {
        return [];
    }
    const context = memory.getFullContext();
    const history = [];
    for (const entry of context) {
        if (entry.user) {
            history.push({ role: 'user', message: entry.user });
        }
        if (entry.ai) {
            history.push({ role: 'assistant', message: entry.ai });
        }
    }
    return history;
}

function createSkillScopedLLMAgent(baseAgent, memory) {
    if (!baseAgent) {
        throw new Error('InteractiveSkillsSubsystem requires a base LLMAgent instance.');
    }

    const scoped = Object.create(baseAgent);

    scoped.executePrompt = (promptText, options = {}) => {
        const merged = {
            ...options,
            sessionMemory: memory,
            skillShortMemory: memory,
        };
        return baseAgent.executePrompt(promptText, merged);
    };

    scoped.doTask = (agentContext, description, options = {}) => {
        const merged = {
            ...options,
            sessionMemory: memory,
            skillShortMemory: memory,
        };
        return baseAgent.doTask(agentContext, description, merged);
    };

    scoped.doTaskWithReview = (agentContext, description, options = {}) => {
        const merged = {
            ...options,
            sessionMemory: memory,
            skillShortMemory: memory,
        };
        return baseAgent.doTaskWithReview(agentContext, description, merged);
    };

    scoped.doTaskWithHumanReview = (agentContext, description, options = {}) => {
        const merged = {
            ...options,
            sessionMemory: memory,
            skillShortMemory: memory,
        };
        return baseAgent.doTaskWithHumanReview(agentContext, description, merged);
    };

    scoped.complete = async (options = {}) => {
        if (!options || typeof options !== 'object') {
            return baseAgent.complete(options);
        }
        const historyFromMemory = buildHistoryFromMemory(memory);
        const providedHistory = Array.isArray(options.history) ? options.history : [];
        const mergedHistory = historyFromMemory.length
            ? [...historyFromMemory, ...providedHistory]
            : providedHistory;
        const mergedOptions = mergedHistory.length
            ? { ...options, history: mergedHistory }
            : { ...options };
        return baseAgent.complete(mergedOptions);
    };

    return scoped;
}

export class InteractiveSkillsSubsystem {
    constructor({ llmAgent }) {
        this.llmAgent = llmAgent;
        this.skillModules = new Map();
    }

    async prepareSkill(skillRecord) {
        // Nothing to precompute beyond basic metadata; actual module loading occurs on demand.
        const { descriptor } = skillRecord;
        skillRecord.metadata = {
            type: 'interactive',
            title: descriptor?.title || null,
            summary: descriptor?.summary || null,
            body: descriptor?.body || null,
            sections: descriptor?.sections || {},
        };
    }

    async ensureSkillModule(skillRecord) {
        if (this.skillModules.has(skillRecord.name)) {
            return this.skillModules.get(skillRecord.name);
        }
        const moduleData = await loadInteractiveModule(skillRecord.skillDir, skillRecord.shortName);
        const specs = { ...(moduleData.specs || {}), name: skillRecord.name };
        const roles = Array.isArray(moduleData.roles) && moduleData.roles.length
            ? moduleData.roles.slice()
            : ['interactive'];
        const action = moduleData.action;
        this.skillModules.set(skillRecord.name, { specs, roles, action });
        return this.skillModules.get(skillRecord.name);
    }

    async executeSkillPrompt({ skillRecord, recursiveAgent, promptText, options = {} }) {
        const {
            sessionMemory = null,
            contextManager = null,
            promptReader = null,
            args = {},
        } = options;

        const memory = ensureMemoryContainer(sessionMemory || contextManager);
        if (promptText && typeof promptText === 'string') {
            recordHistoryEntry(memory, { user: promptText });
        }

        const moduleData = await this.ensureSkillModule(skillRecord);
        const fallbackReader = typeof recursiveAgent?.promptReader === 'function'
            ? recursiveAgent.promptReader
            : (async () => {
                throw new Error(`No prompt reader configured for interactive skill "${skillRecord.name}".`);
            });
        const effectivePromptReader = typeof promptReader === 'function'
            ? promptReader
            : fallbackReader;

        const scopedLLM = createSkillScopedLLMAgent(this.llmAgent, memory);
        const result = await runInteractiveSkill({
            skill: { ...moduleData.specs },
            action: moduleData.action,
            providedArgs: args,
            llmAgent: scopedLLM,
            readUserPrompt: effectivePromptReader,
            taskDescription: promptText,
            contextManager: memory,
        });

        if (result !== undefined) {
            const rendered = typeof result === 'string'
                ? result
                : (() => {
                    try {
                        return JSON.stringify(result);
                    } catch (error) {
                        return String(result);
                    }
                })();
            recordHistoryEntry(memory, { ai: rendered });
        }

        return {
            skill: skillRecord.name,
            metadata: skillRecord.metadata || null,
            result,
            sessionMemory: memory,
        };
    }
}
