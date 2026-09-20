import fs from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';

const OUT = 'dist';

const SOURCES = {
  arte: {
    catalogId: 'arte_documentare_ro',
    catalogName: 'ARTE.tv Documentare — Română',
    feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC7r3wfs9TXuQ5xdkrJYh_Yw',
    sourceName: 'ARTE.tv Documentare',
    languageNote: 'în limba română'
  },
  natgeo: {
    catalogId: 'natgeo_documentare_ro',
    catalogName: 'National Geographic România — Documentare integrale',
    feedUrl: 'https://www.youtube.com/feeds/videos.xml?playlist_id=PL0La8jpoMGUMZq6PCYwHHMh9XVk_640Ix',
    sourceName: 'National Geographic România',
    languageNote: 'cu subtitrare în limba română'
  },
  discovery: {
    catalogId: 'discovery_romania',
    catalogName: 'Discovery România',
    feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCPo3-X59Kr9MP6iaA7BZWow',
    sourceName: 'Discovery România',
    languageNote: 'versiune publicată pentru România',
    exclude: /#shorts|\bshorts?\b/i
  },
  id: {
    catalogId: 'id_crime_romania',
    catalogName: 'ID / Crime — Română',
    feedUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCPo3-X59Kr9MP6iaA7BZWow',
    sourceName: 'Discovery România — selecție ID / Crime',
    languageNote: 'titluri și prezentare în română',
    filter: /(crim|ucis|ucide|omor|asasin|cadav|criminal|poliț|politie|jaf|jefuit|răpit|rapit|dispăr|dispar|anchet|investiga|detectiv|mister|body cam|homicid|cocain|contraband|drog)/i,
    exclude: /#shorts|\bshorts?\b/i
  },
  history: {
    catalogId: 'history_romania',
    catalogName: 'HISTORY România',
    channelPageUrl: 'https://www.youtube.com/@HISTORYRomania',
    sourceName: 'HISTORY România',
    languageNote: 'conținut publicat pentru România',
    exclude: /#shorts|\bshorts?\b/i
  }
};

const manifest = {
  id: 'ro.documentare.oficiale.dan',
  version: '1.1.0',
  name: 'Documentare RO Oficiale',
  description: 'Documentare și emisiuni factuale din surse oficiale: ARTE, National Geographic România, Discovery România, ID/Crime și HISTORY România.',
  resources: ['catalog','meta','stream'],
  types: ['movie'],
  idPrefixes: ['docro:'],
  catalogs: Object.values(SOURCES).map(s => ({
    type: 'movie',
    id: s.catalogId,
    name: s.catalogName
  }))
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false
});

const arr = v => !v ? [] : Array.isArray(v) ? v : [v];
const clean = s => String(s || '')
  .replace(/<br\s*\/?>/gi,'\n')
  .replace(/<[^>]+>/g,'')
  .replace(/&amp;/g,'&')
  .replace(/&quot;/g,'"')
  .replace(/&#39;/g,"'")
  .replace(/&lt;/g,'<')
  .replace(/&gt;/g,'>')
  .replace(/&#13;/g,'')
  .trim();

async function writeJson(rel, obj) {
  const full = path.join(OUT, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, JSON.stringify(obj, null, 2) + '\n');
}

function thumb(media, videoId) {
  const ts = arr(media?.['media:thumbnail']).filter(Boolean);
  ts.sort((a,b) => Number(b?.['@_width']||0)-Number(a?.['@_width']||0));
  return ts[0]?.['@_url'] || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

async function resolveFeedUrl(source) {
  if (source.feedUrl) return source.feedUrl;
  if (!source.channelPageUrl) throw new Error('Nu există feed configurat.');

  const r = await fetch(source.channelPageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.7'
    }
  });
  if (!r.ok) throw new Error(`pagina canalului: HTTP ${r.status}`);
  const html = await r.text();
  const match =
    html.match(/"channelId":"(UC[\w-]+)"/) ||
    html.match(/"externalId":"(UC[\w-]+)"/) ||
    html.match(/youtube\.com\/channel\/(UC[\w-]+)/);

  if (!match) throw new Error('Nu am putut identifica ID-ul canalului YouTube.');
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${match[1]}`;
}

async function fetchSource(key, source) {
  const feedUrl = await resolveFeedUrl(source);
  const r = await fetch(feedUrl, {
    headers: {
      'User-Agent':'DocumentareRO-Stremio/1.1',
      'Accept':'application/atom+xml,application/xml,text/xml,*/*'
    }
  });
  if (!r.ok) throw new Error(`${source.sourceName}: HTTP ${r.status}`);
  const xml = await r.text();
  const parsed = parser.parse(xml);
  const entries = arr(parsed?.feed?.entry);

  return entries.map(e => {
    const videoId = e?.['yt:videoId'];
    if (!videoId) return null;
    const media = e?.['media:group'] || {};
    const title = clean(e?.title || media?.['media:title'] || 'Documentar');
    const description = clean(media?.['media:description'] || e?.summary || '');
    const haystack = `${title}\n${description}`;

    if (source.filter && !source.filter.test(haystack)) return null;
    if (source.exclude && source.exclude.test(haystack)) return null;

    const published = e?.published || e?.updated;
    const id = `docro:${key}:${videoId}`;

    return {
      id,
      type:'movie',
      name:title,
      poster: thumb(media, videoId),
      background: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
      description: `${description}${description ? '\n\n' : ''}Sursă oficială: ${source.sourceName}; ${source.languageNote}.`,
      releaseInfo: published ? String(new Date(published).getFullYear()) : undefined,
      videoId
    };
  }).filter(Boolean);
}

await fs.rm(OUT, { recursive: true, force: true });
await writeJson('manifest.json', manifest);

let total = 0;
const sourceStatus = [];

for (const [key, source] of Object.entries(SOURCES)) {
  try {
    const items = await fetchSource(key, source);
    total += items.length;
    sourceStatus.push({source: source.sourceName, items: items.length, ok: true});

    await writeJson(`catalog/movie/${source.catalogId}.json`, {
      metas: items.map(({videoId, ...x}) => x)
    });

    for (const item of items) {
      const {videoId, ...meta} = item;
      await writeJson(`meta/movie/${encodeURIComponent(item.id)}.json`, {meta});
      await writeJson(`stream/movie/${encodeURIComponent(item.id)}.json`, {
        streams: [{
          ytId: videoId,
          name: 'Documentare RO',
          title: `${source.sourceName} • sursă oficială`
        }]
      });
    }
    console.log(`${source.sourceName}: ${items.length} materiale`);
  } catch (err) {
    console.error(`Eroare la ${source.sourceName}:`, err.message);
    sourceStatus.push({source: source.sourceName, items: 0, ok: false, error: err.message});
    await writeJson(`catalog/movie/${source.catalogId}.json`, {metas:[]});
  }
}

await writeJson('status.json', {
  generatedAt: new Date().toISOString(),
  totalItems: total,
  sources: sourceStatus
});

console.log(`Gata: ${total} materiale.`);
