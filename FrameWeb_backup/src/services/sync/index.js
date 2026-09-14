// GERADO POR `npm run sync-app` — copia de ../Frame. Nao edite aqui:
// mexa no app e rode o script de novo, senao os dois lados divergem.
import { AppState } from 'react-native';
import { supabase } from '../../supabase';
import { flushOutbox, outboxSize } from './core';
import { pullFolders } from './folders';
import { pullSettings } from './settings';
import { pullProgressRows } from './progress';
import { pullWatchlist, pullContinueWatching } from './media';
import { mergeCloudProgress } from '../watchProgress';

export * from './core';
export * from './folders';
export * from './settings';
export * from './progress';
export * from './media';

const FLUSH_INTERVAL_MS = 60000;
const DEBOUNCE_MS = 800;

/**
 * Liga o perfil ativo na nuvem.
 *
 *   const stop = startProfileSync(profileId, {
 *     onFolders: ({ folders, itemsMap }) => { ... },
 *     onSettings: (settings) => { ... },
 *     onWatchlist: (list) => { ... },
 *     onContinueWatching: (list) => { ... },
 *   });
 *   // ao trocar de perfil ou desmontar:
 *   stop();
 *
 * Faz o pull inicial, escuta o realtime (o que voce salva no celular aparece
 * na TV sem refresh) e re-sincroniza quando o app volta do background.
 */
export function startProfileSync(profileId, handlers = {}) {
  if (!profileId) return () => {};

  let stopped = false;
  const timers = {};

  const safe = (fn) => (...args) => {
    try {
      const out = fn(...args);
      if (out && typeof out.catch === 'function') out.catch((e) => console.warn('[sync]', e && e.message));
      return out;
    } catch (e) {
      console.warn('[sync]', e && e.message);
    }
  };

  const pullFoldersNow = safe(async () => {
    const state = await pullFolders(profileId);
    if (!stopped && handlers.onFolders) handlers.onFolders(state);
  });

  const pullSettingsNow = safe(async () => {
    const settings = await pullSettings(profileId);
    if (!stopped && handlers.onSettings) handlers.onSettings(settings);
  });

  const pullProgressNow = safe(async () => {
    const rows = await pullProgressRows(profileId);
    await mergeCloudProgress(profileId, rows);
  });

  const pullWatchlistNow = safe(async () => {
    const list = await pullWatchlist(profileId);
    if (!stopped && handlers.onWatchlist) handlers.onWatchlist(list);
  });

  const pullContinueNow = safe(async () => {
    const list = await pullContinueWatching(profileId);
    if (!stopped && handlers.onContinueWatching) handlers.onContinueWatching(list);
  });

  const pullers = {
    folders: pullFoldersNow,
    folder_items: pullFoldersNow,
    profile_settings: pullSettingsNow,
    watch_progress: pullProgressNow,
    watchlists: pullWatchlistNow,
    continue_watching: pullContinueNow,
  };

  // uma rajada de inserts (import do Letterboxd, por ex.) vira um pull so
  const schedule = (table) => {
    if (stopped) return;
    clearTimeout(timers[table]);
    timers[table] = setTimeout(() => {
      if (!stopped && pullers[table]) pullers[table]();
    }, DEBOUNCE_MS);
  };

  const syncAll = async () => {
    await flushOutbox();
    if (stopped) return;
    await Promise.all([
      pullFoldersNow(),
      pullSettingsNow(),
      pullProgressNow(),
      pullWatchlistNow(),
      pullContinueNow(),
    ]);
  };

  syncAll();

  // ---- realtime: o outro aparelho gravou, este atualiza sozinho ----
  const channel = supabase.channel(`frame-sync-${profileId}`);
  Object.keys(pullers).forEach((table) => {
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table,
        filter: `profile_id=eq.${profileId}`,
      },
      () => schedule(table)
    );
  });
  channel.subscribe();

  // ---- volta do background: drena a fila e re-sincroniza ----
  const appStateSub = AppState.addEventListener('change', (next) => {
    if (next === 'active') syncAll();
  });

  // ---- rede voltou / escrita ficou presa: tenta drenar de tempos em tempos ----
  const interval = setInterval(async () => {
    if (stopped) return;
    if ((await outboxSize()) > 0) flushOutbox();
  }, FLUSH_INTERVAL_MS);

  return () => {
    stopped = true;
    Object.values(timers).forEach(clearTimeout);
    clearInterval(interval);
    appStateSub.remove();
    supabase.removeChannel(channel);
  };
}

/** Forca uma sincronizacao (botao "Sincronizar agora" das Configuracoes). */
export async function syncNow(profileId) {
  await flushOutbox();
  if (!profileId) return null;
  const [folders, settings, progress] = await Promise.all([
    pullFolders(profileId),
    pullSettings(profileId),
    pullProgressRows(profileId),
  ]);
  await mergeCloudProgress(profileId, progress);
  return { folders, settings };
}
