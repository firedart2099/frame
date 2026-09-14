import { useEffect, useMemo, useState } from 'react';
import { backdrop, poster } from '../services/constants';
import { details, season as fetchSeason, logoOf, titleOf, typeOf, yearOf, idOf } from '../lib/tmdb';
import { fetchLetterboxdRating, fetchNotasCompletas } from '../services/ratings';
import { minhaNotaLetterboxd } from '../services/minhaNota';
import { useFrame } from '../lib/FrameContext';
import { navigate, titlePath, back } from '../lib/router';
import Card, { Row } from '../components/Card';
import Icon from '../lib/icons';
import { supabase } from '../supabase';
import '../styles/title.css';

const minutes = (m) => {
  const min = m?.runtime || m?.episode_run_time?.[0];
  if (!min) return null;
  const h = Math.floor(min / 60);
  return h ? `${h}h ${min % 60}min` : `${min}min`;
};

const fmtDate = (d) => (d ? d.split('-').reverse().join('/') : '');

export default function Title({ id, type }) {
  const { play, inMyList, toggleMyList, continueWatching, activeProfile, saveTasteProfile } = useFrame();
  const [opiniaoLocal, setOpiniaoLocal] = useState(undefined);
  const [data, setData] = useState(null);
  const [logo, setLogo] = useState(null);
  const [ratings, setRatings] = useState({});
  const [seasonNo, setSeasonNo] = useState(1);
  const [episodes, setEpisodes] = useState([]);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setLogo(null);
    setRatings({});
    setEpisodes([]);
    setSeasonNo(1);
    setErro(null);

    details(id, type)
      .then((d) => {
        if (!alive) return;
        setData(d);
        // depois dos detalhes: o idioma original decide se a logo `pt` serve
        // (a TMDB nao separa Brasil de Portugal em imagem)
        logoOf(id, type, d.original_language).then((l) => alive && setLogo(l));
        // e a sua nota do Letterboxd casa por nome+ano, entao precisa do titulo
        // nota publica do Letterboxd, pelo endpoint que contorna o desafio
        fetchLetterboxdRating(id).then((v) => alive && v && setRatings((r) => ({ ...r, lbxd: v })));
        minhaNotaLetterboxd(activeProfile?.id, d).then(
          (minha) => alive && minha != null && setRatings((r) => ({ ...r, minhaLbxd: minha }))
        );
      })
      .catch((e) => alive && setErro(String(e.message || e)));

    // as mesmas fontes de nota do app
    // uma chamada ao OMDb traz IMDb, Rotten Tomatoes e premios de uma vez.
    // A nota PUBLICA do Letterboxd nao existe mais: o site esta atras de um
    // desafio do Cloudflare. No lugar dela vai a SUA nota, do CSV importado.
    fetchNotasCompletas(id, type)
      .then((omdb) => alive && setRatings((r) => ({ ...r, ...omdb })))
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [id, type]);

  useEffect(() => {
    if (type !== 'tv' || !data) return undefined;
    let alive = true;
    fetchSeason(id, seasonNo)
      .then((s) => alive && setEpisodes(s.episodes || []))
      .catch(() => alive && setEpisodes([]));
    return () => {
      alive = false;
    };
  }, [id, type, seasonNo, data]);

  /** Se já começou a ver, o botão principal vira "continuar" no ponto certo. */
  const resume = useMemo(
    () => continueWatching.find((c) => String(idOf(c)) === String(id)),
    [continueWatching, id]
  );

  useEffect(() => {
    if (resume?.savedSeason) setSeasonNo(resume.savedSeason);
  }, [resume?.savedSeason]);

  if (erro) {
    return (
      <div className="title-page">
        <div className="empty">
          Não consegui carregar esse título.
          <br />
          <button className="btn btn-ghost" style={{ marginTop: 20 }} onClick={back}>
            Voltar
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="title-page">
        <div className="empty">
          <span className="spinner" style={{ margin: '0 auto' }} />
        </div>
      </div>
    );
  }

  const m = data;
  const saved = inMyList(m);
  // opiniao ja registrada antes, pra o botao vir marcado
  const jaOpinou = (() => {
    const ex = activeProfile?.taste_profile?.explicit_interactions || {};
    const idNum = Number(id);
    if ((ex.liked || []).some((x) => Number(x) === idNum)) return 'like';
    if ((ex.disliked || []).some((x) => Number(x) === idNum)) return 'dislike';
    return null;
  })();
  // undefined = ainda nao mexeu nesta tela; ai vale o que veio do perfil
  const opiniao = opiniaoLocal === undefined ? jaOpinou : opiniaoLocal;
  const seasons = (m.seasons || []).filter((s) => s.season_number > 0);
  const cast = (m.credits?.cast || []).filter((c) => c.profile_path).slice(0, 16);
  const directors = (m.credits?.crew || []).filter((c) => c.job === 'Director').slice(0, 2);
  const creators = (m.created_by || []).slice(0, 2);
  const similar = (m.similar?.results || []).filter((s) => s.poster_path).slice(0, 18);
  const trailer = (m.videos?.results || []).find((v) => v.site === 'YouTube' && v.type === 'Trailer');

  /**
   * Joinha pra cima / pra baixo.
   *
   * Grava nos dois lugares que o app usa, porque cada um serve a uma coisa:
   * `analytics_events` e o historico bruto, e `taste_profile
   * .explicit_interactions` e o que as prateleiras leem na hora de montar a
   * Home. Escrever so num deles faria o botao parecer que nao fez nada.
   */
  const opinar = async (tipo) => {
    if (!activeProfile?.id || !m) return;
    const novo = opiniao === tipo ? null : tipo;
    setOpiniaoLocal(novo);

    const idNum = Number(id);
    const taste = activeProfile.taste_profile || {};
    const ex = taste.explicit_interactions || {};
    const tira = (lista) => (lista || []).filter((x) => Number(x) !== idNum);
    const liked = novo === 'like' ? [...tira(ex.liked), idNum] : tira(ex.liked);
    const disliked = novo === 'dislike' ? [...tira(ex.disliked), idNum] : tira(ex.disliked);

    saveTasteProfile({ ...taste, explicit_interactions: { ...ex, liked, disliked } });

    supabase
      .from('analytics_events')
      .insert({
        profile_id: activeProfile.id,
        event_type: novo === 'like' ? 'explicit_like' : novo === 'dislike' ? 'explicit_dislike' : 'explicit_clear',
        media_id: idNum,
        media_type: type,
        metadata: { score: novo === 'like' ? 30 : novo === 'dislike' ? -30 : 0 },
      })
      .then(() => {}, () => {});
  };

  const start = () =>
    play(m, {
      type,
      season: type === 'tv' ? seasonNo : 1,
      episode: type === 'tv' ? (resume?.savedSeason === seasonNo ? resume.savedEpisode || 1 : 1) : 1,
    });

  return (
    <div className="title-page">
      <header className="title-hero">
        {m.backdrop_path && (
          <div className="title-backdrop">
            <img src={backdrop(m.backdrop_path, 'w1280')} alt="" />
          </div>
        )}

        <button className="title-back" onClick={back} aria-label="Voltar">
          <Icon name="chevronLeft" size={20} />
        </button>

        <div className="title-hero-inner">
          {m.poster_path && (
            <img className="title-poster" src={poster(m.poster_path, 'w500')} alt={`Pôster de ${titleOf(m)}`} />
          )}

          <div className="title-info">
            {logo ? (
              <img className="title-logo-img" src={poster(logo, 'w500')} alt={titleOf(m)} />
            ) : (
              <h1>{titleOf(m)}</h1>
            )}

            {m.tagline && <p className="tagline">{m.tagline}</p>}

            <div className="title-meta">
              <span>{type === 'tv' ? 'Série' : 'Filme'}</span>
              {yearOf(m) && <span>{yearOf(m)}</span>}
              {minutes(m) && <span>{minutes(m)}</span>}
              {type === 'tv' && m.number_of_seasons && (
                <span>
                  {m.number_of_seasons} temporada{m.number_of_seasons > 1 ? 's' : ''}
                </span>
              )}
              {/* As mesmas notas do app, na mesma ordem e com os mesmos selos:
                  Letterboxd, público (TMDB), prêmios, IMDb e Rotten Tomatoes. */}
              {ratings.lbxd && (
                <span className="nota" title="Média pública do Letterboxd">
                  <span className="selo-lbxd">
                    <i />
                    <i />
                    <i />
                  </span>
                  <b>{ratings.lbxd}</b>
                  <small>/5</small>
                </span>
              )}
              {ratings.minhaLbxd != null && (
                <span className="nota" title="Sua nota, do seu export do Letterboxd">
                  <span className="selo-lbxd">
                    <i />
                    <i />
                    <i />
                  </span>
                  <b>{ratings.minhaLbxd}</b>
                  <small>/5 · sua nota</small>
                </span>
              )}
              {m.vote_average > 0 && (
                <span className="nota">
                  <Icon name="users" size={14} style={{ color: 'var(--fg-muted)' }} />
                  <b>{m.vote_average.toFixed(1)}</b>
                  <small>/10</small>
                </span>
              )}
              {ratings.premios && (
                <span className="nota premio" title={ratings.premiosTexto}>
                  <Icon name="award" size={14} style={{ color: '#D4AF37' }} />
                  <b style={{ color: '#D4AF37' }}>
                    {ratings.premios.n} {ratings.premios.tipo}
                    {ratings.premios.n > 1 ? 's' : ''}
                  </b>
                  <small>· {ratings.premios.ganhou ? 'ganhou' : 'indicado'}</small>
                </span>
              )}
              {ratings.imdb && (
                <span className="nota">
                  <span className="selo-imdb">IMDb</span>
                  <b>{ratings.imdb}</b>
                  <small>/10</small>
                </span>
              )}
              {ratings.rt && (
                <span className="nota">
                  <span className="selo-rt">RT</span>
                  <b>{ratings.rt}</b>
                </span>
              )}
            </div>

            {!!m.genres?.length && (
              <div className="chips">
                {m.genres.map((g) => (
                  <span className="chip" key={g.id}>
                    {g.name}
                  </span>
                ))}
              </div>
            )}

            <div className="title-actions">
              <button className="btn btn-light" onClick={start}>
                <Icon name="play" size={15} />
                {resume ? 'Continuar' : 'Assistir'}
              </button>
              <button className={`btn ${saved ? 'btn-primary' : 'btn-ghost'}`} onClick={() => toggleMyList(m)}>
                <Icon name={saved ? 'check' : 'bookmark'} size={15} />
                {saved ? 'Salvo' : 'Salvar'}
              </button>
              <button
                className={`btn btn-ghost${opiniao === 'like' ? ' ativo' : ''}`}
                onClick={() => opinar('like')}
                title="Quero mais coisas assim"
              >
                <Icon name="joinha" size={15} />
              </button>
              <button
                className={`btn btn-ghost${opiniao === 'dislike' ? ' ativo' : ''}`}
                onClick={() => opinar('dislike')}
                title="Não me recomende isso"
              >
                <Icon name="joinhaBaixo" size={15} />
              </button>
              {trailer && (
                <a
                  className="btn btn-ghost"
                  href={`https://www.youtube.com/watch?v=${trailer.key}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name="film" size={15} />
                  Trailer
                </a>
              )}
            </div>

            {resume && type === 'tv' && resume.savedSeason && (
              <p className="resume-hint">
                Você parou na temporada {resume.savedSeason}, episódio {resume.savedEpisode || 1}.
              </p>
            )}
          </div>
        </div>
      </header>

      <div className="title-body">
        <section className="title-sinopse">
          <h2 className="section-title">Sinopse</h2>
          <p>{m.overview || 'Sem sinopse em português por enquanto.'}</p>

          <dl className="title-facts">
            {!!directors.length && (
              <>
                <dt>{directors.length > 1 ? 'Direção' : 'Direção'}</dt>
                <dd>{directors.map((d) => d.name).join(', ')}</dd>
              </>
            )}
            {!!creators.length && (
              <>
                <dt>Criação</dt>
                <dd>{creators.map((c) => c.name).join(', ')}</dd>
              </>
            )}
            {(m.release_date || m.first_air_date) && (
              <>
                <dt>Estreia</dt>
                <dd>{fmtDate(m.release_date || m.first_air_date)}</dd>
              </>
            )}
            {m.status && (
              <>
                <dt>Situação</dt>
                <dd>{m.status}</dd>
              </>
            )}
          </dl>
        </section>

        {type === 'tv' && seasons.length > 0 && (
          <section className="title-section">
            <div className="season-head">
              <h2 className="section-title" style={{ margin: 0 }}>
                Episódios
              </h2>
              <select value={seasonNo} onChange={(e) => setSeasonNo(Number(e.target.value))}>
                {seasons.map((s) => (
                  <option key={s.id} value={s.season_number}>
                    {s.name || `Temporada ${s.season_number}`}
                  </option>
                ))}
              </select>
            </div>

            <ol className="ep-list">
              {episodes.map((ep) => (
                <li key={ep.id}>
                  <button
                    className="ep"
                    onClick={() => play(m, { type: 'tv', season: seasonNo, episode: ep.episode_number })}
                  >
                    <span className="ep-still">
                      {ep.still_path ? (
                        <img src={backdrop(ep.still_path, 'w300')} alt="" loading="lazy" />
                      ) : (
                        <span className="ep-num-big">{ep.episode_number}</span>
                      )}
                      <span className="ep-play">
                        <Icon name="play" size={18} />
                      </span>
                    </span>
                    <span className="ep-text">
                      <span className="ep-h">
                        <b>
                          {ep.episode_number}. {ep.name}
                        </b>
                        {ep.air_date && <span className="ep-d">{fmtDate(ep.air_date)}</span>}
                      </span>
                      {ep.overview && <span className="ep-o">{ep.overview}</span>}
                    </span>
                  </button>
                </li>
              ))}
              {!episodes.length && <li className="empty">Carregando episódios…</li>}
            </ol>
          </section>
        )}

        {!!(cast.length || directors.length || creators.length) && (
          <section className="title-section">
            <h2 className="section-title">Elenco</h2>
            {/* Direcao na frente do elenco, como no app — e clicavel: o nome
                era texto morto aqui, enquanto no celular abre a filmografia. */}
            <div className="cast-row">
              {[
                ...directors.map((d) => ({ ...d, _papel: 'Direção' })),
                ...creators.map((c) => ({ ...c, _papel: 'Criação' })),
                ...cast.map((c) => ({ ...c, _papel: c.character })),
              ].map((c, i) => (
                <figure
                  className={`cast${c._papel === 'Direção' || c._papel === 'Criação' ? ' cast-dir' : ''}`}
                  key={`${c.id}-${i}`}
                  onClick={() => navigate(`/pessoa/${c.id}`)}
                  role="button"
                  tabIndex={0}
                  title={`Ver tudo de ${c.name}`}
                >
                  {c.profile_path ? (
                    <img src={poster(c.profile_path, 'w185')} alt="" loading="lazy" />
                  ) : (
                    <div className="cast-sem-foto">{c.name.charAt(0)}</div>
                  )}
                  <figcaption>
                    <b>{c.name}</b>
                    <span>{c._papel}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        {!!similar.length && (
          <section className="title-section">
            <Row
              title="Parecidos"
              items={similar.map((s) => ({ ...s, media_type: type }))}
              onOpen={(item) => navigate(titlePath({ ...item, media_type: type }))}
            />
          </section>
        )}
      </div>
    </div>
  );
}
