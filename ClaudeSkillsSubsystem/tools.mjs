import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

function isDirectory(target) {
    if (!target || !fs.existsSync(target)) {
        return false;
    }
    try {
        return fs.statSync(target).isDirectory();
    } catch (error) {
        return false;
    }
}

function isSafeChildPath(baseDir, targetPath) {
    if (!baseDir || !targetPath) {
        return false;
    }
    const resolvedBase = path.resolve(baseDir);
    const resolvedTarget = path.resolve(targetPath);
    if (resolvedTarget === resolvedBase) {
        return true;
    }
    return resolvedTarget.startsWith(`${resolvedBase}${path.sep}`);
}

function isProbablyText(buffer) {
    if (!buffer || !buffer.length) {
        return true;
    }
    let controlCount = 0;
    for (const byte of buffer) {
        if (byte === 0) {
            return false;
        }
        if (byte < 9 || (byte > 13 && byte < 32)) {
            controlCount += 1;
        }
    }
    const ratio = controlCount / buffer.length;
    if (ratio > 0.2) {
        return false;
    }
    const decoded = buffer.toString('utf8');
    return !decoded.includes('\uFFFD');
}

function runBashCommand(command, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn('bash', ['-lc', command], { cwd, env: process.env });
        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        child.on('error', (error) => {
            reject(error);
        });
        child.on('close', (code) => {
            resolve({ stdout, stderr, exitCode: code ?? 0 });
        });
    });
}

export function buildClaudeTools({ skillRecord, recursiveAgent, options = {}, sessionMemory }) {
    const skillDir = skillRecord?.skillDir || null;
    const scriptsDir = skillDir ? path.join(skillDir, 'scripts') : null;
    const resourcesDir = skillDir ? path.join(skillDir, 'resources') : null;

    const tools = {};

    tools['ask-user'] = {
        description: 'Prompt the user for missing information. Input is the question text. Returns the user response as plain text (string).',
        handler: async (_agent, promptText) => {
            const prompt = String(promptText ?? '').trim();
            const executionResult = await recursiveAgent.executePrompt(prompt, {
                skillName: 'ask-user',
                context: {
                    ...(options?.context || {}),
                    sessionMemory,
                },
            });
            const result = executionResult?.result ?? executionResult;
            if (result == null) {
                return '';
            }
            return typeof result === 'string' ? result : JSON.stringify(result);
        },
    };

    if (scriptsDir && isDirectory(scriptsDir)) {
        tools['run-script'] = {
            description: 'Execute the provided command to run a script from scripts/. Input must be the full command string; script path can be relative to skill root (e.g. "scripts/tool.sh ...") or from scripts/ directly. Returns a string output.',
            handler: async (_agent, promptText) => {
                const command = String(promptText ?? '').trim();
                if (!command) {
                    throw new Error('run-script requires a command string.');
                }
                const normalizedCommand = command.replace(/\\/g, '/');
                const adjustedCommand = normalizedCommand.replace(
                    /(\s|^)(scripts\/[^\s]+)/,
                    (match, prefix, scriptPath) => {
                        const fullPath = path.resolve(skillDir, scriptPath);
                        if (!isSafeChildPath(scriptsDir, fullPath)) {
                            throw new Error('run-script path must be inside scripts/.');
                        }
                        return `${prefix}${fullPath}`;
                    }
                );
                const output = await runBashCommand(adjustedCommand, skillDir || process.cwd());
                const stderrText = output.stderr ? `\n[stderr]\n${output.stderr}` : '';
                const exitCodeText = output.exitCode ? `\n[exitCode] ${output.exitCode}` : '';
                return `${output.stdout || ''}${stderrText}${exitCodeText}`.trim();
            },
        };
    }

    if (resourcesDir && isDirectory(resourcesDir)) {
        tools['get-resource'] = {
            description: 'Read a file from resources/. Input must be a path relative to the skill root (e.g. "resources/file.txt") or a file name inside resources/. Returns the file contents as a string (utf-8 for text, base64 for binary).',
            handler: async (_agent, promptText) => {
                const resourcePath = String(promptText ?? '').trim();
                if (!resourcePath) {
                    throw new Error('get-resource requires a relative path.');
                }

                const normalized = resourcePath.replace(/\\/g, '/');
                const relativePath = normalized.startsWith('resources/')
                    ? normalized.slice('resources/'.length)
                    : normalized;
                const resolvedResource = path.resolve(resourcesDir, relativePath);
                if (!isSafeChildPath(resourcesDir, resolvedResource)) {
                    throw new Error('get-resource path must be inside resources/.');
                }

                let stats;
                try {
                    stats = fs.statSync(resolvedResource);
                } catch (error) {
                    throw new Error(`get-resource cannot access ${resourcePath}: ${error.message}`);
                }

                if (!stats.isFile()) {
                    throw new Error('get-resource target must be a file.');
                }

                const buffer = await fs.promises.readFile(resolvedResource);
                if (isProbablyText(buffer)) {
                    return buffer.toString('utf8');
                }
                return buffer.toString('base64');
            },
        };
    }

    return tools;
}
