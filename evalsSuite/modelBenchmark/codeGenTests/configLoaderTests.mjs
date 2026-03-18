/**
 * Comprehensive test suite for config-loader generated code.
 *
 * Tests derived from specs/index.mjs.md:
 * - String type passthrough
 * - Number type conversion ("5432" → 5432)
 * - Boolean type conversion ("true" → true, "false" → false)
 * - JSON type parsing
 * - Invalid number (NaN) reported as error
 * - Missing source key reported as error
 * - Success flag reflects error state
 * - Multiple type conversions in one call
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

    // ── 1. Basic type conversions ───────────────────────────────────────────
    try {
        const r = await action({
            promptText: [
                'operation: load',
                'source: {"DB_HOST":"localhost","DB_PORT":"5432","DEBUG":"true"}',
                'schema: {"DB_HOST":"string","DB_PORT":"number","DEBUG":"boolean"}',
            ].join('\n'),
        });
        assert(r?.config?.DB_HOST === 'localhost', 'string passthrough', `got ${r?.config?.DB_HOST}`);
        assert(r?.config?.DB_PORT === 5432, 'number conversion "5432"→5432', `got ${r?.config?.DB_PORT}`);
        assert(r?.config?.DEBUG === true, 'boolean conversion "true"→true', `got ${r?.config?.DEBUG}`);
        assert(r?.success === true, 'success=true when no errors', `got ${r?.success}`);
        assert(
            Array.isArray(r?.errors) && r.errors.length === 0,
            'empty errors array on success',
            `got ${JSON.stringify(r?.errors)}`,
        );
    } catch (e) {
        assert(false, 'basic type conversions', `threw: ${e.message}`);
    }

    // ── 2. Boolean "false" conversion ───────────────────────────────────────
    try {
        const r = await action({
            promptText: [
                'operation: load',
                'source: {"VERBOSE":"false"}',
                'schema: {"VERBOSE":"boolean"}',
            ].join('\n'),
        });
        assert(r?.config?.VERBOSE === false, 'boolean "false"→false', `got ${r?.config?.VERBOSE}`);
    } catch (e) {
        assert(false, 'boolean false conversion', `threw: ${e.message}`);
    }

    // ── 3. Number zero conversion ───────────────────────────────────────────
    try {
        const r = await action({
            promptText: [
                'operation: load',
                'source: {"PORT":"0"}',
                'schema: {"PORT":"number"}',
            ].join('\n'),
        });
        assert(r?.config?.PORT === 0, 'number "0"→0', `got ${r?.config?.PORT}`);
    } catch (e) {
        assert(false, 'number zero conversion', `threw: ${e.message}`);
    }

    // ── 4. Invalid number (NaN) ─────────────────────────────────────────────
    try {
        const r = await action({
            promptText: [
                'operation: load',
                'source: {"PORT":"not_a_number"}',
                'schema: {"PORT":"number"}',
            ].join('\n'),
        });
        assert(r?.success === false, 'NaN: success=false', `got ${r?.success}`);
        assert(
            Array.isArray(r?.errors) && r.errors.length > 0,
            'NaN: has errors',
            `got errors=${JSON.stringify(r?.errors)}`,
        );
    } catch (e) {
        assert(false, 'invalid number detection', `threw: ${e.message}`);
    }

    // ── 5. Missing source key ───────────────────────────────────────────────
    try {
        const r = await action({
            promptText: [
                'operation: load',
                'source: {}',
                'schema: {"REQUIRED_KEY":"string"}',
            ].join('\n'),
        });
        assert(r?.success === false, 'missing key: success=false', `got ${r?.success}`);
        assert(
            Array.isArray(r?.errors) && r.errors.length > 0,
            'missing key: has errors',
            `got errors=${JSON.stringify(r?.errors)}`,
        );
    } catch (e) {
        assert(false, 'missing source key', `threw: ${e.message}`);
    }

    // ── 6. JSON type parsing ────────────────────────────────────────────────
    try {
        const r = await action({
            promptText: [
                'operation: load',
                'source: {"FEATURES":"{\\"cache\\":true,\\"logging\\":false}"}',
                'schema: {"FEATURES":"json"}',
            ].join('\n'),
        });
        assert(
            r?.config?.FEATURES?.cache === true && r?.config?.FEATURES?.logging === false,
            'json type parsing',
            `got ${JSON.stringify(r?.config?.FEATURES)}`,
        );
    } catch (e) {
        assert(false, 'json type parsing', `threw: ${e.message}`);
    }

    // ── 7. Mixed valid and invalid keys ─────────────────────────────────────
    try {
        const r = await action({
            promptText: [
                'operation: load',
                'source: {"GOOD":"hello","BAD":"not_a_number"}',
                'schema: {"GOOD":"string","BAD":"number"}',
            ].join('\n'),
        });
        assert(r?.config?.GOOD === 'hello', 'mixed: valid key converted', `got ${r?.config?.GOOD}`);
        assert(r?.success === false, 'mixed: success=false', `got ${r?.success}`);
    } catch (e) {
        assert(false, 'mixed valid/invalid keys', `threw: ${e.message}`);
    }

    // ── 8. Missing operation throws ─────────────────────────────────────────
    try {
        await action({ promptText: 'source: {}\nschema: {}' });
        assert(false, 'error: missing operation throws', 'did not throw');
    } catch {
        assert(true, 'error: missing operation throws');
    }

    // ── 9. Missing source throws ────────────────────────────────────────────
    try {
        await action({ promptText: 'operation: load\nschema: {"A":"string"}' });
        assert(false, 'error: missing source throws', 'did not throw');
    } catch {
        assert(true, 'error: missing source throws');
    }

    // ── 10. Unknown operation throws ────────────────────────────────────────
    try {
        await action({ promptText: 'operation: save\nsource: {}\nschema: {}' });
        assert(false, 'error: unknown operation throws', 'did not throw');
    } catch {
        assert(true, 'error: unknown operation throws');
    }

    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    return { passed, failed, results };
}
