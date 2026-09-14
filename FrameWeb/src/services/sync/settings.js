// GERADO POR `npm run sync-app` — copia de ../Frame. Nao edite aqui:
// mexa no app e rode o script de novo, senao os dois lados divergem.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { enqueue, flushOutbox, nowIso, pendingKeys, selectAll } from './core';

/**
 * Configuracoes por perfil, em chave/valor (tabela `profile_settings`).
 *
 * Chaves em uso:
 *   onboarded       -> bool, se a calibracao de gosto ja foi feita
 *   playback_prefs  -> { audioLanguage, subtitleLanguage, preferredQuality, ... }
 *   lbxd_ratings    -> array cru do ratings.csv do Letterboxd
 *
 * Chave nova nao precisa de migration: e so chamar setSetting.
 */

export const SETTING_ONBOARDED = 'onboarded';
export const SETTING_PLAYBACK_PREFS = 'playback_prefs';
export const SETTING_LBXD_RATINGS = 'lbxd_ratings';

const localKey = (profileId, key) => `@frame_setting_${profileId || 'guest'}_${key}`;

/** Le do cache local (instantaneo, funciona offline e antes do primeiro pull). */
export async function getSetting(profileId, key, fallback = null) {
  try {
    const raw = await AsyncStorage.getItem(localKey(profileId, key));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && 'v' in parsed ? parsed.v : fallback;
  } catch (e) {
    return fallback;
  }
}

async function writeLocal(profileId, key, value, updatedAt) {
  try {
    await AsyncStorage.setItem(
      localKey(profileId, key),
      JSON.stringify({ v: value, t: updatedAt || Date.now() })
    );
  } catch (e) {}
}

/** Grava local + enfileira pro Supabase. */
export async function setSetting(profileId, key, value) {
  await writeLocal(profileId, key, value);
  if (!profileId) return;
  await enqueue([
    {
      table: 'profile_settings',
      onConflict: 'profile_id,key',
      row: { profile_id: profileId, key, value, updated_at: nowIso() },
    },
  ]);
  flushOutbox();
}

/**
 * Baixa todas as configuracoes do perfil. A nuvem vence, exceto nas chaves
 * que ainda tem escrita pendente na outbox (gravadas offline neste aparelho).
 */
export async function pullSettings(profileId) {
  if (!profileId) return {};
  const rows = await selectAll('profile_settings', 'key,value,updated_at', (q) =>
    q.eq('profile_id', profileId)
  );
  const pending = await pendingKeys('profile_settings', 'key');
  const result = {};

  for (const row of rows) {
    if (pending.has(row.key)) {
      result[row.key] = await getSetting(profileId, row.key, null);
      continue;
    }
    result[row.key] = row.value;
    await writeLocal(profileId, row.key, row.value, Date.parse(row.updated_at) || Date.now());
  }
  return result;
}
