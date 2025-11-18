import { runSkill, printSpecActionPreview } from './executionHelpers.mjs';
import { COLOR_INFO, COLOR_WARN, COLOR_RESET } from './styles.mjs';

const AUTO_BOOTSTRAP_SKILLS = [
    {
        name: 'ignore-files',
        prompt: 'Automatic bootstrap: ensure default ignore list is applied.',
    },
];

const BOOTSTRAP_MODES = new Set(['auto', 'ask', 'manual']);

export const normalizeBootstrapMode = (mode, fallback = 'auto') => {
    const candidate = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
    if (BOOTSTRAP_MODES.has(candidate)) {
        return candidate;
    }
    const normalizedFallback = typeof fallback === 'string' ? fallback.trim().toLowerCase() : '';
    if (BOOTSTRAP_MODES.has(normalizedFallback)) {
        return normalizedFallback;
    }
    return 'auto';
};

export const ensureBootstrap = async (cli, taskDescription) => {
    if (cli.bootstrapCompleted) {
        return;
    }
    if (cli._bootstrapPromise) {
        await cli._bootstrapPromise;
        return;
    }
    cli._bootstrapPromise = (async () => {
        if (cli.bootstrapCompleted) {
            return;
        }
        if (!cli._bootstrapRequired) {
            cli.bootstrapCompleted = true;
            return;
        }

        const effectiveMode = cli.autoBootstrapMode === 'ask' && !cli.interactive
            ? 'auto'
            : cli.autoBootstrapMode;
        if (effectiveMode === 'manual') {
            cli.bootstrapCompleted = true;
            return;
        }

        const promptText = taskDescription || 'Workspace bootstrap';

        for (const step of AUTO_BOOTSTRAP_SKILLS) {
            const record = cli.findSkill(step.name);
            if (!record) {
                cli.output.write(`${COLOR_WARN}[auto] Skill "${step.name}" not found; skipping bootstrap step.${COLOR_RESET}\n`);
                // eslint-disable-next-line no-continue
                continue;
            }

            const plannedPrompt = step.prompt || promptText;

            if (effectiveMode === 'ask') {
                // eslint-disable-next-line no-await-in-loop
                const approve = await cli.promptYesNo(
                    `[auto] ${record.name} – ${plannedPrompt}\nRun this bootstrap step?`,
                    true,
                );
                if (!approve) {
                    cli.output.write(`${COLOR_WARN}[auto] Skipping ${record.name} at user request.${COLOR_RESET}\n`);
                    // eslint-disable-next-line no-continue
                    continue;
                }
            }

            cli.output.write(`${COLOR_INFO}[auto] Running ${record.name} – ${plannedPrompt}${COLOR_RESET}\n`);
            try {
                // eslint-disable-next-line no-await-in-loop
                const result = await runSkill(cli, record, plannedPrompt);
                printSpecActionPreview(cli, record, result?.result || result?.output || result);
                cli.output.write(`${COLOR_INFO}[auto] Completed ${record.name}${COLOR_RESET}\n`);
            } catch (error) {
                cli.output.write(`${COLOR_WARN}[auto] ${record.name} failed: ${error.message}${COLOR_RESET}\n`);
            }
        }

        cli.bootstrapCompleted = true;
        cli._bootstrapRequired = false;
    })().finally(() => {
        cli._bootstrapPromise = null;
    });
    await cli._bootstrapPromise;
};

export default {
    normalizeBootstrapMode,
    ensureBootstrap,
};
