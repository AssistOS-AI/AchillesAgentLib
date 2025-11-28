import { getLLMStats } from '../../../utils/LLMLogger.mjs';
import {
    COLOR_INFO,
    COLOR_WARN,
    COLOR_ERROR,
    COLOR_RESET,
} from './styles.mjs';

export const printHelp = (cli) => {
    const items = [
        { command: '/help', description: 'Show this help.' },
        { command: '/list', description: 'List registered skills with type and implementation.' },
        { command: '/debug [on|off]', description: 'Toggle verbose LLM request/response logging.' },
        { command: '/model fast|deep', description: 'Switch default LLM mode used by planners.' },
        { command: '/lang <language>', description: 'Set specification language (default: english).' },
        { command: '/run <skill> <<prompt>>', description: 'Invoke a specific skill directly with inline instructions.' },
        { command: '/continue [extra]', description: 'Resume pending plan; add extra text to replan with new instructions.' },
        { command: '/status', description: 'Show LLM request statistics, token counts, and log file locations.' },
        { command: '/specs [filter]', description: 'Print the stored URS/FS/NFS/DS sections (filter by IDs or keywords).' },
        { command: '/exit or /quit', description: 'Exit the CLI.' },
    ];
    cli.output.write(`${COLOR_INFO}Achilles CLI Commands:${COLOR_RESET}\n`);
    items.forEach((item) => {
        cli.output.write(`  ${item.command.padEnd(18)} ${item.description}\n`);
    });
    cli.output.write('General input:\n');
    cli.output.write("  End a line with '\\' to continue typing multi-line prompts.\n");
    cli.output.write('  Press Esc or Ctrl+C during execution to cancel the active plan.\n');
    cli.output.write("  Use ↑/↓ to recall previous prompts (stored in .specs/.prompts_history).\n");
    cli.output.write("  Type 'continue' (any language variant) or use /continue to resume after cancelling.\n");
};

export const printStatus = (cli) => {
    const stats = getLLMStats();
    cli.output.write(`${COLOR_INFO}[status] LLM requests: ${stats.totalRequests || 0}${COLOR_RESET}\n`);
    cli.output.write(`  Tokens sent: ${stats.tokensSent || 0}, received: ${stats.tokensReceived || 0}\n`);
    cli.output.write(`  Last model: ${stats.lastModel || 'n/a'} (updated ${stats.lastUpdated || 'n/a'})\n`);
    if (stats.models && Object.keys(stats.models).length) {
        cli.output.write('  Models:\n');
        Object.entries(stats.models).forEach(([model, data]) => {
            cli.output.write(`    - ${model}: ${data.requests} req, sent ${data.tokensSent || 0}, received ${data.tokensReceived || 0}\n`);
        });
    }
    cli.output.write(`  Log file: ${cli.llmLogsPath}\n`);
    cli.output.write(`  Stats file: ${cli.llmStatsPath}\n`);
    const invoker = cli.llmAgent?.invokerStrategy;
    if (invoker && typeof invoker.listAvailableModels === 'function') {
        const available = invoker.listAvailableModels() || {};
        const formatModel = (record) => {
            const details = [];
            if (record.providerKey) {
                details.push(`provider=${record.providerKey}`);
            }
            if (record.apiKeyEnv) {
                details.push(`apiKeyEnv=${record.apiKeyEnv}`);
            }
            if (record.baseURL) {
                details.push(`baseURL=${record.baseURL}`);
            }
            return `${record.name}${details.length ? ` (${details.join(', ')})` : ''}`;
        };
        if (Array.isArray(available.fast) && available.fast.length) {
            cli.output.write('  Fast models:\n');
            available.fast.forEach((record) => {
                cli.output.write(`    - ${formatModel(record)}\n`);
            });
        }
        if (Array.isArray(available.deep) && available.deep.length) {
            cli.output.write('  Deep models:\n');
            available.deep.forEach((record) => {
                cli.output.write(`    - ${formatModel(record)}\n`);
            });
        }
    }
    if (stats.buckets) {
        cli.output.write('  Response buckets:\n');
        Object.entries(stats.buckets).forEach(([label, data]) => {
            if (!data.requests) {
                return;
            }
            const avg = data.requests ? (data.totalMs / data.requests).toFixed(1) : 'n/a';
            const min = data.minMs === null ? 'n/a' : data.minMs.toFixed(1);
            const max = data.maxMs === null ? 'n/a' : data.maxMs.toFixed(1);
            cli.output.write(`    ${label}: ${data.requests} req, avg ${avg}ms (min ${min} / max ${max}), tokens sent ${data.tokensSent}, received ${data.tokensReceived}\n`);
        });
    }
};

export default {
    printHelp,
    printStatus,
};
