/**
 * Shared SSE (Server-Sent Events) stream parser.
 *
 * Reads a ReadableStream (from fetch response.body), splits on double-newline
 * boundaries, extracts standard SSE fields (event, data, id), and yields
 * parsed frame objects.  All streaming LLM providers reuse this module.
 *
 * Spec reference: https://html.spec.whatwg.org/multipage/server-sent-events.html
 */

/**
 * @typedef {Object} SSEFrame
 * @property {string}      event      - The event type (empty string if none).
 * @property {string}      data       - The raw data payload (joined with '\n' when multi-line).
 * @property {string}      id         - The event id (empty string if none).
 * @property {object|null} parsedData - JSON.parse(data) or null if data is not valid JSON.
 */

/**
 * Async generator that yields SSEFrame objects from a ReadableStream.
 *
 * @param {ReadableStream} readableStream - The response body stream (e.g. from fetch).
 * @param {object}         [options]
 * @param {string}         [options.doneSentinel='[DONE]'] - Data value that signals end-of-stream.
 * @yields {SSEFrame}
 */
export async function* parseSSEStream(readableStream, options = {}) {
    const { doneSentinel = '[DONE]' } = options;

    const reader = readableStream.getReader();
    const decoder = new TextDecoder();

    let buffer = '';

    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // SSE frames are separated by blank lines (\n\n).
            // Split on every occurrence and process complete frames.
            const frames = buffer.split('\n\n');

            // The last element is either '' (if buffer ended on \n\n) or an
            // incomplete frame that we keep in the buffer.
            buffer = frames.pop();

            for (const rawFrame of frames) {
                if (!rawFrame.trim()) continue;

                const frame = parseFrame(rawFrame);

                // Stop when we hit the done sentinel.
                if (frame.data === doneSentinel) return;

                yield frame;
            }
        }

        // Process any remaining data left in the buffer after the stream ends.
        if (buffer.trim()) {
            const frame = parseFrame(buffer);
            if (frame.data !== doneSentinel) {
                yield frame;
            }
        }
    } finally {
        reader.releaseLock();
    }
}

/**
 * Parse a single SSE frame (the text between blank-line delimiters) into its
 * constituent fields.
 *
 * @param {string} raw - Raw text of one SSE frame (lines separated by \n).
 * @returns {SSEFrame}
 */
function parseFrame(raw) {
    let event = '';
    const dataLines = [];
    let id = '';

    const lines = raw.split('\n');
    for (const line of lines) {
        // Comment lines start with ':'
        if (line.startsWith(':')) continue;

        const colonIdx = line.indexOf(':');
        let field, value;
        if (colonIdx === -1) {
            field = line;
            value = '';
        } else {
            field = line.slice(0, colonIdx);
            // Per spec, strip a single leading space after the colon.
            value = line.slice(colonIdx + 1);
            if (value.startsWith(' ')) {
                value = value.slice(1);
            }
        }

        switch (field) {
            case 'event':
                event = value;
                break;
            case 'data':
                dataLines.push(value);
                break;
            case 'id':
                id = value;
                break;
            // 'retry' and unknown fields are ignored per spec.
        }
    }

    const data = dataLines.join('\n');
    let parsedData = null;
    if (data) {
        try {
            parsedData = JSON.parse(data);
        } catch {
            // data is not JSON — leave parsedData as null.
        }
    }

    return { event, data, id, parsedData };
}
