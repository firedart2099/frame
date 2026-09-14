// GERADO POR `npm run sync-app` — copia de ../Frame. Nao edite aqui:
// mexa no app e rode o script de novo, senao os dois lados divergem.
/**
 * stremio.js — Provider de streams via addons Stremio (Torrentio + AllDebrid).
 *
 * Com a API key do AllDebrid configurada, o Torrentio devolve URLs HTTP
 * diretas (debrid) prontas pro expo-video — sem P2P, sem magnet.
 *
 * Formato Stremio:
 *   GET {base}/stream/{movie|series}/{imdbId}.json
 *   GET {base}/stream/series/{imdbId}:{season}:{episode}.json
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Frame/1.0';
const TIMEOUT_MS = 15000;

// Palavras que identificam áudio/conteúdo PT-BR em títulos de release
// Sem as bandeiras do Torrentio: ele poe 🇧🇷 tambem por LEGENDA ([POR-BR] do Erai-raws)
const PT_HINTS = ['dublado', 'dublagem', 'pt-br', 'ptbr', 'portugu', 'nacional', 'áudio pt', 'audio pt', 'brazil'];
// "Dual Audio" so quer dizer "duas linguas". Nos sites BR e pt + original;
// em anime (fansub entre colchetes no comeco) e japones + ingles, e em
// release indiano e hindi + ingles. Ate 12/09/2026 tudo isso virava "pt", e
// a TV recebia ingles quando a pessoa pediu portugues.
const DUAL_ESTRANGEIRO = /^\s*\[[^\]]+\]|hindi|\bjpn?\b|japanese|\beng\b|english|\blat\b|latino|castellano|\bita\b|\bvf\b|vostfr|multi/i;

export function releaseHasPt(text) {
  const t = String(text || '').toLowerCase();
  if (PT_HINTS.some((h) => t.includes(h))) return true;
  return /\bdual\b/.test(t) && !DUAL_ESTRANGEIRO.test(String(text || ''));
}

function parseQuality(text) {
  const m = /(\d{3,4})p/i.exec(text || '');
  return m ? Number(m[1]) : 0;
}

function parseSize(text) {
  const m = /([\d.,]+)\s*(GB|GiB|MB|MiB)/i.exec(text || '');
  if (!m) return null;
  const val = Number(m[1].replace(',', '.'));
  const mult = /g/i.test(m[2]) ? 1e9 : 1e6;
  return Math.round(val * mult);
}

function codecOf(text) {
  const t = String(text || '').toLowerCase();
  if (/hevc|x265|h265/.test(t)) return 'hevc';
  if (/av1/.test(t)) return 'av1';
  return 'avc';
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: controller.signal });
    if (!resp.ok) throw new Error(`Stremio HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Busca streams num addon Stremio.
 * @param addonBase ex.: 'https://torrentio.strem.fun' ou 'https://torrentio.strem.fun/alldebrid=KEY'
 */
async function getAddonStreams(addonBase, { imdbId, type = 'movie', season = 0, episode = 0 }) {
  const idPart = type === 'tv' || type === 'series'
    ? `${imdbId}:${season}:${episode}`
    : imdbId;
  const typePart = type === 'tv' ? 'series' : 'movie';
  const data = await fetchJson(`${addonBase.replace(/\/+$/, '')}/stream/${typePart}/${idPart}.json`);
  return Array.isArray(data?.streams) ? data.streams : [];
}

/**
 * Pipeline completo: retorna streams prontos pro NativePlayer.
 * Só mantém streams com URL HTTP direta (debrid) — magnet/infoHash são ignorados.
 *
 * Ordenação: PT-BR primeiro (quando audioLang=pt), depois qualidade/codec.
 */
export async function getDebridStreams({
  imdbId,
  type = 'movie',
  season = 0,
  episode = 0,
  audioLang = null,
  qualityPref = 'auto',
  alldebridKey = null,
}) {
  if (!imdbId) return { streams: [], selected: null };

  // NAO adicione a config `/brazuca` como "fonte extra de dublado". Medido em
  // 09/09/2026 com o Interstellar: `/brazuca` e `language=portuguese` devolvem
  // exatamente os MESMOS 178 streams da config padrao (conjunto de titulos
  // identico). O Torrentio ignora token de config que nao conhece — e so uma
  // requisicao a mais. Se for testar de novo, compare os CONJUNTOS de
  // resultado; ver que responde 200 com streams nao prova nada.
  const addon = alldebridKey
    ? `https://torrentio.strem.fun/alldebrid=${alldebridKey}`
    : 'https://torrentio.strem.fun';

  const raw = await getAddonStreams(addon, { imdbId, type, season, episode });

  const streams = raw
    .filter((s) => s.url && /^https:\/\//.test(s.url) && !/download/i.test(s.name || '')) // sem URL ou nǜo cacheado = descarta
    // O proprio Torrentio devolve um MP4 de erro quando a chave do debrid nao
    // presta ("AD error"). Ele passa no teste de https e viraria um "stream".
    .filter((s) => !/failed_access|torrentio\.strem\.fun\/videos\//i.test(s.url))
    .map((s) => {
      const text = `${s.name || ''} ${s.title || ''}`;
      const pt = releaseHasPt(text);
      return {
        provider: 'torrentio',
        url: s.url,
        title: (s.title || '').split('\n')[0].slice(0, 90),
        name: (s.name || '').replace(/⚙️.*/, '').trim(),
        quality: parseQuality(text),
        sizeBytes: parseSize(text),
        codec: codecOf(text),
        hasPt: pt,
        languages: pt ? ['Português'] : [],
        lang: { code: pt ? 'pt' : 'original', label: pt ? 'Português (BR)' : 'Original' },
        headers: { 'User-Agent': UA },
      };
    })
    .filter((s) => s.url);

  // Ordena: PT (se preferido) > áudio suportado (sem DTS/TrueHD no topo) > codec leve
  const audioPenalty = (s) => {
    const t = `${s.title || ''} ${s.name || ''}`.toLowerCase();
    // AAC ou 2.0 são perfeitos pro celular (nunca ficam mudos)
    if (/aac|2\.0|stereo/.test(t)) return 0;
    // Formatos pesados multicanal que ficam mudos no Android nativo (DTS, TrueHD, EAC3, AC3, DDP)
    if (/dts|truehd|atmos|flac|eac3|ddp|ac3|dd5\.1|5\.1|7\.1/.test(t)) return 10;
    return 2;
  };
    const foreignDubPenalty = (s) => {
      const t = (s.title || '').toLowerCase();
      // Joga os torrents dublados de outros países para o final do poço (se o cara pediu PT ou Original, não quer Francês)
      if (/\b(multi\.?french|truefrench|vff|vfi|vfq|french|italian|german|hindi|spanish|castellano|russian|telugu|tamil|korean|jap|ita|ger|rus|spa|fre|hin)\b/.test(t)) {
        return 50; 
      }
      // Bônus: afundar os de cinema gravado na tela
      if (/\b(cam|camrip|ts|telesync|hdts|hc|hdcam)\b/.test(t)) {
        return 40; 
      }
      return 0;
    };

    const rank = (s) => {
      let r = 0;
      if (audioLang === 'pt') r += s.hasPt ? 0 : 6;
      r += audioPenalty(s) * 2;
      r += foreignDubPenalty(s);
      if (s.codec === 'hevc') r += 1;
      if (s.codec === 'av1') r += 2;
      return r;
    };
  streams.sort((a, b) => {
    const ra = rank(a), rb = rank(b);
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
    selected = streams.find((s) => s.quality <= 1080) || streams[0];
  }

  return { streams, selected };
}
