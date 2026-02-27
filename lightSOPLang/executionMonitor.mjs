export class DefaultExecutionMonitor {
    constructor({
        commandLimit = 100,
        promptCharLimit = 1000000,
        failureLimit = 10,
    } = {}) {
        this.commandLimit = Number.isFinite(commandLimit) ? commandLimit : 100;
        this.promptCharLimit = Number.isFinite(promptCharLimit) ? promptCharLimit : 1000000;
        this.failureLimit = Number.isFinite(failureLimit) ? failureLimit : 10;

        this.commandsExecuted = 0;
        this.promptsConsidered = 0;
        this.totalPromptChars = 0;
        this.failureCounts = new Map();
        this.commandHistory = [];
        this.promptHistory = [];
        this.failureHistory = [];
    }

    beforeExecuteCommand(commandName, commandInput) {
        this.commandsExecuted += 1;
        if (this.commandsExecuted > this.commandLimit) {
            throw new Error(`Execution halted: command budget exceeded (${this.commandLimit})`);
        }
        const entry = { commandName, commandInput };
        this.commandHistory.push(entry);
        this.lastCommand = entry;
    }

    beforeRegenerateScript({ prompt, request }) {
        this.promptsConsidered += 1;
        const length = typeof prompt === 'string' ? prompt.length : 0;
        this.totalPromptChars += length;
        if (this.totalPromptChars > this.promptCharLimit) {
            throw new Error(`Execution halted: prompt budget exceeded (${this.promptCharLimit} characters)`);
        }
        const entry = { prompt, request };
        this.promptHistory.push(entry);
        this.lastPrompt = entry;
    }

    reportCommandFailure(commandName, reason) {
        const current = this.failureCounts.get(commandName) ?? 0;
        const updated = current + 1;
        this.failureCounts.set(commandName, updated);
        const entry = { commandName, reason };
        this.failureHistory.push(entry);
        this.lastFailure = entry;
        if (updated > this.failureLimit) {
            throw new Error(`Execution halted: failure limit exceeded for command ${commandName}`);
        }
    }

    getStats() {
        return {
            commandLimit: this.commandLimit,
            commandsExecuted: this.commandsExecuted,
            promptCharLimit: this.promptCharLimit,
            promptsConsidered: this.promptsConsidered,
            totalPromptChars: this.totalPromptChars,
            failureLimit: this.failureLimit,
            failureCounts: Object.fromEntries(this.failureCounts.entries()),
            lastCommand: this.lastCommand ?? null,
            lastPrompt: this.lastPrompt ?? null,
            lastFailure: this.lastFailure ?? null,
            commandHistory: this.commandHistory.slice(),
            promptHistory: this.promptHistory.slice(),
            failureHistory: this.failureHistory.slice(),
        };
    }
}

export function ensureExecutionMonitor(monitor) {
    if (!monitor) {
        return new DefaultExecutionMonitor();
    }
    const hasBeforeExecute = typeof monitor.beforeExecuteCommand === 'function';
    const hasBeforeRegenerate = typeof monitor.beforeRegenerateScript === 'function';
    const hasReportFailure = typeof monitor.reportCommandFailure === 'function';
    if (!hasBeforeExecute || !hasBeforeRegenerate || !hasReportFailure) {
        throw new Error('executionMonitor must implement beforeExecuteCommand, beforeRegenerateScript, and reportCommandFailure');
    }
    if (typeof monitor.getStats !== 'function') {
        monitor.getStats = () => ({});
    }
    return monitor;
}

export default DefaultExecutionMonitor;
