import { tmdb } from './constants';

/**
 * Resolve no TMDB os itens crus vindos do CSV do Letterboxd.
 *
 * O export do Letterboxd traz só `Name`, `Year` e a URI — sem pôster, sem
 * gênero, sem nota. Sem isso a pasta abre como um monte de quadrado cinza, e
 * os filtros por gênero/nota/duração não teriam em que se apoiar.
 *
 * Marca `tmdb_resolved: true` mesmo quando não acha nada, senão o mesmo
 * título seria buscado de novo a cada abertura da pasta, pra sempre.
 */

const BATCH = 24;
const CONCURRENCY = 6;

export const needsResolving = (item) => !!item && !item.tmdb_resolved && !item.poster_path && !!item.Name;

async function pooled(items, worker, size = CONCURRENCY) {
  let i = 0;
  const out = [];
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        try {
          out.push(await worker(item));
        } catch (e) {
          out.push({ ...item, tmdb_resolved: true });
        }
      }
    })
  );
  return out;
}

async function resolveOne(item) {
  const json = await tmdb('/search/movie', {
    query: item.Name,
    ...(item.Year ? { year: item.Year } : {}),
  });
  const hit = (json.results || []).find((r) => r.poster_path) || json.results?.[0];
  if (!hit) return { ...item, tmdb_resolved: true };
  return {
    ...item,
    tmdb_resolved: true,
    id: hit.id,
    title: hit.title,
    poster_path: hit.poster_path,
    backdrop_path: hit.backdrop_path,
    overview: hit.overview,
    release_date: hit.release_date,
    genre_ids: hit.genre_ids,
    vote_average: hit.vote_average,
    popularity: hit.popularity,
    media_type: 'movie',
  };
}

/**
 * Resolve um lote e devolve a lista inteira já atualizada.
 * @returns {{ items: any[], restantes: number }}
 */
export async function resolveBatch(items) {
  const pendentes = items.filter(needsResolving);
  if (!pendentes.length) return { items, restantes: 0 };

  const lote = pendentes.slice(0, BATCH);
  const resolvidos = await pooled(lote, resolveOne);

  const porChave = new Map(resolvidos.map((r) => [`${r.Name}|${r.Year || ''}`, r]));
  const next = items.map((it) => porChave.get(`${it.Name}|${it.Year || ''}`) || it);

  return { items: next, restantes: pendentes.length - lote.length };
}
