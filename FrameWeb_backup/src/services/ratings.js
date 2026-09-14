// GERADO POR `npm run sync-app` — copia de ../Frame. Nao edite aqui:
// mexa no app e rode o script de novo, senao os dois lados divergem.
// Extraido de App.js — mantenha este arquivo focado em uma responsabilidade.
// Notas: IMDb (via OMDb) e Letterboxd. Tudo com cache em memoria.
import { TMDB_API_KEY } from './constants';

// Cache TMDB id -> IMDb id (Stremio/Torrentio usa imdb)
const imdbCache = {};
const getImdbId = async (tmdbId, mediaType) => {
  const key = `${mediaType}:${tmdbId}`;
  if (imdbCache[key]) return imdbCache[key];
  try {
    const path = mediaType === 'tv' ? `tv/${tmdbId}` : `movie/${tmdbId}`;
    const r = await fetch(`https://api.themoviedb.org/3/${path}/external_ids?api_key=${TMDB_API_KEY}`);
    const j = await r.json();
    imdbCache[key] = j.imdb_id || null;
    return imdbCache[key];
  } catch {
    return null;
  }
};

// Nota do IMDb pelo /api/nota do site: OMDb primeiro e, quando ele ainda
// nao indexou (titulo novo: "Sterling Point" ficou semanas sem nota, "O
// Rato" idem), o GraphQL do proprio IMDb. Chamar o OMDb daqui era o que o
// app fazia antes — e serie recem-lancada aparecia sem nota nenhuma.
const URL_NOTA = 'https://frametv.pages.dev/api/nota';
const imdbRatingCache = {};
export const fetchImdbRatingByImdbId = async (imdbId) => {
  if (!imdbId) return null;
  if (imdbRatingCache[imdbId] !== undefined) return imdbRatingCache[imdbId];
  let rating = null;
  try {
    const r = await fetch(`${URL_NOTA}?imdb=${imdbId}`);
    const j = await r.json();
    if (j && j.nota) rating = String(j.nota);
  } catch (e) {}
  // mesma regra do Letterboxd: falha nao vira cache
  if (rating) imdbRatingCache[imdbId] = rating;
  return rating;
};
const fetchImdbRating = async (tmdbId, mediaType) => {
  if (!tmdbId) return null;
  try {
    const imdbId = await getImdbId(tmdbId, mediaType);
    return imdbId ? await fetchImdbRatingByImdbId(imdbId) : null;
  } catch (e) {
    return null;
  }
};

// Nota do Letterboxd (0..5). Antes esse mesmo fetch estava copiado em tres
// lugares do App.js; agora e um so, com cache.
const lbxdCache = {};
export const fetchLetterboxdRating = async (tmdbId) => {
  if (!tmdbId) return null;
  const k = String(tmdbId);
  if (lbxdCache[k] !== undefined) return lbxdCache[k];
  let rating = null;
  try {
    // Passa pelo nosso endpoint, e nao direto no letterboxd.com.
    //
    // O atalho `letterboxd.com/tmdb/{id}` entrou atras de um desafio do
    // Cloudflare: devolve 403 com "Just a moment...", tanto do servidor quanto
    // da maquina de casa — foi assim que a nota sumiu. A PAGINA DO FILME
    // (`/film/{slug}/`) continua respondendo 200; o /api/letterboxd descobre o
    // slug a partir do titulo e confere o `data-tmdb-id` antes de acreditar na
    // nota, pra "The Thing" de 1982 nao devolver a nota do remake.
    const r = await fetch(`https://frametv.pages.dev/api/letterboxd?tmdb=${tmdbId}`);
    if (r.ok) {
      const j = await r.json();
      rating = j && j.nota ? j.nota : null;
    }
  } catch (e) {}
  // So guarda ACERTO. Cachear a falha significava que um tropeco de rede — ou
  // uma janela em que o endpoint ainda nao existia — apagava a nota daquele
  // filme ate o app ser reiniciado.
  if (rating) lbxdCache[k] = rating;
  return rating;
};

/**
 * IMDb, Rotten Tomatoes e prêmios numa chamada só.
 *
 * O OMDb devolve tudo junto; pedir três vezes a mesma coisa era o que o app
 * fazia (uma chamada pra nota, outra pra RT, outra pros prêmios, cada uma com
 * o seu try/catch). O site já chamava assim — esta função existe pra que os
 * dois usem exatamente a mesma, com o mesmo formato.
 *
 * `premios` sai mastigado porque a frase do OMDb ("Won 4 Oscars. 152 wins &
 * 200 nominations total") não cabe num selo: o que cabe é "4 Oscars, ganhou".
 */
const omdbCache = {};
export const fetchNotasCompletas = async (tmdbId, mediaType = 'movie') => {
  const vazio = { imdb: null, rt: null, premios: null, premiosTexto: null };
  if (!tmdbId) return vazio;
  const ck = `${mediaType}:${tmdbId}`;
  if (omdbCache[ck]) return omdbCache[ck];

  try {
    const imdbId = await getImdbId(tmdbId, mediaType);
    if (!imdbId) return vazio;
    // nota pelo /api/nota (sabe de titulo novo); Rotten e premios pelo OMDb
    const [notaImdb, r] = await Promise.all([
      fetchImdbRatingByImdbId(imdbId),
      fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`),
    ]);
    const j = await r.json().catch(() => null);
    if (!j || j.Response !== 'True') return { ...vazio, imdb: notaImdb };

    const imdb = notaImdb || (j.imdbRating && j.imdbRating !== 'N/A' ? j.imdbRating : null);
    const rtItem = Array.isArray(j.Ratings)
      ? j.Ratings.find((x) => x.Source === 'Rotten Tomatoes')
      : null;
    const texto = j.Awards && j.Awards !== 'N/A' ? j.Awards : null;

    let premios = null;
    if (texto) {
      const achar = (re) => { const m = texto.match(re); return m ? Number(m[1]) : 0; };
      const oscarGanhou = achar(/Won (\d+) Oscar/i);
      const emmyGanhou = achar(/Won (\d+) (?:Primetime )?Emmy/i);
      const oscarIndicado = achar(/Nominated for (\d+) Oscar/i);
      const emmyIndicado = achar(/Nominated for (\d+) (?:Primetime )?Emmy/i);
      if (oscarGanhou) premios = { n: oscarGanhou, tipo: 'Oscar', ganhou: true };
      else if (emmyGanhou) premios = { n: emmyGanhou, tipo: 'Emmy', ganhou: true };
      else if (oscarIndicado) premios = { n: oscarIndicado, tipo: 'Oscar', ganhou: false };
      else if (emmyIndicado) premios = { n: emmyIndicado, tipo: 'Emmy', ganhou: false };
    }

    const saida = { imdb, rt: rtItem?.Value || null, premios, premiosTexto: texto };
    // igual às outras: só acerto vira cache
    if (imdb || premios || saida.rt) omdbCache[ck] = saida;
    return saida;
  } catch (e) {
    return vazio;
  }
};

export { getImdbId, fetchImdbRating };
