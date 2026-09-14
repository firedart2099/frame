/**
 * SuperFlix — fonte brasileira de embed, usada para o áudio DUBLADO.
 *
 * Ela não entra no nosso player: o stream é montado pelo JavaScript deles e a
 * página não expõe m3u8 nem mp4 (17 KB de HTML, zero URL de mídia). É iframe,
 * como o AutoEmbed. O que ela resolve é o buraco que torrent não cobre —
 * título sem nenhuma dublagem indexada, que é o caso de série recente.
 *
 * Duas coisas descobertas testando, e as duas mudam o que dá pra fazer:
 *
 *  - O domínio muda. `superflixapi.dev` e `.sbs` já não resolvem da máquina do
 *    usuário (provedor bloqueia); `.baby` responde direto do navegador dele E
 *    do Worker. Quando cair, é aqui que se troca.
 *  - O endpoint `/lista` diz o que eles têm, por id da TMDB. Isso permite
 *    oferecer "dublado" só quando existe de verdade, em vez de mandar a pessoa
 *    pra uma tela de erro.
 */

const BASE = 'https://superflixapi.baby';

// A lista não manda CORS, então passa pelo nosso Worker — que alcança o
// SuperFlix normalmente (ao contrário do AllDebrid, que bloqueia datacenter).
const viaProxy = (url) => `/api/proxy?url=${encodeURIComponent(url)}`;

const CACHE_KEY = (tipo) => `frame:superflix:${tipo}`;
const memoria = {};

/** Ids da TMDB que o SuperFlix tem, por tipo. ~6,5 mil séries, 56 KB. */
async function catalogo(tipo) {
  const categoria = tipo === 'tv' ? 'serie' : 'filme';
  if (memoria[categoria]) return memoria[categoria];

  try {
    const salvo = sessionStorage.getItem(CACHE_KEY(categoria));
    if (salvo) {
      memoria[categoria] = new Set(JSON.parse(salvo));
      return memoria[categoria];
    }
  } catch (e) {
    /* aba anônima com storage bloqueado */
  }

  try {
    const resp = await fetch(viaProxy(`${BASE}/lista?category=${categoria}&type=tmdb&format=json`));
    if (!resp.ok) return new Set();
    const lista = await resp.json();
    const ids = (Array.isArray(lista) ? lista : []).map(String);
    memoria[categoria] = new Set(ids);
    try {
      sessionStorage.setItem(CACHE_KEY(categoria), JSON.stringify(ids));
    } catch (e) {
      /* cota cheia: segue só com a memória */
    }
    return memoria[categoria];
  } catch (e) {
    return new Set();
  }
}

/** O SuperFlix tem este título? */
export async function temDublagem(tmdbId, tipo) {
  if (!tmdbId) return false;
  const ids = await catalogo(tipo);
  return ids.has(String(tmdbId));
}

export function urlDoEmbed(tmdbId, tipo, temporada, episodio) {
  return tipo === 'tv'
    ? `${BASE}/serie/${tmdbId}/${temporada}/${episodio}`
    : `${BASE}/filme/${tmdbId}`;
}
