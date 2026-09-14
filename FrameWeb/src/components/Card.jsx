import { useRef, useState, useEffect } from 'react';
import { poster, backdrop } from '../services/constants';
import { titleOf, idOf, typeOf } from '../lib/tmdb';
import { useFrame } from '../lib/FrameContext';
import Icon from '../lib/icons';

/* -------------------------------------------------------------- pôster 2:3
   O card de catálogo continua vertical: pôster é pôster, e numa tela larga
   cabem muitos mais por linha do que no celular. */

export default function Card({ item, onOpen, progress, showTitle = false }) {
  const { inMyList, toggleMyList } = useFrame();
  const src = poster(item.poster_path, 'w342');
  const saved = inMyList(item);

  return (
    <div className="card">
      <button className="art" onClick={() => onOpen?.(item)} aria-label={titleOf(item)} style={{ display: 'block', width: '100%', padding: 0 }}>
        {src ? (
          <img src={src} alt={titleOf(item)} loading="lazy" decoding="async" />
        ) : (
          <span className="fallback">{titleOf(item)}</span>
        )}
      </button>

      <button
        className={`save${saved ? ' on' : ''}`}
        title={saved ? 'Tirar da Watchlist' : 'Salvar na Watchlist'}
        onClick={(e) => {
          e.stopPropagation();
          toggleMyList(item);
        }}
      >
        <Icon name="bookmark" size={13} />
      </button>

      {typeof progress === 'number' && progress > 0 && (
        <div className="progress-bar">
          <i style={{ width: `${Math.min(100, progress * 100)}%` }} />
        </div>
      )}
      {showTitle && <div className="title">{titleOf(item)}</div>}
    </div>
  );
}

/* ------------------------------------------------------------- card 16:9
   Para "Continuar assistindo": numa tela horizontal o still deitado diz mais
   que o pôster (mostra a cena onde você parou) e aproveita a largura. */

export function WideCard({ item, onOpen, onPlay, onRemove, progress }) {
  const art = backdrop(item.backdrop_path, 'w780') || poster(item.poster_path, 'w500');
  const isTv = typeOf(item) === 'tv';

  return (
    <div className="wide-card">
      <button className="art" onClick={() => onPlay?.(item)} aria-label={`Continuar ${titleOf(item)}`}>
        {art ? <img src={art} alt="" loading="lazy" decoding="async" /> : <span className="fallback">{titleOf(item)}</span>}
        <span className="play-veil">
          <Icon name="play" size={20} />
        </span>
      </button>

      {/* dois cantos, duas acoes: o X tira da lista, o "i" abre a pagina do
          titulo. Antes so dava pra abrir clicando no nome, que ninguem adivinha. */}
      <button className="wc-info" title="Detalhes" onClick={() => onOpen?.(item)}>
        <Icon name="info" size={13} />
      </button>

      <button className="wc-remove" title="Tirar da lista" onClick={() => onRemove?.(item)}>
        <Icon name="x" size={13} />
      </button>

      <div className="wc-meta">
        <div className="wc-title" onClick={() => onOpen?.(item)} role="button" tabIndex={0}>
          {titleOf(item)}
        </div>
        {isTv && item.savedSeason ? (
          <div className="wc-sub">
            T{item.savedSeason} · E{item.savedEpisode || 1}
          </div>
        ) : null}
      </div>

      <div className="progress-bar wc-bar">
        <i style={{ width: `${Math.min(100, (progress || 0.06) * 100)}%` }} />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- fileira
   No celular você arrasta com o dedo; no PC não. Daí as setas, que só
   aparecem quando o mouse entra na fileira e quando há pra onde ir. */

export function Row({ title, items, onOpen, right, wide = false, renderItem }) {
  const ref = useRef(null);
  const [edge, setEdge] = useState({ left: false, right: false });

  const measure = () => {
    const el = ref.current;
    if (!el) return;
    setEdge({
      left: el.scrollLeft > 8,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 8,
    });
  };

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return undefined;
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [items]);

  const nudge = (dir) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.82), behavior: 'smooth' });
  };

  if (!items?.length) return null;

  return (
    <section className={`row${wide ? ' row-wide' : ''}`}>
      <div className="row-head">
        <h2>{title}</h2>
        {right}
      </div>

      <div className="row-viewport">
        {edge.left && (
          <button className="row-arrow left" onClick={() => nudge(-1)} aria-label="Anterior">
            <Icon name="chevronLeft" size={22} />
          </button>
        )}
        <div className="row-scroller" ref={ref}>
          {items.map((item, i) =>
            renderItem ? (
              <div key={`${idOf(item)}-${i}`} className={wide ? 'wide-slot' : 'card-slot'}>
                {renderItem(item)}
              </div>
            ) : (
              <Card key={`${idOf(item)}-${i}`} item={item} onOpen={onOpen} />
            )
          )}
        </div>
        {edge.right && (
          <button className="row-arrow right" onClick={() => nudge(1)} aria-label="Próximo">
            <Icon name="chevronRight" size={22} />
          </button>
        )}
      </div>
    </section>
  );
}
