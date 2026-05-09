class ArxivFeedAdapter {
    config;
    id = 'org.arxiv';
    name = 'arXiv';
    availableFormats = [
        { format: 'application/x-tex', priority: 1, fetchRequired: false, extension: 'tex' },
        { format: 'application/pdf', priority: 2, fetchRequired: false, extension: 'pdf' },
        { format: 'text/html', priority: 3, fetchRequired: false, extension: 'html' },
    ];
    configSchema = {
        id: 'adapter.arxiv',
        sections: [
            {
                id: 'general',
                fields: [
                    {
                        key: 'categories',
                        type: 'multiselect',
                        defaultValue: [],
                        validation: { required: true },
                        options: [
                            { value: 'cs.AI', i18nKey: 'adapter.arxiv.categories.cs.AI' },
                            { value: 'cs.CL', i18nKey: 'adapter.arxiv.categories.cs.CL' },
                            { value: 'cs.LG', i18nKey: 'adapter.arxiv.categories.cs.LG' },
                            { value: 'cs.CV', i18nKey: 'adapter.arxiv.categories.cs.CV' },
                            { value: 'cs.RO', i18nKey: 'adapter.arxiv.categories.cs.RO' },
                            { value: 'cs.DB', i18nKey: 'adapter.arxiv.categories.cs.DB' },
                            { value: 'cs.DC', i18nKey: 'adapter.arxiv.categories.cs.DC' },
                            { value: 'cs.DS', i18nKey: 'adapter.arxiv.categories.cs.DS' },
                            { value: 'cs.GT', i18nKey: 'adapter.arxiv.categories.cs.GT' },
                            { value: 'cs.HC', i18nKey: 'adapter.arxiv.categories.cs.HC' },
                            { value: 'cs.IR', i18nKey: 'adapter.arxiv.categories.cs.IR' },
                            { value: 'cs.IT', i18nKey: 'adapter.arxiv.categories.cs.IT' },
                            { value: 'cs.MA', i18nKey: 'adapter.arxiv.categories.cs.MA' },
                            { value: 'cs.MM', i18nKey: 'adapter.arxiv.categories.cs.MM' },
                            { value: 'cs.NE', i18nKey: 'adapter.arxiv.categories.cs.NE' },
                            { value: 'cs.NI', i18nKey: 'adapter.arxiv.categories.cs.NI' },
                            { value: 'cs.OS', i18nKey: 'adapter.arxiv.categories.cs.OS' },
                            { value: 'cs.PF', i18nKey: 'adapter.arxiv.categories.cs.PF' },
                            { value: 'cs.PL', i18nKey: 'adapter.arxiv.categories.cs.PL' },
                            { value: 'cs.SC', i18nKey: 'adapter.arxiv.categories.cs.SC' },
                            { value: 'cs.SD', i18nKey: 'adapter.arxiv.categories.cs.SD' },
                            { value: 'cs.SE', i18nKey: 'adapter.arxiv.categories.cs.SE' },
                            { value: 'cs.SY', i18nKey: 'adapter.arxiv.categories.cs.SY' },
                            { value: 'physics.optics', i18nKey: 'adapter.arxiv.categories.physics.optics' },
                            { value: 'physics.chem-ph', i18nKey: 'adapter.arxiv.categories.physics.chem-ph' },
                            { value: 'physics.comp-ph', i18nKey: 'adapter.arxiv.categories.physics.comp-ph' },
                            { value: 'q-bio.BM', i18nKey: 'adapter.arxiv.categories.q-bio.BM' },
                            { value: 'q-bio.GN', i18nKey: 'adapter.arxiv.categories.q-bio.GN' },
                            { value: 'q-bio.MN', i18nKey: 'adapter.arxiv.categories.q-bio.MN' },
                            { value: 'math.NA', i18nKey: 'adapter.arxiv.categories.math.NA' },
                            { value: 'math.CO', i18nKey: 'adapter.arxiv.categories.math.CO' },
                            { value: 'math.ST', i18nKey: 'adapter.arxiv.categories.math.ST' },
                            { value: 'stat.ML', i18nKey: 'adapter.arxiv.categories.stat.ML' },
                            { value: 'stat.TH', i18nKey: 'adapter.arxiv.categories.stat.TH' },
                            { value: 'stat.ME', i18nKey: 'adapter.arxiv.categories.stat.ME' },
                        ],
                    },
                    {
                        key: 'searchQuery',
                        type: 'text',
                        defaultValue: '',
                    },
                    {
                        key: 'since',
                        type: 'date',
                        defaultValue: '',
                        validation: { required: false },
                    },
                ],
            },
        ],
    };
    constructor(config) {
        this.config = config;
    }
    async fetch(options) {
        const { categories, searchQuery } = options.config;
        const limit = options.limit ?? (this.config.get('feeds.adapters.arxiv.limit') ?? 50);
        const start = parseInt(options.cursor ?? '0', 10);
        let query = categories.map(c => `cat:${c}`).join(' OR ');
        if (searchQuery) {
            query = `(${query}) AND (${searchQuery})`;
        }
        const url = `https://export.arxiv.org/api/query?` +
            `search_query=${encodeURIComponent(query)}` +
            `&start=${start}` +
            `&max_results=${limit}` +
            `&sortBy=submittedDate&sortOrder=descending`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Yandu/1.0' },
        });
        if (!response.ok) {
            throw new Error(`arXiv API error: ${response.status} ${response.statusText}`);
        }
        const xml = await response.text();
        const entries = this.parseAtom(xml);
        return {
            entries,
            nextCursor: String(start + entries.length),
            hasMore: entries.length >= limit,
        };
    }
    resolveDownload(externalIds) {
        const arxivId = externalIds.arxiv;
        if (!arxivId) {
            return null;
        }
        return {
            url: `https://arxiv.org/pdf/${arxivId}.pdf`,
            format: 'application/pdf',
            priority: 1,
        };
    }
    async fetchFormat(entryId, format) {
        const urls = {
            'application/x-tex': `https://arxiv.org/e-print/${entryId}`,
            'application/pdf': `https://arxiv.org/pdf/${entryId}.pdf`,
            'text/html': `https://arxiv.org/abs/${entryId}`,
        };
        const url = urls[format];
        if (!url) {
            throw new Error(`Unsupported format: ${format}`);
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await fetch(url, {
                headers: { 'User-Agent': 'Yandu/1.0' },
                signal: controller.signal,
            });
            const data = await response.arrayBuffer();
            return new Blob([data], { type: format });
        }
        finally {
            clearTimeout(timeout);
        }
    }
    parseAtom(xml) {
        const entries = [];
        const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
        let match;
        while ((match = entryRegex.exec(xml)) !== null) {
            const entryXml = match[1];
            const idMatch = entryXml.match(/<id>([^<]+)<\/id>/);
            const titleMatch = entryXml.match(/<title>([\s\S]*?)<\/title>/);
            const summaryMatch = entryXml.match(/<summary>([\s\S]*?)<\/summary>/);
            const publishedMatch = entryXml.match(/<published>([^<]+)<\/published>/);
            const updatedMatch = entryXml.match(/<updated>([^<]+)<\/updated>/);
            const arxivUrl = idMatch?.[1] || '';
            const arxivIdMatch = arxivUrl.match(/(\d+\.\d+)/);
            const arxivId = arxivIdMatch?.[1];
            if (!arxivId)
                continue;
            const authors = [];
            const authorRegex = /<author>\s*<name>([^<]+)<\/name>\s*<\/author>/g;
            let authorMatch;
            while ((authorMatch = authorRegex.exec(entryXml)) !== null) {
                authors.push(authorMatch[1].trim());
            }
            const categories = [];
            const categoryRegex = /<category\s+term="([^"]+)"/g;
            let categoryMatch;
            while ((categoryMatch = categoryRegex.exec(entryXml)) !== null) {
                categories.push(categoryMatch[1]);
            }
            const pdfLinkMatch = entryXml.match(/<link\s+title="pdf"\s+href="([^"]+)"/);
            const title = titleMatch?.[1]?.trim()
                .replace(/\s+/g, ' ')
                .replace(/\n/g, '') || 'Untitled';
            const summary = summaryMatch?.[1]?.trim() || '';
            const published = publishedMatch?.[1] || updatedMatch?.[1];
            entries.push({
                id: arxivId,
                externalIds: { arxiv: arxivId },
                title,
                abstract: summary,
                authors,
                publishedAt: published ? new Date(published) : new Date(),
                availableFormats: ['application/x-tex', 'application/pdf', 'text/html'],
                sourceUrl: pdfLinkMatch?.[1] || `https://arxiv.org/abs/${arxivId}`,
                metadata: {
                    categories,
                    primaryCategory: categories[0],
                },
            });
        }
        return entries;
    }
}
export default {
    name: '@yandu/plugin-feed-arxiv',
    version: '1.0.0',
    register(system) {
        const adapter = new ArxivFeedAdapter(system.config);
        system.capabilities.register({ type: 'feed', id: adapter.id, name: adapter.name }, adapter);
    },
};
