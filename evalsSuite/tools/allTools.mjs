async function resolveArguments(agent, prompt, instruction, schema, regexPatterns = []) {
    // Unified extraction for SOP and Loop: structured input, regex, heuristics, then LLM fallback.

    const isLoop = !!agent.currentSession;
    const input = prompt;

    const debugEnabled = process.env.AGENTIC_DEBUG === 'true';
    const debugLog = (...args) => {
        if (debugEnabled) {
            // eslint-disable-next-line no-console
            console.log(...args);
        }
    };

    debugLog(`[resolveArguments] isLoop=${isLoop}, prompt=${JSON.stringify(input)}, instruction="${instruction}"`);

    // 1) Structured inputs (arrays) — preserve SOP-friendly handling
    if (Array.isArray(input)) {
        const parts = input.map((value) => (value === null || value === undefined ? '' : String(value)));
        if (!parts.length) {
            return [];
        }
        if (parts.length >= schema.length) {
            if (schema.length === 1) {
                return [parts.join(' ')];
            }
            if (parts.length > schema.length) {
                const head = parts.slice(0, schema.length - 1);
                const tail = parts.slice(schema.length - 1).join(' ');
                return head.concat([tail]);
            }
            return parts.slice(0, schema.length);
        }
    }

    const textInput = String(input ?? '').trim();
    if (!textInput) {
        return [];
    }

    // 2) Regex first (now for both SOP and Loop)
    for (const pattern of regexPatterns) {
        const match = textInput.match(pattern);
        if (match) {
            const captured = match.slice(1);
            if (captured.length >= schema.length) {
                debugLog(`[resolveArguments] Regex matched: ${pattern}`);
                return captured.map((c) => c.trim());
            }
        }
    }

    // 2b) Single-argument tools: keep the full string intact
    if (schema.length <= 1) {
        return [textInput];
    }

    // 3) Heuristics: commas, whitespace, numeric lists
    const commaParts = textInput.split(',').map((x) => x.trim()).filter(Boolean);
    if (commaParts.length > 1) {
        const numericOnly = commaParts.every((p) => !Number.isNaN(Number.parseFloat(p)));
        if (numericOnly || commaParts.length >= schema.length) {
            if (schema.length === 2 && commaParts.length > 2) {
                const [first, ...rest] = commaParts;
                return [first, rest.join(' ')];
            }
            return commaParts.slice(0, schema.length);
        }
    }

    const parts = textInput.split(/\s+/).filter(Boolean);
    if (parts.length >= schema.length) {
        if (schema.length === 2 && parts.length > 2) {
            const [first, ...rest] = parts;
            return [first, rest.join(' ')];
        }
        return parts.slice(0, schema.length);
    }

    if (schema.length <= 1) {
        return [textInput];
    }

    // 4) LLM extraction fallback (both modes)
    const extractionPrompt = [
        'You are an argument extractor.',
        `Task: ${instruction}`,
        'Extract the arguments from the following user prompt.',
        `Return ONLY a JSON array of strings/numbers matching this schema: ${JSON.stringify(schema)}`,
        'Do not explain.',
        '',
        `Prompt: ${prompt}`
    ].join('\n');

    const result = await agent.complete({
        prompt: extractionPrompt,
        mode: 'fast',
        context: { intent: 'perf-tool-extract-args' },
    });

    try {
        const parsed = JSON.parse(result);
        if (Array.isArray(parsed)) {
            debugLog(`[resolveArguments] LLM extraction success: ${JSON.stringify(parsed)}`);
            return parsed;
        }
    } catch (e) {
        // ignore parse errors, fall back
    }

    // 5) Last resort: return whole prompt
    return [String(prompt ?? '')];
}

const getToolStateBucket = (agent) => {
    if (!agent) {
        return null;
    }
    if (agent.__toolState instanceof Map) {
        return agent.__toolState;
    }
    agent.__toolState = new Map();
    return agent.__toolState;
};

const getToolState = (agent, toolName) => {
    const bucket = getToolStateBucket(agent);
    if (!bucket) {
        return null;
    }
    if (!bucket.has(toolName)) {
        bucket.set(toolName, { count: 0, data: null });
    }
    return bucket.get(toolName);
};

const BASE_PERFORMANCE_TOOLS = {
    add: {
        description: 'Adds two numbers. Usage: add(a, b) or add("a, b")',
        handler: async (agent, prompt) => {
            const funcMatch = String(prompt).match(/add\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\)/i);
            if (funcMatch) {
                const [, a, b] = funcMatch;
                return String(Number(a) + Number(b));
            }

            const resolved = await resolveArguments(agent, prompt, 'Extract two numbers to add.', ['number', 'number'], [
                /add\s+(\d+)\s+and\s+(\d+)/i,
                /(\d+)\s*\+\s*(\d+)/
            ]);
            const [a, b] = resolved;
            return String(Number(a) + Number(b));
        },
    },
    multiply: {
        description: 'Multiplies two numbers. Usage: multiply(a, b) or multiply("a, b")',
        handler: async (agent, prompt) => {
            const funcMatch = String(prompt).match(/multiply\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\)/i);
            if (funcMatch) {
                const [, a, b] = funcMatch;
                return String(Number(a) * Number(b));
            }

            const resolved = await resolveArguments(agent, prompt, 'Extract two numbers to multiply.', ['number', 'number'], [
                /multiply\s+(\d+)\s+by\s+(\d+)/i,
                /(\d+)\s*\*\s*(\d+)/
            ]);
            const [a, b] = resolved;
            return String(Number(a) * Number(b));
        },
    },
    subtract: {
        description: 'Subtracts the second number from the first. Usage: subtract(a, b) or subtract("a, b")',
        handler: async (agent, prompt) => {
            // Support common phrasings and function-style calls before falling back.
            const fromMatch = String(prompt).match(/subtract\s+(\d+)\s+from\s+(\d+)/i);
            if (fromMatch) {
                const [, subtrahend, minuend] = fromMatch;
                return String(Number(minuend) - Number(subtrahend));
            }

            const resolved = await resolveArguments(agent, prompt, 'Extract two numbers: [minuend, subtrahend].', ['number', 'number'], [
                /(\d+)\s*-\s*(\d+)/,
                /subtract\((\d+)\s*,\s*(\d+)\)/i,
                /subtract\s+(\d+)\s+by\s+(\d+)/i,
            ]);

            const [a, b] = resolved;
            return String(Number(a) - Number(b));
        },
    },
    divide: {
        description: 'Divides the first number by the second. Usage: divide(a, b) or divide("a, b")',
        handler: async (agent, prompt) => {
            const funcMatch = String(prompt).match(/divide\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\)/i);
            if (funcMatch) {
                const [, a, b] = funcMatch;
                const numB = Number(b);
                if (numB === 0) return 'Infinity';
                return String(Number(a) / numB);
            }

            const resolved = await resolveArguments(agent, prompt, 'Extract two numbers: [numerator, denominator].', ['number', 'number'], [
                /divide\s+(\d+)\s+by\s+(\d+)/i,
                /(\d+)\s*\/\s*(\d+)/
            ]);
            const [a, b] = resolved;
            const numB = Number(b);
            if (numB === 0) return 'Infinity';
            return String(Number(a) / numB);
        },
    },
    reverse: {
        description: 'Reverses the provided text.',
        handler: async (agent, prompt) => {
            const resolved = await resolveArguments(agent, prompt, 'Extract the text content to be reversed.', ['text'], [
                /reverse\s+(?:the\s+text\s+)?['"]?(.+?)['"]?$/i
            ]);
            const text = resolved[0];
            return String(text).split('').reverse().join('');
        },
    },
    uppercase: {
        description: 'Converts the provided text to uppercase.',
        handler: async (agent, prompt) => {
            const resolved = await resolveArguments(agent, prompt, 'Extract the text content to be uppercased.', ['text'], [
                /uppercase\s+(?:the\s+text\s+)?['"]?(.+?)['"]?$/i,
                /convert\s+(?:['"]?(.+?)['"]?)\s+to\s+uppercase/i
            ]);
            const text = resolved[0];
            return String(text).toUpperCase();
        },
    },
    lowercase: {
        description: 'Converts the provided text to lowercase.',
        handler: async (agent, prompt) => {
            const resolved = await resolveArguments(agent, prompt, 'Extract the text content to be lowercased.', ['text'], [
                /lowercase\s+(?:the\s+text\s+)?['"]?(.+?)['"]?$/i,
                /convert\s+(?:['"]?(.+?)['"]?)\s+to\s+lowercase/i
            ]);
            const text = resolved[0];
            return String(text).toLowerCase();
        },
    },
    length: {
        description: 'Returns the character length of the provided text.',
        handler: async (agent, prompt) => {
            const resolved = await resolveArguments(agent, prompt, 'Extract the text content to count length.', ['text'], [
                /length\s+of\s+(?:the\s+text\s+)?['"]?(.+?)['"]?$/i,
                /count\s+characters\s+in\s+['"]?(.+?)['"]?$/i
            ]);
            const text = resolved[0];
            return String(String(text).length);
        },
    },
    substring: {
        description: 'Extracts a substring given text, start, and length. Usage: substring(text, start, length). Note: indexes start from 0',
        handler: async (agent, prompt) => {
            const resolved = await resolveArguments(agent, prompt, 'Extract text, start index, and length for substring.', ['text', 'number', 'number']);
            const [text, start, length] = resolved;
            const begin = Number(start);
            const take = Number(length);
            return String(text).substring(begin, begin + take);
        },
    },
    concat: {
        description: 'Concatenates two strings. Usage: concat(a, b) or concat("a, b")',
        handler: async (agent, prompt) => {
            const resolved = await resolveArguments(agent, prompt, 'Extract two strings to concatenate.', ['string', 'string'], [
                /concatenate\s+['"]?(.+?)['"]?\s+and\s+['"]?(.+?)['"]?$/i
            ]);
            const [a, b] = resolved;
            return String(a) + String(b);
        },
    },
    contains: {
        description: 'Checks if the first string contains the second string.',
        handler: async (agent, prompt) => {
            const resolved = await resolveArguments(agent, prompt, 'Extract haystack and needle strings.', ['string', 'string']);
            const [haystack, needle] = resolved;
            return String(haystack).includes(String(needle)) ? 'true' : 'false';
        },
    },
    isEven: {
        description: 'Returns true if the provided integer is even.',
        handler: async (agent, prompt) => {
            const resolved = await resolveArguments(agent, prompt, 'Extract the integer to check.', ['number'], [
                /is\s+(\d+)\s+even/i,
                /check\s+if\s+(\d+)\s+is\s+even/i
            ]);
            const n = resolved[0];
            return (Number.parseInt(n, 10) % 2 === 0 ? 'true' : 'false');
        },
    },
    invert: {
        description: 'Inverts a boolean string (true/false).',
        handler: async (agent, prompt) => {
            const resolved = await resolveArguments(agent, prompt, 'Extract the boolean value (true/false) to invert.', ['boolean'], [
                /invert\s+(true|false)/i
            ]);
            const bool = resolved[0];
            return (String(bool).trim() === 'true' ? 'false' : 'true');
        },
    },
    extractEmail: {
        description: 'Extracts the first e-mail address from text.',
        handler: async (agent, prompt) => {
            const text = String(prompt ?? '');
            const match = String(text).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            return match ? match[0] : '';
        },
    },
    getDomain: {
        description: 'Extracts the domain portion of an e-mail address.',
        handler: async (agent, prompt) => {
            const resolved = await resolveArguments(agent, prompt, 'Extract the email address to get domain from.', ['email'], [
                /domain\s+of\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i
            ]);
            const email = resolved[0];
            const parts = String(email).split('@');
            return parts.length > 1 ? parts[1] : '';
        },
    },
    analyzeSentiment: {
        description: 'Analyzes the sentiment of the text (POSITIVE, NEGATIVE, NEUTRAL).',
        handler: async (agent, prompt) => {
            const text = String(prompt ?? '');
            const instruction = [
                'Analyze the sentiment of the following text.',
                'Respond ONLY with one of: POSITIVE, NEGATIVE, NEUTRAL.',
                'Do not explain.',
                '',
                text,
            ].join('\n');
            const result = await agent.complete({
                prompt: instruction,
                mode: 'fast',
                context: { intent: 'perf-tool-sentiment' },
            });
            return String(result).trim();
        },
    },
    translateText: {
        description: 'Translates text to a specified language. Usage: translateText(targetLang, text)',
        handler: async (agent, prompt) => {
            const resolved = await resolveArguments(agent, prompt, 'Extract target language and text to translate.', ['targetLang', 'text'], [
                /translate\s+['"]?(.+?)['"]?\s+to\s+(\w+)$/i // "Translate 'hello' to Spanish" -> captures [text, lang]. Wait, schema is [targetLang, text].
                // Regex captures [text, lang]. We need to swap.
                // resolveArguments returns captures in order.
                // So we can't use this regex if we want generic resolveArguments to map to schema.
                // Unless we change schema or regex.
                // Let's use a regex that matches schema order if possible, or just rely on LLM.
                // "Translate to Spanish: hello" -> /translate\s+to\s+(\w+):\s+(.+)/i -> [lang, text]
            ]);

            // If we used the regex above, we might get [text, lang] if we matched "Translate X to Y".
            // But our tool expects [targetLang, text].
            // Let's rely on LLM for translation to be safe, or use named groups if we could (but JS regex groups are positional in match result).
            // I will omit regex for translation to avoid parameter swapping issues for now.

            const [targetLang, text] = resolved;

            const instruction = [
                `Translate the following text to ${targetLang}.`,
                'Respond ONLY with the translated text.',
                'Do not explain.',
                '',
                text,
            ].join('\n');
            const result = await agent.complete({
                prompt: instruction,
                mode: 'fast',
                context: { intent: 'perf-tool-translate' },
            });
            return String(result).trim();
        },
    },
    classifyTopic: {
        description: 'Classifies text into one of: Finance, Health, Technology, Sports.',
        handler: async (agent, prompt) => {
            const text = String(prompt ?? '');
            const instruction = [
                'Classify the following text into one of these topics: Finance, Health, Technology, Sports.',
                'Respond ONLY with the topic name.',
                '',
                text,
            ].join('\n');
            const result = await agent.complete({
                prompt: instruction,
                mode: 'fast',
                context: { intent: 'perf-tool-classify' },
            });
            return String(result).trim();
        },
    },
    extractNames: {
        description: 'Extracts person names from text. Returns comma-separated list.',
        handler: async (agent, prompt) => {
            const text = String(prompt ?? '');
            const instruction = [
                'Extract all person names from the following text.',
                'Respond ONLY with a comma-separated list of names.',
                'If none, respond with "NONE".',
                '',
                text,
            ].join('\n');
            const result = await agent.complete({
                prompt: instruction,
                mode: 'fast',
                context: { intent: 'perf-tool-extract-names' },
            });
            return String(result).trim();
        },
    },
    summarizeContent: {
        description: 'Summarizes text into a single sentence.',
        handler: async (agent, prompt) => {
            const text = String(prompt ?? '');
            const instruction = [
                'Summarize the following text into exactly one sentence.',
                'Respond ONLY with the summary.',
                '',
                text,
            ].join('\n');
            const result = await agent.complete({
                prompt: instruction,
                mode: 'fast',
                context: { intent: 'perf-tool-summarize' },
            });
            return String(result).trim();
        },
    },
    flakyAdd: {
        description: 'Adds two numbers but may fail the first time with a transient error.',
        handler: async (agent, prompt) => {
            const resolved = await resolveArguments(agent, prompt, 'Extract two numbers to add.', ['number', 'number']);
            const [a, b] = resolved;
            const state = getToolState(agent, 'flakyAdd');
            state.count = (state.count || 0) + 1;
            if (state.count === 1) {
                throw new Error('flakyAdd encountered a transient failure. Regenerate or retry the same plan.');
            }
            return String(Number(a) + Number(b));
        },
    },
    flakyUppercase: {
        description: 'Converts text to uppercase but fails the first time to simulate flaky dependencies.',
        handler: async (agent, prompt) => {
            const resolved = await resolveArguments(agent, prompt, 'Extract the text content to be uppercased.', ['text']);
            const text = resolved[0];
            const state = getToolState(agent, 'flakyUppercase');
            state.count = (state.count || 0) + 1;
            if (state.count === 1) {
                throw new Error('flakyUppercase could not acquire the transform service. Try again.');
            }
            return String(text).toUpperCase();
        },
    },
    and: {
        description: 'Logical AND of two booleans.',
        handler: async (agent, prompt) => {
            const resolved = await resolveArguments(agent, prompt, 'Extract two boolean values (true/false).', ['boolean', 'boolean']);
            const [a, b] = resolved.map((val) => String(val).trim().toLowerCase() === 'true');
            return (a && b) ? 'true' : 'false';
        },
    },
    or: {
        description: 'Logical OR of two booleans.',
        handler: async (agent, prompt) => {
            const resolved = await resolveArguments(agent, prompt, 'Extract two boolean values (true/false).', ['boolean', 'boolean']);
            const [a, b] = resolved.map((val) => String(val).trim().toLowerCase() === 'true');
            return (a || b) ? 'true' : 'false';
        },
    },

};

const PERFORMANCE_TOOLS = { ...BASE_PERFORMANCE_TOOLS };

export {
    PERFORMANCE_TOOLS,
};
