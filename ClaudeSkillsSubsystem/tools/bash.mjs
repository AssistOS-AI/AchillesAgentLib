import { parseJsonInput, runBashCommand } from './utils.mjs';

export function buildBashTool() {
    return {
        description: `Run a shell command.
When to use: execute a terminal command or script.
How to call: pass JSON string with command and optional timeout (ms).
Examples:
- {"command":"ls -la"}
- {"command":"node --version","timeout":60000}
Notes: runs via bash -lc in the current working directory.`,
        handler: async (_agent, promptText) => {
            const { json, raw } = parseJsonInput(promptText);
            const input = json && typeof json === 'object' ? json : { command: raw };
            const command = String(input.command || '').trim();
            if (!command) {
                throw new Error('Bash requires a command string.');
            }
            const timeout = input.timeout ? Number(input.timeout) : undefined;
            const output = await runBashCommand(command, process.cwd(), timeout);
            const stderrText = output.stderr ? `\n[stderr]\n${output.stderr}` : '';
            const exitCodeText = output.exitCode ? `\n[exitCode] ${output.exitCode}` : '';
            const timeoutText = output.timedOut ? '\n[timedOut] true' : '';
            return `${output.stdout || ''}${stderrText}${exitCodeText}${timeoutText}`.trim();
        },
    };
}
