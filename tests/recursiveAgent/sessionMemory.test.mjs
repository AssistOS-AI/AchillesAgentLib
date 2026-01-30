import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RecursiveSkilledAgent } from '../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Stub LLM agent that doesn't make real API calls.
 */
class StubLLMAgent extends LLMAgent {
    constructor() {
        super({ name: 'StubLLMAgent' });
    }

    executePrompt(prompt, options = {}) {
        return { result: 'stub response' };
    }
}

test('sessionMemory management', async (t) => {
    await t.test('getSessionMemory returns a Map', () => {
        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
        });

        const sessionMemory = agent.getSessionMemory();

        assert.ok(sessionMemory instanceof Map, 'sessionMemory should be a Map');
    });

    await t.test('getSessionMemory without sessionId returns default session', () => {
        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
        });

        const session1 = agent.getSessionMemory();
        const session2 = agent.getSessionMemory(null);
        const session3 = agent.getSessionMemory(undefined);

        assert.strictEqual(session1, session2, 'null should return same session as no arg');
        assert.strictEqual(session2, session3, 'undefined should return same session as null');
    });

    await t.test('getSessionMemory with sessionId returns isolated session', () => {
        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
        });

        const defaultSession = agent.getSessionMemory();
        const userASession = agent.getSessionMemory('user-a');
        const userBSession = agent.getSessionMemory('user-b');

        // All should be different Map instances
        assert.notStrictEqual(defaultSession, userASession, 'default and user-a should be different');
        assert.notStrictEqual(defaultSession, userBSession, 'default and user-b should be different');
        assert.notStrictEqual(userASession, userBSession, 'user-a and user-b should be different');

        // Modifying one should not affect others
        defaultSession.set('key', 'default-value');
        userASession.set('key', 'user-a-value');
        userBSession.set('key', 'user-b-value');

        assert.strictEqual(defaultSession.get('key'), 'default-value');
        assert.strictEqual(userASession.get('key'), 'user-a-value');
        assert.strictEqual(userBSession.get('key'), 'user-b-value');
    });

    await t.test('getSessionMemory returns same Map for same sessionId', () => {
        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
        });

        const session1 = agent.getSessionMemory('user-123');
        session1.set('test', 'value');

        const session2 = agent.getSessionMemory('user-123');

        assert.strictEqual(session1, session2, 'should return same Map instance');
        assert.strictEqual(session2.get('test'), 'value', 'data should persist');
    });

    await t.test('clearSessionMemory clears session data', () => {
        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
        });

        const session = agent.getSessionMemory('user-abc');
        session.set('key1', 'value1');
        session.set('key2', 'value2');

        assert.strictEqual(session.size, 2);

        agent.clearSessionMemory('user-abc');

        assert.strictEqual(session.size, 0, 'session should be empty after clear');
        
        // Session Map should still be the same reference
        const sessionAfterClear = agent.getSessionMemory('user-abc');
        assert.strictEqual(session, sessionAfterClear, 'should return same Map after clear');
    });

    await t.test('clearSessionMemory with null clears default session', () => {
        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
        });

        const session = agent.getSessionMemory();
        session.set('pending_record_create', { data: 'test' });

        agent.clearSessionMemory(null);

        assert.strictEqual(session.size, 0, 'default session should be cleared');
    });

    await t.test('deleteSession removes session entirely', () => {
        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
        });

        agent.getSessionMemory('user-to-delete');
        assert.ok(agent.hasSession('user-to-delete'), 'session should exist');

        const deleted = agent.deleteSession('user-to-delete');

        assert.ok(deleted, 'deleteSession should return true');
        assert.ok(!agent.hasSession('user-to-delete'), 'session should not exist after delete');
    });

    await t.test('deleteSession cannot delete default session', () => {
        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
        });

        const session = agent.getSessionMemory();
        session.set('key', 'value');

        const deleted = agent.deleteSession(null);

        assert.ok(!deleted, 'deleteSession should return false for default session');
        // Default session should be cleared but still exist
        assert.ok(agent.hasSession(null), 'default session should still exist');
        assert.strictEqual(session.size, 0, 'default session should be cleared');
    });

    await t.test('getActiveSessions returns non-default session IDs', () => {
        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
        });

        // Create some sessions
        agent.getSessionMemory(); // default
        agent.getSessionMemory('user-1');
        agent.getSessionMemory('user-2');
        agent.getSessionMemory('user-3');

        const activeSessions = agent.getActiveSessions();

        assert.ok(Array.isArray(activeSessions), 'should return array');
        assert.strictEqual(activeSessions.length, 3, 'should have 3 user sessions');
        assert.ok(activeSessions.includes('user-1'), 'should include user-1');
        assert.ok(activeSessions.includes('user-2'), 'should include user-2');
        assert.ok(activeSessions.includes('user-3'), 'should include user-3');
        assert.ok(!activeSessions.includes('__default__'), 'should not include default session marker');
    });

    await t.test('hasSession returns correct boolean', () => {
        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
        });

        assert.ok(!agent.hasSession('nonexistent'), 'should return false for nonexistent session');
        assert.ok(!agent.hasSession(), 'should return false for uncreated default session');

        agent.getSessionMemory();
        assert.ok(agent.hasSession(), 'should return true for created default session');
        assert.ok(agent.hasSession(null), 'should return true with null arg');

        agent.getSessionMemory('user-x');
        assert.ok(agent.hasSession('user-x'), 'should return true for created user session');
    });
});

test('sessionMemory auto-injection in executeWithReviewMode', async (t) => {
    await t.test('sessionMemory is auto-injected into context', async () => {
        let capturedOptions = null;

        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
        });

        // Mock the executor to capture options
        const originalExecute = agent.executor.execute.bind(agent.executor);
        agent.executor.execute = async (taskDescription, options, reviewMode, recursiveAgent) => {
            capturedOptions = options;
            // Return a minimal result to avoid errors
            return { result: 'mocked' };
        };

        await agent.executePrompt('test task', {
            context: {
                user: { name: 'Test User' },
            },
        });

        assert.ok(capturedOptions, 'options should be captured');
        assert.ok(capturedOptions.context, 'context should exist');
        assert.ok(capturedOptions.context.sessionMemory instanceof Map, 'sessionMemory should be injected');
    });

    await t.test('uses user.sessionId for multi-session mode', async () => {
        let capturedOptions = null;

        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
        });

        const originalExecute = agent.executor.execute.bind(agent.executor);
        agent.executor.execute = async (taskDescription, options, reviewMode, recursiveAgent) => {
            capturedOptions = options;
            return { result: 'mocked' };
        };

        // First request from user-1
        await agent.executePrompt('task 1', {
            context: {
                user: { sessionId: 'user-session-1' },
            },
        });

        const user1Session = capturedOptions.context.sessionMemory;
        user1Session.set('pending', 'data-for-user-1');

        // Second request from user-2
        await agent.executePrompt('task 2', {
            context: {
                user: { sessionId: 'user-session-2' },
            },
        });

        const user2Session = capturedOptions.context.sessionMemory;

        // Sessions should be isolated
        assert.notStrictEqual(user1Session, user2Session, 'different users should have different sessions');
        assert.ok(!user2Session.has('pending'), 'user-2 should not see user-1 data');
    });

    await t.test('does not override explicitly provided sessionMemory', async () => {
        let capturedOptions = null;

        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
        });

        agent.executor.execute = async (taskDescription, options, reviewMode, recursiveAgent) => {
            capturedOptions = options;
            return { result: 'mocked' };
        };

        const explicitSessionMemory = new Map([['custom', 'value']]);

        await agent.executePrompt('test task', {
            context: {
                sessionMemory: explicitSessionMemory,
            },
        });

        assert.strictEqual(
            capturedOptions.context.sessionMemory,
            explicitSessionMemory,
            'explicit sessionMemory should not be overridden'
        );
        assert.strictEqual(
            capturedOptions.context.sessionMemory.get('custom'),
            'value',
            'explicit sessionMemory data should be preserved'
        );
    });

    await t.test('uses sessionToken if sessionId not present', async () => {
        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
        });

        let capturedSessionId = null;
        const originalGetSessionMemory = agent.getSessionMemory.bind(agent);
        agent.getSessionMemory = (sessionId) => {
            capturedSessionId = sessionId;
            return originalGetSessionMemory(sessionId);
        };

        agent.executor.execute = async () => ({ result: 'mocked' });

        await agent.executePrompt('test', {
            context: {
                user: { sessionToken: 'token-123' },
            },
        });

        assert.strictEqual(capturedSessionId, 'token-123', 'should use sessionToken as sessionId');
    });

    await t.test('uses context.sessionId if user.sessionId not present', async () => {
        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
        });

        let capturedSessionId = null;
        const originalGetSessionMemory = agent.getSessionMemory.bind(agent);
        agent.getSessionMemory = (sessionId) => {
            capturedSessionId = sessionId;
            return originalGetSessionMemory(sessionId);
        };

        agent.executor.execute = async () => ({ result: 'mocked' });

        await agent.executePrompt('test', {
            context: {
                sessionId: 'explicit-session-id',
                user: { name: 'User without sessionId' },
            },
        });

        assert.strictEqual(capturedSessionId, 'explicit-session-id', 'should use context.sessionId');
    });
});

test('sessionMemory integration with pending states', async (t) => {
    await t.test('pending states persist across multiple prompts in same session', async () => {
        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
        });

        // Simulate what ConversationalTskillController does - store pending state
        const sessionMemory = agent.getSessionMemory('user-session');
        sessionMemory.set('pending_record_create', {
            record: { name: 'Test Record' },
        });

        // Later request should see the same pending state
        const sameSession = agent.getSessionMemory('user-session');
        const pendingCreate = sameSession.get('pending_record_create');

        assert.ok(pendingCreate, 'pending state should persist');
        assert.deepStrictEqual(pendingCreate.record, { name: 'Test Record' });
        
        agent.shutdown();
    });

    await t.test('pending states are isolated between sessions', async () => {
        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
        });

        // User A has pending create
        const sessionA = agent.getSessionMemory('user-a');
        sessionA.set('pending_job_create', { record: { title: 'Job A' } });

        // User B has pending update
        const sessionB = agent.getSessionMemory('user-b');
        sessionB.set('pending_job_update', { id: 123, changes: { status: 'active' } });

        // Verify isolation
        assert.ok(!sessionA.has('pending_job_update'), 'User A should not see User B pending');
        assert.ok(!sessionB.has('pending_job_create'), 'User B should not see User A pending');
        
        agent.shutdown();
    });
});

test('session lifecycle management', async (t) => {
    await t.test('getSessionStats returns session information', () => {
        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
        });

        // Create some sessions
        agent.getSessionMemory('user-1');
        agent.getSessionMemory('user-2');
        agent.getSessionMemory(); // default

        const stats = agent.getSessionStats();

        assert.strictEqual(stats.totalSessions, 3, 'should have 3 total sessions');
        assert.strictEqual(stats.userSessions, 2, 'should have 2 user sessions');
        assert.strictEqual(stats.sessions.length, 2, 'should list 2 user sessions');
        
        const user1Session = stats.sessions.find(s => s.sessionId === 'user-1');
        assert.ok(user1Session, 'should include user-1 session');
        assert.ok(user1Session.createdAt > 0, 'should have createdAt');
        assert.ok(user1Session.lastAccessTime > 0, 'should have lastAccessTime');
        
        agent.shutdown();
    });

    await t.test('session TTL expires idle sessions', async () => {
        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
            sessionConfig: {
                sessionTTL: 50, // 50ms TTL for testing
                cleanupInterval: 0, // disable auto cleanup
            },
        });

        // Create a session
        agent.getSessionMemory('short-lived');
        assert.ok(agent.hasSession('short-lived'), 'session should exist');

        // Wait for TTL to expire
        await new Promise(resolve => setTimeout(resolve, 100));

        // Manual cleanup
        const cleaned = agent.cleanupSessions();

        assert.strictEqual(cleaned, 1, 'should clean 1 session');
        assert.ok(!agent.hasSession('short-lived'), 'session should be expired');
        
        agent.shutdown();
    });

    await t.test('maxSessions enforces LRU eviction', async () => {
        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
            sessionConfig: {
                maxSessions: 3,
                sessionTTL: 0, // disable TTL
                cleanupInterval: 0,
            },
        });

        // Create sessions with small delays to ensure different timestamps
        agent.getSessionMemory('user-1');
        await new Promise(r => setTimeout(r, 5));
        agent.getSessionMemory('user-2');
        await new Promise(r => setTimeout(r, 5));
        agent.getSessionMemory('user-3');

        assert.strictEqual(agent.getActiveSessions().length, 3, 'should have 3 sessions');

        // Wait and access user-1 to make it most recently used
        await new Promise(r => setTimeout(r, 5));
        agent.getSessionMemory('user-1');

        // Create new session - should evict user-2 (oldest that wasn't recently accessed)
        await new Promise(r => setTimeout(r, 5));
        agent.getSessionMemory('user-4');

        const active = agent.getActiveSessions();
        assert.strictEqual(active.length, 3, 'should still have 3 sessions');
        assert.ok(active.includes('user-1'), 'user-1 should survive (recently accessed)');
        assert.ok(active.includes('user-4'), 'user-4 should exist (just created)');
        // user-2 should have been evicted as it was oldest and not recently accessed
        
        agent.shutdown();
    });

    await t.test('default session is never evicted', () => {
        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
            sessionConfig: {
                maxSessions: 2,
                sessionTTL: 0,
                cleanupInterval: 0,
            },
        });

        // Create default session first
        agent.getSessionMemory();
        agent.getSessionMemory('user-1');
        agent.getSessionMemory('user-2');
        
        // Create another - should evict user-1 not default
        agent.getSessionMemory('user-3');

        assert.ok(agent.hasSession(), 'default session should survive');
        assert.ok(agent.hasSession('user-3'), 'user-3 should exist');
        
        agent.shutdown();
    });

    await t.test('cleanupSessions can be called manually', () => {
        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
            sessionConfig: {
                sessionTTL: 0,
                cleanupInterval: 0,
            },
        });

        agent.getSessionMemory('user-1');
        agent.getSessionMemory('user-2');

        // Manual cleanup with no TTL should clean nothing
        const cleaned = agent.cleanupSessions();
        assert.strictEqual(cleaned, 0, 'should clean 0 sessions');
        
        agent.shutdown();
    });

    await t.test('shutdown clears all sessions', () => {
        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
        });

        agent.getSessionMemory('user-1');
        agent.getSessionMemory('user-2');
        agent.getSessionMemory();

        assert.strictEqual(agent.getSessionStats().totalSessions, 3);

        agent.shutdown();

        assert.strictEqual(agent.getSessionStats().totalSessions, 0, 'all sessions should be cleared');
    });

    await t.test('access updates lastAccessTime', async () => {
        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
        });

        agent.getSessionMemory('user-1');
        const stats1 = agent.getSessionStats();
        const initialAccess = stats1.sessions[0].lastAccessTime;

        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, 50));

        // Access again
        agent.getSessionMemory('user-1');
        const stats2 = agent.getSessionStats();
        const newAccess = stats2.sessions[0].lastAccessTime;

        assert.ok(newAccess > initialAccess, 'lastAccessTime should be updated');
        
        agent.shutdown();
    });
});
