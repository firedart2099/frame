import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabase';
import {
  startProfileSync,
  persistFolders,
  setSetting,
  enqueue,
  flushOutbox,
  nowIso,
  pullWatchlist,
  pullContinueWatching,
  outboxSize,
  SETTING_ONBOARDED,
} from '../services/sync';
import { loadPlaybackPrefs, savePlaybackPrefs, DEFAULT_PREFS } from '../services/playbackPrefs';
import { idOf, typeOf, titleOf } from './tmdb';

/**
 * Estado do usuário logado — o equivalente web do componente App do app.
 * As mesmas tabelas, a mesma fila offline, a mesma resolução de conflito:
 * o que você salva aqui aparece no celular e vice-versa.
 */

const Ctx = createContext(null);
export const useFrame = () => useContext(Ctx);

export function FrameProvider({ children }) {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [activeProfile, setActiveProfile] = useState(null);
  const [isOnboarded, setIsOnboarded] = useState(null); // null = ainda não sei

  const [myList, setMyList] = useState([]);
  const [continueWatching, setContinueWatching] = useState([]);
  const [folders, setFolders] = useState([]);
  const [folderItems, setFolderItems] = useState({});
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [pendingWrites, setPendingWrites] = useState(0);

  // player: um só, compartilhado entre tela cheia e miniplayer
  const [playing, setPlaying] = useState(null); // { item, type, season, episode }
  const [mini, setMini] = useState(false);

  const profileId = activeProfile?.id || null;

  // ---------------------------------------------------- perfil que fica

  /**
   * O perfil escolhido sobrevive a remontagem.
   *
   * Arrastar a janela de um monitor pro outro derrubava a sessão inteira de
   * volta pra "selecione o perfil". O motivo não é óbvio: a largura em CSS
   * muda com o monitor (tamanho e escala), `useIsMobile` vira true, o App
   * troca o AppShell pela landing — e o FrameProvider mora DENTRO do AppShell,
   * então desmontar levou junto perfil, listas e o que estava tocando.
   *
   * Guardar o id resolve isso e mais um caso que ninguém tinha pedido mas todo
   * mundo esperava: dar F5 e continuar no mesmo perfil.
   *
   * A restauração acontece UMA vez por montagem. Sem isso, clicar em "trocar
   * de perfil" (que zera o perfil ativo) seria desfeito no mesmo instante.
   */
  const K_PERFIL_ATIVO = 'frame_perfil_ativo';
  const perfilRestauradoRef = useRef(false);

  useEffect(() => {
    if (perfilRestauradoRef.current || activeProfile || !profiles.length) return;
    perfilRestauradoRef.current = true;
    try {
      const salvo = window.localStorage.getItem(K_PERFIL_ATIVO);
      if (!salvo) return;
      const achado = profiles.find((x) => String(x.id) === salvo);
      if (achado) setActiveProfile(achado);
    } catch (e) {
      /* localStorage bloqueado: só não lembra */
    }
  }, [profiles, activeProfile]);

  useEffect(() => {
    try {
      if (profileId) window.localStorage.setItem(K_PERFIL_ATIVO, String(profileId));
      else window.localStorage.removeItem(K_PERFIL_ATIVO);
    } catch (e) {}
  }, [profileId]);

  // ------------------------------------------------------------- sessão
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session || null);
      setBooting(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s || null);
      if (!s) {
        setActiveProfile(null);
        setProfiles([]);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadProfiles = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*');
    const list = (data || []).map((p) => {
      let tp = p.taste_profile;
      if (typeof tp === 'string') {
        try {
          tp = JSON.parse(tp);
        } catch (e) {}
      }
      return { ...p, taste_profile: tp };
    });
    setProfiles(list);
    return list;
  }, []);

  useEffect(() => {
    if (session) loadProfiles();
  }, [session, loadProfiles]);

  // -------------------------------------------------------- sync do perfil
  useEffect(() => {
    if (!profileId) return undefined;
    setIsOnboarded(activeProfile?.taste_profile?.analytics ? true : null);
    loadPlaybackPrefs(profileId).then(setPrefs);

    return startProfileSync(profileId, {
      onFolders: ({ folders: f, itemsMap }) => {
        setFolders(f);
        setFolderItems(itemsMap);
      },
      onSettings: (s) => {
        if (typeof s[SETTING_ONBOARDED] === 'boolean') setIsOnboarded(s[SETTING_ONBOARDED]);
      },
      onWatchlist: (list) => list && setMyList(list),
      onContinueWatching: (list) => list && list.length && setContinueWatching(list),
    });
  }, [profileId]); // eslint-disable-line react-hooks/exhaustive-deps

  // primeira carga (o sync também puxa, mas isso aqui é imediato)
  useEffect(() => {
    if (!profileId) return;
    let alive = true;
    (async () => {
      try {
        const [wl, cw] = await Promise.all([pullWatchlist(profileId), pullContinueWatching(profileId)]);
        if (!alive) return;
        setMyList(wl);
        setContinueWatching(cw);
      } catch (e) {}
    })();
    return () => {
      alive = false;
    };
  }, [profileId]);

  // indicador de "tem coisa pra subir"
  useEffect(() => {
    const tick = async () => setPendingWrites(await outboxSize());
    tick();
    const t = setInterval(tick, 4000);
    return () => clearInterval(t);
  }, []);

  // ------------------------------------------------------------- ações
  const persistFoldersState = useCallback(
    (f, itemsMap) => {
      setFolders(f);
      setFolderItems(itemsMap);
      return persistFolders(profileId, f, itemsMap);
    },
    [profileId]
  );

  const markOnboarded = useCallback(
    async (value) => {
      setIsOnboarded(value);
      if (profileId) await setSetting(profileId, SETTING_ONBOARDED, !!value);
    },
    [profileId]
  );

  const inMyList = useCallback(
    (item) => myList.some((m) => idOf(m) === idOf(item)),
    [myList]
  );

  const toggleMyList = useCallback(
    async (media) => {
      if (!profileId) return;
      const mediaId = idOf(media);
      const exists = myList.some((m) => idOf(m) === mediaId);
      setMyList((prev) => (exists ? prev.filter((m) => idOf(m) !== mediaId) : [media, ...prev]));

      const stamp = nowIso();
      await enqueue([
        {
          table: 'watchlists',
          onConflict: 'profile_id,tmdb_id',
          row: {
            profile_id: profileId,
            tmdb_id: mediaId,
            media_type: typeOf(media),
            title: titleOf(media) || null,
            poster_path: media.poster_path || null,
            metadata: exists ? {} : media,
            added_at: stamp,
            deleted_at: exists ? stamp : null,
            updated_at: stamp,
          },
        },
      ]);
      flushOutbox();
    },
    [profileId, myList]
  );

  const pushContinueWatching = useCallback(
    async (media, extra = {}) => {
      if (!profileId) return;
      const mediaId = idOf(media);
      const entry = { ...media, ...extra };
      setContinueWatching((prev) => [entry, ...prev.filter((m) => idOf(m) !== mediaId)].slice(0, 20));

      await enqueue([
        {
          table: 'continue_watching',
          onConflict: 'profile_id,tmdb_id',
          row: {
            profile_id: profileId,
            tmdb_id: mediaId,
            media_type: typeOf(media),
            title: titleOf(media) || null,
            poster_path: media.poster_path || null,
            season_number: extra.savedSeason || null,
            episode_number: extra.savedEpisode || null,
            metadata: entry,
            deleted_at: null,
            updated_at: nowIso(),
          },
        },
      ]);
      flushOutbox();
    },
    [profileId]
  );

  const removeContinueWatching = useCallback(
    async (media) => {
      if (!profileId) return;
      const mediaId = idOf(media);
      setContinueWatching((prev) => prev.filter((m) => idOf(m) !== mediaId));
      const stamp = nowIso();
      await enqueue([
        {
          table: 'continue_watching',
          onConflict: 'profile_id,tmdb_id',
          row: {
            profile_id: profileId,
            tmdb_id: mediaId,
            media_type: typeOf(media),
            title: titleOf(media) || null,
            poster_path: media.poster_path || null,
            season_number: media.savedSeason || null,
            episode_number: media.savedEpisode || null,
            metadata: {},
            deleted_at: stamp,
            updated_at: stamp,
          },
        },
      ]);
      flushOutbox();
    },
    [profileId]
  );

  const saveTasteProfile = useCallback(
    async (tasteProfile) => {
      if (!profileId) return;
      await supabase.from('profiles').update({ taste_profile: tasteProfile }).eq('id', profileId);
      setActiveProfile((p) => (p ? { ...p, taste_profile: tasteProfile } : p));
      setProfiles((list) => list.map((p) => (p.id === profileId ? { ...p, taste_profile: tasteProfile } : p)));
    },
    [profileId]
  );

  const updatePrefs = useCallback(
    (next) => {
      setPrefs(next);
      savePlaybackPrefs(profileId, next);
    },
    [profileId]
  );

  const play = useCallback(
    (item, opts = {}) => {
      // quem chama pode declarar o tipo (a pagina de detalhes sabe pela rota);
      // typeOf e o palpite, nao a fonte da verdade
      const type = opts.type === 'tv' || opts.type === 'movie' ? opts.type : typeOf(item);
      setPlaying({ item, type, season: opts.season || 1, episode: opts.episode || 1 });
      setMini(false);
      pushContinueWatching(item, {
        savedSeason: type === 'tv' ? opts.season || 1 : null,
        savedEpisode: type === 'tv' ? opts.episode || 1 : null,
      });
    },
    [pushContinueWatching]
  );

  const stop = useCallback(() => {
    setPlaying(null);
    setMini(false);
  }, []);

  const signOut = useCallback(async () => {
    await flushOutbox();
    await supabase.auth.signOut();
    setActiveProfile(null);
  }, []);

  const value = useMemo(
    () => ({
      booting, session, profiles, activeProfile, isOnboarded,
      myList, continueWatching, folders, folderItems, prefs, pendingWrites,
      playing, mini,
      setActiveProfile, setProfiles, loadProfiles, setIsOnboarded,
      persistFoldersState, markOnboarded, inMyList, toggleMyList,
      pushContinueWatching, removeContinueWatching, saveTasteProfile, updatePrefs,
      play, stop, setMini, signOut,
    }),
    [
      booting, session, profiles, activeProfile, isOnboarded, myList, continueWatching,
      folders, folderItems, prefs, pendingWrites, playing, mini, loadProfiles,
      persistFoldersState, markOnboarded, inMyList, toggleMyList, pushContinueWatching,
      removeContinueWatching, saveTasteProfile, updatePrefs, play, stop, signOut,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
