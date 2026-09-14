/**
 * MovieBox no navegador, pela extensão.
 *
 * O `/api/resolve` chama o MovieBox do Cloudflare e leva 440 em todo host do
 * pool — a API recusa IP de datacenter. O app tem o MovieBox porque roda no
 * celular; aqui, o pedido sai do computador da pessoa pela busca por
 * procuração da extensão (`buscarPelaExtensao`), que entra no cliente como
 * transporte. O cliente é o mesmo do app (`functions/_providers/`, gerado por
 * `npm run sync-app`) — nada é reimplementado.
 *
 * O que sai daqui tem a forma das fontes do player (mesma dos releases do
 * Torrentio: `quality` em número, `idioma` em código, `size` em bytes), com
 * `kind: 'video'` e `proxied: false` — o CDN do MovieBox manda CORS e não
 * exige Referer, então o `<video>` toca direto.
 *
 * Medido em 12/09/2026: a API respondeu com o MESMO .mp4 de 930 KB pra
 * Inception e Interestelar, em todos os idiomas — o stub anti-abuso do CDN,
 * o mesmo que o app filtra com `checkPlayableUrl`. Por isso todo link passa
 * por um HEAD antes de entrar na lista: menos de 3 MB não é filme.
 */
import { usarTransporte } from '../../functions/_providers/mbclient.js';
import * as MovieBox from '../../functions/_providers/moviebox.js';
import { buscarPelaExtensao, extensaoBusca } from './extensao';

const STUB_MAX_BYTES = 3 * 1024 * 1024;

/** Tamanho real do arquivo pelo HEAD (via extensão: o navegador não lê `content-length` de outra origem). */
async function tamanhoReal(url) {
  const r = await buscarPelaExtensao(url, { method: 'HEAD' });
  const n = Number(r.headers.get('content-length'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function buscarMovieBox({ title, original = null, year = '', type = 'movie', season = 0, episode = 0 }) {
  if (!extensaoBusca()) return [];
  usarTransporte(buscarPelaExtensao);

  let found = null;
  for (const nome of [...new Set([title, original].filter(Boolean))]) {
    found = await MovieBox.findSubjectWithAudio({ title: nome, year, type, audioLang: 'pt' }).catch(() => null);
    if (found) break;
  }
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
  const streams = (Array.isArray(out) ? out : out?.streams || []).filter((s) => s?.url && /^https:/i.test(s.url));

  // Um HEAD por URL (o mesmo arquivo aparece uma vez por idioma), em
  // sequência — CDN com limite de conexão devolve 503 pra rajada.
  const porUrl = new Map();
  for (const s of streams) {
    if (!porUrl.has(s.url)) porUrl.set(s.url, []);
    porUrl.get(s.url).push(s);
  }
  const vivas = [];
  for (const [url, grupo] of porUrl) {
    const bytes = await tamanhoReal(url).catch(() => null);
    if (bytes !== null && bytes <= STUB_MAX_BYTES) continue; // stub: não é filme
    for (const s of grupo) vivas.push({ ...s, sizeBytes: bytes || s.sizeBytes || null });
  }

  return vivas.map((s) => ({
    kind: 'video',
    provider: 'MovieBox',
    url: s.url,
    quality: Number(s.quality) || 0,
    codec: s.codec || null,
    idioma: s.lang?.code || 'original',
    pt: s.lang?.code === 'pt',
    size: s.sizeBytes || null,
    release: `MovieBox${s.label ? ` · ${s.label}` : ''}${s.lang?.label ? ` (${s.lang.label})` : ''}`,
    duracaoS: s.durationSeconds || null,
    proxied: false,
  }));
}
