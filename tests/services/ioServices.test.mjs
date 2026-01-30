/**
 * Unit Tests for IOServices and I/O classes
 *
 * Tests the IOServices singleton, InputReader classes, and OutputWriter classes
 * that provide environment-agnostic I/O for the agent framework.
 */

import test from 'node:test';
import assert from 'node:assert';
import { Writable, Readable } from 'node:stream';
import {
    IOServices,
    InputReader,
    CLIInputReader,
    MockInputReader,
    OutputWriter,
    CLIOutputWriter,
    MockOutputWriter,
} from '../../services/index.mjs';

// ============================================================================
// IOServices Singleton Tests
// ============================================================================

test('IOServices: initial state has no readers/writers', () => {
    IOServices.clear();
    assert.strictEqual(IOServices.getInputReader(), null);
    assert.strictEqual(IOServices.getOutputWriter(), null);
    assert.strictEqual(IOServices.isAvailable(), false);
});

test('IOServices: setInputReader and getInputReader', () => {
    IOServices.clear();
    const mockReader = new MockInputReader(['test']);

    IOServices.setInputReader(mockReader);
    assert.strictEqual(IOServices.getInputReader(), mockReader);
});

test('IOServices: setOutputWriter and getOutputWriter', () => {
    IOServices.clear();
    const mockWriter = new MockOutputWriter();

    IOServices.setOutputWriter(mockWriter);
    assert.strictEqual(IOServices.getOutputWriter(), mockWriter);
});

test('IOServices: isAvailable returns true when both reader and writer are set', () => {
    IOServices.clear();
    assert.strictEqual(IOServices.isAvailable(), false);

    IOServices.setInputReader(new MockInputReader());
    assert.strictEqual(IOServices.isAvailable(), false);

    IOServices.setOutputWriter(new MockOutputWriter());
    assert.strictEqual(IOServices.isAvailable(), true);
});

test('IOServices: clear resets both reader and writer', () => {
    IOServices.setInputReader(new MockInputReader());
    IOServices.setOutputWriter(new MockOutputWriter());
    assert.strictEqual(IOServices.isAvailable(), true);

    IOServices.clear();
    assert.strictEqual(IOServices.getInputReader(), null);
    assert.strictEqual(IOServices.getOutputWriter(), null);
    assert.strictEqual(IOServices.isAvailable(), false);
});

test('IOServices: can replace existing reader/writer', () => {
    IOServices.clear();
    const reader1 = new MockInputReader(['first']);
    const reader2 = new MockInputReader(['second']);
    const writer1 = new MockOutputWriter();
    const writer2 = new MockOutputWriter();

    IOServices.setInputReader(reader1);
    IOServices.setOutputWriter(writer1);
    assert.strictEqual(IOServices.getInputReader(), reader1);
    assert.strictEqual(IOServices.getOutputWriter(), writer1);

    IOServices.setInputReader(reader2);
    IOServices.setOutputWriter(writer2);
    assert.strictEqual(IOServices.getInputReader(), reader2);
    assert.strictEqual(IOServices.getOutputWriter(), writer2);
});

// ============================================================================
// InputReader Base Class Tests
// ============================================================================

test('InputReader: base class read() throws error', async () => {
    const reader = new InputReader();
    await assert.rejects(
        () => reader.read(),
        { message: 'InputReader.read() must be implemented by subclass' }
    );
});

test('InputReader: confirm() returns true for "yes"', async () => {
    // We need to subclass to test confirm behavior
    class TestReader extends InputReader {
        constructor(response) {
            super();
            this.response = response;
        }
        async read() {
            return this.response;
        }
    }

    const yesReader = new TestReader('yes');
    assert.strictEqual(await yesReader.confirm(), true);

    const yUpperReader = new TestReader('YES');
    assert.strictEqual(await yUpperReader.confirm(), true);

    const yReader = new TestReader('y');
    assert.strictEqual(await yReader.confirm(), true);

    const yUpperSingleReader = new TestReader('Y');
    assert.strictEqual(await yUpperSingleReader.confirm(), true);
});

test('InputReader: confirm() returns false for non-yes responses', async () => {
    class TestReader extends InputReader {
        constructor(response) {
            super();
            this.response = response;
        }
        async read() {
            return this.response;
        }
    }

    const noReader = new TestReader('no');
    assert.strictEqual(await noReader.confirm(), false);

    const emptyReader = new TestReader('');
    assert.strictEqual(await emptyReader.confirm(), false);

    const maybeReader = new TestReader('maybe');
    assert.strictEqual(await maybeReader.confirm(), false);
});

test('InputReader: confirm() trims whitespace', async () => {
    class TestReader extends InputReader {
        constructor(response) {
            super();
            this.response = response;
        }
        async read() {
            return this.response;
        }
    }

    const spacedReader = new TestReader('  yes  ');
    assert.strictEqual(await spacedReader.confirm(), true);
});

test('InputReader: close() is a no-op by default', () => {
    const reader = new InputReader();
    // Should not throw
    reader.close();
});

// ============================================================================
// MockInputReader Tests
// ============================================================================

test('MockInputReader: returns responses in order', async () => {
    const reader = new MockInputReader(['first', 'second', 'third']);

    assert.strictEqual(await reader.read(), 'first');
    assert.strictEqual(await reader.read(), 'second');
    assert.strictEqual(await reader.read(), 'third');
});

test('MockInputReader: throws when no more responses', async () => {
    const reader = new MockInputReader(['only']);

    await reader.read();
    await assert.rejects(
        () => reader.read(),
        { message: 'MockInputReader: No more responses available' }
    );
});

test('MockInputReader: tracks prompts', async () => {
    const reader = new MockInputReader(['answer1', 'answer2']);

    await reader.read('First prompt?');
    await reader.read('Second prompt?');

    assert.deepStrictEqual(reader.prompts, ['First prompt?', 'Second prompt?']);
});

test('MockInputReader: addResponses() adds to queue', async () => {
    const reader = new MockInputReader(['first']);

    assert.strictEqual(await reader.read(), 'first');

    reader.addResponses('second', 'third');

    assert.strictEqual(await reader.read(), 'second');
    assert.strictEqual(await reader.read(), 'third');
});

test('MockInputReader: reset() restarts from beginning', async () => {
    const reader = new MockInputReader(['first', 'second']);

    await reader.read('prompt1');
    await reader.read('prompt2');

    reader.reset();

    assert.strictEqual(reader.index, 0);
    assert.deepStrictEqual(reader.prompts, []);
    assert.strictEqual(await reader.read(), 'first');
});

test('MockInputReader: confirm() works with yes/no responses', async () => {
    const reader = new MockInputReader(['yes', 'no', 'y', 'n']);

    assert.strictEqual(await reader.confirm(), true);
    assert.strictEqual(await reader.confirm(), false);
    assert.strictEqual(await reader.confirm(), true);
    assert.strictEqual(await reader.confirm(), false);
});

test('MockInputReader: empty constructor creates reader with no responses', async () => {
    const reader = new MockInputReader();

    await assert.rejects(
        () => reader.read(),
        { message: 'MockInputReader: No more responses available' }
    );
});

// ============================================================================
// OutputWriter Base Class Tests
// ============================================================================

test('OutputWriter: base class write() throws error', async () => {
    const writer = new OutputWriter();
    await assert.rejects(
        () => writer.write('test'),
        { message: 'OutputWriter.write() must be implemented by subclass' }
    );
});

test('OutputWriter: writeError() prefixes with "Error: "', async () => {
    class TestWriter extends OutputWriter {
        constructor() {
            super();
            this.output = [];
        }
        async write(message) {
            this.output.push(message);
        }
    }

    const writer = new TestWriter();
    await writer.writeError('something went wrong');

    assert.deepStrictEqual(writer.output, ['Error: something went wrong']);
});

test('OutputWriter: writeWarning() prefixes with "Warning: "', async () => {
    class TestWriter extends OutputWriter {
        constructor() {
            super();
            this.output = [];
        }
        async write(message) {
            this.output.push(message);
        }
    }

    const writer = new TestWriter();
    await writer.writeWarning('careful now');

    assert.deepStrictEqual(writer.output, ['Warning: careful now']);
});

test('OutputWriter: writeSuccess() passes through message', async () => {
    class TestWriter extends OutputWriter {
        constructor() {
            super();
            this.output = [];
        }
        async write(message) {
            this.output.push(message);
        }
    }

    const writer = new TestWriter();
    await writer.writeSuccess('all good');

    assert.deepStrictEqual(writer.output, ['all good']);
});

test('OutputWriter: writeProgress() passes through message', async () => {
    class TestWriter extends OutputWriter {
        constructor() {
            super();
            this.output = [];
        }
        async write(message) {
            this.output.push(message);
        }
    }

    const writer = new TestWriter();
    await writer.writeProgress('processing...');

    assert.deepStrictEqual(writer.output, ['processing...']);
});

test('OutputWriter: clear() is a no-op by default', async () => {
    const writer = new OutputWriter();
    // Should not throw (even though write() would)
    await writer.clear();
});

// ============================================================================
// CLIOutputWriter Tests
// ============================================================================

test('CLIOutputWriter: write() outputs to stdout with newline', async () => {
    const chunks = [];
    const mockStdout = new Writable({
        write(chunk, encoding, callback) {
            chunks.push(chunk.toString());
            callback();
        }
    });

    const writer = new CLIOutputWriter({ stdout: mockStdout });
    await writer.write('Hello, World!');

    assert.strictEqual(chunks.join(''), 'Hello, World!\n');
});

test('CLIOutputWriter: writeError() outputs to stderr with red color', async () => {
    const chunks = [];
    const mockStderr = new Writable({
        write(chunk, encoding, callback) {
            chunks.push(chunk.toString());
            callback();
        }
    });

    const writer = new CLIOutputWriter({ stderr: mockStderr, useColors: true });
    await writer.writeError('test error');

    const output = chunks.join('');
    assert.ok(output.includes('Error: test error'), 'Should include error message');
    assert.ok(output.includes('\x1b[31m'), 'Should include red ANSI code');
    assert.ok(output.includes('\x1b[0m'), 'Should include reset ANSI code');
});

test('CLIOutputWriter: writeError() without colors', async () => {
    const chunks = [];
    const mockStderr = new Writable({
        write(chunk, encoding, callback) {
            chunks.push(chunk.toString());
            callback();
        }
    });

    const writer = new CLIOutputWriter({ stderr: mockStderr, useColors: false });
    await writer.writeError('test error');

    const output = chunks.join('');
    assert.strictEqual(output, 'Error: test error\n');
    assert.ok(!output.includes('\x1b['), 'Should not include ANSI codes');
});

test('CLIOutputWriter: writeWarning() outputs with yellow color', async () => {
    const chunks = [];
    const mockStdout = new Writable({
        write(chunk, encoding, callback) {
            chunks.push(chunk.toString());
            callback();
        }
    });

    const writer = new CLIOutputWriter({ stdout: mockStdout, useColors: true });
    await writer.writeWarning('test warning');

    const output = chunks.join('');
    assert.ok(output.includes('Warning: test warning'), 'Should include warning message');
    assert.ok(output.includes('\x1b[33m'), 'Should include yellow ANSI code');
});

test('CLIOutputWriter: writeSuccess() outputs with green color', async () => {
    const chunks = [];
    const mockStdout = new Writable({
        write(chunk, encoding, callback) {
            chunks.push(chunk.toString());
            callback();
        }
    });

    const writer = new CLIOutputWriter({ stdout: mockStdout, useColors: true });
    await writer.writeSuccess('operation completed');

    const output = chunks.join('');
    assert.ok(output.includes('operation completed'), 'Should include success message');
    assert.ok(output.includes('\x1b[32m'), 'Should include green ANSI code');
});

test('CLIOutputWriter: writeProgress() outputs with dim color', async () => {
    const chunks = [];
    const mockStdout = new Writable({
        write(chunk, encoding, callback) {
            chunks.push(chunk.toString());
            callback();
        }
    });

    const writer = new CLIOutputWriter({ stdout: mockStdout, useColors: true });
    await writer.writeProgress('loading...');

    const output = chunks.join('');
    assert.ok(output.includes('loading...'), 'Should include progress message');
    assert.ok(output.includes('\x1b[2m'), 'Should include dim ANSI code');
});

test('CLIOutputWriter: defaults to colors enabled', async () => {
    const chunks = [];
    const mockStdout = new Writable({
        write(chunk, encoding, callback) {
            chunks.push(chunk.toString());
            callback();
        }
    });

    const writer = new CLIOutputWriter({ stdout: mockStdout });
    await writer.writeSuccess('test');

    const output = chunks.join('');
    assert.ok(output.includes('\x1b[32m'), 'Colors should be enabled by default');
});

// ============================================================================
// MockOutputWriter Tests
// ============================================================================

test('MockOutputWriter: write() records messages', async () => {
    const writer = new MockOutputWriter();

    await writer.write('message 1');
    await writer.write('message 2');

    assert.deepStrictEqual(writer.messages, ['message 1', 'message 2']);
});

test('MockOutputWriter: writeError() records errors', async () => {
    const writer = new MockOutputWriter();

    await writer.writeError('error 1');
    await writer.writeError('error 2');

    assert.deepStrictEqual(writer.errors, ['error 1', 'error 2']);
    assert.deepStrictEqual(writer.messages, []); // Not added to messages
});

test('MockOutputWriter: writeWarning() records warnings', async () => {
    const writer = new MockOutputWriter();

    await writer.writeWarning('warning 1');
    await writer.writeWarning('warning 2');

    assert.deepStrictEqual(writer.warnings, ['warning 1', 'warning 2']);
});

test('MockOutputWriter: writeSuccess() records successes', async () => {
    const writer = new MockOutputWriter();

    await writer.writeSuccess('success 1');
    await writer.writeSuccess('success 2');

    assert.deepStrictEqual(writer.successes, ['success 1', 'success 2']);
});

test('MockOutputWriter: writeProgress() records progress', async () => {
    const writer = new MockOutputWriter();

    await writer.writeProgress('step 1');
    await writer.writeProgress('step 2');

    assert.deepStrictEqual(writer.progress, ['step 1', 'step 2']);
});

test('MockOutputWriter: getAll() returns all recorded output', async () => {
    const writer = new MockOutputWriter();

    await writer.write('msg');
    await writer.writeError('err');
    await writer.writeWarning('warn');
    await writer.writeSuccess('succ');
    await writer.writeProgress('prog');

    const all = writer.getAll();

    assert.deepStrictEqual(all, {
        messages: ['msg'],
        errors: ['err'],
        warnings: ['warn'],
        successes: ['succ'],
        progress: ['prog'],
    });
});

test('MockOutputWriter: getAll() returns copies of arrays', async () => {
    const writer = new MockOutputWriter();
    await writer.write('original');

    const all = writer.getAll();
    all.messages.push('modified');

    // Original should be unchanged
    assert.deepStrictEqual(writer.messages, ['original']);
});

test('MockOutputWriter: reset() clears all recorded output', async () => {
    const writer = new MockOutputWriter();

    await writer.write('msg');
    await writer.writeError('err');
    await writer.writeWarning('warn');
    await writer.writeSuccess('succ');
    await writer.writeProgress('prog');

    writer.reset();

    assert.deepStrictEqual(writer.messages, []);
    assert.deepStrictEqual(writer.errors, []);
    assert.deepStrictEqual(writer.warnings, []);
    assert.deepStrictEqual(writer.successes, []);
    assert.deepStrictEqual(writer.progress, []);
});

// ============================================================================
// Integration Tests: IOServices with Mock I/O
// ============================================================================

test('Integration: IOServices with MockInputReader and MockOutputWriter', async () => {
    IOServices.clear();

    const reader = new MockInputReader(['John', 'yes']);
    const writer = new MockOutputWriter();

    IOServices.setInputReader(reader);
    IOServices.setOutputWriter(writer);

    // Simulate a simple interaction
    const outputWriter = IOServices.getOutputWriter();
    const inputReader = IOServices.getInputReader();

    await outputWriter.write('What is your name?');
    const name = await inputReader.read();
    await outputWriter.write(`Hello, ${name}!`);
    await outputWriter.write('Do you want to continue?');
    const confirmed = await inputReader.confirm();

    assert.strictEqual(name, 'John');
    assert.strictEqual(confirmed, true);
    assert.deepStrictEqual(writer.messages, [
        'What is your name?',
        'Hello, John!',
        'Do you want to continue?',
    ]);
});

test('Integration: graceful handling when IOServices not configured', async () => {
    IOServices.clear();

    const writer = IOServices.getOutputWriter();

    // Code should check for null before using
    if (writer) {
        await writer.write('This should not execute');
    }

    // No error should be thrown
    assert.strictEqual(writer, null);
});

// Cleanup after all tests
test.after(() => {
    IOServices.clear();
});

console.log('IOServices unit tests completed');
