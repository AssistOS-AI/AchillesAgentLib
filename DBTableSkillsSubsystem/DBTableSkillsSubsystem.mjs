import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { MemoryContainer } from '../MemoryContainer/MemoryContainer.mjs';
import { compileDBTableSkill } from './compiler/compileDBTableSkill.mjs';
import { runDBTableSkill } from './executor/runDBTableSkill.mjs';

const GENERATED_FILE = 'dbtable.generated.mjs';

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
        // History failures must never block execution.
    }
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
        throw new Error('DBTableSkillsSubsystem requires a base LLMAgent instance.');
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

export class DBTableSkillsSubsystem {
    constructor({ llmAgent }) {
        this.llmAgent = llmAgent;
        this.skillModules = new Map();
    }

    prepareSkill(skillRecord) {
        const compilation = compileDBTableSkill(skillRecord);
        skillRecord.metadata = {
            type: 'dbtable',
            title: skillRecord.descriptor?.title || compilation.blueprint.title,
            summary: skillRecord.descriptor?.summary || compilation.blueprint.summary,
            tableName: compilation.blueprint.tableName,
            fieldOrder: compilation.blueprint.fieldOrder,
            primaryKeys: compilation.blueprint.primaryKeys,
            descriptorHash: compilation.blueprint.descriptorHash,
            generatedFile: path.join(skillRecord.skillDir, GENERATED_FILE),
        };
    }

    async ensureSkillModule(skillRecord) {
        if (this.skillModules.has(skillRecord.name)) {
            return this.skillModules.get(skillRecord.name);
        }
        const generatedPath = path.join(skillRecord.skillDir, GENERATED_FILE);
        const moduleUrl = pathToFileURL(generatedPath);
        const imported = await import(moduleUrl.href);
        const moduleEntry = imported.generated || imported.default || imported;
        this.skillModules.set(skillRecord.name, moduleEntry);
        return moduleEntry;
    }

    async executeSkillPrompt({
        skillRecord,
        recursiveAgent,
        promptText,
        options = {},
    }) {
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

        const moduleEntry = await this.ensureSkillModule(skillRecord);
        const scopedLLM = createSkillScopedLLMAgent(this.llmAgent, memory);

        const fallbackReader = typeof recursiveAgent?.promptReader === 'function'
            ? recursiveAgent.promptReader
            : (async () => {
                throw new Error(`No prompt reader configured for DB table skill "${skillRecord.name}".`);
            });
        const effectiveReader = typeof promptReader === 'function'
            ? promptReader
            : fallbackReader;

        const result = await runDBTableSkill({
            skillRecord,
            blueprint: moduleEntry.blueprint,
            generated: moduleEntry,
            llmAgent: scopedLLM,
            promptText,
            readUserPrompt: effectiveReader,
            args,
            taskDescription: promptText,
        });

        if (result !== undefined) {
            const rendered = typeof result.markdown === 'string'
                ? result.markdown
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

export default {
    DBTableSkillsSubsystem,
};
