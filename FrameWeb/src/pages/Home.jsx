import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '../lib/FrameContext';
import { buildHeroPool, fetchShelf, logoOf, titleOf, typeOf, yearOf, idOf } from '../lib/tmdb';
import { backdrop, poster, tmdb } from '../services/constants';
import { fetchLetterboxdRating, fetchNotasCompletas } from '../services/ratings';
import { INFINITE_SHELF_POOL, generateDynamicShelves } from '../services/shelves';
import * as Recs from '../services/recomendacoes';
import { getSetting } from '../services/sync/settings';
import { ultimoEpisodio } from '../services/watchProgress';
import { Row, WideCard } from '../components/Card';
import Icon from '../lib/icons';
import { navigate, titlePath } from '../lib/router';
import ColecaoCard from '../components/ColecaoCard';
import { COLECOES } from '../config/colecoes';

const HERO_MS = 9000;
const SHELVES_PER_PAGE = 4;

/* ------------------------------------------------------------------ hero
   No app o banner é um card em pé. Aqui a tela é deitada: usa o backdrop
   16:9 inteiro, texto ancorado à esquerda e o logo do título no lugar do
   texto — que é o que a faixa larga pede. */

function Hero({ pool, onOpen }) {
  const { play, inMyList, toggleMyList, activeProfile } = useFrame();
  const [i, setI] = useState(0);
  const [logo, setLogo] = useState(null);
  // O app mostra Letterboxd em filme e IMDb em serie — nao a media da TMDB,
  // que ninguem usa como referencia. O banner do site fazia diferente.
  const [nota, setNota] = useState(null);
  const [premios, setPremios] = useState(null);
  // Enquanto a nota do Letterboxd nao volta, o banner nao mostra nota nenhuma.
  // Antes ele exibia a da TMDB/IMDb e trocava segundos depois — pisca e da a
  // impressao de que o numero mudou de valor.
  const [notaPendente, setNotaPendente] = useState(false);
  const paused = useRef(false);

  const item = pool[i];

  useEffect(() => {
    if (pool.length < 2) return undefined;
    const t = setInterval(() => {
      if (!paused.current) setI((n) => (n + 1) % pool.length);
    }, HERO_MS);
    return () => clearInterval(t);
  }, [pool.length]);

  useEffect(() => {
    let alive = true;
    setLogo(null);
    if (!item) return undefined;
    logoOf(idOf(item), typeOf(item), item.original_language).then((l) => alive && setLogo(l));

    // filme -> Letterboxd, serie -> IMDb, exatamente como o app faz. E a mesma
    // chamada ao OMDb ja traz os premios, entao o banner mostra o Oscar/Emmy
    // sem pedir nada a mais.
    setNota(null);
    setPremios(null);
    const ehSerie = typeOf(item) === 'tv';
    setNotaPendente(!ehSerie); // em filme, espera o Letterboxd antes de mostrar

    fetchNotasCompletas(idOf(item), ehSerie ? 'tv' : 'movie')
      .then((omdb) => {
        if (!alive) return;
        if (omdb.premios) setPremios({ ...omdb.premios, texto: omdb.premiosTexto });
        if (ehSerie && omdb.imdb) setNota({ valor: omdb.imdb, fonte: 'imdb' });
      })
      .catch(() => {});

    // A nota publica do Letterboxd caiu (desafio do Cloudflare no site deles).
    // No lugar dela, a SUA nota do export — quando o filme estiver no seu CSV.
    if (!ehSerie) {
      fetchLetterboxdRating(idOf(item))
        .then((v) => {
          if (!alive) return;
          if (v) setNota({ valor: v, fonte: 'lbxd' });
          setNotaPendente(false); // sem Letterboxd, ai sim vale o que houver
        })
        .catch(() => alive && setNotaPendente(false));
    }
    return () => {
      alive = false;
    };
  }, [item]);

  if (!item) return null;
  const saved = inMyList(item);

  return (
    <section
      className="home-hero"
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
    >
      <div className="backdrop">
        {item.backdrop_path && <img key={item.id} src={backdrop(item.backdrop_path, 'w1280')} alt="" />}
      </div>

      <div className="inner">
        {logo ? (
          <img className="title-logo" src={poster(logo, 'w500')} alt={titleOf(item)} />
        ) : (
          <h1>{titleOf(item)}</h1>
        )}

        <div className="meta">
          <span>{typeOf(item) === 'tv' ? 'Série' : 'Filme'}</span>
          {yearOf(item) && <span>{yearOf(item)}</span>}
          {nota && nota.fonte === 'lbxd' ? (
            <span className="nota" title="Média pública do Letterboxd">
              <span className="selo-lbxd">
                <i />
                <i />
                <i />
              </span>
              <b>{nota.valor}</b>
              <small>/5</small>
            </span>
          ) : nota && nota.fonte === 'imdb' ? (
            <span className="nota">
              <span className="selo-imdb">IMDb</span>
              <b>{nota.valor}</b>
              <small>/10</small>
            </span>
          ) : (
            // nada enquanto o Letterboxd nao responde: melhor um espaco vazio
            // por um segundo do que um numero que se troca na cara da pessoa
            !notaPendente &&
            item.vote_average > 0 && (
              <span className="nota">
                <Icon name="users" size={13} style={{ color: 'var(--fg-muted)' }} />
                <b>{item.vote_average.toFixed(1)}</b>
                <small>/10</small>
              </span>
            )
          )}
          {premios && (
            <span className="nota premio" title={premios.texto}>
              <Icon name="award" size={13} style={{ color: '#D4AF37' }} />
              <b style={{ color: '#D4AF37' }}>
                {premios.n} {premios.tipo}
                {premios.n > 1 ? 's' : ''}
              </b>
              <small>· {premios.ganhou ? 'ganhou' : 'indicado'}</small>
            </span>
          )}
          {item._fromWatchlist && <span style={{ color: 'var(--fg)' }}>Da sua watchlist</span>}
        </div>

        <p className="overview">{item.overview}</p>

        <div className="actions">
          <button className="btn btn-light" onClick={() => play(item)}>
            <Icon name="play" size={15} />
            Assistir
          </button>
          <button className={`btn ${saved ? 'btn-primary' : 'btn-ghost'}`} onClick={() => toggleMyList(item)}>
            <Icon name={saved ? 'check' : 'bookmark'} size={15} />
            {saved ? 'Salvo' : 'Salvar'}
          </button>
          <button className="btn btn-ghost" onClick={() => navigate(titlePath(item))}>
            <Icon name="info" size={15} />
            Detalhes
          </button>
        </div>

        <div className="hero-dots" role="tablist" aria-label="Destaques">
          {pool.map((p, n) => (
            <button
              key={idOf(p)}
              className={n === i ? 'on' : ''}
              onClick={() => setI(n)}
              aria-label={`Destaque ${n + 1}: ${titleOf(p)}`}
              aria-selected={n === i}
              role="tab"
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ home */

/** Uma prateleira a partir de ids do TMDB; some se não juntar gente o bastante. */
async function prateleiraDeIds(id, titulo, ids) {
  if (!ids || ids.length < 6) return null;
  const itens = await Recs.buscarFilmes(ids);
  if (itens.length < 6) return null;
  return { id, title: titulo, type: 'movie', items: itens };
}

// A busca por nome mora na aba Explorar — aqui e so o que o Frame acha que
// voce quer ver.
export default function Home({ onOpen }) {
  const { activeProfile, myList, continueWatching, removeContinueWatching, play, folderItems, folders } = useFrame();
  const [heroPool, setHeroPool] = useState([]);
  const [shelves, setShelves] = useState([]);
  const [visible, setVisible] = useState(SHELVES_PER_PAGE);
  const sentinel = useRef(null);

  const taste = activeProfile?.taste_profile;

  /**
   * Tudo que voce ja viu: o diario do Letterboxd (a pasta importada) mais o
   * "continuar assistindo". Recomendar de volta o que a pessoa acabou de ver e
   * o jeito mais rapido de a Home parecer burra.
   */
  /**
   * O CSV do Letterboxd guarda nome e ano, não id do TMDB. O app resolve isso
   * aos poucos e grava em `lbxd_ids` (profile_settings, que sincroniza) — aqui
   * a gente só lê. É esse mapa que faz o filtro de "já vi" ter o que filtrar.
   */
  const [mapaLbxd, setMapaLbxd] = useState({});
  useEffect(() => {
    if (!activeProfile?.id) return;
    getSetting(activeProfile.id, 'lbxd_ids', {}).then((m) => setMapaLbxd(m || {}));
  }, [activeProfile?.id]);

  const jaVistos = useMemo(
    () =>
      Recs.idsJaVistos({
        itemsMap: folderItems || {},
        taste,
        continueWatching,
        mapaLbxd,
      }),
    [folderItems, continueWatching, taste, mapaLbxd]
  );

  /**
   * "Vale a pena ver de novo": os favoritos que vieram do Letterboxd — os
   * quatro do topo do perfil e tudo que voce deu nota 4 ou mais. Sao os unicos
   * titulos que MERECEM reaparecer depois de vistos.
   */
  const favoritos = useMemo(
    () => Recs.idsParaRever({ itemsMap: folderItems || {}, taste, mapaLbxd }),
    [folderItems, taste, mapaLbxd]
  );

  /** O que ela marcou pra ver no Letterboxd e ainda não viu. */
  const daWatchlist = useMemo(
    () => Recs.idsDaWatchlistLbxd({ itemsMap: folderItems || {}, mapaLbxd, vistos: jaVistos }),
    [folderItems, mapaLbxd, jaVistos]
  );

  // banner
  useEffect(() => {
    let alive = true;
    const watched = new Set(continueWatching.map((c) => String(idOf(c))));
    buildHeroPool(taste, myList, watched).then((pool) => alive && setHeroPool(pool));
    return () => {
      alive = false;
    };
    // roda uma vez por perfil: não quero o banner trocando a cada save
  }, [activeProfile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // prateleiras: as mesmas fórmulas do app
  const formulas = useMemo(() => {
    try {
      const pessoais = (generateDynamicShelves(taste) || []).sort(
        (a, b) => (b._score || 0) - (a._score || 0)
      );
      // As personalizadas acabam (sao ~50). Depois delas entra o pool geral,
      // que e o mesmo do app e nao tem fim — a Home parava de crescer no meio
      // do scroll justamente por faltar isto.
      const vistas = new Set(pessoais.map((f) => f.title));
      const gerais = (INFINITE_SHELF_POOL || []).filter((f) => !vistas.has(f.title));
      return [...pessoais, ...gerais];
    } catch (e) {
      return [];
    }
  }, [taste]);

  /**
   * Linhas antigas do "continuar assistindo" foram gravadas antes das colunas
   * de temporada e episodio existirem, entao vem sem o "T1 - E4". O progresso
   * por episodio sempre existiu: da pra recuperar dali.
   */
  const [episodioPorId, setEpisodioPorId] = useState({});
  useEffect(() => {
    let vivo = true;
    const faltando = (continueWatching || []).filter(
      (c) => typeOf(c) === 'tv' && !c.savedSeason && idOf(c)
    );
    if (!faltando.length || !activeProfile?.id) return undefined;
    Promise.all(
      faltando.map(async (c) => [idOf(c), await ultimoEpisodio(activeProfile.id, idOf(c))])
    ).then((pares) => {
      if (!vivo) return;
      const mapa = {};
      for (const [id, ep] of pares) if (ep) mapa[String(id)] = ep;
      if (Object.keys(mapa).length) setEpisodioPorId((m) => ({ ...m, ...mapa }));
    });
    return () => {
      vivo = false;
    };
  }, [continueWatching, activeProfile?.id]);

  const continuarComEpisodio = useMemo(
    () =>
      (continueWatching || []).map((c) => {
        const extra = episodioPorId[String(idOf(c))];
        return extra && !c.savedSeason ? { ...c, savedSeason: extra.season, savedEpisode: extra.episode } : c;
      }),
    [continueWatching, episodioPorId]
  );

  const semVistos = useCallback((itens) => Recs.semVistos(itens, jaVistos), [jaVistos]);

  useEffect(() => {
    let alive = true;
    setShelves([]);
    setVisible(SHELVES_PER_PAGE);
    (async () => {
      const loaded = await Promise.all(
        formulas.slice(0, SHELVES_PER_PAGE).map(async (f) => ({ ...f, items: semVistos(await fetchShelf(f)) }))
      );
      // As mesmas três linhas pessoais do app, na mesma ordem: o que vale
      // rever, o que você mesmo marcou pra ver, e o "porque você assistiu".
      const [revisitar, watchlist, porque] = await Promise.all([
        prateleiraDeIds('revisitar', 'Vale a pena ver de novo', favoritos),
        prateleiraDeIds('lbxd-watchlist', 'Sua watchlist do Letterboxd', daWatchlist),
        Recs.linhasPorqueAssistiu({
          bases: [...(continueWatching || []), ...(myList || [])],
          vistos: jaVistos,
        }),
      ]);
      if (alive) {
        const prontas = loaded.filter((s) => s.items.length >= 6);
        const pessoais = [revisitar, watchlist, ...(porque || [])].filter(Boolean);
        setShelves([prontas[0], ...pessoais, ...prontas.slice(1)].filter(Boolean));
      }
    })();
    return () => {
      alive = false;
    };
  }, [formulas]);

  // rolagem infinita das prateleiras
  // Coleções (Marvel, Pixar, Star Wars...) entram no feed como cartões
  // especiais, iguais aos do app: o primeiro depois da 2ª prateleira, depois
  // a cada 5. A ordem entre elas é sorteada uma vez por sessão; as que não
  // couberam entram conforme o feed cresce.
  const ordemColecoes = useMemo(() => [...COLECOES].sort(() => Math.random() - 0.5), []);
  const feed = useMemo(() => {
    const saida = [];
    let proximo = 2;
    let ci = 0;
    shelves.forEach((s, i) => {
      saida.push(s);
      if (i + 1 === proximo && ci < ordemColecoes.length) {
        const c = ordemColecoes[ci++];
        saida.push({ kind: 'colecao', id: `col_${c.id}`, colecao: c });
        proximo += 5;
      }
    });
    return saida;
  }, [shelves, ordemColecoes]);

  const loadMore = useCallback(async () => {
    const next = formulas.slice(visible, visible + SHELVES_PER_PAGE);
    if (!next.length) return;
    setVisible((v) => v + SHELVES_PER_PAGE);
    const loaded = await Promise.all(next.map(async (f) => ({ ...f, items: semVistos(await fetchShelf(f)) })));
    setShelves((prev) => [...prev, ...loaded.filter((s) => s.items.length >= 6)]);
  }, [formulas, visible]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && loadMore(), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  return (
    <>
      <Hero pool={heroPool} onOpen={onOpen} />

      <div className="rows">
        {continueWatching.length > 0 && (
          <Row
            title="Continuar assistindo"
            items={continuarComEpisodio}
            wide
            renderItem={(item) => (
              <WideCard
                item={item}
                onOpen={onOpen}
                onPlay={(m) => play(m, { season: m.savedSeason || 1, episode: m.savedEpisode || 1 })}
                onRemove={removeContinueWatching}
              />
            )}
          />
        )}

        {myList.length > 0 && <Row title="Sua Watchlist" items={myList} onOpen={onOpen} />}

        {feed.map((s) =>
          s.kind === 'colecao' ? (
            <ColecaoCard key={s.id} colecao={s.colecao} salva={!!(folders || []).find((f) => f.id === `colecao_${s.colecao.id}`)} />
          ) : (
            <Row key={s.id || s.title} title={s.title} items={s.items} onOpen={onOpen} />
          )
        )}

        {!shelves.length && (
          <div className="empty">
            <span className="spinner" style={{ margin: '0 auto 14px' }} />
            Montando suas prateleiras…
          </div>
        )}

        <div ref={sentinel} style={{ height: 1 }} />
      </div>
    </>
  );
}
