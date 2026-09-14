import { useEffect, useMemo, useState } from 'react';
import { useFrame } from '../lib/FrameContext';
import { back } from '../lib/router';
import { colecaoPorId } from '../config/colecoes';
import { carregarColecao, capaDaColecao, itensDaColecao } from '../services/colecoes';
import * as Recs from '../services/recomendacoes';
import { getSetting } from '../services/sync/settings';
import { idOf } from '../lib/tmdb';
import Card, { Row } from '../components/Card';
import Icon from '../lib/icons';

/**
 * Página de uma coleção (#/colecao/marvel): banner, descrição, "Salvar
 * coleção" (vira uma pasta na Biblioteca, com a contagem de vistos) e as
 * seções, cada uma numa fileira. Coleção é catálogo, não recomendação: nada
 * é escondido por já ter sido visto — o que você viu ganha um selo.
 */
export default function Colecao({ id, onOpen }) {
  const colecao = colecaoPorId(id);
  const { activeProfile, folders, folderItems, continueWatching, persistFoldersState } = useFrame();
  const [capa, setCapa] = useState(null);
  const [secoes, setSecoes] = useState(null);
  const [mapaLbxd, setMapaLbxd] = useState({});

  useEffect(() => {
    if (!colecao) return undefined;
    let vivo = true;
    setSecoes(null);
    capaDaColecao(colecao).then((u) => { if (vivo) setCapa(u); });
    carregarColecao(colecao).then((s) => { if (vivo) setSecoes(s); });
    return () => { vivo = false; };
  }, [colecao?.id]);

  useEffect(() => {
    if (!activeProfile?.id) return;
    getSetting(activeProfile.id, 'lbxd_ids', {}).then((m) => setMapaLbxd(m || {}));
  }, [activeProfile?.id]);

  const vistos = useMemo(
    () => Recs.idsJaVistos({ itemsMap: folderItems || {}, taste: activeProfile?.taste_profile, continueWatching, mapaLbxd }),
    [folderItems, activeProfile, continueWatching, mapaLbxd]
  );

  if (!colecao) {
    return (
      <div className="empty">
        Essa coleção não existe.
        <button className="btn btn-ghost" onClick={back} style={{ marginTop: 14 }}>Voltar</button>
      </div>
    );
  }

  const todos = secoes ? itensDaColecao(secoes) : [];
  const quantosVistos = todos.filter((m) => vistos.has(Number(idOf(m)))).length;
  const folderId = `colecao_${colecao.id}`;
  const salva = !!(folders || []).find((f) => f.id === folderId);

  const salvar = async () => {
    if (salva) {
      if (!window.confirm(`Tirar "${colecao.titulo}" das suas pastas?`)) return;
      const { [folderId]: _fora, ...resto } = folderItems || {};
      await persistFoldersState((folders || []).filter((f) => f.id !== folderId), resto);
      return;
    }
    if (!todos.length) return;
    const pasta = { id: folderId, name: colecao.titulo, description: `Coleção · ${colecao.subtitulo}`, isAuto: false };
    await persistFoldersState([...(folders || []), pasta], { ...(folderItems || {}), [folderId]: todos });
  };

  return (
    <div className="colecao-page" style={{ '--cor': colecao.cor || '#fff' }}>
      <div className="colecao-hero">
        {capa && <img src={capa} alt="" />}
        <div className="veu" />
        <button className="icon-btn voltar" onClick={back} aria-label="Voltar">
          <Icon name="chevronLeft" size={22} />
        </button>
        <div className="inner">
          <div className="selo"><i />Coleção</div>
          <h1>{colecao.titulo}</h1>
          <p className="sub">{colecao.subtitulo}</p>
        </div>
      </div>

      <div className="colecao-corpo">
        <p className="descricao">{colecao.descricao}</p>
        <div className="acoes">
          <button className={`btn ${salva ? 'btn-ghost on' : 'btn-light'}`} onClick={salvar} disabled={!secoes}>
            <Icon name={salva ? 'check' : 'bookmark'} size={15} />
            {salva ? 'Salva nas pastas' : 'Salvar coleção'}
          </button>
          {todos.length > 0 && (
            <span className="contagem">
              {todos.length} títulos · {quantosVistos} vistos
            </span>
          )}
        </div>
      </div>

      <div className="rows">
        {!secoes ? (
          <div className="empty">
            <span className="spinner" style={{ margin: '0 auto 14px' }} />
            Abrindo a coleção…
          </div>
        ) : (
          secoes.map((s) => (
            <Row
              key={s.id}
              title={s.titulo}
              items={s.itens}
              onOpen={onOpen}
              renderItem={(item) => (
                <div className={`colecao-item${vistos.has(Number(idOf(item))) ? ' visto' : ''}`}>
                  <Card item={item} onOpen={onOpen} />
                  {vistos.has(Number(idOf(item))) && (
                    <span className="selo-visto"><Icon name="check" size={11} />Visto</span>
                  )}
                </div>
              )}
            />
          ))
        )}
      </div>
    </div>
  );
}
