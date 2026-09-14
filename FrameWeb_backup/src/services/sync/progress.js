// GERADO POR `npm run sync-app` — copia de ../Frame. Nao edite aqui:
// mexa no app e rode o script de novo, senao os dois lados divergem.
import { enqueue, flushOutbox, nowIso, selectAll } from './core';

/**
 * Sync do "onde eu parei" (tabela `watch_progress`).
 *
 * A chave e a mesma do src/services/watchProgress.js:
 *   `<tmdbId>:<type>:<season>:<episode>`
 * Assim voce pausa o episodio no celular e retoma no ponto certo na TV.
 *
 * Conflito: vence o maior `client_ts` (Date.now() de quem gravou). Relogio de
 * aparelho pode estar torto, mas aqui isso e melhor que o relogio do servidor:
 * duas telas assistindo o mesmo episodio, quem assistiu por ultimo manda.
 */

export function parseMediaKey(mediaKey) {
  const [tmdbId, type, season, episode] = String(mediaKey).split(':');
  const id = Number(tmdbId);
  return {
    tmdb_id: Number.isFinite(id) ? id : null,
    media_type: type || 'movie',
    season: Number(season) || 0,
    episode: Number(episode) || 0,
  };
}

export async function pushProgress(profileId, mediaKey, record) {
  if (!profileId || !mediaKey || !record) return;
  await enqueue([
    {
      table: 'watch_progress',
      onConflict: 'profile_id,media_key',
      row: {
        profile_id: profileId,
        media_key: mediaKey,
        ...parseMediaKey(mediaKey),
        position_seconds: Math.max(0, Math.floor(record.progressSeconds || 0)),
        duration_seconds: record.durationSeconds || null,
        completed: !!record.completed,
        ratio: typeof record.ratio === 'number' ? record.ratio : null,
        audio_code: record.audioCode || null,
        subtitle_obj: record.subtitleObj || null,
        fonte_obj: record.fonte || null,
        client_ts: record.timestamp || Date.now(),
        updated_at: nowIso(),
      },
    },
  ]);
  flushOutbox();
}

/** Devolve { [mediaKey]: record } no formato local do watchProgress.js. */
export async function pullProgressRows(profileId) {
  if (!profileId) return {};
  const rows = await selectAll(
    'watch_progress',
    'media_key,position_seconds,duration_seconds,completed,ratio,audio_code,subtitle_obj,fonte_obj,client_ts',
    (q) => q.eq('profile_id', profileId).order('client_ts', { ascending: false })
  );

  const map = {};
  rows.forEach((row) => {
    map[row.media_key] = {
      progressSeconds: row.position_seconds || 0,
      durationSeconds: row.duration_seconds || null,
      completed: !!row.completed,
      ratio: typeof row.ratio === 'number' ? row.ratio : null,
      timestamp: Number(row.client_ts) || 0,
      audioCode: row.audio_code || undefined,
      subtitleObj: row.subtitle_obj || undefined,
      fonte: row.fonte_obj || undefined,
    };
  });
  return map;
}
