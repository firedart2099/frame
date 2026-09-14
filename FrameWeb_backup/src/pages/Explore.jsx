import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { idOf, search as tmdbSearch, typeOf } from '../lib/tmdb';
import {
  CATEGORIAS,
  DECADAS,
  FILTROS_PADRAO,
  GENEROS,
  NOTAS,
  ORDENS,
  TIPOS,
  buscarExplorar,
  categoriaVale,
  contarFiltros,
} from '../services/explorar';
import Card from '../components/Card';
import Icon from '../lib/icons';
import ColecaoCard from '../components/ColecaoCard';
import { COLECOES } from '../config/colecoes';
import { buscarColecoes } from '../services/colecoes';

/**
 * Explorar — o catálogo, não a recomendação.
 *
 * Era só um campo de busca: quem não sabia o nome do que queria não tinha o
 * que fazer aqui. Agora a busca é uma das entradas, e a outra é filtrar —
 * gênero, época, nota, categoria — do jeito que já dá pra fazer dentro de uma
 * pasta. Nada nesta tela olha o seu gosto: isso é trabalho da Home.
 */

const PAGINAS_ALEATORIAS = 5; // "populares" começa numa página sorteada
const chaveDe = (m) => `${m.media_type || typeOf(m)}-${idOf(m)}`;

export default function Explore({ query, onOpen }) {
  const [filtros, setFiltros] = useState(FILTROS_PADRAO);
  const [itens, setItens] = useState([]);
  const [pagina, setPagina] = useState(1);
  const [carregando, setCarregando] = useState(true);
  const [acabou, setAcabou] = useState(false);
  // De onde a lista começa. Sorteado pra que "populares" não seja a mesma
  // parede de pôsteres toda vez que a aba abre.
  const [salto, setSalto] = useState(() => 1 + Math.floor(Math.random() * PAGINAS_ALEATORIAS));
  const [resultados, setResultados] = useState(null);
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
  const sentinela = useRef(null);
  const carregandoRef = useRef(false);

  const categorias = useMemo(() => CATEGORIAS.filter((c) => categoriaVale(c, filtros.tipo)), [filtros.tipo]);
  const catAtual = CATEGORIAS.find((c) => c.id === filtros.categoria);
  const extras = contarFiltros(filtros);

  const mudar = (mudanca) => setFiltros((f) => ({ ...f, ...mudanca }));

  const alternarGenero = (id) =>
    setFiltros((f) => ({
      ...f,
      generos: f.generos.includes(id) ? f.generos.filter((g) => g !== id) : [...f.generos, id],
    }));

  /**
   * Trocar de tipo pode invalidar a categoria (não existe "Nos cinemas" de
   * série). Em vez de sumir com a lista, volta pra "Populares".
   */
  const trocarTipo = (tipo) =>
    setFiltros((f) => {
      const cat = CATEGORIAS.find((c) => c.id === f.categoria);
      return { ...f, tipo, categoria: categoriaVale(cat, tipo) ? f.categoria : 'populares' };
    });

  // catálogo: recomeça a cada mexida no filtro
  useEffect(() => {
    if (query && query.trim()) return undefined;
    let vivo = true;
    setCarregando(true);
    setAcabou(false);
    setItens([]);
    setPagina(1);
    buscarExplorar(filtros, salto).then((lista) => {
      if (!vivo) return;
      setItens(lista);
      setAcabou(lista.length === 0);
      setCarregando(false);
    });
    return () => {
      vivo = false;
    };
  }, [filtros, salto, query]);

  const carregarMais = useCallback(async () => {
    if (carregandoRef.current || acabou || carregando || (query && query.trim())) return;
    carregandoRef.current = true;
    const proxima = pagina + 1;
    const lista = await buscarExplorar(filtros, salto + proxima - 1);
    setPagina(proxima);
    if (!lista.length) setAcabou(true);
    setItens((prev) => {
      const vistos = new Set(prev.map(chaveDe));
      return [...prev, ...lista.filter((m) => !vistos.has(chaveDe(m)))];
    });
    carregandoRef.current = false;
  }, [filtros, salto, pagina, acabou, carregando, query]);

  useEffect(() => {
    const el = sentinela.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && carregarMais(), { rootMargin: '700px' });
    io.observe(el);
    return () => io.disconnect();
  }, [carregarMais]);

  // busca por nome
  useEffect(() => {
    if (!query || !query.trim()) {
      setResultados(null);
      return undefined;
    }
    let vivo = true;
    const t = setTimeout(() => {
      tmdbSearch(query).then((r) => vivo && setResultados(r));
    }, 320);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [query]);

  if (query && query.trim()) {
    return (
      <div className="page">
        <div className="page-head">
          <h1>Resultados</h1>
          <p>{resultados ? `${resultados.length} para “${query}”` : `Procurando “${query}”…`}</p>
        </div>
        {buscarColecoes(COLECOES, query).map((c) => (
          <ColecaoCard key={c.id} colecao={c} />
        ))}
        {resultados && resultados.length ? (
          <div className="grid">
            {resultados.map((r) => (
              <Card key={chaveDe(r)} item={r} onOpen={onOpen} showTitle />
            ))}
          </div>
        ) : resultados ? (
          <div className="empty">Nada encontrado. Tenta escrever de outro jeito.</div>
        ) : (
          <div className="empty">
            <span className="spinner" style={{ margin: '0 auto' }} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page explorar">
      <div className="page-head">
        <h1>Explorar</h1>
        <p>Tudo que existe, sem recomendação no meio.</p>
      </div>

      <div className="explorar-barra">
        <div className="toggle-row tipos">
          {TIPOS.map((t) => (
            <button
              key={t.id}
              className={`toggle${filtros.tipo === t.id ? ' on' : ''}`}
              onClick={() => trocarTipo(t.id)}
            >
              {t.label}
            </button>
          ))}

          <button
            className={`toggle${mostrarFiltros ? ' on' : ''}`}
            style={{ marginLeft: 'auto' }}
            onClick={() => setMostrarFiltros((v) => !v)}
          >
            <Icon name="grid" size={13} />
            Filtros{extras ? ` (${extras})` : ''}
          </button>

          <button className="toggle" onClick={() => setSalto(1 + Math.floor(Math.random() * 12))}>
            <Icon name="refresh" size={13} />
            Surpreenda
          </button>
        </div>

        <div className="explorar-linha">
          {categorias.map((c) => (
            <button
              key={c.id}
              className={`toggle${filtros.categoria === c.id ? ' on' : ''}`}
              onClick={() => mudar({ categoria: c.id })}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="explorar-linha generos">
          {GENEROS.map((g) => (
            <button
              key={g.id}
              className={`toggle${filtros.generos.includes(g.id) ? ' on' : ''}`}
              onClick={() => alternarGenero(g.id)}
            >
              {g.name}
            </button>
          ))}
        </div>
      </div>

      {mostrarFiltros && (
        <div className="explorar-painel">
          <div className="filter-panel">
            <div className="filter-group">
              <span className="filter-label">Época</span>
              <select
                className="ctl-select"
                value={filtros.decada}
                onChange={(e) => mudar({ decada: e.target.value })}
              >
                {DECADAS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-group">
              <span className="filter-label">Nota do público</span>
              <select
                className="ctl-select"
                value={filtros.nota}
                onChange={(e) => mudar({ nota: Number(e.target.value) })}
              >
                {NOTAS.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-group">
              <span className="filter-label">Ordenar por</span>
              <select
                className="ctl-select"
                value={filtros.ordem}
                onChange={(e) => mudar({ ordem: e.target.value })}
              >
                {ORDENS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            {extras > 0 && (
              <button
                className="btn btn-ghost"
                style={{ padding: '9px 14px', alignSelf: 'end' }}
                onClick={() => setFiltros((f) => ({ ...FILTROS_PADRAO, tipo: f.tipo, categoria: f.categoria }))}
              >
                Limpar filtros
              </button>
            )}
          </div>
        </div>
      )}

      {carregando ? (
        <div className="empty">
          <span className="spinner" style={{ margin: '0 auto 14px' }} />
          Procurando…
        </div>
      ) : itens.length ? (
        <>
          <div className="grid">
            {itens.map((m) => (
              <Card key={chaveDe(m)} item={m} onOpen={onOpen} showTitle />
            ))}
          </div>
          <div ref={sentinela} style={{ height: 1 }} />
        </>
      ) : (
        <div className="empty">
          Nada com esses filtros{catAtual ? ` em “${catAtual.label}”` : ''}. Tira um e tenta de novo.
        </div>
      )}
    </div>
  );
}
