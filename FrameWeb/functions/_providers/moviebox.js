// GERADO POR `npm run sync-app` — copia de ../Frame. Nao edite aqui:
// mexa no app e rode o script de novo, senao os dois lados divergem.
/**
 * index.js — API de alto nível do provider MovieBox para o Frame.
 *
 * Fluxo típico:
 *   const subject = await findSubject({ title: 'Dune', year: 2021, type: 'movie' });
 *   const streams = await getStreams(subject.subjectId, { qualityPref: prefs.preferredQuality });
 *   const subs    = await getSubtitles(subject.subjectId, streams[0].resourceId, prefs.subtitleLanguage);
 */

import { MovieBoxClient } from './mbclient.js';

// Singleton — mantém token e host ativo entre chamadas
const client = new MovieBoxClient();

// ---------------------------------------------------------------------------
// Títulos (port de title.rs)
// ---------------------------------------------------------------------------
const LANGUAGE_TAGS = [
  'hindi', 'tamil', 'telugu', 'kannada', 'malayalam', 'bengali', 'marathi',
  'punjabi', 'gujarati', 'urdu', 'english', 'spanish', 'french', 'german',
  'italian', 'japanese', 'korean', 'chinese', 'russian', 'portuguese',
  'turkish', 'arabic', 'dub', 'audio', 'multi', 'season',
];

function cleanTitle(raw) {
  if (!raw) return '';
  let title = String(raw).trim();
  if (!title) return '';

  // Remove tags à esquerda: [Dub] [1080p] Foo
  while (title.startsWith('[')) {
    const close = title.indexOf(']');
    if (close === -1) break;
    const rest = title.slice(close + 1).trim();
    if (!rest) break;
    title = rest;
  }

  // Remove sufixo entre colchetes: "Dune [2021]"
  const bracket = title.indexOf('[');
  if (bracket > 0) title = title.slice(0, bracket).trim();

  // Parênteses: mantém se for ano, remove se for tag (ex: "(Director's Cut)")
  const paren = title.indexOf('(');
  if (paren > 0) {
    const inside = title.slice(paren + 1).split(')')[0].trim();
    const isYear = /^\d{4}$/.test(inside) && +inside >= 1900 && +inside <= 2099;
    if (!isYear) title = title.slice(0, paren).trim();
  }

  // Sufixo " - Hindi Dub" etc.
  const dash = title.lastIndexOf(' - ');
  if (dash > 0) {
    const suffix = title.slice(dash + 3).toLowerCase();
    const isTag =
      LANGUAGE_TAGS.some((t) => suffix.includes(t)) ||
      /^s[\d-]*$/.test(suffix.replace(/ /g, ''));
    if (isTag) title = title.slice(0, dash).trim();
  }

  // Sufixo " S01" / " S1-2"
  const sMatch = title.match(/^(.*?)\s+S(\d[\dS-]*)$/i);
  if (sMatch && sMatch[1].trim()) title = sMatch[1].trim();

  // " season 2"
  const seasonIdx = title.toLowerCase().lastIndexOf(' season ');
  if (seasonIdx > 0) title = title.slice(0, seasonIdx).trim();

  const cleaned = title.replace(/[-:_.\s]+$/, '').trim();
  return cleaned || raw.trim();
}

/**
 * Extrai o código de idioma de um rótulo de dublagem do MovieBox.
 * Aceita: 'Portuguese', 'Portuguese (BR)', 'ptbr dub', 'pt-BR', etc.
 */
function dubLanguageCode(label) {
  if (!label) return null;
  const s = String(label).trim().toLowerCase();
  if (/ptbr|pt[\s\-_]?br|portugu/.test(s)) return 'pt';
  if (/esla dub|spanish|\bespa/.test(s)) return 'es';
  return languageToCode(s.replace(/\s*dub\s*$/i, '').trim());
}

/**
 * Lista as dublagens de um subject. Cada dub é um subjectId diferente.
 * @returns [{ code, label, subjectId }]
 */
async function getDubs(subjectId) {
  const details = await client.getDetails(subjectId);
  const dubs = Array.isArray(details?.dubs) ? details.dubs : [];
  return dubs
    .map((d) => {
      const label = d.title || d.lanName || d.audioName || d.name || '';
      const code = dubLanguageCode(label);
      return d.subjectId != null && label
        ? { code, label, subjectId: String(d.subjectId) }
        : null;
    })
    .filter(Boolean);
}

/**
 * Busca o subject e, se houver dublagem no idioma pedido, devolve o subjectId da dub.
 * Retorna { subject, audioSubjectId, dubs } — audioSubjectId = base se não houver dub.
 */
async function findSubjectWithAudio({ title, year, type, audioLang = null }) {
  const subject = await findSubject({ title, year, type });
  if (!subject) return null;
  let dubs = [];
  try {
    dubs = await getDubs(subject.subjectId);
  } catch {}
  let audioSubjectId = subject.subjectId;
  let chosenDub = null;
  if (audioLang && dubs.length) {
    chosenDub = dubs.find((d) => d.code === audioLang) || null;
    if (chosenDub) audioSubjectId = String(chosenDub.subjectId);
  }
  return { subject, audioSubjectId, dubs, chosenDub };
}

const normalize = (s) =>
  cleanTitle(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// ---------------------------------------------------------------------------
// Idiomas (port de language_to_code)
// ---------------------------------------------------------------------------
const LANGUAGE_MAP = {
  english: 'en', en: 'en', eng: 'en',
  spanish: 'es', es: 'es', spa: 'es', 'español': 'es', castellano: 'es',
  hindi: 'hi', hi: 'hi', hin: 'hi',
  french: 'fr', fr: 'fr', fre: 'fr', fra: 'fr', 'français': 'fr',
  german: 'de', de: 'de', ger: 'de', deu: 'de', deutsch: 'de',
  italian: 'it', it: 'it', ita: 'it', italiano: 'it',
  japanese: 'ja', ja: 'ja', jpn: 'ja', '日本語': 'ja',
  korean: 'ko', ko: 'ko', kor: 'ko', '한국어': 'ko',
  chinese: 'zh', zh: 'zh', zho: 'zh', chi: 'zh', '中文': 'zh', mandarin: 'zh', cantonese: 'zh',
  portuguese: 'pt', pt: 'pt', por: 'pt', 'português': 'pt',
  russian: 'ru', ru: 'ru', rus: 'ru', 'русский': 'ru',
  arabic: 'ar', ar: 'ar', ara: 'ar', 'العربية': 'ar',
  turkish: 'tr', tr: 'tr', tur: 'tr', 'türkçe': 'tr',
  bengali: 'bn', bn: 'bn', tamil: 'ta', ta: 'ta', telugu: 'te', te: 'te',
  malayalam: 'ml', ml: 'ml', kannada: 'kn', kn: 'kn', marathi: 'mr', mr: 'mr',
  punjabi: 'pa', pa: 'pa', gujarati: 'gu', gu: 'gu', urdu: 'ur', ur: 'ur',
  indonesian: 'id', id: 'id', thai: 'th', th: 'th', vietnamese: 'vi', vi: 'vi',
  dutch: 'nl', nl: 'nl', polish: 'pl', pl: 'pl', swedish: 'sv', sv: 'sv',
  danish: 'da', da: 'da', norwegian: 'no', no: 'no', finnish: 'fi', fi: 'fi',
  greek: 'el', el: 'el', hebrew: 'he', he: 'he', czech: 'cs', cs: 'cs',
  hungarian: 'hu', hu: 'hu', romanian: 'ro', ro: 'ro', ukrainian: 'uk', uk: 'uk',
  persian: 'fa', fa: 'fa', farsi: 'fa', tagalog: 'tl', tl: 'tl', filipino: 'tl',
  malay: 'ms', ms: 'ms',
};

function languageToCode(name) {
  if (!name) return null;
  return LANGUAGE_MAP[String(name).trim().toLowerCase()] || null;
}

// ---------------------------------------------------------------------------
// Busca do "subject" equivalente a um título TMDB
// ---------------------------------------------------------------------------
/** Detecta a língua da tag de dublagem: "[Portuguese]", corner "Hindi" etc. */
function detectTagLanguage(item) {
  const candidates = [];
  if (item.corner) candidates.push(item.corner);
  const bracket = String(item.title || '').match(/\[([^\]]+)\]/);
  if (bracket) candidates.push(bracket[1]);
  const dash = String(item.title || '').match(/ - (\w[\w ]+)$/);
  if (dash) candidates.push(dash[1]);
  for (const c of candidates) {
    const code = languageToCode(c);
    if (code) return code;
  }
  return null;
}

/**
 * @param {{title:string, year?:string|number, type:'movie'|'tv', audioLang?:string}} media
 * @returns subject do MovieBox ({subjectId, title, subjectType, ...}) ou null
 */
async function findSubject({ title, year, type, audioLang = null }) {
  const data = await client.search(title, 1);
  // Resposta real: data.results[] = { topicType, subjects[] }
  const results = Array.isArray(data?.results) ? data.results : [];
  const items = results.flatMap((r) => (Array.isArray(r.subjects) ? r.subjects : []));
  if (!items.length) return null;

  const target = normalize(title);
  const wantType = type === 'tv' ? 2 : 1;
  const wantYear = year ? String(year) : null;

  const scored = items.map((item) => {
    const stype = Number(item.subjectType ?? item.stype ?? 0);
    const itemYear = String(item.releaseDate || '').slice(0, 4);
    const normTitle = normalize(item.title || '');
    const tagLang = detectTagLanguage(item);
    let score = 0;
    if (normTitle === target) score += 100;
    else if (normTitle.includes(target) || target.includes(normTitle)) score += 40;

    // Dublagem: preferência de áudio manda — PT procurada, outras dubs evitadas
    if (audioLang) {
      if (tagLang === audioLang) score += 90; // versão dublada no idioma desejado
      else if (tagLang) score -= 90; // dublagem em outro idioma: longe da gente
    } else if (tagLang) {
      score -= 25; // sem preferência: evita versões tagueadas
    }

    if (stype === wantType) score += 30;
    if (wantYear && itemYear === wantYear) score += 30;
    if (item.hasResource) score += 15; // prioriza o que realmente tem stream
    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 40) return null;
  return best.item;
}

// ---------------------------------------------------------------------------
// Streams + qualidades
// ---------------------------------------------------------------------------
/**
 * @returns Array de { quality, url, resourceId, sizeBytes, codec, label }
 *          ordenado da maior qualidade para a menor.
 */
async function getStreams(subjectId, { season = 0, episode = 0, qualityPref = 'auto' } = {}) {
  const data = await client.getResources(subjectId, season, episode);
  const list = Array.isArray(data?.list) ? data.list : [];

  // A API ignora se/ep e devolve a temporada inteira: filtramos no cliente
  const wantEpisode = (season > 0 || episode > 0);

  const streams = list
    .filter((f) => f && f.resourceLink)
    .filter((f) => !wantEpisode || (Number(f.se) === season && Number(f.ep) === episode))
    .map((f) => ({
      quality: Number(f.resolution) || 0,
      url: f.resourceLink,
      resourceId: f.resourceId != null ? String(f.resourceId) : null,
      sizeBytes: Number(f.size) || null,
      codec: f.codecName || f.codec || null,
      label: f.title || null,
      durationSeconds: Number(f.duration) || null,
    }))
    .sort((a, b) => b.quality - a.quality);

  const isBadCodec = (s) => {
    const c = (s.codec || '').toLowerCase();
    return c.includes('hevc') || c.includes('h265') || c.includes('ac3') || c.includes('eac3');
  };

  // Dedup por URL e remove codecs mudos
  const seen = new Set();
  const unique = streams
    .filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)))
    .filter((s) => !isBadCodec(s));

  // Seleção inicial conforme preferência salva nas Configurações
  let selected = unique[0] || null;
  if (qualityPref && qualityPref !== 'auto' && unique.length) {
    const want = Number(qualityPref);
    selected =
      unique.find((s) => s.quality === want) ||
      unique.filter((s) => s.quality < want).sort((a, b) => b.quality - a.quality)[0] ||
      unique[0];
  }

  return { streams: unique, selected };
}

// ---------------------------------------------------------------------------
// Legendas
// ---------------------------------------------------------------------------
/**
 * @returns [{ code, name, url }] — code é ISO (pt, en...), name é o rótulo da API.
 */
async function getSubtitles(subjectId, resourceId, preferredCode = 'pt') {
  if (!resourceId) return { subtitles: [], selected: null };
  const data = await client.getExtCaptions(subjectId, resourceId);
  const caps = Array.isArray(data?.extCaptions) ? data.extCaptions : [];

  const subtitles = caps
    .filter((c) => c && c.url)
    .map((c) => ({
      name: c.lanName || 'Unknown',
      code: languageToCode(c.lanName) || languageToCode(c.lan),
      url: c.url,
    }));

  let selected = null;
  if (preferredCode && preferredCode !== 'off') {
    selected = subtitles.find((s) => s.code === preferredCode) || null;
  }
  return { subtitles, selected };
}

/**
 * Multi-idioma: busca streams do subject base + subjects dublados.
 * Cada stream sai com tag { lang: {code, label} } — usado pelo NativePlayer
 * pra trocar idioma em plena reprodução (estilo Netflix).
 */
async function getMultiLangStreams({
  baseSubjectId,
  dubs = [],            // [{code,label,subjectId}]
  langs = [],           // ['pt','en'] — ordem de prioridade
  season = 0,
  episode = 0,
  qualityPref = 'auto',
}) {
  const jobs = [{ code: 'original', label: 'Original', subjectId: String(baseSubjectId) }];
  const seenCodes = new Set(['original']);
  for (const lang of langs) {
    const dub = dubs.find((d) => d.code === lang && !seenCodes.has(lang));
    if (dub) { seenCodes.add(lang); jobs.push(dub); }
  }

  const all = [];
  // Em sequência pra não alarmar o CDN; máx. 3 idiomas
  for (const job of jobs.slice(0, 3)) {
    try {
      const { streams } = await getStreams(job.subjectId, { season, episode, qualityPref });
      for (const s of streams) all.push({ ...s, lang: { code: job.code, label: job.label } });
    } catch {
      // dub sem stream hoje: pula
    }
  }
  return all;
}

export {
  client,
  cleanTitle,
  languageToCode,
  detectTagLanguage,
  dubLanguageCode,
  findSubject,
  findSubjectWithAudio,
  getDubs,
  getStreams,
  getMultiLangStreams,
  getSubtitles,
};
