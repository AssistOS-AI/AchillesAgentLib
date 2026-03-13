import { parseKeyValueInput, runBashCommand } from '../../../utils/internalSkillsUtils.mjs';

export async function action(context) {
    const { promptText } = context;
    const { data, raw, hasPairs } = parseKeyValueInput(promptText);
    const input = hasPairs ? data : { command: raw };
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
}
