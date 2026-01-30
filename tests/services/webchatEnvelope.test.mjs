/**
 * Unit Tests for WebchatEnvelope
 *
 * Tests the webchat envelope protocol for parsing and serializing
 * structured messages between webchat UI and agent containers.
 */

import test from 'node:test';
import assert from 'node:assert';
import {
    parseWebchatEnvelope,
    serializeWebchatEnvelope,
    isWebchatEnvelope,
    extractText,
    WEBCHAT_ENVELOPE_FLAG,
    WEBCHAT_ENVELOPE_VERSION,
} from '../../services/WebchatEnvelope.mjs';

// ============================================================================
// serializeWebchatEnvelope Tests
// ============================================================================

test('serializeWebchatEnvelope: creates valid envelope with text only', () => {
    const envelope = serializeWebchatEnvelope({ text: 'Hello world' });
    const parsed = JSON.parse(envelope);

    assert.strictEqual(parsed[WEBCHAT_ENVELOPE_FLAG], WEBCHAT_ENVELOPE_VERSION);
    assert.strictEqual(parsed.version, WEBCHAT_ENVELOPE_VERSION);
    assert.strictEqual(parsed.text, 'Hello world');
    assert.deepStrictEqual(parsed.attachments, []);
});

test('serializeWebchatEnvelope: preserves multiline text', () => {
    const envelope = serializeWebchatEnvelope({ text: 'Line 1\nLine 2\nLine 3' });
    const parsed = JSON.parse(envelope);

    assert.strictEqual(parsed.text, 'Line 1\nLine 2\nLine 3');
});

test('serializeWebchatEnvelope: includes attachments', () => {
    const envelope = serializeWebchatEnvelope({
        text: 'Check this file',
        attachments: [
            {
                id: 'abc123',
                filename: 'data.csv',
                mime: 'text/csv',
                size: 1024,
                downloadUrl: 'https://example.com/data.csv',
                localPath: '/tmp/data.csv',
            },
        ],
    });
    const parsed = JSON.parse(envelope);

    assert.strictEqual(parsed.attachments.length, 1);
    assert.strictEqual(parsed.attachments[0].id, 'abc123');
    assert.strictEqual(parsed.attachments[0].filename, 'data.csv');
    assert.strictEqual(parsed.attachments[0].mime, 'text/csv');
    assert.strictEqual(parsed.attachments[0].size, 1024);
});

test('serializeWebchatEnvelope: filters invalid attachments', () => {
    const envelope = serializeWebchatEnvelope({
        text: 'Test',
        attachments: [
            { filename: 'valid.txt' },
            null,
            undefined,
            {},
            { invalid: true }, // No valid fields
        ],
    });
    const parsed = JSON.parse(envelope);

    assert.strictEqual(parsed.attachments.length, 1);
    assert.strictEqual(parsed.attachments[0].filename, 'valid.txt');
});

test('serializeWebchatEnvelope: includes user when provided', () => {
    const envelope = serializeWebchatEnvelope({
        text: 'Test',
        user: {
            username: 'john',
            roles: ['admin', 'user'],
            email: 'john@example.com',
            sessionId: 'sess123',
        },
    });
    const parsed = JSON.parse(envelope);

    assert.strictEqual(parsed.user.username, 'john');
    assert.deepStrictEqual(parsed.user.roles, ['admin', 'user']);
    assert.strictEqual(parsed.user.email, 'john@example.com');
    assert.strictEqual(parsed.user.sessionId, 'sess123');
});

test('serializeWebchatEnvelope: includes settings when provided', () => {
    const envelope = serializeWebchatEnvelope({
        text: 'Test',
        settings: { maxTableRows: 50 },
    });
    const parsed = JSON.parse(envelope);

    assert.strictEqual(parsed.settings.maxTableRows, 50);
});

test('serializeWebchatEnvelope: handles empty input', () => {
    const envelope = serializeWebchatEnvelope({});
    const parsed = JSON.parse(envelope);

    assert.strictEqual(parsed.text, '');
    assert.deepStrictEqual(parsed.attachments, []);
});

test('serializeWebchatEnvelope: handles undefined input', () => {
    const envelope = serializeWebchatEnvelope();
    const parsed = JSON.parse(envelope);

    assert.strictEqual(parsed.text, '');
    assert.deepStrictEqual(parsed.attachments, []);
});

// ============================================================================
// parseWebchatEnvelope Tests
// ============================================================================

test('parseWebchatEnvelope: parses valid envelope', () => {
    const input = JSON.stringify({
        [WEBCHAT_ENVELOPE_FLAG]: WEBCHAT_ENVELOPE_VERSION,
        version: WEBCHAT_ENVELOPE_VERSION,
        text: 'Hello',
        attachments: [],
    });

    const result = parseWebchatEnvelope(input);

    assert.notStrictEqual(result, null);
    assert.strictEqual(result.text, 'Hello');
    assert.deepStrictEqual(result.attachments, []);
});

test('parseWebchatEnvelope: returns null for plain text', () => {
    const result = parseWebchatEnvelope('Just a plain message');
    assert.strictEqual(result, null);
});

test('parseWebchatEnvelope: returns null for non-string input', () => {
    assert.strictEqual(parseWebchatEnvelope(null), null);
    assert.strictEqual(parseWebchatEnvelope(undefined), null);
    assert.strictEqual(parseWebchatEnvelope(123), null);
    assert.strictEqual(parseWebchatEnvelope({}), null);
});

test('parseWebchatEnvelope: returns null for invalid JSON', () => {
    assert.strictEqual(parseWebchatEnvelope('{ invalid json }'), null);
    assert.strictEqual(parseWebchatEnvelope('{'), null);
});

test('parseWebchatEnvelope: returns null for JSON without envelope flag', () => {
    const input = JSON.stringify({ text: 'Hello', other: 'data' });
    assert.strictEqual(parseWebchatEnvelope(input), null);
});

test('parseWebchatEnvelope: returns null for wrong version', () => {
    const input = JSON.stringify({
        [WEBCHAT_ENVELOPE_FLAG]: 999,
        text: 'Hello',
    });
    assert.strictEqual(parseWebchatEnvelope(input), null);
});

test('parseWebchatEnvelope: trims whitespace from input', () => {
    const input = `  ${JSON.stringify({
        [WEBCHAT_ENVELOPE_FLAG]: WEBCHAT_ENVELOPE_VERSION,
        version: WEBCHAT_ENVELOPE_VERSION,
        text: 'Trimmed',
    })}  `;

    const result = parseWebchatEnvelope(input);
    assert.strictEqual(result.text, 'Trimmed');
});

test('parseWebchatEnvelope: normalizes attachments', () => {
    const input = JSON.stringify({
        [WEBCHAT_ENVELOPE_FLAG]: WEBCHAT_ENVELOPE_VERSION,
        version: WEBCHAT_ENVELOPE_VERSION,
        text: '',
        attachments: [
            { filename: 'file.txt', size: 100 },
            { invalid: 'attachment' },
        ],
    });

    const result = parseWebchatEnvelope(input);
    assert.strictEqual(result.attachments.length, 1);
    assert.strictEqual(result.attachments[0].filename, 'file.txt');
});

test('parseWebchatEnvelope: normalizes user object', () => {
    const input = JSON.stringify({
        [WEBCHAT_ENVELOPE_FLAG]: WEBCHAT_ENVELOPE_VERSION,
        version: WEBCHAT_ENVELOPE_VERSION,
        text: '',
        user: {
            username: '  john  ',
            role: 'admin',
            email: '  john@test.com  ',
            sessionId: '  sess123  ',
        },
    });

    const result = parseWebchatEnvelope(input);
    assert.strictEqual(result.user.username, '  john  '); // username not trimmed
    assert.strictEqual(result.user.role, 'admin');
    assert.strictEqual(result.user.email, 'john@test.com');
    assert.strictEqual(result.user.sessionId, 'sess123');
});

test('parseWebchatEnvelope: converts single role to roles array', () => {
    const input = JSON.stringify({
        [WEBCHAT_ENVELOPE_FLAG]: WEBCHAT_ENVELOPE_VERSION,
        version: WEBCHAT_ENVELOPE_VERSION,
        text: '',
        user: { role: 'admin' },
    });

    const result = parseWebchatEnvelope(input);
    assert.deepStrictEqual(result.user.roles, ['admin']);
    assert.strictEqual(result.user.role, 'admin');
});

test('parseWebchatEnvelope: normalizes settings', () => {
    const input = JSON.stringify({
        [WEBCHAT_ENVELOPE_FLAG]: WEBCHAT_ENVELOPE_VERSION,
        version: WEBCHAT_ENVELOPE_VERSION,
        text: '',
        settings: { maxTableRows: 25, lineLimit: 50 },
    });

    const result = parseWebchatEnvelope(input);
    assert.strictEqual(result.settings.maxTableRows, 25);
});

test('parseWebchatEnvelope: uses lineLimit as fallback for maxTableRows', () => {
    const input = JSON.stringify({
        [WEBCHAT_ENVELOPE_FLAG]: WEBCHAT_ENVELOPE_VERSION,
        version: WEBCHAT_ENVELOPE_VERSION,
        text: '',
        settings: { lineLimit: 100 },
    });

    const result = parseWebchatEnvelope(input);
    assert.strictEqual(result.settings.maxTableRows, 100);
});

test('parseWebchatEnvelope: preserves raw object', () => {
    const input = JSON.stringify({
        [WEBCHAT_ENVELOPE_FLAG]: WEBCHAT_ENVELOPE_VERSION,
        version: WEBCHAT_ENVELOPE_VERSION,
        text: 'Test',
        custom: 'field',
    });

    const result = parseWebchatEnvelope(input);
    assert.strictEqual(result.raw.custom, 'field');
});

// ============================================================================
// isWebchatEnvelope Tests
// ============================================================================

test('isWebchatEnvelope: returns true for valid envelope', () => {
    const input = serializeWebchatEnvelope({ text: 'Test' });
    assert.strictEqual(isWebchatEnvelope(input), true);
});

test('isWebchatEnvelope: returns false for plain text', () => {
    assert.strictEqual(isWebchatEnvelope('Plain text'), false);
});

test('isWebchatEnvelope: returns false for invalid JSON', () => {
    assert.strictEqual(isWebchatEnvelope('{ not json'), false);
});

test('isWebchatEnvelope: returns false for JSON without flag', () => {
    assert.strictEqual(isWebchatEnvelope('{"text": "hello"}'), false);
});

// ============================================================================
// extractText Tests
// ============================================================================

test('extractText: returns text from envelope', () => {
    const input = serializeWebchatEnvelope({ text: 'Envelope text' });
    assert.strictEqual(extractText(input), 'Envelope text');
});

test('extractText: returns trimmed plain text', () => {
    assert.strictEqual(extractText('  Plain text  '), 'Plain text');
});

test('extractText: returns empty string for non-string', () => {
    assert.strictEqual(extractText(null), '');
    assert.strictEqual(extractText(undefined), '');
    assert.strictEqual(extractText(123), '');
});

// ============================================================================
// Round-trip Tests
// ============================================================================

test('Round-trip: serialize then parse preserves data', () => {
    const original = {
        text: 'Test message\nWith newlines',
        attachments: [
            {
                id: 'file1',
                filename: 'document.pdf',
                mime: 'application/pdf',
                size: 2048,
                downloadUrl: 'https://example.com/doc.pdf',
                localPath: '/tmp/doc.pdf',
            },
        ],
        user: {
            username: 'testuser',
            roles: ['viewer', 'editor'],
            email: 'test@example.com',
            sessionId: 'session-abc-123',
        },
        settings: {
            maxTableRows: 100,
        },
    };

    const serialized = serializeWebchatEnvelope(original);
    const parsed = parseWebchatEnvelope(serialized);

    assert.strictEqual(parsed.text, original.text);
    assert.strictEqual(parsed.attachments.length, 1);
    assert.strictEqual(parsed.attachments[0].filename, 'document.pdf');
    assert.strictEqual(parsed.user.username, 'testuser');
    assert.deepStrictEqual(parsed.user.roles, ['viewer', 'editor']);
    assert.strictEqual(parsed.settings.maxTableRows, 100);
});

console.log('WebchatEnvelope unit tests completed');
