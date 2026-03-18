/**
 * Comprehensive test suite for hash-util generated code.
 *
 * Tests derived from specs/index.mjs.md:
 * - SHA-256 hashing with explicit salt
 * - SHA-256 hashing with auto-generated salt
 * - Verify matching hash returns valid: true
 * - Verify wrong data returns valid: false
 * - Verify wrong salt returns valid: false
 * - Deterministic: same data + salt = same hash
 * - Missing required params throw errors
 * - Unknown operation throws error
 *
 * @param {Function} action - The generated action function
 * @returns {Promise<{ passed: number, failed: number, results: Array }>}
 */
export async function runTests(action) {
    const results = [];

    function assert(condition, name, detail) {
        results.push({ name, pass: !!condition, detail: condition ? null : detail });
    }

    // ── 1. Hash with explicit salt ──────────────────────────────────────────
    let hashResult;
    try {
        hashResult = await action({
            promptText: 'operation: hash\ndata: password123\nsalt: testSalt123',
        });
        assert(
            typeof hashResult?.hash === 'string' && hashResult.hash.length > 0,
            'hash: returns hash string',
            `got hash=${JSON.stringify(hashResult?.hash)}`,
        );
        assert(
            hashResult?.salt === 'testSalt123',
            'hash: returns provided salt',
            `got salt=${JSON.stringify(hashResult?.salt)}`,
        );
    } catch (e) {
        assert(false, 'hash: with explicit salt', `threw: ${e.message}`);
    }

    // ── 2. Hash with auto-generated salt ────────────────────────────────────
    let autoSaltResult;
    try {
        autoSaltResult = await action({
            promptText: 'operation: hash\ndata: password123',
        });
        assert(
            typeof autoSaltResult?.hash === 'string' && autoSaltResult.hash.length > 0,
            'hash: auto-salt returns hash',
            `got hash=${JSON.stringify(autoSaltResult?.hash)}`,
        );
        assert(
            typeof autoSaltResult?.salt === 'string' && autoSaltResult.salt.length > 0,
            'hash: auto-salt generates salt',
            `got salt=${JSON.stringify(autoSaltResult?.salt)}`,
        );
    } catch (e) {
        assert(false, 'hash: auto-generated salt', `threw: ${e.message}`);
    }

    // ── 3. Verify correct data ──────────────────────────────────────────────
    if (hashResult?.hash && hashResult?.salt) {
        try {
            const verifyOk = await action({
                promptText: `operation: verify\ndata: password123\nhash: ${hashResult.hash}\nsalt: ${hashResult.salt}`,
            });
            assert(
                verifyOk?.valid === true,
                'verify: correct data returns valid=true',
                `got valid=${verifyOk?.valid}`,
            );
        } catch (e) {
            assert(false, 'verify: correct data', `threw: ${e.message}`);
        }
    }

    // ── 4. Verify wrong data ────────────────────────────────────────────────
    if (hashResult?.hash && hashResult?.salt) {
        try {
            const verifyBad = await action({
                promptText: `operation: verify\ndata: wrongPassword\nhash: ${hashResult.hash}\nsalt: ${hashResult.salt}`,
            });
            assert(
                verifyBad?.valid === false,
                'verify: wrong data returns valid=false',
                `got valid=${verifyBad?.valid}`,
            );
        } catch (e) {
            assert(false, 'verify: wrong data', `threw: ${e.message}`);
        }
    }

    // ── 5. Verify wrong salt ────────────────────────────────────────────────
    if (hashResult?.hash) {
        try {
            const verifyBadSalt = await action({
                promptText: `operation: verify\ndata: password123\nhash: ${hashResult.hash}\nsalt: wrongSalt`,
            });
            assert(
                verifyBadSalt?.valid === false,
                'verify: wrong salt returns valid=false',
                `got valid=${verifyBadSalt?.valid}`,
            );
        } catch (e) {
            assert(false, 'verify: wrong salt', `threw: ${e.message}`);
        }
    }

    // ── 6. Deterministic hashing ────────────────────────────────────────────
    try {
        const h1 = await action({ promptText: 'operation: hash\ndata: abc\nsalt: fixed' });
        const h2 = await action({ promptText: 'operation: hash\ndata: abc\nsalt: fixed' });
        assert(
            h1?.hash === h2?.hash,
            'hash: deterministic (same input = same output)',
            `h1=${h1?.hash}, h2=${h2?.hash}`,
        );
    } catch (e) {
        assert(false, 'hash: deterministic', `threw: ${e.message}`);
    }

    // ── 7. Different data produces different hash ───────────────────────────
    try {
        const ha = await action({ promptText: 'operation: hash\ndata: alpha\nsalt: s1' });
        const hb = await action({ promptText: 'operation: hash\ndata: beta\nsalt: s1' });
        assert(
            ha?.hash !== hb?.hash,
            'hash: different data = different hash',
            `both=${ha?.hash}`,
        );
    } catch (e) {
        assert(false, 'hash: different data', `threw: ${e.message}`);
    }

    // ── 8. Missing operation throws ─────────────────────────────────────────
    try {
        await action({ promptText: 'data: test' });
        assert(false, 'error: missing operation throws', 'did not throw');
    } catch {
        assert(true, 'error: missing operation throws');
    }

    // ── 9. Missing data for hash throws ─────────────────────────────────────
    try {
        await action({ promptText: 'operation: hash' });
        assert(false, 'error: missing data throws', 'did not throw');
    } catch {
        assert(true, 'error: missing data throws');
    }

    // ── 10. Unknown operation throws ────────────────────────────────────────
    try {
        await action({ promptText: 'operation: encrypt\ndata: test' });
        assert(false, 'error: unknown operation throws', 'did not throw');
    } catch {
        assert(true, 'error: unknown operation throws');
    }

    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    return { passed, failed, results };
}
