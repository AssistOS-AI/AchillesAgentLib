import { printPlan, printExecutions } from './executionHelpers.mjs';

const exitCLI = (cli) => {
    cli.output.write('Exiting Achilles CLI.\n');
    if (cli.readline) {
        cli.readline.close();
    }
};

const handleCommand = async (cli, commandLine) => {
    const trimmedCommand = commandLine.trim();
    const [base, ...commandArgs] = trimmedCommand.split(/\s+/);
    const normalized = base.toLowerCase();

    if (normalized === '/exit' || normalized === '/quit') {
        exitCLI(cli);
        return true;
    }
    if (normalized === '/list') {
        try {
            const lines = await cli.listSkills();
            lines.forEach((line) => cli.output.write(`${line}\n`));
        } catch (error) {
            cli.output.write(`${cli.colors.warn}[warn] ${error.message}${cli.colors.reset}\n`);
        }
        return false;
    }
    if (normalized === '/continue' || normalized === '/resume') {
        await cli.resumePendingPlan(commandArgs.join(' ').trim());
        return false;
    }
    if (normalized === '/help') {
        cli.printHelp();
        return false;
    }
    if (normalized === '/status') {
        cli.printStatus();
        return false;
    }
    if (normalized === '/debug') {
        const desired = (commandArgs[0] || '').toLowerCase();
        if (desired === 'on' || desired === 'enable' || desired === 'true') {
            cli.setDebugMode(true);
        } else if (desired === 'off' || desired === 'disable' || desired === 'false') {
            cli.setDebugMode(false);
        } else {
            const toggled = cli.setDebugMode(!cli.debugMode);
            if (desired && desired !== '') {
                cli.output.write(`${cli.colors.warn}[debug] Unknown argument "${commandArgs[0]}". Toggled debug to ${toggled ? 'on' : 'off'}.${cli.colors.reset}\n`);
            }
        }
        return false;
    }
    if (normalized === '/model') {
        const desired = (commandArgs[0] || '').toLowerCase();
        if (desired === 'fast' || desired === 'deep') {
            cli.defaultModelMode = desired;
            process.env.ACHILLES_DEFAULT_MODEL_TYPE = desired;
            cli.output.write(`${cli.colors.info}[info] Default LLM mode set to ${desired}.${cli.colors.reset}\n`);
        } else {
            cli.output.write(`${cli.colors.warn}[warn] Usage: /model fast|deep${cli.colors.reset}\n`);
        }
        return false;
    }
    if (normalized === '/lang') {
        const desired = commandArgs.join(' ').trim();
        if (!desired) {
            cli.output.write(`${cli.colors.info}[info] Current specification language: ${cli.activeSpecLanguage()}. Use /lang <language> to change it.${cli.colors.reset}\n`);
            return false;
        }
        if (desired.length < 2) {
            cli.output.write(`${cli.colors.warn}[warn] Usage: /lang <language> (e.g., english, spanish)${cli.colors.reset}\n`);
            return false;
        }
        try {
            const updatedLanguage = cli.setSpecLanguage(desired);
            cli.output.write(`${cli.colors.info}[info] Default specification language set to ${updatedLanguage}.${cli.colors.reset}\n`);
        } catch (error) {
            cli.output.write(`${cli.colors.warn}[warn] ${error.message}${cli.colors.reset}\n`);
        }
        return false;
    }
    if (normalized === '/specs') {
        const query = commandArgs.join(' ').trim();
        await cli.showSpecifications(query);
        return false;
    }
    if (normalized === '/run') {
        const skillName = commandArgs.shift();
        if (!skillName) {
            cli.output.write(`${cli.colors.warn}[warn] Usage: /run <skill> <<instructions>>${cli.colors.reset}\n`);
            return false;
        }
        const paddingStart = trimmedCommand.indexOf(skillName) + skillName.length;
        const inlinePrompt = trimmedCommand.slice(paddingStart + 1).trim();
        const explicitPrompt = cli.extractInlinePrompt(inlinePrompt);
        const instructionText = explicitPrompt || await cli.promptReader(`(${skillName})> `);
        await cli.executeSingleSkill(skillName, instructionText);
        return false;
    }
    if (normalized === '/cancel') {
        if (!cli.requestCancel('User typed /cancel.')) {
            cli.output.write(`${cli.colors.warn}[info] No plan was running.${cli.colors.reset}\n`);
        }
        return false;
    }

    cli.output.write(`${cli.colors.warn}Unknown command: ${commandLine}${cli.colors.reset}\n`);
    return false;
};

export const runInteractiveLoop = async (cli) => {
    cli.output.write(`${cli.colors.info}Achilles CLI ready. Commands: /list, /exit. End lines with '\\' to continue typing.${cli.colors.reset}\n`);
    if (cli.debugMode) {
        cli.output.write(`${cli.colors.debug}[debug] LLM debug logging enabled.${cli.colors.reset}\n`);
    }
    try {
        while (true) {
            // eslint-disable-next-line no-await-in-loop
            const { command, text } = await cli.readMultiline();
            if (command) {
                // eslint-disable-next-line no-await-in-loop
                const shouldExit = await handleCommand(cli, command);
                if (shouldExit) {
                    break;
                }
                // eslint-disable-next-line no-continue
                continue;
            }

            if (!text) {
                // eslint-disable-next-line no-continue
                continue;
            }

            let trimmedTask = text.trim();
            if (!trimmedTask) {
                // eslint-disable-next-line no-continue
                continue;
            }

            // eslint-disable-next-line no-await-in-loop
            const resumeInfo = await cli.detectResumeInput(trimmedTask);
            if (resumeInfo) {
                // eslint-disable-next-line no-await-in-loop
                await cli.resumePendingPlan(resumeInfo.extra);
                // eslint-disable-next-line no-continue
                continue;
            }

            let plan = [];
            try {
                // eslint-disable-next-line no-await-in-loop
                plan = await cli.preparePlan(trimmedTask);
                cli.pendingPlan = { plan, prompt: trimmedTask, nextIndex: 0 };
            } catch (error) {
                cli.output.write(`${cli.colors.error}[error] ${error.message}${cli.colors.reset}\n`);
                // eslint-disable-next-line no-continue
                continue;
            }

            if (!plan.length) {
                // eslint-disable-next-line no-continue
                continue;
            }

            printPlan(cli, plan);

            if (cli.requirePlanConfirmation) {
                const confirmMessage = `[plan] Execute ${plan.length} ${plan.length === 1 ? 'step' : 'steps'}?`;
                // eslint-disable-next-line no-await-in-loop
                const approved = await cli.promptYesNo(confirmMessage, true);
                if (!approved) {
                    cli.output.write(`${cli.colors.warn}[info] Plan execution cancelled by user.${cli.colors.reset}\n`);
                    // eslint-disable-next-line no-continue
                    continue;
                }
            }

            // eslint-disable-next-line no-await-in-loop
            const { executions, cancelled } = await cli.executePlan(plan, {
                announceProgress: cli.announceStepProgress,
                startIndex: cli.pendingPlan?.nextIndex ?? 0,
            });
            printExecutions(cli, executions);
            // eslint-disable-next-line no-await-in-loop
            await cli.captureMemoryEntry({
                userPrompt: trimmedTask,
                plan,
                executions,
                cancelled,
            });
        }
    } finally {
        cli.restoreInputMode();
    }
};

export default {
    runInteractiveLoop,
};
