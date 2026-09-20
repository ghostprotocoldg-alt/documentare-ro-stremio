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
  }
};

const manifest = {
  id: 'ro.documentare.oficiale.dan',
  version: '1.0.0',
  name: 'Documentare RO Oficiale',
  description: 'Documentare gratuite din surse oficiale, în română sau subtitrate în română.',
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

async function fetchSource(key, source) {
  const r = await fetch(source.feedUrl, {
    headers: {'User-Agent':'DocumentareRO-Stremio/1.0','Accept':'application/atom+xml,application/xml,text/xml,*/*'}
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
    const published = e?.published || e?.updated;
    const id = `docro:${key}:${videoId}`;
    return {
      id, type:'movie', name:title,
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
for (const [key, source] of Object.entries(SOURCES)) {
  try {
    const items = await fetchSource(key, source);
    total += items.length;
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
          title: `${source.sourceName} • oficial`
        }]
      });
    }
    console.log(`${source.sourceName}: ${items.length} materiale`);
  } catch (err) {
    console.error(`Eroare la ${source.sourceName}:`, err.message);
    await writeJson(`catalog/movie/${source.catalogId}.json`, {metas:[]});
  }
}

await writeJson('status.json', {
  generatedAt: new Date().toISOString(),
  totalItems: total,
  sources: Object.values(SOURCES).map(s => s.sourceName)
});
console.log(`Gata: ${total} materiale.`);
