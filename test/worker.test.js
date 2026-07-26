import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQueryUrl, handleRequest, parseAtom } from '../dist/worker.js';

const atom = `<?xml version="1.0"?><feed><entry><id>https://arxiv.org/abs/2607.12345v2</id><title>  A &amp; B\n paper </title><summary> Useful &lt;work&gt; </summary><published>2026-07-25T00:00:00Z</published><author><name>Ada Lovelace</name></author><category term="cs.AI"/></entry></feed>`;

test('builds bounded newest-first API query', () => {
  assert.equal(buildQueryUrl('cat:cs.AI', 2, 8), 'https://export.arxiv.org/api/query?search_query=cat%3Acs.AI&start=2&max_results=8&sortBy=submittedDate&sortOrder=descending');
  assert.throws(() => buildQueryUrl('cat:cs.AI', 0, 51), /limit/);
});

test('parses versioned IDs and decodes Atom text', () => {
  assert.deepEqual(parseAtom(atom), [{
    id: '2607.12345v2', title: 'A & B paper', abstractText: 'Useful <work>', authors: ['Ada Lovelace'],
    publishedAt: '2026-07-25T00:00:00Z', sourceUrl: 'https://arxiv.org/abs/2607.12345v2', sourceType: 'arxiv',
    externalIds: [{ kind: 'arxiv', value: '2607.12345v2' }],
  }]);
});

test('rejects malformed protocol requests without fetching', async () => {
  const response = await handleRequest({ id: 'x', method: 'fetch', params: { query: '', limit: 8 } }, async () => { throw new Error('must not fetch'); });
  assert.deepEqual(response, { id: 'x', ok: false, error: { code: 'INVALID_REQUEST', message: 'params.query must be a non-empty string' } });
});

test('returns a strict correlated fetch response', async () => {
  const response = await handleRequest({ id: 'req-1', method: 'fetch', params: { query: 'cat:cs.AI', cursor: '0', limit: 8 } }, async () => atom);
  assert.equal(response.id, 'req-1');
  assert.equal(response.ok, true);
  if (response.ok) {
    assert.equal(response.result.entries.length, 1);
    assert.equal(response.result.nextCursor, null);
  }
});
