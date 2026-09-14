import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '../lib/FrameContext';
import { idOf } from '../lib/tmdb';
import { applyFilters, hasDiaryDates, DECADES, SORTS, VISIBILITY, GENRE_OPTIONS, DEFAULT_FILTERS } from '../lib/folderFilters';
import { resolveBatch, needsResolving } from '../services/resolveItems';
import Card from '../components/Card';
import Icon from '../lib/icons';

const NATIVE = {
  watchlist: { id: 'native_watch', name: 'Watchlist', description: 'Filmes e séries pra ver' },
  history: { id: 'native_history', name: 'Histórico', description: 'O que você começou a ver' },
};

export default function Library({ onOpen }) {
  const { myList, continueWatching, folders, folderItems, persistFoldersState } = useFrame();
  const [open, setOpen] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [query, setQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [resolving, setResolving] = useState(0); // quantos ainda faltam resolver
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const trabalhando = useRef(false);

  const itemsOf = (folder) => {
    if (!folder) return [];
    if (folder.id === NATIVE.watchlist.id) return myList;
    if (folder.id === NATIVE.history.id) return continueWatching;
    return folderItems[folder.id] || [];
  };

  const bruto = itemsOf(open);

  /**
   * Pasta do Letterboxd chega só com nome e ano. Ao abrir, resolve no TMDB em
   * lotes — a pasta vai ganhando pôster enquanto você olha, e o resultado é
   * gravado (sincroniza, então o app também recebe já resolvido).
   */
  useEffect(() => {
    if (!open || open.id.startsWith('native_')) return undefined;
    let vivo = true;

    const rodar = async () => {
      if (trabalhando.current) return;
      const atual = folderItems[open.id] || [];
      const faltam = atual.filter(needsResolving).length;
      setResolving(faltam);
      if (!faltam) return;

      trabalhando.current = true;
      try {
        const { items } = await resolveBatch(atual);
        if (!vivo) return;
        await persistFoldersState(folders, { ...folderItems, [open.id]: items });
      } finally {
        trabalhando.current = false;
      }
    };

    rodar();
    return () => {
      vivo = false;
    };
  }, [open, folderItems, folders, persistFoldersState]);

  const watchedIds = useMemo(
    () => new Set(continueWatching.map((c) => String(idOf(c)))),
    [continueWatching]
  );
  const watchlistIds = useMemo(() => new Set(myList.map((m) => String(idOf(m)))), [myList]);

  const shown = useMemo(
    () => applyFilters(bruto, filters, { watchedIds, watchlistIds, query }),
    [bruto, filters, watchedIds, watchlistIds, query]
  );

  const sortOptions = useMemo(
    () => (hasDiaryDates(bruto) ? SORTS : SORTS.filter((s) => !s.id.startsWith('diary'))),
    [bruto]
  );

  const ativos =
    (filters.decade !== 'any' ? 1 : 0) +
    (filters.genre !== 'any' ? 1 : 0) +
    VISIBILITY.filter((v) => filters[v.id]).length;

  const createFolder = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const id = `custom_${Date.now()}`;
    await persistFoldersState([...folders, { id, name: newName.trim(), description: 'Pasta manual', isAuto: false }], {
      ...folderItems,
      [id]: [],
    });
    setNewName('');
    setCreating(false);
  };

  const deleteFolder = async (id) => {
    const nextItems = { ...folderItems };
    delete nextItems[id];
    await persistFoldersState(folders.filter((f) => f.id !== id), nextItems);
    setOpen(null);
  };

  const abrir = (folder) => {
    setOpen(folder);
    setFilters(DEFAULT_FILTERS);
    setQuery('');
    setShowFilters(false);
    window.scrollTo({ top: 0 });
  };

  /* ------------------------------------------------------------ pasta aberta */
  if (open) {
    const isNative = open.id.startsWith('native_');
    return (
      <div className="page">
        <div className="page-head">
          <button className="back-link" onClick={() => setOpen(null)}>
            <Icon name="chevronLeft" size={14} />
            Salvos
          </button>
          <h1>{open.name}</h1>
          <p>
            {shown.length}
            {shown.length !== bruto.length && ` de ${bruto.length}`} {bruto.length === 1 ? 'título' : 'títulos'}
            {resolving > 0 && ` · buscando pôster de ${resolving}…`}
          </p>

          <div className="folder-tools">
            <div className="header-search" style={{ flex: '1 1 220px', maxWidth: 320 }}>
              <Icon name="search" size={15} style={{ color: 'var(--fg-dim)' }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filtrar nesta pasta"
                style={{ width: '100%' }}
              />
            </div>

            <select
              className="ctl-select"
              value={filters.sort}
              onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}
              aria-label="Ordenar por"
            >
              {sortOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>

            <button
              className={`btn btn-ghost${showFilters ? ' on' : ''}`}
              style={{ padding: '10px 16px' }}
              onClick={() => setShowFilters((v) => !v)}
            >
              <Icon name="grid" size={14} />
              Filtros{ativos ? ` (${ativos})` : ''}
            </button>

            {!isNative && (
              <button
                className="btn btn-ghost"
                style={{ padding: '10px 16px' }}
                onClick={() =>
                  confirm(`Apagar a pasta "${open.name}"? Os títulos dela saem daqui.`) && deleteFolder(open.id)
                }
              >
                <Icon name="trash" size={14} />
                Apagar
              </button>
            )}
          </div>

          {showFilters && (
            <div className="filter-panel">
              <div className="filter-group">
                <span className="filter-label">Década</span>
                <select
                  className="ctl-select"
                  value={filters.decade}
                  onChange={(e) => setFilters((f) => ({ ...f, decade: e.target.value }))}
                >
                  {DECADES.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filter-group">
                <span className="filter-label">Gênero</span>
                <select
                  className="ctl-select"
                  value={filters.genre}
                  onChange={(e) => setFilters((f) => ({ ...f, genre: e.target.value }))}
                >
                  {GENRE_OPTIONS.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filter-group wide">
                <span className="filter-label">Mostrar</span>
                <div className="toggle-row">
                  {VISIBILITY.map((v) => (
                    <label key={v.id} className={`toggle${filters[v.id] ? ' on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={!!filters[v.id]}
                        onChange={(e) => setFilters((f) => ({ ...f, [v.id]: e.target.checked }))}
                      />
                      {v.label}
                    </label>
                  ))}
                </div>
              </div>

              {ativos > 0 && (
                <button
                  className="btn btn-ghost"
                  style={{ padding: '9px 14px', alignSelf: 'end' }}
                  onClick={() => setFilters((f) => ({ ...DEFAULT_FILTERS, sort: f.sort }))}
                >
                  Limpar filtros
                </button>
              )}
            </div>
          )}
        </div>

        {shown.length ? (
          <div className="grid">
            {shown.map((item, i) => (
              <Card key={`${idOf(item) || item.Name}-${i}`} item={item} onOpen={onOpen} showTitle />
            ))}
          </div>
        ) : (
          <div className="empty">
            {bruto.length ? 'Nenhum título passou pelos filtros.' : 'Nada aqui ainda.'}
          </div>
        )}
      </div>
    );
  }

  /* --------------------------------------------------------- lista de pastas */
  const all = [
    { ...NATIVE.watchlist, count: myList.length, auto: true },
    { ...NATIVE.history, count: continueWatching.length, auto: true },
    ...folders.map((f) => ({ ...f, count: (folderItems[f.id] || []).length, auto: f.isAuto })),
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Salvos</h1>
        <p>Suas pastas — as mesmas que aparecem no app.</p>
      </div>

      <div className="folder-list">
        {all.map((f) => (
          <button className="folder-card" key={f.id} onClick={() => abrir(f)}>
            <Icon name={f.id === NATIVE.history.id ? 'film' : 'folder'} size={20} style={{ color: 'var(--fg-muted)' }} />
            <div>
              <div className="name">{f.name}</div>
              <div className="desc">{f.description || 'Pasta'}</div>
            </div>
            <span className="count">{f.count}</span>
          </button>
        ))}

        {creating ? (
          <form onSubmit={createFolder} className="folder-card" style={{ gap: 12 }}>
            <Icon name="folder" size={20} style={{ color: 'var(--fg-dim)' }} />
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nome da pasta"
              style={{ flex: 1, background: 'none', border: 'none', fontSize: 15 }}
            />
            <button className="btn btn-primary" style={{ padding: '9px 16px' }} type="submit">
              Criar
            </button>
            <button type="button" className="icon-btn" onClick={() => setCreating(false)}>
              <Icon name="x" size={16} />
            </button>
          </form>
        ) : (
          <button className="folder-card" onClick={() => setCreating(true)} style={{ color: 'var(--fg-muted)' }}>
            <Icon name="plus" size={20} />
            <div className="name" style={{ fontWeight: 500 }}>
              Nova pasta
            </div>
          </button>
        )}
      </div>
    </div>
  );
}
