import { tmdb, toTvGenre, TMDB_API_KEY } from '../services/constants';

/** Tipo do item como o resto do código espera: 'movie' | 'tv'. */
/**
 * Filme ou serie.
 *
 * CUIDADO com `item.type`: a resposta de detalhes de SERIE da TMDB traz um
 * campo `type` proprio, com valores como "Scripted", "Miniseries" ou
 * "Documentary" — nada a ver com filme/serie. Aceitar esse campo cegamente
 * fazia toda serie aberta pela pagina de detalhes virar "filme", e o player ia
 * buscar /movie/<id do programa>: The Walking Dead (serie 1402) tocava o FILME
 * 1402, "Em Busca da Felicidade", e Round 6 (serie 93405) dava 404 porque nao
 * existe filme com esse id. So 'tv' e 'movie' valem como declaracao.
 */
export const typeOf = (item) => {
  const declarado = item?.type || item?.media_type;
  if (declarado === 'tv' || declarado === 'movie') return declarado;
  const ehSerie =
    !!item?.first_air_date ||
    !!item?.seasons ||
    !!item?.episode_run_time ||
    !!item?.number_of_seasons ||
    (!!item?.name && !item?.title);
  return ehSerie ? 'tv' : 'movie';
};

export const titleOf = (item) => item?.title || item?.name || item?.original_title || item?.original_name || '';
export const yearOf = (item) => {
  const d = item?.release_date || item?.first_air_date;
  return d ? String(d).slice(0, 4) : '';
};
export const idOf = (item) => item?.id || item?.tmdbId;

const clean = (list = []) =>
  list.filter((m) => m && m.poster_path && !m.adult).map((m) => ({ ...m, media_type: m.media_type || undefined }));

export const trending = async (type = 'movie') => clean((await tmdb(`/trending/${type}/week`)).results);

export const topRated = async (type = 'movie', page = 1) =>
  clean((await tmdb(`/${type}/top_rated`, { page })).results);

export const byGenre = async (genreId, type = 'movie', page = 1) =>
  clean((await tmdb(`/discover/${type}`, { with_genres: genreId, sort_by: 'popularity.desc', page })).results);

export const search = async (q) => {
  if (!q?.trim()) return [];
  const json = await tmdb('/search/multi', { query: q, include_adult: 'false' });
  return clean(json.results).filter((r) => r.media_type === 'movie' || r.media_type === 'tv');
};

export const details = async (id, type = 'movie') =>
  tmdb(`/${type}/${id}`, { append_to_response: 'credits,similar,videos,images,keywords,external_ids' });

export const season = async (id, n) => tmdb(`/tv/${id}/season/${n}`);

/** Busca uma prateleira do INFINITE_SHELF_POOL (formula com url pronta). */
export const fetchShelf = async (formula, page = 1) => {
  try {
    // O pool infinito guarda a url com __KEY__ no lugar da chave (ele e montado
    // uma vez, fora do componente). Sem trocar aqui, a prateleira volta vazia.
    const base = String(formula.url).replace('__KEY__', TMDB_API_KEY);
    const url = base.includes('?') ? `${base}&page=${page}` : `${base}?page=${page}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    const raw = json.results || json.parts || [];
    return clean(raw).map((m) => ({ ...m, media_type: m.media_type || formula.type || 'movie' }));
  } catch (e) {
    return [];
  }
};

/** Logo do título (usado no hero) — cai pro texto se não houver. */
/**
 * Logo do título pro banner.
 *
 * CUIDADO com o `pt`: a TMDB usa o MESMO código para logo do Brasil e de
 * Portugal — não existe pt-BR em imagem. Pegar a primeira `pt` fazia
 * "Bastardos Inglórios" aparecer como "Sacanas Sem Lei" no banner, que é o
 * título português. Como não dá pra ler o texto da imagem, a regra é: só usa
 * `pt` quando o título é falado em português de origem (aí a logo é
 * brasileira ou não há divergência). Nos outros, vale a arte original em
 * inglês, ou a sem texto — nunca uma tradução que pode ser a errada.
 */
export const logoOf = async (id, type, idiomaOriginal = null) => {
  try {
    const json = await tmdb(`/${type}/${id}/images`, { include_image_language: 'pt,en,null' });
    const logos = json.logos || [];
    const pt = logos.find((l) => l.iso_639_1 === 'pt');
    const en = logos.find((l) => l.iso_639_1 === 'en');
    const semTexto = logos.find((l) => !l.iso_639_1);
    if (idiomaOriginal === 'pt') return (pt || en || logos[0])?.file_path || null;
    return (en || semTexto || logos[0])?.file_path || null;
  } catch (e) {
    return null;
  }
};

/**
 * Pool do banner: 5 filmes + 5 séries, como no app.
 * A watchlist do usuário entra primeiro; o resto é bem avaliado e alinhado
 * com os gêneros que ele mais curte.
 */
export async function buildHeroPool(tasteProfile, myList = [], watchedIds = new Set()) {
  const genres = Object.entries(tasteProfile?.analytics?.top_genres || {})
    .map(([id, v]) => ({ id, score: typeof v === 'number' ? v : v?.score || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((g) => g.id);

  const pick = async (type) => {
    const params = {
      sort_by: 'vote_count.desc',
      'vote_average.gte': type === 'movie' ? 7 : 7.5,
      'vote_count.gte': type === 'movie' ? 800 : 250,
      page: 1 + Math.floor(Math.random() * 3),
    };
    if (genres.length) {
      // ids de gênero de série são diferentes dos de filme na TMDB
      params.with_genres = genres.map((g) => (type === 'tv' ? toTvGenre(Number(g)) : g)).join('|');
    }
    try {
      const json = await tmdb(`/discover/${type}`, params);
      return clean(json.results).map((m) => ({ ...m, media_type: type }));
    } catch (e) {
      return [];
    }
  };

  const fromList = (want) =>
    myList.filter((m) => typeOf(m) === want && m.backdrop_path).slice(0, 2).map((m) => ({ ...m, _fromWatchlist: true }));

  const [movies, series] = await Promise.all([pick('movie'), pick('tv')]);
  const take = (want, pool) => {
    const seen = new Set();
    const out = [];
    for (const item of [...fromList(want), ...pool]) {
      const id = String(idOf(item));
      if (seen.has(id) || (!item._fromWatchlist && watchedIds.has(id))) continue;
      if (!item.backdrop_path) continue;
      seen.add(id);
      out.push({ ...item, media_type: want });
      if (out.length === 5) break;
    }
    return out;
  };

  const pool = [...take('movie', movies), ...take('tv', series)];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

export { TMDB_API_KEY };
