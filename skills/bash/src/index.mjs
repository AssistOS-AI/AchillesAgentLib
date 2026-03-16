import { parseKeyValueInput, runBashCommand } from '../../../utils/internalSkillsUtils.mjs';

function extractMultilineAfterKey(promptText, key) {
    const lines = String(promptText ?? '').split(/\r?\n/);
    const pattern = new RegExp(`^${key}\\s*:\\s*(.*)$`);
    for (let i = 0; i < lines.length; i += 1) {
        const match = lines[i].match(pattern);
        if (!match) {
            continue;
        }
        const firstLine = match[1] ?? '';
        const rest = lines.slice(i + 1).join('\n');
        return rest ? `${firstLine}\n${rest}` : firstLine;
    }
    return null;
}

export async function action(context) {
    const { promptText } = context;
    const { data, raw, hasPairs } = parseKeyValueInput(promptText);
    const input = hasPairs ? data : { command: raw };
    const multilineCommand = extractMultilineAfterKey(promptText, 'command');
    const command = String(multilineCommand ?? (input.command || '')).trim();
    if (!command) {
        throw new Error('Bash requires a command string.');
    }
    const timeout = input.timeout ? Number(input.timeout) : undefined;
    const output = await runBashCommand(command, process.cwd(), timeout);
    const stderrText = output.stderr ? `\n[stderr]\n${output.stderr}` : '';
    const exitCodeText = output.exitCode ? `\n[exitCode] ${output.exitCode}` : '';
    const timeoutText = output.timedOut ? '\n[timedOut] true' : '';
    return `${output.stdout || ''}${stderrText}${exitCodeText}${timeoutText}`.trim();
}
