// GERADO POR `npm run sync-app` — copia de ../Frame. Nao edite aqui:
// mexa no app e rode o script de novo, senao os dois lados divergem.
import { selectAll } from './core';

/**
 * Leitura das duas tabelas que ja existiam antes deste sync:
 * `watchlists` (Watchlist do app) e `continue_watching`.
 *
 * A chave delas e `tmdb_id` (nao `media_id`), e o item inteiro do TMDB mora em
 * `metadata`. Linha gravada antes do sync existir so tem title/poster_path —
 * `rowToItem` remonta um item minimo nesse caso, pra lista antiga nao sumir.
 */

export function rowToItem(row) {
  const meta = row && row.metadata;
  if (meta && (meta.id || meta.tmdbId)) return meta;
  return {
    id: row.tmdb_id,
    tmdbId: row.tmdb_id,
    media_type: row.media_type,
    type: row.media_type,
    // `title` so em filme: com os dois preenchidos, quem adivinha o tipo pelos
    // campos (`name` sem `title` = serie) tratava serie como filme.
    title: row.media_type === 'tv' ? undefined : row.title,
    name: row.title,
    poster_path: row.poster_path,
  };
}

export async function pullWatchlist(profileId) {
  if (!profileId) return [];
  const rows = await selectAll(
    'watchlists',
    'tmdb_id,media_type,title,poster_path,metadata,added_at',
    (q) => q.eq('profile_id', profileId).is('deleted_at', null).order('added_at', { ascending: false })
  );
  return rows.map(rowToItem);
}

export async function pullContinueWatching(profileId) {
  if (!profileId) return [];
  const rows = await selectAll(
    'continue_watching',
    'tmdb_id,media_type,title,poster_path,metadata,season_number,episode_number,updated_at',
    (q) => q.eq('profile_id', profileId).is('deleted_at', null).order('updated_at', { ascending: false })
  );
  return rows.map((row) => ({
    ...rowToItem(row),
    savedSeason: row.season_number,
    savedEpisode: row.episode_number,
  }));
}
