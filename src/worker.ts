import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

export type Entry = { id: string; title: string; abstractText: string; authors: string[]; publishedAt: string | null; sourceUrl: string; sourceType: 'arxiv'; externalIds: { kind: 'arxiv'; value: string }[] };
type Request = { id: string; method: string; params?: unknown };
type Response = { id: string; ok: true; result: { entries: Entry[]; nextCursor: string | null } } | { id: string; ok: false; error: { code: string; message: string } };

const text = (xml: string, tag: string) => {
  const value = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))?.[1] ?? '';
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
};

export function buildQueryUrl(query: string, start: number, limit: number): string {
  if (!Number.isInteger(start) || start < 0) throw new Error('cursor must be a non-negative integer');
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('limit must be between 1 and 50');
  return `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&start=${start}&max_results=${limit}&sortBy=submittedDate&sortOrder=descending`;
}

export function parseAtom(xml: string): Entry[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].flatMap((match) => {
    const block = match[1];
    const sourceUrl = text(block, 'id');
    const id = sourceUrl.match(/\/abs\/([^?#/]+)/)?.[1];
    if (!id) return [];
    return [{ id, title: text(block, 'title'), abstractText: text(block, 'summary'), authors: [...block.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)].map((author) => text(`<name>${author[1]}</name>`, 'name')), publishedAt: text(block, 'published') || null, sourceUrl, sourceType: 'arxiv' as const, externalIds: [{ kind: 'arxiv' as const, value: id }] }];
  });
}

export async function handleRequest(request: Request, get: (url: string) => Promise<string>): Promise<Response> {
  const fail = (message: string, code = 'INVALID_REQUEST'): Response => ({ id: typeof request?.id === 'string' ? request.id : '', ok: false, error: { code, message } });
  if (!request || typeof request.id !== 'string' || request.id.length === 0) return fail('id must be a non-empty string');
  if (request.method !== 'fetch') return fail('method must be fetch');
  const params = request.params as { query?: unknown; cursor?: unknown; limit?: unknown } | undefined;
  if (!params || typeof params.query !== 'string' || params.query.trim() === '') return fail('params.query must be a non-empty string');
  const cursor = params.cursor === undefined ? 0 : Number(params.cursor);
  const limit = params.limit === undefined ? 50 : Number(params.limit);
  try {
    const entries = parseAtom(await get(buildQueryUrl(params.query, cursor, limit)));
    return { id: request.id, ok: true, result: { entries, nextCursor: entries.length >= limit ? String(cursor + entries.length) : null } };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 'FETCH_FAILED');
  }
}

async function main() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    let response: Response;
    try {
      const request = JSON.parse(line) as Request;
      response = await handleRequest(request, async (url) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        try {
          const result = await fetch(url, { headers: { 'user-agent': 'Yandu/1.0 (feed-arxiv)' }, signal: controller.signal });
          if (!result.ok) throw new Error(`arXiv API returned ${result.status}`);
          const length = Number(result.headers.get('content-length') ?? 0);
          if (length > 16 * 1024 * 1024) throw new Error('arXiv response exceeds 16 MiB');
          return await result.text();
        } finally { clearTimeout(timeout); }
      });
    } catch (error) {
      response = { id: '', ok: false, error: { code: 'INVALID_JSON', message: error instanceof Error ? error.message : String(error) } };
    }
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
