// GERADO POR `npm run sync-app` — copia de ../Frame. Nao edite aqui:
// mexa no app e rode o script de novo, senao os dois lados divergem.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { pushProgress } from './sync/progress';

/**
 * Serviço de progresso de exibição ("onde o espectador parou").
 * Regras inspiradas no MovieBox-Tui:
 *  - completed = posição >= 90% da duração
 *  - posição < 30s => recomeçar do zero
 *  - caso contrário => retomar de onde parou
 *
 * Persistência local (AsyncStorage, leitura instantânea) + espelho no
 * Supabase (tabela `watch_progress`): pausar no celular e retomar no ponto
 * certo na TV/site.
 * O espelhamento no Supabase acontece via metadata do `continue_watching`
 * (saveToContinueWatching no App.js), sem mudança de schema.
 */

const COMPLETION_RATIO = 0.9;
const MIN_PROGRESS_SECONDS = 30;

const mapKey = (profileId) => `@frame_progress_${profileId || 'guest'}`;

export function mediaKey(tmdbId, type, season = 0, episode = 0) {
  return `${tmdbId}:${type || 'movie'}:${season || 0}:${episode || 0}`;
}

async function readMap(profileId) {
  try {
    const raw = await AsyncStorage.getItem(mapKey(profileId));
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

async function writeMap(profileId, map) {
  try {
    // Cap simples pra não crescer infinito: mantém os 200 mais recentes
    const entries = Object.entries(map)
      .sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0))
      .slice(0, 200);
    await AsyncStorage.setItem(mapKey(profileId), JSON.stringify(Object.fromEntries(entries)));
  } catch (e) {
    // silencioso
  }
}

/**
 * `fonte`: o ARQUIVO que estava tocando — { hash, fileIdx, idioma, quality,
 * faixa, release }. Sem isso, cada retomada refaz a sondagem de 40 releases
 * pra chegar no mesmo lugar; com isso, o player vai direto nele, no mesmo
 * idioma, na mesma qualidade e na mesma faixa de áudio do arquivo.
 */
function buildRecord(progressSeconds, durationSeconds, prevCompleted, audioCode, subtitleObj, fonte) {
  const completed =
    prevCompleted ||
    !!(durationSeconds && durationSeconds > 0 && progressSeconds >= durationSeconds * COMPLETION_RATIO);
  const ratio = durationSeconds ? Math.min(1, progressSeconds / durationSeconds) : null;
  return { progressSeconds, durationSeconds, completed, ratio, timestamp: Date.now(), audioCode, subtitleObj, fonte: fonte || undefined };
}

/**
 * Registra um "pulso" de progresso somando ao que já existia.
 * Usado hoje pelo player WebView (estimativa por tempo de tela);
 * o player nativo (Etapa 3) usará savePosition com posição real.
 */
export async function savePulse({
  profileId,
  tmdbId,
  type = 'movie',
  season = 0,
  episode = 0,
  elapsedSeconds = 0,
  durationSeconds = null,
}) {
  if (!tmdbId) return null;

  const map = await readMap(profileId);
  const key = mediaKey(tmdbId, type, season, episode);
  const prev = map[key] || { progressSeconds: 0 };

  const duration = durationSeconds || prev.durationSeconds || null;
  let progressSeconds = Math.max(0, Math.floor((prev.progressSeconds || 0) + elapsedSeconds));
  if (duration) progressSeconds = Math.min(progressSeconds, duration);

  const record = buildRecord(progressSeconds, duration, prev.completed, prev?.audioCode, prev?.subtitleObj, prev?.fonte);
  map[key] = record;
  await writeMap(profileId, map);
  pushProgress(profileId, key, record);
  return record;
}

/** Grava posição absoluta (será usado pelo player nativo na Etapa 3). */
export async function savePosition({
  profileId,
  tmdbId,
  type = 'movie',
  season = 0,
  episode = 0,
  positionSeconds,
  durationSeconds = null,
  audioCode = null,
  subtitleObj = null,
  fonte = null,
}) {
  if (!tmdbId) return null;
  const map = await readMap(profileId);
  const key = mediaKey(tmdbId, type, season, episode);
  const prev = map[key];
  const duration = durationSeconds || prev?.durationSeconds || null;
  let position = Math.max(0, Math.floor(positionSeconds || 0));
  if (duration) position = Math.min(position, duration);

  const record = buildRecord(
    position,
    duration,
    prev?.completed,
    audioCode !== null ? audioCode : prev?.audioCode,
    subtitleObj !== null ? subtitleObj : prev?.subtitleObj,
    fonte !== null ? fonte : prev?.fonte
  );
  map[key] = record;
  await writeMap(profileId, map);
  pushProgress(profileId, key, record);
  return record;
}

export async function getProgress(profileId, tmdbId, type = 'movie', season = 0, episode = 0) {
  const map = await readMap(profileId);
  return map[mediaKey(tmdbId, type, season, episode)] || null;
}

/**
 * Decide o que fazer ao dar play, dadas as regras de retomada.
 * @returns 'none' | 'restart' | 'resume'
 */
/**
 * Em que episódio a pessoa parou nesta série.
 *
 * As linhas antigas do "continuar assistindo" foram gravadas antes de existirem
 * as colunas de temporada e episódio, então vêm sem o "T1 E4". O progresso POR
 * EPISÓDIO sempre existiu — dá pra recuperar dali qual foi o mais recente.
 */
export async function ultimoEpisodio(profileId, tmdbId) {
  if (!tmdbId) return null;
  const map = await readMap(profileId);
  const prefixo = `${tmdbId}:tv:`;
  let melhor = null;
  for (const [chave, valor] of Object.entries(map || {})) {
    if (!chave.startsWith(prefixo)) continue;
    if (melhor && (valor?.timestamp || 0) <= (melhor.valor?.timestamp || 0)) continue;
    const [, , season, episode] = chave.split(':');
    melhor = { valor, season: Number(season) || 0, episode: Number(episode) || 0 };
  }
  if (!melhor || !melhor.episode) return null;
  return { season: melhor.season, episode: melhor.episode, progress: melhor.valor || null };
}

export function resumeDecision(progress) {
  if (!progress) return 'none';
  if (progress.completed) return 'restart';
  if ((progress.progressSeconds || 0) < MIN_PROGRESS_SECONDS) return 'restart';
  if (
    progress.durationSeconds &&
    progress.progressSeconds >= progress.durationSeconds * COMPLETION_RATIO
  ) {
    return 'restart';
  }
  return 'resume';
}

export async function clearProgress(profileId, tmdbId, type = 'movie', season = 0, episode = 0) {
  const map = await readMap(profileId);
  delete map[mediaKey(tmdbId, type, season, episode)];
  await writeMap(profileId, map);
}

/**
 * Funde o progresso vindo da nuvem no mapa local. Vence o maior `timestamp`
 * (Date.now() de quem gravou). O que só existe aqui sobe na mesma passada.
 */
export async function mergeCloudProgress(profileId, remoteMap) {
  if (!profileId || !remoteMap) return null;
  const local = await readMap(profileId);
  let changed = false;

  Object.keys(remoteMap).forEach((key) => {
    const remote = remoteMap[key];
    const mine = local[key];
    if (!mine || (remote.timestamp || 0) > (mine.timestamp || 0)) {
      local[key] = remote;
      changed = true;
    }
  });

  // registros que ainda não subiram (primeira sincronização deste aparelho)
  Object.keys(local).forEach((key) => {
    const remote = remoteMap[key];
    if (!remote || (local[key].timestamp || 0) > (remote.timestamp || 0)) {
      pushProgress(profileId, key, local[key]);
    }
  });

  if (changed) await writeMap(profileId, local);
  return local;
}
