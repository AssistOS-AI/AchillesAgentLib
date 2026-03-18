/**
 * Comprehensive test suite for schema-validator generated code.
 *
 * Tests derived from specs/index.mjs.md:
 * - Valid data passes validation
 * - Type mismatch detected (string where number expected)
 * - Min constraint on strings
 * - Min constraint on numbers
 * - Multiple errors collected
 * - Empty data with required fields
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

    // ── 1. Valid data passes ────────────────────────────────────────────────
    try {
        const r = await action({
            promptText: [
                'operation: validate',
                'data: {"name":"John","age":25}',
                'schema: {"name":{"type":"string","min":3},"age":{"type":"number","min":18}}',
            ].join('\n'),
        });
        assert(r?.valid === true, 'valid data passes', `got valid=${r?.valid}`);
        assert(
            Array.isArray(r?.errors) && r.errors.length === 0,
            'valid data has empty errors array',
            `got errors=${JSON.stringify(r?.errors)}`,
        );
    } catch (e) {
        assert(false, 'valid data passes', `threw: ${e.message}`);
    }

    // ── 2. Type mismatch: string where number expected ──────────────────────
    try {
        const r = await action({
            promptText: [
                'operation: validate',
                'data: {"user":"John","age":"25"}',
                'schema: {"user":{"type":"string","min":3},"age":{"type":"number","min":18}}',
            ].join('\n'),
        });
        assert(r?.valid === false, 'type mismatch: valid=false', `got valid=${r?.valid}`);
        assert(
            Array.isArray(r?.errors) && r.errors.length > 0,
            'type mismatch: has errors',
            `got errors=${JSON.stringify(r?.errors)}`,
        );
    } catch (e) {
        assert(false, 'type mismatch detected', `threw: ${e.message}`);
    }

    // ── 3. String too short (min constraint) ────────────────────────────────
    try {
        const r = await action({
            promptText: [
                'operation: validate',
                'data: {"name":"Jo"}',
                'schema: {"name":{"type":"string","min":3}}',
            ].join('\n'),
        });
        assert(r?.valid === false, 'string min: valid=false for short string', `got valid=${r?.valid}`);
    } catch (e) {
        assert(false, 'string min constraint', `threw: ${e.message}`);
    }

    // ── 4. Number below min ─────────────────────────────────────────────────
    try {
        const r = await action({
            promptText: [
                'operation: validate',
                'data: {"age":15}',
                'schema: {"age":{"type":"number","min":18}}',
            ].join('\n'),
        });
        assert(r?.valid === false, 'number min: valid=false for value below min', `got valid=${r?.valid}`);
    } catch (e) {
        assert(false, 'number min constraint', `threw: ${e.message}`);
    }

    // ── 5. Number at exact min passes ───────────────────────────────────────
    try {
        const r = await action({
            promptText: [
                'operation: validate',
                'data: {"age":18}',
                'schema: {"age":{"type":"number","min":18}}',
            ].join('\n'),
        });
        assert(r?.valid === true, 'number at min passes', `got valid=${r?.valid}`);
    } catch (e) {
        assert(false, 'number at exact min', `threw: ${e.message}`);
    }

    // ── 6. Multiple errors collected ────────────────────────────────────────
    try {
        const r = await action({
            promptText: [
                'operation: validate',
                'data: {"name":"X","age":"young"}',
                'schema: {"name":{"type":"string","min":3},"age":{"type":"number","min":18}}',
            ].join('\n'),
        });
        assert(r?.valid === false, 'multiple errors: valid=false', `got valid=${r?.valid}`);
        assert(
            Array.isArray(r?.errors) && r.errors.length >= 2,
            'multiple errors: at least 2 errors',
            `got ${r?.errors?.length} errors`,
        );
    } catch (e) {
        assert(false, 'multiple errors collected', `threw: ${e.message}`);
    }

    // ── 7. Boolean type validation ──────────────────────────────────────────
    try {
        const r = await action({
            promptText: [
                'operation: validate',
                'data: {"active":true}',
                'schema: {"active":{"type":"boolean"}}',
            ].join('\n'),
        });
        assert(r?.valid === true, 'boolean type: true passes', `got valid=${r?.valid}`);
    } catch (e) {
        assert(false, 'boolean type validation', `threw: ${e.message}`);
    }

    // ── 8. Missing operation throws ─────────────────────────────────────────
    try {
        await action({ promptText: 'data: {"a":1}\nschema: {"a":{"type":"number"}}' });
        assert(false, 'error: missing operation throws', 'did not throw');
    } catch {
        assert(true, 'error: missing operation throws');
    }

    // ── 9. Missing data throws ──────────────────────────────────────────────
    try {
        await action({ promptText: 'operation: validate\nschema: {"a":{"type":"number"}}' });
        assert(false, 'error: missing data throws', 'did not throw');
    } catch {
        assert(true, 'error: missing data throws');
    }

    // ── 10. Unknown operation throws ────────────────────────────────────────
    try {
        await action({ promptText: 'operation: check\ndata: {}\nschema: {}' });
        assert(false, 'error: unknown operation throws', 'did not throw');
    } catch {
        assert(true, 'error: unknown operation throws');
    }

    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    return { passed, failed, results };
}
