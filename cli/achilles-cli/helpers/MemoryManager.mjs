import fs from 'node:fs';
import path from 'node:path';
import { MemoryContainer } from '../../../MemoryContainer/MemoryContainer.mjs';

const HISTORY_FILE_KEYS = {
    global: 'global_memory',
    user: 'user_memory',
};

const loadHistory = (specsRoot, key) => {
    if (!specsRoot) {
        return [];
    }
    const target = path.join(specsRoot, `.history_${key}`);
    try {
        const raw = JSON.parse(fs.readFileSync(target, 'utf8'));
        if (Array.isArray(raw?.history)) {
            return raw.history;
        }
    } catch {
        // ignore parse errors
    }
    return [];
};

class MemoryManager {
    constructor({ specsRoot, workspaceRoot, llmAgent = null, summarizeExecutions = null }) {
        this.specsRoot = specsRoot || path.join(workspaceRoot || process.cwd(), '.specs');
        this.llmAgent = llmAgent;
        this.summarizeExecutions = typeof summarizeExecutions === 'function'
            ? summarizeExecutions
            : ((executions) => executions
                .map((execution) => execution.prompt || '')
                .filter(Boolean));
        this.globalMemory = new MemoryContainer({
            baseDir: this.specsRoot,
            initialHistory: loadHistory(this.specsRoot, HISTORY_FILE_KEYS.global),
        });
        this.userMemory = new MemoryContainer({
            baseDir: this.specsRoot,
            initialHistory: loadHistory(this.specsRoot, HISTORY_FILE_KEYS.user),
        });
        this.sessionMemory = new MemoryContainer({
            baseDir: this.specsRoot,
            initialHistory: [],
        });
    }

    getContext() {
        return {
            globalMemory: this.globalMemory.getFullContext(),
            userMemory: this.userMemory.getFullContext(),
            sessionMemory: this.sessionMemory.getFullContext(),
        };
    }

    async capture({ userPrompt, plan = [], executions = [], cancelled = false }) {
        if (!userPrompt && !plan.length && !executions.length) {
            return;
        }
        const summaryLines = [];
        if (plan.length) {
            summaryLines.push(`Plan steps: ${plan.map((step) => step.skill).join(', ')}`);
        }
        const executionSummaries = this.summarizeExecutions(executions);
        summaryLines.push(...executionSummaries);
        if (cancelled) {
            summaryLines.push('Plan cancelled before completion.');
        }
        const summary = summaryLines.filter(Boolean).join('\n');

        const routing = await this._classifyMemory(userPrompt, summary)
            .catch(() => null);
        if (!routing) {
            this.sessionMemory.appendToHistory({ user: userPrompt, ai: summary });
            return;
        }

        this._maybeStore(this.globalMemory, HISTORY_FILE_KEYS.global, routing.global, userPrompt, summary);
        this._maybeStore(this.userMemory, HISTORY_FILE_KEYS.user, routing.user, userPrompt, summary);
        this._maybeStore(this.sessionMemory, null, routing.session, userPrompt, summary, false);
    }

    async _classifyMemory(userPrompt, summary) {
        if (!this.llmAgent || typeof this.llmAgent.executePrompt !== 'function') {
            return null;
        }
        const body = [
            '# Memory Router',
            'Decide whether to store the interaction in long-term memory.',
            'Memory types:',
            '- global: enduring workspace context or rules.',
            '- user: operator preferences or instructions.',
            '- session: short-lived context for this CLI session.',
            'Respond with JSON: {"global":{"store":bool,"note":""}, "user":{...}, "session":{...}}',
            `User prompt:\n${userPrompt || '<empty>'}`,
            `Summary:\n${summary || '<none>'}`,
        ].join('\n\n');

        const response = await this.llmAgent.executePrompt(body, {
            responseShape: 'json',
            context: { intent: 'memory-routing' },
            mode: 'fast',
        });
        if (typeof response === 'string') {
            return JSON.parse(response);
        }
        return response;
    }

    _maybeStore(container, key, decision = {}, userPrompt, summary, persist = true) {
        if (!container) {
            return;
        }
        const shouldStore = decision.store !== false;
        if (!shouldStore) {
            return;
        }
        const note = decision.note || summary || userPrompt || null;
        container.appendToHistory({
            user: userPrompt || null,
            ai: note,
        });
        if (key && persist && typeof container.saveContext === 'function') {
            try {
                container.saveContext(key);
            } catch {
                // ignore persistence issues
            }
        }
    }
}

export { MemoryManager };
export default MemoryManager;
