import { useEffect, useState } from 'react';
import { useFrame } from '../lib/FrameContext';
import Icon, { Logo } from '../lib/icons';

const TABS = [
  { id: 'home', label: 'Início' },
  { id: 'explore', label: 'Explorar' },
  { id: 'library', label: 'Salvos' },
  { id: 'settings', label: 'Ajustes' },
];

export default function Header({ tab, onTab, query, onQuery }) {
  const { activeProfile, setActiveProfile } = useFrame();
  const [scrolled, setScrolled] = useState(false);
  const [escondido, setEscondido] = useState(false);

  /**
   * Some ao descer, volta ao subir.
   *
   * O card cresce no hover e passava POR BAIXO do cabeçalho, que fica fixo por
   * cima — dava a impressão de estar cortado. Dá pra brigar por espaço com
   * margem, mas o problema volta em qualquer fileira que pare colada no topo.
   * Sumir na descida resolve e ainda devolve a tela inteira pro conteúdo.
   */
  useEffect(() => {
    let anterior = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 12);
      // 6px de folga: rolagem por toque treme e faria o cabeçalho piscar
      if (Math.abs(y - anterior) > 6) {
        setEscondido(y > anterior && y > 120);
        anterior = y;
      }
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`app-header${scrolled ? ' scrolled' : ''}${escondido ? ' escondido' : ''}`}>
      <button className="brand" onClick={() => onTab('home')} aria-label="Início">
        <Logo size={22} strokeWidth={5} />
        <span className="wordmark">FRAME</span>
      </button>

      <nav className="nav-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <div className="header-right">
        <div className="header-search">
          <Icon name="search" size={15} style={{ color: 'var(--fg-dim)' }} />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Buscar"
            aria-label="Buscar filmes e séries"
          />
          {query && (
            <button onClick={() => onQuery('')} aria-label="Limpar busca" style={{ color: 'var(--fg-dim)' }}>
              <Icon name="x" size={14} />
            </button>
          )}
        </div>

        <button
          className="avatar"
          title={`${activeProfile?.name} — trocar de perfil`}
          onClick={() => setActiveProfile(null)}
        >
          {activeProfile?.avatar_url ? (
            <img src={activeProfile.avatar_url} alt="" />
          ) : (
            (activeProfile?.name || '?').charAt(0).toUpperCase()
          )}
        </button>
      </div>
    </header>
  );
}
