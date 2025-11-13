import { LLMAgent } from '../../LLMAgents/index.mjs';
import { SkilledAgent } from '../../SkilledAgents/SkilledAgent.mjs';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function cloneValue(value) {
    if (Array.isArray(value)) {
        return value.map(cloneValue);
    }
    if (value && typeof value === 'object') {
        const copy = {};
        for (const [key, inner] of Object.entries(value)) {
            copy[key] = cloneValue(inner);
        }
        return copy;
    }
    return value;
}

function levenshteinDistance(a, b) {
    const source = String(a || '');
    const target = String(b || '');
    const m = source.length;
    const n = target.length;
    if (m === 0) {
        return n;
    }
    if (n === 0) {
        return m;
    }
    const matrix = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i += 1) {
        matrix[i][0] = i;
    }
    for (let j = 0; j <= n; j += 1) {
        matrix[0][j] = j;
    }
    for (let i = 1; i <= m; i += 1) {
        for (let j = 1; j <= n; j += 1) {
            const cost = source[i - 1] === target[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost,
            );
        }
    }
    return matrix[m][n];
}

export async function runUseSkillScenario({
    agentName = 'UseSkillScenarioAgent',
    taskDescription,
    responses = [],
    skillConfig,
    interceptExtraction = false,
    manualOverrides = null,
    additionalMatchers = [],
} = {}) {
    const responsesQueue = Array.isArray(responses) ? responses.slice() : [];
    const aggregatedLogs = [];
    const aggregatedPrompts = [];
    const aggregatedTranscript = [];
    const aggregatedActionCalls = [];
    let finalResult = null;
    let finalError = null;
    let carryOverArgs = {};
    let runIndex = 0;
    let lastLLMAgent = null;
    let lastAutoMatchers = [];

    while (runIndex === 0 || responsesQueue.length > 0) {
        const runLogs = [];
        const runPrompts = [];
        const runTranscript = [];
        const runActionCalls = [];

        const llmAgent = new LLMAgent({
            name: agentName,
            invokerStrategy: async () => ({ output: '' }),
        });
        lastLLMAgent = llmAgent;

        const workingSkillConfig = {
            ...skillConfig,
            specs: cloneValue(skillConfig.specs),
        };

        const autoMatchers = [];
        const argumentEntries = Object.entries(workingSkillConfig.specs?.arguments || {});
        if (argumentEntries.length) {
            const connectorPattern = '(?:is|=|should be|set to|set as|assigned to|assigned as|goes to|start(?:s)? on|starts? at|due on|due by|needs to be|needs to|must be|wraps up on|wraps up at|wraps on|occurs on|occurs at|begins on|begins at|starts|start on|start at|runs on|runs at)';
            for (const [argumentName] of argumentEntries) {
                const definition = workingSkillConfig.specs?.arguments?.[argumentName] || {};
                const parts = argumentName.split('_').map((segment) => escapeRegExp(segment));
                const placeholderPattern = parts.join('[\\s_-]+');
                const baseLabel = argumentName.replace(/_/g, ' ');
                const labelVariants = [baseLabel];
                if (baseLabel.endsWith(' id')) {
                    labelVariants.push(baseLabel.replace(/ id$/, ''));
                }
                if (definition.description) {
                    labelVariants.push(String(definition.description));
                }
                autoMatchers.push({
                    key: argumentName,
                    labels: labelVariants.map((value) => String(value).trim()).filter(Boolean),
                    label: baseLabel,
                    isAuto: true,
                    options: Array.isArray(definition.options) ? definition.options : null,
                    build: () => new RegExp(`${placeholderPattern}\s*(?:${connectorPattern})?\s+([^\n]+)`, 'i'),
                });
            }
        }
        workingSkillConfig.__autoMatchers = autoMatchers;
        lastAutoMatchers = autoMatchers;

        if (interceptExtraction) {
            const originalComplete = llmAgent.complete.bind(llmAgent);
            const maxIntercepts = interceptExtraction === true ? Number.POSITIVE_INFINITY : Number(interceptExtraction) || 0;
            let remainingIntercepts = maxIntercepts;

            const normalize = (value) => (value || '').toString().trim().replace(/[.!]+$/, '');
            const baseMatchers = [
                { key: 'project_code', regex: /project code (?:is|should be|set to|=)\s+([a-zA-Z0-9\- _]+)/i },
                { key: 'location', regex: /location (?:is|should be|set to|=)\s+([a-zA-Z0-9\- _]+)/i },
                { key: 'start_date', regex: /start(?: date)? (?:is|should be|set to|on|=)\s+([a-zA-Z0-9\- ,]+)/i },
                { key: 'start_date', regex: /we start on\s+([a-zA-Z0-9\- ,]+)/i },
                { key: 'end_date', regex: /end(?: date)? (?:is|should be|set to|on|=)\s+([a-zA-Z0-9\- ,]+)/i },
                { key: 'end_date', regex: /wrap(?: up)?(?: on)?\s+([a-zA-Z0-9\- ,]+)/i },
                { key: 'supervisor', regex: /supervisor (?:is|should be|set to|=|make)\s+([a-zA-Z0-9\- ']+)(?:(?:\sand)|$)/i },
                { key: 'backup_supervisor', regex: /backup supervisor (?:is|should be|set to|=|add)\s+([a-zA-Z0-9\- ']+)/i },
                { key: 'priority', regex: /priority (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ]+)/i },
                { key: 'region_code', regex: /region(?: code)? (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ]+)/i },
                { key: 'region_code', regex: /region should be\s+([a-zA-Z0-9\- ]+)/i },
                { key: 'quantity', regex: /(?:quantity|units|need)\s*(?:is|should be|set to|=)?\s*([0-9]+)/i },
                { key: 'source_warehouse_id', regex: /source warehouse (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+)/i },
                { key: 'destination_warehouse_id', regex: /destination(?: warehouse)? (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+)/i },
                { key: 'destination_warehouse_id', regex: /destination should be\s+([a-zA-Z0-9\- ']+)/i },
                { key: 'sku_id', regex: /(?:sku|item|product) (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+)/i },
                { key: 'sku_id', regex: /transfer the\s+([a-zA-Z0-9\- ']+)/i },
            ];
            const matchers = [...baseMatchers, ...autoMatchers, ...additionalMatchers];

            const remapOptionValue = (options, value) => {
                if (!Array.isArray(options) || !options.length) {
                    return value;
                }
                const input = String(value || '').trim();
                if (!input) {
                    return value;
                }
                const lowerInput = input.toLowerCase();
                let bestCandidate = null;
                let bestScore = Number.POSITIVE_INFINITY;

                for (const option of options) {
                    const candidates = [];
                    if (option.value != null) {
                        candidates.push(String(option.value));
                    }
                    if (option.label) {
                        candidates.push(String(option.label));
                    }
                    if (Array.isArray(option.synonyms)) {
                        for (const synonym of option.synonyms) {
                            candidates.push(String(synonym));
                        }
                    }

                    for (const candidate of candidates) {
                        const normalizedCandidate = candidate.trim();
                        if (!normalizedCandidate) {
                            continue;
                        }
                        const candidateLower = normalizedCandidate.toLowerCase();
                        if (candidateLower === lowerInput) {
                            return option.value ?? normalizedCandidate;
                        }
                        const distance = levenshteinDistance(lowerInput, candidateLower);
                        if (distance < bestScore) {
                            bestScore = distance;
                            bestCandidate = option.value ?? normalizedCandidate;
                        }
                    }
                }

                if (bestCandidate == null) {
                    return value;
                }

                const threshold = Math.max(1, Math.floor(lowerInput.length * 0.3));
                if (bestScore <= threshold) {
                    return bestCandidate;
                }
                return value;
            };

            const stripTrailingLabelReferences = (raw, currentKey) => {
                const textValue = String(raw || '');
                const lowerValue = textValue.toLowerCase();
                let cutIndex = textValue.length;
                for (const candidate of autoMatchers) {
                    if (!candidate || candidate.key === currentKey) {
                        continue;
                    }
                    const candidateLabels = Array.isArray(candidate.labels) && candidate.labels.length
                        ? candidate.labels
                        : [(candidate.label || candidate.key || '').trim()];
                    for (const label of candidateLabels) {
                        const labelText = String(label || '').trim();
                        if (!labelText) {
                            continue;
                        }
                        const candidateIndex = lowerValue.indexOf(labelText.toLowerCase());
                        if (candidateIndex >= 0 && candidateIndex < cutIndex) {
                            cutIndex = candidateIndex;
                        }
                    }
                }
                const shortened = textValue.slice(0, cutIndex).replace(/[ ,;]+$/,'').trim();
                const leadingTrimmed = shortened.replace(/^(?:to|keep|set|make|be|is)\s+/i, '');
                const cleaned = leadingTrimmed.replace(/(?:,\s*)?(?:and|keep|set)\s*$/i, '').replace(/[ ,;]+$/,'').trim();
                return cleaned || textValue.trim();
            };



            const extractWithMatchers = (message) => {
                const updates = {};
                const lowerMessage = message.toLowerCase();
                for (const matcher of matchers) {
                    const pattern = typeof matcher.build === 'function' ? matcher.build() : matcher.regex;
                    let matchedValue = null;
                    if (pattern) {
                        const match = message.match(pattern);
                        if (match && match[1]) {
                            const refined = stripTrailingLabelReferences(match[1], matcher.key);
                            matchedValue = normalize(refined);
                        }
                    }

                    if (!matchedValue && matcher.isAuto) {
                        const labelCandidates = Array.isArray(matcher.labels) && matcher.labels.length
                            ? matcher.labels
                            : [(matcher.label || matcher.key || '').trim()];
                        for (const candidate of labelCandidates) {
                            const labelText = String(candidate || '').trim();
                            if (!labelText) {
                                continue;
                            }
                            const normalizedLabel = labelText.toLowerCase();
                            const position = lowerMessage.indexOf(normalizedLabel);
                            if (position === -1) {
                                continue;
                            }
                            const remainder = message.slice(position + labelText.length);
                            const fallbackMatch = remainder.match(/^\s*(?:is|=|should be|set to|set as|assigned to|assigned as|goes to|start(?:s)? on|starts? at|due on|due by|needs to be|needs to|must be|wraps up(?: on| at)?|wraps on|occurs on|occurs at|begins on|begins at|runs on|runs at|:|-)?\s*(.+)$/i);
                            if (fallbackMatch && fallbackMatch[1]) {
                                const refined = stripTrailingLabelReferences(fallbackMatch[1], matcher.key);
                                matchedValue = normalize(refined);
                                break;
                            }
                        }
                    }

                    if (matchedValue != null) {
                        if (matcher.isAuto && Array.isArray(matcher.options) && matcher.options.length) {
                            matchedValue = remapOptionValue(matcher.options, matchedValue);
                        }
                        updates[matcher.key] = matchedValue;
                    }
                }
                return updates;
            };

            llmAgent.complete = async (options = {}) => {
                if (options?.context?.intent === 'skill-argument-extraction') {
                    const history = options.history || [];
                    const systemMessages = history.filter((h) => h.role === 'system').map((h) => h.message).join(' ');
                    const lastUserMessage = history.filter((h) => h.role === 'user').pop()?.message || '';
                    const messageToExtract = lastUserMessage || systemMessages;
                    const extracted = extractWithMatchers(messageToExtract);

                    if (Object.keys(extracted).length > 0) {
                        if (Number.isFinite(remainingIntercepts) && remainingIntercepts > 0) {
                            remainingIntercepts -= 1;
                        }
                        const lines = Object.entries(extracted).map(([key, value]) => `- ${key}: ${value}`);
                        return lines.join('\\n');
                    }
                }
                return originalComplete(options);
            };

            llmAgent.interpretMessage = async (message) => {
                if (!message || typeof message !== 'string') {
                    return { intent: 'unknown' };
                }
                const lower = message.toLowerCase();
                if (lower.includes('cancel')) {
                    return { intent: 'cancel' };
                }
                if (lower.includes('accept')) {
                    return { intent: 'accept' };
                }

                const updates = extractWithMatchers(message);
                if (Object.keys(updates).length) {
                    return { intent: 'update', updates };
                }
                return { intent: 'unknown' };
            };
        }

        const consoleLog = console.log;
        console.log = (...args) => {
            runLogs.push(args.join(' '));
        };

        let promptCount = 0;
        const MAX_PROMPTS = 100;

        const promptReader = async (message) => {
            runPrompts.push(message);
            promptCount += 1;
            if (promptCount > MAX_PROMPTS) {
                throw new Error(`Test exceeded maximum prompt limit (${MAX_PROMPTS}). Possible infinite loop.`);
            }

            let reply = responsesQueue.length ? responsesQueue.shift() : '';
            if (!reply && !responsesQueue.length && promptCount > 1) {
                throw new Error(`Test ran out of responses. Last prompt was: "${message.substring(0, 200)}..."`);
            }

            runTranscript.push({ prompt: message, reply });
            return reply;
        };

        const agent = new SkilledAgent({
            llmAgent,
            promptReader,
        });

        if (manualOverrides && typeof manualOverrides === 'function') {
            manualOverrides({
                agent,
                skillConfig: workingSkillConfig.specs,
            });
        }

        const skill = {
            ...workingSkillConfig,
            action: (...args) => {
                const result = typeof workingSkillConfig.action === 'function'
                    ? workingSkillConfig.action(...args)
                    : (args.length === 1 ? args[0] : args);
                runActionCalls.push(result);
                return result;
            },
        };

        agent.registerSkill(skill);

        let result = null;
        let error = null;
        try {
            result = await agent.useSkill(skill.specs.name, {
                taskDescription: runIndex === 0 ? taskDescription : '',
                args: carryOverArgs,
            });
        } catch (err) {
            error = err;
        } finally {
            console.log = consoleLog;
        }

        aggregatedLogs.push(...runLogs);
        aggregatedPrompts.push(...runPrompts);
        aggregatedTranscript.push(...runTranscript);
        aggregatedActionCalls.splice(0, aggregatedActionCalls.length, ...runActionCalls);

        finalResult = result;
        finalError = error;

        if (!responsesQueue.length) {
            break;
        }

        carryOverArgs = result && typeof result === 'object' ? { ...result } : {};
        runIndex += 1;
    }

    return {
        llmAgent: lastLLMAgent,
        result: finalResult,
        error: finalError,
        logs: aggregatedLogs,
        prompts: aggregatedPrompts,
        transcript: aggregatedTranscript,
        actionCalls: aggregatedActionCalls,
        remainingResponses: responsesQueue,
        autoMatchers: lastAutoMatchers,
    };
}

const confirmationPromptPattern = /About to (?:apply|perform)/i;
const missingDetailsPromptPattern = /(To continue I need|Please provide) the following details:/i;

const containsConfirmationPrompt = (text) => confirmationPromptPattern.test(String(text || ''));
const containsMissingDetailsPrompt = (text) => missingDetailsPromptPattern.test(String(text || ''));
const summaryContainsParameterValue = (text, label, value) => {
    if (!text) {
        return false;
    }
    const safeLabel = escapeRegExp(String(label || ''));
    const safeValue = escapeRegExp(String(value || ''));
    const strictPattern = new RegExp(`${safeLabel}\\s*(?:[:|])\\s*${safeValue}`, 'i');
    if (strictPattern.test(text)) {
        return true;
    }
    const relaxedPattern = new RegExp(`${safeLabel}[^\n]{0,80}${safeValue}`, 'i');
    return relaxedPattern.test(text);
};

export {
    containsConfirmationPrompt,
    containsMissingDetailsPrompt,
    confirmationPromptPattern,
    missingDetailsPromptPattern,
    summaryContainsParameterValue,
};
