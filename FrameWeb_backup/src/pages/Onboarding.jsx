import { useCallback, useEffect, useRef, useState } from 'react';
import { tmdb, poster } from '../services/constants';
import { titleOf, yearOf } from '../lib/tmdb';
import { useFrame } from '../lib/FrameContext';
import LetterboxdImport from '../components/LetterboxdImport';
import Icon from '../lib/icons';

const MIN_PICKS = 5;

/**
 * Calibração de gosto — mesma ideia do app: escolhe filmes, depois séries.
 * O Letterboxd resolve a parte de filmes de uma vez, mas ainda pede as
 * séries, porque o export não tem nada de TV.
 *
 * A grade puxa os títulos mais AMADOS de todos os tempos, não os populares
 * da semana: `sort_by=vote_count.desc` com nota mínima. Popularidade da TMDB
 * é o que está em alta hoje — enche a tela de lançamento que ninguém viu, e
 * calibrar gosto com isso não diz nada sobre a pessoa.
 */

const DISCOVER = {
  movie: { 'vote_average.gte': 7, 'vote_count.gte': 1500 },
  tv: { 'vote_average.gte': 7.5, 'vote_count.gte': 300 },
};

const fetchPage = async (kind, page) => {
  const json = await tmdb(`/discover/${kind}`, {
    sort_by: 'vote_count.desc',
    include_adult: 'false',
    page,
    ...DISCOVER[kind],
  });
  return (json.results || []).filter((m) => m.poster_path);
};

export default function Onboarding() {
  const { saveTasteProfile, markOnboarded, activeProfile } = useFrame();
  const [phase, setPhase] = useState('movie'); // movie | tv
  const [grid, setGrid] = useState([]);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);

  const [picked, setPicked] = useState([]);
  const [moviePicks, setMoviePicks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [fromLetterboxd, setFromLetterboxd] = useState(null);

  const seen = useRef(new Set());
  const sentinel = useRef(null);

  // troca de etapa: zera a grade e o histórico de ids
  useEffect(() => {
    seen.current = new Set();
    setGrid([]);
    setPage(1);
    setExhausted(false);
    setQuery('');
    setResults(null);
  }, [phase]);

  // carrega uma página da grade
  useEffect(() => {
    let alive = true;
    setLoadingMore(true);
    fetchPage(phase, page)
      .then((items) => {
        if (!alive) return;
        const novos = items.filter((m) => !seen.current.has(m.id));
        novos.forEach((m) => seen.current.add(m.id));
        // a TMDB para de paginar em algum ponto; sem isso o observer ficaria
        // pedindo página nova pra sempre
        if (!novos.length) setExhausted(true);
        setGrid((prev) => [...prev, ...novos]);
      })
      .catch(() => alive && setExhausted(true))
      .finally(() => alive && setLoadingMore(false));
    return () => {
      alive = false;
    };
  }, [phase, page]);

  // rolagem infinita de verdade
  useEffect(() => {
    const el = sentinel.current;
    if (!el || results || exhausted) return undefined;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !loadingMore) setPage((p) => p + 1);
      },
      { rootMargin: '900px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [results, exhausted, loadingMore]);

  // busca
  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      return undefined;
    }
    let alive = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const json = await tmdb(`/search/${phase}`, { query: query.trim(), include_adult: 'false' });
        if (alive) setResults((json.results || []).filter((m) => m.poster_path));
      } catch (e) {
        if (alive) setResults([]);
      }
      if (alive) setSearching(false);
    }, 320);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, phase]);

  const toggle = (m) =>
    setPicked((prev) => (prev.some((p) => p.id === m.id) ? prev.filter((p) => p.id !== m.id) : [...prev, m]));

  /** Conta gênero/diretor/elenco/tema dos escolhidos, no formato do app. */
  const analyze = useCallback(async (items, kind) => {
    const top_genres = {};
    const top_directors = {};
    const top_cast = {};
    const top_keywords = {};
    const raw_genre_ids = [];

    await Promise.all(
      items.map(async (m) => {
        (m.genre_ids || []).forEach((g) => {
          top_genres[g] = (top_genres[g] || 0) + 1;
          raw_genre_ids.push(g);
        });
        try {
          const full = await tmdb(`/${kind}/${m.id}`, { append_to_response: 'credits,keywords' });
          (full.credits?.crew || [])
            .filter((c) => c.job === 'Director' || c.known_for_department === 'Directing')
            .slice(0, 2)
            .forEach((d) => (top_directors[d.id] = (top_directors[d.id] || 0) + 1));
          (full.credits?.cast || []).slice(0, 4).forEach((c) => (top_cast[c.id] = (top_cast[c.id] || 0) + 1));
          const kws = full.keywords?.keywords || full.keywords?.results || [];
          kws.slice(0, 6).forEach((k) => (top_keywords[k.id] = (top_keywords[k.id] || 0) + 1));
        } catch (e) {}
      })
    );
    return { top_genres, top_directors, top_cast, top_keywords, raw_genre_ids };
  }, []);

  const merge = (a = {}, b = {}) => {
    const out = { ...a };
    Object.entries(b).forEach(([k, v]) => (out[k] = (out[k] || 0) + v));
    return out;
  };

  const next = async () => {
    if (phase === 'movie') {
      setMoviePicks(picked);
      setPicked([]);
      setPhase('tv');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setBusy(true);
    const [mv, tv] = await Promise.all([
      moviePicks.length ? analyze(moviePicks, 'movie') : Promise.resolve({}),
      analyze(picked, 'tv'),
    ]);

    const base = fromLetterboxd?.analytics || {};
    const total = moviePicks.length + picked.length || 1;
    const topGenres = merge(merge(base.top_genres, mv.top_genres), tv.top_genres);

    await saveTasteProfile({
      analytics: {
        avg_rating_preference: base.avg_rating_preference || 4.0,
        release_year_trend: base.release_year_trend || 0,
        top_genres: topGenres,
        top_directors: merge(merge(base.top_directors, mv.top_directors), tv.top_directors),
        top_cast: merge(merge(base.top_cast, mv.top_cast), tv.top_cast),
        top_keywords: merge(merge(base.top_keywords, mv.top_keywords), tv.top_keywords),
        tv_ratio: Number((picked.length / total).toFixed(2)),
        raw_genre_ids: [...(base.raw_genre_ids || []), ...(mv.raw_genre_ids || []), ...(tv.raw_genre_ids || [])],
        recent_genre_shift: Object.entries(topGenres).sort((a, b) => b[1] - a[1])[0]?.[0] || '',
      },
      context: { preferred_device: 'web', prime_watch_time: 'unknown' },
      is_cinephile: !!fromLetterboxd,
    });
    await markOnboarded(true);
    setBusy(false);
  };

  const enough = picked.length >= MIN_PICKS;
  const shown = results ?? grid;

  if (importing) {
    return (
      <div className="onb">
        <button className="back-link" onClick={() => setImporting(false)}>
          <Icon name="chevronLeft" size={14} />
          Voltar
        </button>
        <h1>Traz seu Letterboxd</h1>
        <p className="sub">
          Anos de diário, watchlist e notas viram recomendação em segundos. Depois só falta escolher umas
          séries — o Letterboxd não tem TV.
        </p>
        <div style={{ maxWidth: 560 }}>
          <LetterboxdImport
            onDone={(r) => {
              setFromLetterboxd(r.taste_profile);
              setImporting(false);
              setMoviePicks([]);
              setPicked([]);
              setPhase('tv');
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="onb">
      <p className="eyebrow">
        {phase === 'movie' ? 'Passo 1 de 2' : 'Passo 2 de 2'} · {activeProfile?.name}
      </p>
      <h1>{phase === 'movie' ? 'Escolhe uns filmes que você ama.' : 'Agora umas séries.'}</h1>
      <p className="sub">
        {phase === 'movie'
          ? 'Os mais amados de todos os tempos primeiro. Não precisa pensar muito — bate o olho e marca o que você gosta. Rola pra baixo que sempre vem mais.'
          : fromLetterboxd
          ? 'Seus filmes já vieram do Letterboxd. Falta a parte de TV, que o export não traz.'
          : 'Mesma coisa, agora do lado das séries.'}
      </p>

      <div className="onb-tools">
        <div className="header-search onb-search">
          <Icon name="search" size={16} style={{ color: 'var(--fg-dim)' }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={phase === 'movie' ? 'Procurar um filme…' : 'Procurar uma série…'}
            aria-label={phase === 'movie' ? 'Procurar um filme' : 'Procurar uma série'}
          />
          {searching && <span className="spinner" style={{ width: 14, height: 14 }} />}
          {query && !searching && (
            <button onClick={() => setQuery('')} aria-label="Limpar busca" style={{ color: 'var(--fg-dim)' }}>
              <Icon name="x" size={15} />
            </button>
          )}
        </div>

        {phase === 'movie' && (
          <button className="btn btn-ghost" onClick={() => setImporting(true)}>
            <Icon name="upload" size={15} />
            Tenho Letterboxd
          </button>
        )}
      </div>

      {results && (
        <p className="onb-hint">
          {results.length
            ? `${results.length} resultado(s) para “${query}”. Marca e continua rolando quando limpar a busca.`
            : `Nada encontrado para “${query}”.`}
        </p>
      )}

      <div className="onb-grid">
        {shown.map((m) => {
          const on = picked.some((p) => p.id === m.id);
          return (
            <button
              key={m.id}
              className={`pick${on ? ' on' : ''}`}
              onClick={() => toggle(m)}
              aria-pressed={on}
              aria-label={`${titleOf(m)}${yearOf(m) ? ` (${yearOf(m)})` : ''}`}
              title={`${titleOf(m)}${yearOf(m) ? ` · ${yearOf(m)}` : ''}`}
            >
              <img src={poster(m.poster_path, 'w342')} alt="" loading="lazy" decoding="async" />
              <span className="tick">
                <Icon name="check" size={30} />
              </span>
            </button>
          );
        })}
      </div>

      {!results && (
        <>
          <div ref={sentinel} style={{ height: 1 }} />
          {loadingMore && (
            <div className="onb-more">
              <span className="spinner" />
            </div>
          )}
          {exhausted && grid.length > 0 && (
            <p className="onb-hint" style={{ textAlign: 'center', marginTop: 26 }}>
              Acabou a lista. Se faltou alguma coisa, usa a busca aí em cima.
            </p>
          )}
        </>
      )}

      {!shown.length && !loadingMore && !searching && <div className="empty">Carregando…</div>}

      <div className="onb-bar">
        <span className="count">
          <b>{picked.length}</b> {picked.length === 1 ? 'escolhido' : 'escolhidos'}
          {!enough && ` · faltam ${MIN_PICKS - picked.length}`}
        </span>
        <div className="push">
          <button className="btn btn-primary" disabled={!enough || busy} onClick={next}>
            {busy ? <span className="spinner" /> : phase === 'movie' ? 'Continuar' : 'Terminar'}
            {!busy && <Icon name="arrowRight" size={15} />}
          </button>
        </div>
      </div>
    </div>
  );
}
