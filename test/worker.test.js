import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { buildQueryUrl, handleRequest, parseAtom, readResponseBody } from '../dist/worker.js';

const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>https://arxiv.org/abs/2607.12345v2</id><title>A &amp; B paper</title><summary>Useful work</summary><published>2026-07-25T00:00:00Z</published><author><name>Ada Lovelace</name></author><link title="pdf" href="https://arxiv.org/pdf/2607.12345v2.pdf"/></entry></feed>`;

test('builds bounded newest-first API query', () => {
  assert.equal(buildQueryUrl('cat:cs.AI', 2, 8), 'https://export.arxiv.org/api/query?search_query=cat%3Acs.AI&start=2&max_results=8&sortBy=submittedDate&sortOrder=descending');
  assert.throws(() => buildQueryUrl('cat:cs.AI', 0, 51), /limit/);
});

test('parses official modern and legacy identifiers and exact PDF URLs', () => {
  assert.equal(parseAtom(atom)[0].pdfUrl, 'https://arxiv.org/pdf/2607.12345v2.pdf');
  const legacy = atom.replaceAll('2607.12345v2', 'hep-th/9901001v3');
  assert.equal(parseAtom(legacy)[0].id, 'hep-th/9901001v3');
});

test('normalizes an official legacy HTTP Atom id to an HTTPS source URL', () => {
  const legacyHttpId = atom.replace('https://arxiv.org/abs/', 'http://arxiv.org/abs/');
  assert.equal(parseAtom(legacyHttpId)[0].sourceUrl, 'https://arxiv.org/abs/2607.12345v2');
});

test('accepts standard direct Atom entry updated and category fields', () => {
  const withUpdatedAndCategory = atom.replace('</published>', '</published><updated>2026-07-26T00:00:00Z</updated><category term="cs.AI"/>');
  assert.equal(parseAtom(withUpdatedAndCategory).length, 1);
});

test('rejects malformed XML, namespaces, CDATA, DTD, entities, and forged URLs', () => {
  for (const xml of [
    atom.replace('</entry>', ''), atom.replace('<entry>', '<evil:entry>'),
    atom.replace('A &amp; B paper', '<![CDATA[A]]>'),
    `<!DOCTYPE feed [<!ENTITY x SYSTEM "file:///etc/passwd">]>${atom}`,
    atom.replace('A &amp; B paper', '&unknown;'),
    atom.replace('https://arxiv.org/abs/', 'https://evil.test/abs/'),
    atom.replace('https://arxiv.org/pdf/', 'https://evil.test/pdf/'),
  ]) assert.throws(() => parseAtom(xml));
});

test('rejects unexpected Atom duplicates and placements', () => {
  for (const xml of [
    atom.replace('</entry>', '<title>duplicate</title></entry>'),
    atom.replace('<entry>', '<entry><entry>'),
    atom.replace('<author><name>', '<author><name>First</name><name>'),
    atom.replace('<author><name>Ada Lovelace</name></author>', '<name>Ada Lovelace</name>'),
    atom.replace('<title>A &amp; B paper</title>', '<author><title>A &amp; B paper</title><name>Ada</name></author>'),
    atom.replace('<published>', '<author><published>').replace('</published>', '</published></author>'),
    atom.replace('<link title="pdf"', '<author><link title="pdf"').replace('/></entry>', '/></author></entry>'),
    atom.replace('<summary>', '<feed><summary>').replace('</summary>', '</summary></feed>'),
  ]) assert.throws(() => parseAtom(xml));
});

test('accepts arXiv extension fields only as direct entry children', () => {
  const extended = atom.replace('<published>', '<arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.AI"/><arxiv:comment xmlns:arxiv="http://arxiv.org/schemas/atom">note</arxiv:comment><published>');
  assert.equal(parseAtom(extended).length, 1);
  assert.throws(() => parseAtom(extended.replace('<arxiv:comment', '<author><arxiv:comment').replace('</arxiv:comment>', '</arxiv:comment></author>')));
  assert.throws(() => parseAtom(atom.replace('<title>A &amp; B paper</title>', '<x:title xmlns:x="http://arxiv.org/schemas/atom">ignored</x:title><title>A &amp; B paper</title>')));
});

test('strict request schema rejects coercion and unknown fields', async () => {
  const get = async () => { throw new Error('must not fetch'); };
  for (const request of [
    { id: 'x', method: 'fetch', params: { query: 'x', cursor: '0', limit: '8' } },
    { id: 'x', method: 'fetch', params: { query: 'x', cursor: 0, limit: 8, extra: true } },
    { id: 'x', method: 'fetch', params: { query: 'x', cursor: -1, limit: 8 } },
    { id: 'x', method: 'fetch', params: { query: 'x', cursor: 0, limit: 8 }, extra: true },
  ]) assert.equal((await handleRequest(request, get)).ok, false);
});

test('returns a consistent correlated result', async () => {
  const response = await handleRequest({ id: 'req-1', method: 'fetch', params: { query: 'cat:cs.AI', cursor: 0, limit: 8 } }, async () => atom);
  assert.deepEqual(response, { id: 'req-1', ok: true, result: { entries: parseAtom(atom), nextCursor: null } });
});

test('streams with a live 16 MiB cap regardless of content-length', async () => {
  const body = Readable.toWeb(Readable.from([Buffer.alloc(9 * 1024 * 1024), Buffer.alloc(8 * 1024 * 1024)]));
  await assert.rejects(readResponseBody(body), /16 MiB/);
});
