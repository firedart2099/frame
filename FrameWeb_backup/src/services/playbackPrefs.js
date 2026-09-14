// GERADO POR `npm run sync-app` — copia de ../Frame. Nao edite aqui:
// mexa no app e rode o script de novo, senao os dois lados divergem.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSetting, setSetting, SETTING_PLAYBACK_PREFS } from './sync/settings';

/**
 * Preferências de reprodução por perfil.
 * Sincronizadas no Supabase (`profile_settings`, chave `playback_prefs`), com
 * cache local no AsyncStorage — o idioma de áudio/legenda escolhido no celular
 * já vale no site e na TV.
 */

export const AUDIO_LANGUAGES = [
  { code: 'original', label: 'Original do título' },
  { code: 'pt', label: 'Português' },
  { code: 'en', label: 'Inglês' },
  { code: 'es', label: 'Espanhol' },
  { code: 'fr', label: 'Francês' },
  { code: 'de', label: 'Alemão' },
  { code: 'it', label: 'Italiano' },
  { code: 'ja', label: 'Japonês' },
  { code: 'ko', label: 'Coreano' },
  { code: 'zh', label: 'Chinês' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ar', label: 'Árabe' },
  { code: 'ru', label: 'Russo' },
  { code: 'tr', label: 'Turco' },
];

export const SUBTITLE_LANGUAGES = [
  { code: 'off', label: 'Sem legenda' },
  ...AUDIO_LANGUAGES.filter((l) => l.code !== 'original'),
];

export const QUALITY_OPTIONS = [
  { code: 'auto', label: 'Automática (recomendada)' },
  { code: '1080', label: '1080p (Full HD)' },
  { code: '720', label: '720p (HD)' },
  { code: '480', label: '480p (SD)' },
  { code: '360', label: '360p (econômica)' },
];

export const SUBTITLE_SIZES = [
  { code: 'small', label: 'Pequena' },
  { code: 'medium', label: 'Média' },
  { code: 'large', label: 'Grande' },
];

export const DEFAULT_PREFS = {
  audioLanguage: 'original',
  secondaryAudioLanguage: 'pt',
  subtitleLanguage: 'pt',
  preferredQuality: 'auto',
  subtitleSize: 'medium',
  proximoEpisodio: true,
};

const keyFor = (profileId) => `@frame_playback_prefs_${profileId || 'guest'}`;

export async function loadPlaybackPrefs(profileId) {
  try {
    const synced = await getSetting(profileId, SETTING_PLAYBACK_PREFS, null);
    if (synced) return { ...DEFAULT_PREFS, ...synced };
    // legado: prefs gravadas antes do sync existir
    const raw = await AsyncStorage.getItem(keyFor(profileId));
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch (e) {
    return { ...DEFAULT_PREFS };
  }
}

export async function savePlaybackPrefs(profileId, prefs) {
  try {
    await AsyncStorage.setItem(keyFor(profileId), JSON.stringify(prefs));
    await setSetting(profileId, SETTING_PLAYBACK_PREFS, prefs);
  } catch (e) {
    // silencioso: preferências não são críticas
  }
}

export function labelFor(list, code) {
  const found = list.find((item) => item.code === code);
  return found ? found.label : code;
}
