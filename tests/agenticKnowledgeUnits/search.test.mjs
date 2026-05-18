import test from 'node:test';
import assert from 'node:assert/strict';
import { AKUIndexBuilder } from '../../AgenticKnowledgeUnits/internal/indexing.mjs';
import { AKUSearchIndex, BM25FScorer, ExactMatchScorer } from '../../AgenticKnowledgeUnits/internal/ranking.mjs';
import { AKUTokenizer } from '../../AgenticKnowledgeUnits/internal/tokenizer.mjs';

function makeIndex(records) {
    const tokenizer = new AKUTokenizer();
    const builder = new AKUIndexBuilder({ tokenizer, clock: () => new Date('2026-05-18T00:00:00.000Z') });
    const stats = builder.buildStats(records);
    return {
        tokenizer,
        stats,
        index: new AKUSearchIndex({ tokenizer }).load(records, stats),
    };
}

test('tokenizer creates technical aliases without stemming', () => {
    const tokenizer = new AKUTokenizer();
    const tokens = tokenizer.tokenizeField('HTTPServer parses café-files/foo_bar.baz', 'path');
    assert.ok(tokens.includes('httpserver'));
    assert.ok(tokens.includes('http'));
    assert.ok(tokens.includes('server'));
    assert.ok(tokens.includes('cafe'));
    assert.ok(tokens.includes('foo'));
    assert.ok(tokens.includes('bar'));
    assert.ok(!tokens.includes('the'));
});

test('BM25F combines field evidence before saturation', () => {
    const { tokenizer, stats } = makeIndex([
        {
            search_id: 'a',
            record_type: 'ku',
            ku_id: 'ku_a',
            status: 'active',
            title: 'alpha',
            summary: 'alpha',
            tags: [],
            keywords: [],
            reusable_findings: [],
            type: 'note',
            path: 'a',
            updated_at: '2026-05-18T00:00:00.000Z',
        },
    ]);
    const index = new AKUSearchIndex({ tokenizer }).load([
        {
            search_id: 'combined',
            record_type: 'ku',
            ku_id: 'ku_a',
            status: 'active',
            title: 'alpha',
            summary: 'alpha',
            tags: [],
            keywords: [],
            reusable_findings: [],
            type: 'note',
            path: 'a',
            updated_at: '2026-05-18T00:00:00.000Z',
        },
    ], stats);
    const query = tokenizer.tokenizeQuery('alpha');
    const scorer = new BM25FScorer();
    const record = index.records[0];
    const score = scorer.score(record, query, stats);
    assert.ok(score > 0);
    assert.ok(score < 10, 'combined evidence is saturated once per term');
});

test('search applies phrase handling, filters, bounded exact boosts, and explanations', () => {
    const { index, tokenizer } = makeIndex([
        {
            search_id: 'doc:1',
            record_type: 'document',
            ku_id: 'ku_one',
            ku_type: 'design',
            ku_status: 'active',
            document_type: 'spec',
            status: 'validated',
            title: 'Context Pack Builder',
            summary: 'Greedy MMR selection for quoted phrase matching',
            tags: ['AKU'],
            keywords: ['Context Pack'],
            reusable_findings: ['Quoted phrases are verified across candidate text'],
            type: 'spec',
            path: 'docs/context-pack.md',
            updated_at: '2026-05-18T00:00:00.000Z',
        },
        {
            search_id: 'doc:2',
            record_type: 'document',
            ku_id: 'ku_two',
            ku_type: 'design',
            ku_status: 'discarded',
            document_type: 'spec',
            status: 'active',
            title: 'Discarded Context Pack',
            summary: 'context pack',
            tags: ['AKU'],
            keywords: ['Context Pack'],
            reusable_findings: [],
            type: 'spec',
            path: 'docs/discarded.md',
            updated_at: '2026-05-18T00:00:00.000Z',
        },
    ]);
    const result = index.search(tokenizer.tokenizeQuery({ text: '"quoted phrase"', tags: ['AKU'], keywords: ['Context Pack'] }), {
        explain: true,
        recordType: 'document',
        now: '2026-05-18T00:00:00.000Z',
    });

    assert.equal(result.total, 1);
    assert.equal(result.results[0].search_id, 'doc:1');
    assert.ok(result.results[0].matched_on.some(item => item.startsWith('quoted_phrase:')));
    assert.ok(result.results[0].score_components.exact_bonus <= 0.35);
    assert.equal(result.results[0].score_components.status_modifier, 0.10);
});

test('search accepts documented direct query filter shape', () => {
    const { index, tokenizer } = makeIndex([
        {
            search_id: 'doc:shape',
            record_type: 'document',
            ku_id: 'ku_shape',
            ku_type: 'decision',
            ku_status: 'active',
            document_type: 'spec',
            status: 'active',
            title: 'Direct Query Shape',
            summary: 'caller supplies record_types and ku_types directly',
            tags: ['query-shape'],
            keywords: ['Direct Filter'],
            reusable_findings: [],
            type: 'spec',
            path: 'docs/direct-query.md',
            updated_at: '2026-05-18T00:00:00.000Z',
        },
        {
            search_id: 'result:shape',
            record_type: 'result',
            ku_id: 'ku_shape',
            ku_type: 'experiment',
            ku_status: 'active',
            result_type: 'run',
            status: 'active',
            title: 'Direct Query Shape',
            summary: 'same words but wrong type',
            tags: ['query-shape'],
            keywords: ['Direct Filter'],
            reusable_findings: [],
            type: 'run',
            path: 'results/direct-query.md',
            updated_at: '2026-05-18T00:00:00.000Z',
        },
    ]);

    const result = index.search(tokenizer.tokenizeQuery({
        text: 'Direct Query Shape',
        record_types: ['document'],
        ku_types: ['decision'],
    }), { explain: true });

    assert.equal(result.total, 1);
    assert.equal(result.results[0].search_id, 'doc:shape');
});

test('exact boosts are capped', () => {
    const scorer = new ExactMatchScorer();
    const { index, tokenizer } = makeIndex([
        {
            search_id: 'hit',
            record_type: 'ku',
            ku_id: 'ku_hit',
            status: 'validated',
            title: 'AKU Context Pack',
            summary: 'AKU Context Pack phrase',
            tags: ['AKU'],
            keywords: ['Context Pack'],
            reusable_findings: ['Context Pack phrase'],
            type: 'Context Pack',
            path: 'context-pack/AKU.md',
            updated_at: '2026-05-18T00:00:00.000Z',
        },
    ]);
    const exact = scorer.score(index.records[0], tokenizer.tokenizeQuery({ text: '"Context Pack"', tags: ['AKU'], keywords: ['Context Pack'] }));
    assert.equal(exact.bonus, 0.35);
});
