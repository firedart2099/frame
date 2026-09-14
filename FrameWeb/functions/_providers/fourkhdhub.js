// GERADO POR `npm run sync-app` — copia de ../Frame. Nao edite aqui:
// mexa no app e rode o script de novo, senao os dois lados divergem.
/**
 * fourkhdhub.js — Provider 4KHDHub para o Frame.
 * Porte simplificado do MovieBox-Tui (fourkhdhub/client.rs + hubcloud.rs).
 *
 * Cadeia de resolução testada ao vivo:
 *   página do título (hubdrive/hubcloud)
 *   -> hubcloud.ist/drive/:id  (a#download)
 *   -> gamerxyt.com/hubcloud.php?...  (página de mirrors)
 *   -> pixel.hubcloud.cx/?id=...      (302)
 *   -> gamerxyt.com/dl.php?link=<URL REAL googleusercontent>
 *
 * Requer cookie jar (mirror quebra sem cookies de sessão).
 * CommonJS (igual ao moviebox/) — testável via node.
 */

const { URL } = globalThis;

const BASE = 'https://4khdhub.one/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TIMEOUT_MS = 15000;
const MAX_MIRRORS_TO_TRY = 8;   // duração real do usuário importa mais que limite enxuto
const MAX_STREAMS = 4;

// ---------------------------------------------------------------------------
// Cookie jar mínimo (essencial: os mirrors validam sessão)
// ---------------------------------------------------------------------------
function makeJar() {
  const jar = new Map(); // host -> Map(cookie -> value)
  return {
    absorb(resp, url) {
      const setCookies = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [];
      if (!setCookies.length) return;
      let host;
      try { host = new URL(url).host; } catch { return; }
      if (!jar.has(host)) jar.set(host, new Map());
      for (const sc of setCookies) {
        const [pair] = sc.split(';');
        const eq = pair.indexOf('=');
        if (eq > 0) jar.get(host).set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    },
    header(url) {
      let host;
      try { host = new URL(url).host; } catch { return undefined; }
      const m = jar.get(host);
      return m && m.size ? [...m.entries()].map(([k, v]) => `${k}=${v}`).join('; ') : undefined;
    },
  };
}

async function fetchText(url, { jar, referer } = {}) {
  const headers = { 'User-Agent': UA, Accept: 'text/html,*/*' };
  if (referer) headers.Referer = referer;
  if (jar) {
    const c = jar.header(url);
    if (c) headers.Cookie = c;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
    if (jar) jar.absorb(resp, url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} em ${url}`);
    return { text: await resp.text(), finalUrl: resp.url };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------
/** @returns [{ id:urlAbsoluta, title, year|null }] */
async function search(query) {
  const { text } = await fetchText(`${BASE}?s=${encodeURIComponent(query)}`);
  const out = [];
  // cards: <a href="..." class="movie-card" ...> ... h3.movie-card-title + p.movie-card-meta
  const re = /<a\s[^>]*href="([^"]+)"[^>]*class="movie-card"[^>]*>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const href = m[1];
    const after = text.slice(m.index, m.index + 4000);
    const title = (after.match(/movie-card-title"[^>]*>\s*([^<]+?)\s*<\/h3>/) || [])[1];
    const meta = (after.match(/movie-card-meta"[^>]*>\s*([^<]*)</) || [])[1] || '';
    if (!href || !title) continue;
    const id = href.startsWith('http') ? href : new URL(href, BASE).toString();
    out.push({ id, title: title.trim(), year: (meta.match(/\d{4}/) || [null])[0] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Página de detalhes -> "releases" (blocos de download)
// ---------------------------------------------------------------------------
/**
 * Extrai blocos de download da página.
 * @returns [{ title, quality, sizeBytes, languages:string[], mirrors:[{url,kind}] }]
 */
async function getReleases(pageUrl, { season = 0, episode = 0 } = {}) {
  const { text } = await fetchText(pageUrl);
  const blocks = text.split('download-item').slice(1);
  const releases = [];

  for (const block of blocks) {
    // título do bloco (texto antes do primeiro <br> dentro de .font-semibold)
    const titleMatch = block.match(/font-semibold[^>]*>\s*([^<]+?)\s*<br/);
    const rawTitle = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
    if (!rawTitle) continue;

    const qualityMatch = rawTitle.match(/(\d{3,4})p/i);
    const sizeText = (block.match(/background-color: ?#ea580c[^>]*>([\d.,]+)\s*(GB|MB)/i) || [])[0];
    const langsText = (block.match(/background-color: ?#0d9488[^>]*>([^<]+)</) || [])[1] || '';
    const languages = langsText.split(',').map((s) => s.trim()).filter(Boolean);

    const mirrors = [];
    for (const am of block.matchAll(/href="(https?:\/\/(?:hubcloud|hubdrive)\.[^"]+)"[^>]*>/gi)) {
      mirrors.push({ url: am[1], kind: am[1].includes('hubcloud') ? 'hubcloud' : 'hubdrive' });
      if (mirrors.length >= 4) break;
    }
    if (!mirrors.length) continue;

    releases.push({
      title: rawTitle,
      quality: qualityMatch ? Number(qualityMatch[1]) : 0,
      sizeBytes: parseSize(sizeText),
      languages,
      mirrors,
    });
  }

  // Série: filtra blocos pelo episódio pedido (S01E02 / E02 etc.)
  if (season > 0 && episode > 0 && releases.length) {
    const se = new RegExp(`S0*${season}E0*${episode}\\b`, 'i');
    const onlyEp = releases.filter((r) => se.test(r.title));
    if (onlyEp.length) return onlyEp;
    const seasonOnly = new RegExp(`S0*${season}\\b`, 'i');
    const seasonBlocks = releases.filter((r) => seasonOnly.test(r.title) && !/S0*\d+E0*\d+/i.test(r.title));
    if (seasonBlocks.length) return seasonBlocks;
  }
  return releases;
}

function parseSize(sizeText) {
  const m = /([\d.,]+)\s*(GB|MB)/i.exec(sizeText || '');
  if (!m) return null;
  const val = Number(m[1].replace(',', '.'));
  return Math.round(val * (m[2].toUpperCase() === 'GB' ? 1e9 : 1e6));
}

// ---------------------------------------------------------------------------
// Resolução de mirror (hubcloud chain, port de hubcloud.rs)
// ---------------------------------------------------------------------------
function pixeldrainApi(raw) {
  try {
    const u = new URL(raw);
    if (!u.host.includes('pixeldrain.')) return null;
    let id = null;
    if (u.pathname.startsWith('/u/')) id = u.pathname.slice(3).replace(/\/+$/, '');
    else if (u.pathname.startsWith('/api/file/')) id = u.pathname.slice(10).replace(/\/+$/, '');
    if (!id || !/^[\w-]+$/.test(id)) return null;
    return `https://${u.host}/api/file/${id}?download`;
  } catch { return null; }
}

function extractScriptPixeldrains(html) {
  const out = [];
  for (const prefix of ['https://pixeldrain.dev/u/', 'https://pixeldrain.com/u/', 'https://pixeldrain.dev/api/file/', 'https://pixeldrain.com/api/file/']) {
    let rest = html;
    let idx;
    while ((idx = rest.indexOf(prefix)) !== -1) {
      const tail = rest.slice(idx);
      const raw = (tail.match(/^[^"'\\\s<]+/) || [''])[0];
      const api = pixeldrainApi(raw);
      if (api && !out.includes(api)) out.push(api);
      rest = tail.slice(Math.max(1, raw.length));
    }
  }
  return out;
}

/** Resolve um mirror hubcloud/hubdrive para URL direta final. */
async function resolveMirror(mirrorUrl, jar) {
  // hubdrive: acha o hubcloud dentro
  let driveUrl = mirrorUrl;
  if (mirrorUrl.includes('hubdrive.')) {
    const { text } = await fetchText(mirrorUrl, { jar });
    const m = text.match(/href="(https?:\/\/hubcloud\.[^"]*\/drive\/[^"]+)"/);
    if (!m) throw new Error('HubDrive sem mirror HubCloud');
    driveUrl = m[1];
  }

  // página /drive/ -> a#download
  const drive = await fetchText(driveUrl, { jar });
  const m = drive.text.match(/id="download"[^>]*href="(https?:[^"]+)"/) || drive.text.match(/href="(https?:[^"]+)"[^>]*id="download"/);
  if (!m) throw new Error('HubCloud sem a#download');
  const resolverUrl = m[1];

  // página do resolver (gamerxyt) -> candidatos
  const resolver = await fetchText(resolverUrl, { jar, referer: driveUrl });
  const html = resolver.text;

  const candidates = [];
  for (const a of html.matchAll(/<a[^>]+href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const href = a[1];
    const label = a[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!/download|direct|server|file|mp4|mkv/i.test(label + href)) continue;
    candidates.push(pixeldrainApi(href) || href);
  }
  for (const u of extractScriptPixeldrains(html)) candidates.push(u);

  // pixel.hubcloud.cx: segue o 302 para dl.php?link=...
  // Procura primeiro um MP4 (seguro no ExoPlayer); MKV só como última opção.
  let fallbackMkv = null;
  for (const cand of candidates) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let finalUrl = cand;
      if (cand.includes('pixel.')) {
        const headers = { 'User-Agent': UA, Referer: resolverUrl };
        const c = jar.header(cand);
        if (c) headers.Cookie = c;
        const resp = await fetch(cand, { headers, redirect: 'follow', signal: controller.signal });
        jar.absorb(resp, cand);
        finalUrl = resp.url;
        // dl.php?link=<http real>
        if (finalUrl.includes('dl.php?link=')) {
          const link = new URL(finalUrl).searchParams.get('link');
          if (link) finalUrl = link;
        }
        await resp.arrayBuffer().catch(() => {}); // drena/fecha
      }
      clearTimeout(timer);

      const probe = await probeStream(finalUrl, jar);
      if (probe.ok) {
        if (probe.container === 'mp4') {
          return { url: finalUrl, container: 'mp4' };
        }
        if (!fallbackMkv) fallbackMkv = { url: finalUrl, container: probe.container || 'mkv' };
      }
    } catch {
      // tenta próximo candidato
    }
  }
  if (fallbackMkv) return fallbackMkv;
  throw new Error('nenhum candidato playável no mirror');
}

const STUB_MAX_BYTES = 3 * 1024 * 1024;

/** Detecta o container pelos magic bytes (MP4 ftyp / MKV EBML). */
function detectContainer(buf) {
  if (!buf || buf.length < 12) return null;
  // EBML magic (MKV/WebM)
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'mkv';
  // ftyp em bytes 4-7
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'mp4';
  return null;
}

/**
 * Valida o stream de verdade: Range nos primeiros 64KB, content-type de vídeo
 * e magic bytes do container. @returns {ok, container, contentType, totalBytes}
 */
async function probeStream(url, jar) {
  const headers = { 'User-Agent': UA, Range: 'bytes=0-65535', Referer: BASE };
  const c = jar && jar.header(url);
  if (c) headers.Cookie = c;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
    const type = resp.headers.get('content-type') || '';
    const cr = resp.headers.get('content-range');
    const total = cr ? Number(cr.split('/')[1]) : Number(resp.headers.get('content-length'));
    const buf = new Uint8Array(await resp.arrayBuffer().catch(() => new ArrayBuffer(0)));
    const container = detectContainer(buf);
    const ok =
      (resp.ok || resp.status === 206) &&
      (/video|octet-stream/.test(type) || container) &&
      (isNaN(total) || total > STUB_MAX_BYTES);
    return { ok, container, contentType: type, totalBytes: isNaN(total) ? null : total };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

async function validateStream(url, jar) {
  return (await probeStream(url, jar)).ok;
}

// ---------------------------------------------------------------------------
// API de alto nível
// ---------------------------------------------------------------------------
/**
 * Retorna streams playáveis para um título.
 * @returns { streams:[{quality,url,mirror,title,sizeBytes,languages}], selected }
 */
const LANG_WORDS = { pt: 'portuguese', en: 'english', es: 'spanish', fr: 'french', de: 'german', it: 'italian', ja: 'japanese', ko: 'korean', hi: 'hindi' };

async function getStreams({ title, year, type = 'movie', season = 0, episode = 0, qualityPref = 'auto', audioLang = null }) {
  const results = await search(title);
  if (!results.length) return { streams: [], selected: null };

  const target = title.trim().toLowerCase();
  const page =
    results.find((r) => r.title.toLowerCase() === target && (!year || r.year === String(year))) ||
    results.find((r) => r.title.toLowerCase().includes(target)) ||
    results[0];

  const releases = await getReleases(page.id, { season, episode });
    if (!releases.length) return { streams: [], selected: null };

  // Ordenação pensada pra CELULAR: prioriza <=1080p (streaming fluido) e
  // codecs leves (x264 > HEVC > REMUX) — HEVC 10-bit/Remux dá tela preta
  // em vários devices e os arquivos remux passam de 60GB.
  // ExoPlayer não decodifica DTS/TrueHD/ATMOS/FLAC7.1 -> vídeo passa, som morre.
  // AC3/EAC3 (Dolby) também deixam mudo em muitos celulares Android/iOS por falta de licença!
  // Punimos esses releases com força; prioridade máxima vai pra AAC (único universal).
  const audioPenalty = (r) => {
    const t = r.title.toLowerCase();
    if (/dts|truehd|atmos|flac|dts-hd/.test(t)) return 5; // Mudo garantido
    if (/ac3|eac3|ddp|dd\+|dd5\.1|ddp5\.1/.test(t)) return 3; // Provavelmente mudo no expo-video
    if (/aac/.test(t)) return 0; // Toca 100% perfeito
    return 1; // desconhecido: tenta a sorte, melhor que dolby
  };
  const wantLangWord = audioLang && LANG_WORDS[audioLang] ? LANG_WORDS[audioLang] : null;
  const langMatch = (r) =>
    wantLangWord && (r.languages || []).some((l) => l.toLowerCase() === wantLangWord) ? -1 : 0;
  const codecPenalty = (r) => (/REMUX/i.test(r.title) ? 2 : /HEVC|H265/i.test(r.title) ? 1 : 0);
  releases.sort((a, b) => {
    const ra = codecPenalty(a) + (a.quality > 1080 ? 4 : 0) + langMatch(a) + audioPenalty(a);
    const rb = codecPenalty(b) + (b.quality > 1080 ? 4 : 0) + langMatch(b) + audioPenalty(b);
    if (ra !== rb) return ra - rb;
    return (b.quality || 0) - (a.quality || 0);
  });

  const jar = makeJar();
  const streams = [];
  let tried = 0;

  for (const rel of releases) {
    if (streams.length >= 3 || tried >= MAX_MIRRORS_TO_TRY) break;
    for (const mirror of rel.mirrors) {
      if (tried >= MAX_MIRRORS_TO_TRY) break;
      tried++;
      try {
        const resolved = await resolveMirror(mirror.url, jar);
        streams.push({
          provider: 'fourkhdhub',
          quality: rel.quality,
          url: resolved.url,
          container: resolved.container, // 'mp4' | 'mkv' | null
          mirror: mirror.url,
          title: rel.title,
          sizeBytes: rel.sizeBytes,
          languages: rel.languages,
          codec: /HEVC|H265/i.test(rel.title) ? 'hevc' : /AV1/i.test(rel.title) ? 'av1' : 'avc',
          headers: { 'User-Agent': UA, Referer: BASE },
        });
        break; // um mirror bom por release basta
      } catch {
        // espelho falhou: próximo
      }
    }
  }

  // Ordenação final pra player: MP4+AVC primeiro (o que sempre toca),
  // depois o resto por qualidade.
  const safetyRank = (s) => (s.container === 'mp4' ? 0 : 1) + (s.codec === 'avc' ? 0 : 1);
  streams.sort((a, b) => {
    const ra = safetyRank(a), rb = safetyRank(b);
    if (ra !== rb) return ra - rb;
    return b.quality - a.quality;
  });

  let selected = streams[0] || null;
  if (qualityPref && qualityPref !== 'auto' && streams.length) {
    const want = Number(qualityPref);
    selected =
      streams.find((s) => s.quality === want) ||
      streams.filter((s) => s.quality < want).sort((a, b) => b.quality - a.quality)[0] ||
      streams[0];
  } else if (streams.length) {
    // 'auto' no celular: MP4 seguro <=1080p > qualquer <=1080p > primeiro
    selected =
      streams.find((s) => s.quality <= 1080 && s.container === 'mp4' && s.codec === 'avc') ||
      streams.find((s) => s.quality <= 1080 && s.container === 'mp4') ||
      streams.find((s) => s.quality <= 1080) ||
      streams[0];
  }
  return { streams, selected };
}

export { search, getReleases, resolveMirror, getStreams, validateStream, probeStream };
