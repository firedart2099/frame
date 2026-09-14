import { useEffect, useState } from 'react';
import { tmdb, poster } from '../services/constants';
import { titlePath, navigate, back } from '../lib/router';
import Card from '../components/Card';
import Icon from '../lib/icons';

/**
 * Tudo de uma pessoa — direção primeiro, depois atuação.
 *
 * Existe porque no app o diretor é clicável e abre a filmografia dele; no site
 * o nome era texto morto. A separação importa: quem clica em "Christopher
 * Nolan" quer os filmes que ele DIRIGIU, não as pontas em que apareceu.
 */
export default function Person({ id }) {
  const [pessoa, setPessoa] = useState(null);
  const [dirigiu, setDirigiu] = useState([]);
  const [atuou, setAtuou] = useState([]);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    let vivo = true;
    setPessoa(null);
    setDirigiu([]);
    setAtuou([]);
    setErro(null);

    tmdb(`/person/${id}`, { append_to_response: 'combined_credits' })
      .then((p) => {
        if (!vivo) return;
        setPessoa(p);

        const creditos = p.combined_credits || {};
        const comPoster = (lista) => (lista || []).filter((c) => c.poster_path);

        // só o que ela dirigiu/criou, sem os créditos de produção e roteiro
        const direcao = comPoster(creditos.crew).filter((c) =>
          /^(director|creator)$/i.test(c.job || '')
        );

        const ordenar = (lista) =>
          [...lista].sort(
            (a, b) =>
              String(b.release_date || b.first_air_date || '').localeCompare(
                String(a.release_date || a.first_air_date || '')
              )
          );

        // o mesmo filme aparece uma vez por função; uma linha por título basta
        const unicos = (lista) => {
          const vistos = new Set();
          return lista.filter((c) => (vistos.has(c.id) ? false : vistos.add(c.id)));
        };

        setDirigiu(unicos(ordenar(direcao)).slice(0, 40));
        setAtuou(unicos(ordenar(comPoster(creditos.cast))).slice(0, 40));
      })
      .catch((e) => vivo && setErro(String(e.message || e)));

    return () => {
      vivo = false;
    };
  }, [id]);

  if (erro) {
    return (
      <div className="page">
        <p style={{ color: 'var(--fg-muted)' }}>Não consegui carregar esta pessoa. {erro}</p>
        <button className="btn btn-ghost" onClick={back}>
          Voltar
        </button>
      </div>
    );
  }

  if (!pessoa) {
    return (
      <div className="center-screen">
        <span className="spinner" />
      </div>
    );
  }

  const abrir = (item) => navigate(titlePath(item));

  return (
    <div className="page pessoa-page">
      <button className="icon-btn" onClick={back} title="Voltar" style={{ marginBottom: 18 }}>
        <Icon name="chevronLeft" size={20} />
      </button>

      <header className="pessoa-topo">
        {pessoa.profile_path && <img src={poster(pessoa.profile_path, 'w185')} alt="" />}
        <div>
          <h1>{pessoa.name}</h1>
          {pessoa.known_for_department && (
            <div className="pessoa-papel">
              {pessoa.known_for_department === 'Directing'
                ? 'Direção'
                : pessoa.known_for_department === 'Acting'
                  ? 'Atuação'
                  : pessoa.known_for_department}
            </div>
          )}
          {pessoa.biography && <p className="pessoa-bio">{pessoa.biography.slice(0, 420)}</p>}
        </div>
      </header>

      {!!dirigiu.length && (
        <section className="title-section">
          <h2 className="section-title">Dirigiu</h2>
          <div className="grid-cards">
            {dirigiu.map((m) => (
              <Card key={`d-${m.id}`} item={m} onOpen={abrir} showTitle />
            ))}
          </div>
        </section>
      )}

      {!!atuou.length && (
        <section className="title-section">
          <h2 className="section-title">Atuou</h2>
          <div className="grid-cards">
            {atuou.map((m) => (
              <Card key={`a-${m.id}`} item={m} onOpen={abrir} showTitle />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
