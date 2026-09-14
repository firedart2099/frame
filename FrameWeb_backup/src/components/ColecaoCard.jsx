import { useEffect, useRef, useState } from 'react';
import { fundosDaColecao } from '../services/colecoes';
import { navigate } from '../lib/router';
import Icon from '../lib/icons';

/**
 * Cartão de coleção na Home — o mesmo do app: banner largo, "COLEÇÃO",
 * "Explore a coleção" + nome, subtítulo e Explorar. O fundo é um slideshow
 * dos filmes da coleção: capa e depois os backdrops dos primeiros títulos,
 * trocando a cada 3 s em fade, com um zoom lento por cima.
 *
 * Duas camadas de <img> FIXAS que se alternam: a próxima foto carrega na
 * camada escondida, entra em fade por cima (`.visivel` tem transição), e só
 * então a antiga apaga — sem transição (`.camada` não tem), por baixo, sem
 * ninguém ver. A versão anterior trocava o `src` da camada de cima e a
 * deixava apagar em transição: ela apagava mostrando a foto SEGUINTE — era
 * o "volta abruptamente pra outro filme".
 */
const INTERVALO = 3000;
const FADE = 900;

export default function ColecaoCard({ colecao, salva = false }) {
  const [fundos, setFundos] = useState([]);
  const [camadas, setCamadas] = useState([null, null]);
  const [visiveis, setVisiveis] = useState([false, false]);
  const [topo, setTopo] = useState(0);
  const frenteRef = useRef(0);
  const idxRef = useRef(0);

  useEffect(() => {
    let vivo = true;
    setFundos([]);
    setCamadas([null, null]);
    setVisiveis([false, false]);
    setTopo(0);
    frenteRef.current = 0;
    idxRef.current = 0;
    fundosDaColecao(colecao).then((lista) => {
      if (!vivo || !lista.length) return;
      setFundos(lista);
      setCamadas([lista[0], null]);
      setVisiveis([true, false]);
      lista.slice(1).forEach((u) => { const im = new Image(); im.src = u; });
    });
    return () => { vivo = false; };
  }, [colecao.id]);

  useEffect(() => {
    if (fundos.length < 2) return undefined;
    let t2;
    let t3;
    const timer = setInterval(() => {
      const frente = frenteRef.current;
      const tras = 1 - frente;
      const proximoIdx = (idxRef.current + 1) % fundos.length;
      setCamadas((c) => { const n = [...c]; n[tras] = fundos[proximoIdx]; return n; });
      setTopo(tras);
      t2 = setTimeout(() => {
        setVisiveis((v) => { const n = [...v]; n[tras] = true; return n; });
        t3 = setTimeout(() => {
          setVisiveis((v) => { const n = [...v]; n[frente] = false; return n; });
          frenteRef.current = tras;
          idxRef.current = proximoIdx;
        }, FADE + 50);
      }, 120);
    }, INTERVALO);
    return () => { clearInterval(timer); clearTimeout(t2); clearTimeout(t3); };
  }, [fundos]);

  const pronto = !!camadas[0] || !!camadas[1];
  const ir = () => navigate(`/colecao/${colecao.id}`);

  return (
    <section className="colecao-card-wrap">
      <a
        className={`colecao-card${pronto ? ' pronto' : ''}`}
        href={`#/colecao/${colecao.id}`}
        onClick={(e) => { e.preventDefault(); ir(); }}
        style={{ '--cor': colecao.cor || '#fff' }}
      >
        <div className="fundo">
          {camadas.map((uri, i) => uri ? (
            <img
              key={i}
              src={uri}
              alt=""
              className={`camada${visiveis[i] ? ' visivel' : ''}`}
              style={{ zIndex: topo === i ? 2 : 1 }}
            />
          ) : null)}
        </div>
        <div className="veu" />
        <div className="fio" />

        <div className="selo">
          <i />
          {salva ? 'Coleção · salva' : 'Coleção'}
        </div>

        <div className="texto">
          <small>Explore a coleção</small>
          <h2>{colecao.titulo}</h2>
          <p>{colecao.subtitulo}</p>
          <span className="btn btn-light">
            Explorar
            <Icon name="arrowRight" size={15} />
          </span>
        </div>
      </a>
    </section>
  );
}
