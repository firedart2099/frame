import * as Stremio from '../_providers/stremio.js';
import * as MovieBox from '../_providers/moviebox.js';
import * as FourKHDHub from '../_providers/fourkhdhub.js';

/**
 * GET /api/resolve?tmdb=603&type=movie&title=Matrix&year=1999[&season=&episode=][&debug=1]
 *
 * Acha links de vídeo de verdade — arquivo direto, pro player nativo do site.
 * Roda no servidor por dois motivos: CORS, e porque a chave do AllDebrid NÃO
 * pode ir pro navegador (é a conta paga do usuário). Ela vem de
 * `env.ALLDEBRID_KEY`, configurada como secret no Cloudflare:
 *
 *   npx wrangler pages secret put ALLDEBRID_KEY --project-name=frametv
 *
 * Ordem de preferência: AllDebrid (paga, rápida, arquivo direto) > MovieBox >
 * 4KHDHub. O iframe do AutoEmbed é o último recurso e vive no cliente.
 */

const TIMEOUT_MS = 16000;
const CACHE_S = 60 * 20;
const TMDB_API_KEY = '9cfddb984190a8787820822d4c78ac32';

const json = (data, status = 200, cacheS = 0) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': cacheS ? `public, max-age=${cacheS}` : 'no-store',
    },
  });

async function guard(name, fn) {
  const started = Date.now();
  try {
    const value = await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ]);
    return { name, value: value || [], ms: Date.now() - started };
  } catch (e) {
    return { name, value: [], error: String((e && e.message) || e), ms: Date.now() - started };
  }
}

/** Torrentio indexa por IMDb, não por TMDB. */
async function imdbIdOf(tmdbId, type) {
  if (!tmdbId) return null;
  const path = type === 'tv' ? 'tv' : 'movie';
  const r = await fetch(`https://api.themoviedb.org/3/${path}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`);
  if (!r.ok) return null;
  const j = await r.json();
  return j.imdb_id || null;
}

function normalize(list, provider) {
  if (!Array.isArray(list)) return [];
  return list
    .map((s) => {
      const url = s.url || s.link || s.file || s.playUrl;
      if (!url || typeof url !== 'string' || !/^https?:/i.test(url)) return null;
      const q = s.quality;
      const gb = s.sizeBytes ? `${(s.sizeBytes / 1e9).toFixed(1)} GB` : null;
      return {
        provider,
        url,
        quality: typeof q === 'number' ? (q ? `${q}p` : null) : q || s.resolution || null,
        language: s.lang?.label || s.langLabel || s.language || null,
        release: s.name || s.title || null,
        size: gb,
        proxied: true,
      };
    })
    .filter(Boolean);
}

/* ---------------------------------------------------------------- fontes */

async function debrid({ tmdbId, type, season, episode, key }) {
  if (!key) return [];
  const imdbId = await imdbIdOf(tmdbId, type);
  if (!imdbId) return [];
  const { streams } = await Stremio.getDebridStreams({
    imdbId,
    type,
    season: type === 'tv' ? season : 0,
    episode: type === 'tv' ? episode : 0,
    audioLang: 'pt',
    qualityPref: 'auto',
    alldebridKey: key,
  });
  return streams || [];
}

async function moviebox({ title, year, type, season, episode }) {
  const found = await MovieBox.findSubjectWithAudio({ title, year, type, audioLang: 'pt' });
  if (!found) return [];
  const baseSubjectId = found.audioSubjectId || found.subject?.subjectId;
  if (!baseSubjectId) return [];
  const out = await MovieBox.getMultiLangStreams({
    baseSubjectId,
    dubs: found.dubs || [],
    langs: ['pt', 'en'],
    season: type === 'tv' ? season : 0,
    episode: type === 'tv' ? episode : 0,
    qualityPref: 'auto',
  });
  return Array.isArray(out) ? out : out?.streams || [];
}

async function fourk({ title, year, type }) {
  if (type === 'tv') return []; // o 4KHDHub só tem filme
  const out = await FourKHDHub.getStreams({ title, year, type: 'movie', qualityPref: 'auto' });
  return out?.streams || [];
}

const ARQUIVO = 'https://archive.org';

const semAcentoIA = (s) =>
  String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** As palavras do título que valem pra comparar (fora artigo e preposição). */
const palavrasDe = (s) =>
  semAcentoIA(s)
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !['the', 'and', 'para', 'com', 'dos', 'das', 'uma', 'que'].includes(w));

/**
 * Internet Archive — arquivo direto, sem torrent e sem debrid.
 *
 * Ele cobre um buraco que nenhuma outra fonte daqui cobre: cinema antigo,
 * domínio público e material obscuro que ninguém semeia mais. E toca do jeito
 * mais simples possível — HTTP com Range (206), sem liberar nada antes.
 *
 * Em troca, a busca dele é um lixão: procurar "Rick and Morty" devolve vídeo
 * do YouTube de gente aleatória. Por isso o casamento é RÍGIDO — todas as
 * palavras do título têm que aparecer no título do item, e quando há ano ele
 * tem que bater. Fonte que devolve o filme errado é pior do que fonte nenhuma.
 *
 * Série fica de fora: no Archive um "item" de série é a temporada inteira com
 * nomes de arquivo que ninguém consegue mapear pra episódio com confiança.
 */
async function archive({ title, year, type }) {
  if (type === 'tv' || !title) return [];
  const alvo = palavrasDe(title);
  if (!alvo.length) return [];

  const q = `title:(${title.replace(/[^\w\s]/g, ' ')}) AND mediatype:(movies)`;
  const url =
    `${ARQUIVO}/advancedsearch.php?q=${encodeURIComponent(q)}` +
    '&fl[]=identifier&fl[]=title&fl[]=year&fl[]=downloads&rows=6&page=1&output=json';

  const busca = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!busca.ok) return [];
  const docs = (await busca.json())?.response?.docs || [];

  // Casamento RÍGIDO, e cada regra aqui nasceu de um falso positivo real:
  //
  //   "Nosferatu"    casava com um vídeo de Street Fighter (um jogador se
  //                  chamava Nosferatu);
  //   "The Kid"      casava com "MEDUSA - The kid of Olympus";
  //   "Interstellar" casava com uma aula de física sobre o filme.
  //
  // Conter as palavras não basta: o título do item tem que COMEÇAR pelo título
  // do filme, e o ano tem que bater. Sem ano declarado, o item não entra —
  // fonte que devolve o filme errado é pior do que fonte nenhuma.
  const alvoTexto = alvo.join(' ');
  const bons = docs.filter((d) => {
    const nome = palavrasDe(d.title).join(' ');
    if (!nome.startsWith(alvoTexto)) return false;
    if (year) {
      if (!d.year) return false;
      if (Math.abs(Number(d.year) - Number(year)) > 1) return false;
    }
    return true;
  });
  if (!bons.length) return [];

  const item = bons[0];
  const meta = await fetch(`${ARQUIVO}/metadata/${item.identifier}`).then((r) => (r.ok ? r.json() : null));
  const arquivos = (meta?.files || [])
    .filter((f) => /\.(mp4|webm|ogv|mkv)$/i.test(f.name || ''))
    // menos de 80 MB não é filme, é trecho — o Archive é cheio deles
    .filter((f) => Number(f.size || 0) > 80e6)
    .sort((a, b) => Number(b.size || 0) - Number(a.size || 0));

  return arquivos.slice(0, 3).map((f) => ({
    url: `${ARQUIVO}/download/${item.identifier}/${encodeURIComponent(f.name)}`,
    // o Archive raramente declara resolução; altura quando existe, senão nada
    quality: Number(f.height) || null,
    name: `${item.title} — ${f.name}`,
    sizeBytes: Number(f.size) || null,
  }));
}

/* ------------------------------------------------------------------ rota */

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const tmdbId = q.get('tmdb');
  const type = q.get('type') === 'tv' ? 'tv' : 'movie';
  const title = (q.get('title') || '').trim();
  const year = q.get('year') || '';
  const season = Number(q.get('season')) || 1;
  const episode = Number(q.get('episode')) || 1;
  const debug = q.get('debug') === '1';

  if (!tmdbId && !title) return json({ sources: [], error: 'faltou tmdb ou title' }, 400);

  const key = (env?.ALLDEBRID_KEY || '').trim() || null;
  const args = { tmdbId, title, year, type, season, episode };

  const results = await Promise.all([
    guard('AllDebrid', () => debrid({ ...args, key })),
    guard('MovieBox', () => moviebox(args)),
    guard('4KHDHub', () => fourk(args)),
    guard('Archive', () => archive(args)),
  ]);

  // AllDebrid primeiro: é conta paga, o link é arquivo direto e não cai.
  // Dentro de cada provedor, maior resolução na frente.
  const rank = (s) => {
    const m = /(\d{3,4})/.exec(s.quality || '');
    return m ? Number(m[1]) : 0;
  };
  const sources = results.flatMap((r) => normalize(r.value, r.name).sort((a, b) => rank(b) - rank(a)));

  const body = { sources: sources.slice(0, 20) };
  if (debug) {
    body.debug = {
      alldebridConfigurada: !!key,
      provedores: results.map((r) => ({
        provider: r.name,
        encontrados: Array.isArray(r.value) ? r.value.length : 0,
        ms: r.ms,
        erro: r.error || null,
      })),
    };
  }

  return json(body, 200, sources.length && !debug ? CACHE_S : 0);
}

export const onRequestOptions = () =>
  new Response(null, {
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': 'content-type,range',
    },
  });
