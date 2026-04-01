import { parseKeyValueInput, runBashCommand, stripDependsOn, unwrapBacktickLiteral } from '../../../utils/internalSkillsUtils.mjs';

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
    const sanitizedPrompt = stripDependsOn(promptText);
    const { data, raw, hasPairs } = parseKeyValueInput(sanitizedPrompt);
    const input = hasPairs ? data : { command: raw };
    const multilineCommand = extractMultilineAfterKey(sanitizedPrompt, 'command');
    const rawCommand = multilineCommand ?? (input.command || '');
    const command = String(unwrapBacktickLiteral(rawCommand)).trim();
    if (!command) {
        throw new Error('Bash requires a command string.');
    }
    const timeout = input.timeout ? Number(input.timeout) : undefined;
    const baseDir = process.cwd();
    const output = await runBashCommand(command, baseDir, timeout);
    const stderrText = output.stderr ? `\n[stderr]\n${output.stderr}` : '';
    const exitCodeText = output.exitCode ? `\n[exitCode] ${output.exitCode}` : '';
    const timeoutText = output.timedOut ? '\n[timedOut] true' : '';
    return `${output.stdout || ''}${stderrText}${exitCodeText}${timeoutText}`.trim();
}
