import { useEffect, useRef, useState } from 'react';
import Icon, { Logo } from '../lib/icons';
import { trending } from '../lib/tmdb';
import { poster } from '../services/constants';
import { latest } from '../data/releases';
import '../styles/landing.css';

/**
 * Landing do Frame. Refeita em 12/09/2026: o app entrou nela (celular E
 * computador), e o texto foi reescrito sem os cacoetes de texto gerado
 * (contraste "não é X, é Y", fecho de uma linha, travessão em toda frase,
 * trio por regra, palavra de propaganda). O que a página diz é o que o
 * produto faz; nenhum número inventado.
 *
 * Princípios que continuam valendo:
 *  - Rams: nada decorativo sobra. Se um elemento não informa nem conduz, sai.
 *  - van Schneider / Sagmeister: uma ideia tipográfica forte e só uma. O
 *    nome ocupa a tela; o resto se comporta.
 *  - Zeldman: HTML semântico (header/main/section/footer), um h1 só,
 *    hierarquia real, skip link, foco visível.
 *  - Marcotte / Walton: nada de largura de aparelho. Tipografia fluida com
 *    clamp() e quebras onde o conteúdo pede.
 *  - Norman / Spool: uma ação primária óbvia por tela, e o aviso de que é
 *    só pra convidado aparece ANTES do cadastro.
 *  - Drasner: movimento com propósito e sempre sujeito a prefers-reduced-motion.
 */

/* ------------------------------------------------------------ primitivas */

/** Revela a seção quando ela entra na tela. Sem JS de scroll a cada frame. */
function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.classList.add('in');
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && (el.classList.add('in'), io.disconnect()),
      { rootMargin: '-12% 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

function Section({ index, eyebrow, children, className = '', id }) {
  const ref = useReveal();
  return (
    <section className={`reveal ${className}`} ref={ref} id={id}>
      {(index || eyebrow) && (
        <p className="eyebrow sec-eyebrow">
          {index && <span className="idx">{index}</span>}
          {eyebrow}
        </p>
      )}
      {children}
    </section>
  );
}

/** O catálogo é o plano de fundo. Se a TMDB não responder, fica o preto. */
function PosterWall() {
  const [cols, setCols] = useState([]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    let alive = true;
    (async () => {
      try {
        const [movies, tv] = await Promise.all([trending('movie'), trending('tv')]);
        if (!alive) return;
        const paths = [...movies, ...tv].map((m) => m.poster_path).filter(Boolean).slice(0, 36);
        if (paths.length < 12) return;
        const n = 6;
        setCols(
          Array.from({ length: n }, (_, i) => {
            const slice = paths.filter((_, idx) => idx % n === i);
            return [...slice, ...slice]; // duplica pra emendar o loop
          })
        );
      } catch (e) {
        /* silêncio: a página funciona sem isso */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!cols.length) return null;
  return (
    <div className="poster-wall" aria-hidden="true">
      <div className="poster-wall-grid">
        {cols.map((col, i) => (
          <div className="poster-col" key={i} style={{ animationDelay: `${i * -9}s` }}>
            {col.map((p, j) => (
              <img key={`${i}-${j}`} src={poster(p, 'w342')} alt="" loading="lazy" decoding="async" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
};

/**
 * O cartão do app: versão, tamanho e o botão. Vive na landing (nas duas
 * caras) pra ninguém precisar achar a página de downloads pra instalar.
 * Sem link ainda, mostra "em breve" em vez de sumir.
 */
function AppCard({ onDownloads }) {
  const atual = latest();
  const android = atual?.files?.find((f) => f.platform === 'android') || null;
  return (
    <div className="app-card">
      <div className="app-card-row">
        <span className="ico" aria-hidden="true">
          <Icon name="download" size={20} />
        </span>
        <div className="app-card-info">
          <div className="lbl">Android</div>
          <div className="note">
            {atual ? `Versão ${atual.version}` : 'Sem versão publicada'}
            {atual?.size ? ` · ${atual.size}` : ''}
            {atual?.date ? ` · ${fmtDate(atual.date)}` : ''}
          </div>
        </div>
        {android?.url ? (
          <a className="btn btn-primary act" href={android.url} target="_blank" rel="noopener noreferrer">
            <Icon name="download" size={15} />
            Baixar
          </a>
        ) : (
          <span className="soon-tag">Em breve</span>
        )}
      </div>
      <div className="app-card-row soon">
        <span className="ico" aria-hidden="true">
          <Icon name="film" size={20} />
        </span>
        <div className="app-card-info">
          <div className="lbl">iPhone e iPad</div>
          <div className="note">Ainda não tem versão</div>
        </div>
      </div>
      <p className="app-card-tip">
        O Android avisa que o arquivo veio de fora da Play Store. Toca em "Instalar mesmo assim" quando ele
        perguntar.
      </p>
      <button className="app-card-more" onClick={onDownloads}>
        Ver o que mudou em cada versão
        <Icon name="arrowRight" size={14} />
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- página */

const FEATURES = [
  {
    icon: 'film',
    title: 'Todo o catálogo',
    text: 'Filmes e séries de qualquer época, dublados ou legendados.',
  },
  {
    icon: 'zap',
    title: 'Feito pro seu gosto',
    text: 'As prateleiras mudam com o que você assiste. O que você já viu não volta.',
  },
  {
    icon: 'heart',
    title: 'Seu Letterboxd, importado',
    text: 'Diário, watchlist, listas e notas, importados de uma vez.',
  },
  {
    icon: 'refresh',
    title: 'O mesmo em todo aparelho',
    text: 'Salvou no celular, está no computador. Parou na TV, continua no telefone.',
  },
];

/* O player: o que acontece depois do play. Tudo aqui existe e foi medido. */
const PLAYER = [
  {
    icon: 'audioTrack',
    title: 'Dublado ou original, no mesmo arquivo',
    text: 'Quando o release traz os dois áudios, você troca no menu sem recarregar o filme.',
  },
  {
    icon: 'volume',
    title: 'Dolby e DTS no navegador',
    text: 'O Chrome não decodifica AC3 nem DTS. Com a extensão do Frame, decodifica.',
  },
  {
    icon: 'subtitles',
    title: 'Legenda em português, sozinha',
    text: 'O Frame procura a legenda do arquivo certo e já deixa selecionada.',
  },
  {
    icon: 'grid',
    title: 'Qualidade sem perder o idioma',
    text: 'Trocar de 1080p pra 720p mantém o áudio que estava tocando.',
  },
  {
    icon: 'play',
    title: '2x com a voz normal',
    text: 'Acelerar não vira desenho animado: o tom da voz fica no lugar.',
  },
  {
    icon: 'tv',
    title: 'Manda pra TV',
    text: 'No app, um toque envia o filme pro Web Video Caster, VLC ou MX Player.',
  },
];

/* Explorar: categorias que se somam. As etiquetas sao chips reais do app. */
const CHIPS = ['Animação', 'Romance', 'Anos 80', 'Terror', 'Super-herói', 'Anime', 'Coreano', 'Natal', 'Zumbi', 'Documentário'];

const CONTA = [
  {
    icon: 'users',
    title: 'Perfis',
    text: 'Cada pessoa da casa com o seu gosto, as suas listas e o seu "continuar assistindo".',
  },
  {
    icon: 'folder',
    title: 'Pastas',
    text: 'Monte as suas. As listas do Letterboxd chegam já como pastas.',
  },
  {
    icon: 'star',
    title: 'Nota em todo cartaz',
    text: 'IMDb nas séries, Letterboxd nos filmes, antes de abrir.',
  },
  {
    icon: 'download',
    title: 'Sem internet',
    text: 'No app, o que você baixou abre e toca. O resto espera a rede voltar.',
  },
];

export default function Landing({ onEnter, onDownloads, isMobile }) {
  const irParaApp = () => document.getElementById('app')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="landing">
      <a className="skip" href="#conteudo">
        Pular para o conteúdo
      </a>

      <PosterWall />

      <header className="landing-nav">
        <span className="brand">
          <Logo size={26} />
          <span className="wordmark">FRAME</span>
        </span>
        {isMobile ? (
          <button className="enter" onClick={irParaApp}>
            Baixar
          </button>
        ) : (
          <button className="enter" onClick={() => onEnter('login')}>
            Entrar
          </button>
        )}
      </header>

      <main id="conteudo">
        <div className="hero">
          <div className="hero-logo">
            <Logo size={92} strokeWidth={3.6} />
          </div>

          <p className="eyebrow">Filmes e séries</p>

          <h1>
            <span className="sr-only">Frame: todos os filmes e todas as séries, sem anúncios, de graça, para sempre</span>
            <span aria-hidden="true" className="wordmark hero-mark">
              FRAME
            </span>
          </h1>

          <p className="claim" aria-hidden="true">
            Todos os filmes. Todas as séries.
          </p>
          <p className="subclaim" aria-hidden="true">
            Sem anúncios. De graça, para sempre.
          </p>

          <p className="lede">
            Você entra, procura o que quer ver e dá play. Nenhum plano, nenhum anúncio no meio do filme. O Frame
            aprende seu gosto pelo que você assiste e pelo seu <strong>Letterboxd</strong>, e o ponto onde você
            parou num aparelho é o mesmo em todos os outros.
          </p>

          <div className="hero-actions">
            {isMobile ? (
              <>
                <button className="btn btn-primary" onClick={irParaApp}>
                  <Icon name="download" size={16} />
                  Baixar o app
                </button>
                <p className="fineprint" style={{ width: '100%' }}>
                  Android, grátis. No computador, abre direto no navegador.
                </p>
              </>
            ) : (
              <>
                <button className="btn btn-primary" onClick={() => onEnter('signup')}>
                  Criar conta
                  <Icon name="arrowRight" size={16} />
                </button>
                <button className="btn btn-ghost" onClick={() => onEnter('login')}>
                  Já tenho conta
                </button>
                <button className="btn btn-ghost" onClick={irParaApp}>
                  <Icon name="download" size={15} />
                  App pra celular
                </button>
              </>
            )}
          </div>

          {/* Norman: o obstáculo aparece antes do esforço, não depois. */}
          <p className="invite-note">
            <Icon name="shield" size={14} />
            Só entra quem foi convidado: a conta precisa de um e-mail que já esteja na lista.
          </p>
        </div>

        <Section index="01" eyebrow="O que tem" className="pillars">
          <ul className="pillar-list">
            {FEATURES.map((p) => (
              <li className="pillar" key={p.title}>
                <span className="ico" aria-hidden="true">
                  <Icon name={p.icon} size={22} />
                </span>
                <h2>{p.title}</h2>
                <p>{p.text}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section index="02" eyebrow="O app" className="showcase app-section" id="app">
          <div className="showcase-text">
            <h2>
              No celular e na TV, <span className="hl">o app.</span>
            </h2>
            <p>
              Mesma conta, mesmas listas, mesmo ponto onde você parou. E o que só o app faz: baixa o episódio
              pra ver sem internet, manda o filme pra TV pelo Web Video Caster e escolhe a faixa de áudio
              (dublado ou original) dentro do arquivo.
            </p>
            {isMobile ? (
              <p>Baixa aqui embaixo. Instala em um minuto.</p>
            ) : (
              <p>Abre este endereço no celular e baixa por lá, ou manda o link pra você mesmo.</p>
            )}
          </div>
          <AppCard onDownloads={onDownloads} />
        </Section>

        {!isMobile && (
          <Section index="03" eyebrow="Só no computador" className="showcase reverse">
            <div className="showcase-text">
              <h2>
                O filme te segue <span className="hl">enquanto você fuça o resto.</span>
              </h2>
              <p>
                Minimiza o player e ele vira uma janela flutuante, arrastável, por cima das prateleiras. Você
                procura o próximo com o filme ainda rodando.
              </p>
            </div>
            <div className="mini-mock" role="img" aria-label="Ilustração: janela de vídeo flutuando sobre a grade de pôsteres">
              <div className="fake-page" aria-hidden="true">
                {Array.from({ length: 12 }).map((_, i) => (
                  <i key={i} />
                ))}
              </div>
              <div className="float" aria-hidden="true" />
            </div>
          </Section>
        )}

        <Section index={isMobile ? '03' : '04'} eyebrow="Importação" className="showcase">
          <div className="showcase-text">
            <h2>
              Seus anos de Letterboxd, <span className="hl">num arrastar.</span>
            </h2>
            <p>
              O Frame lê o export inteiro: diário, watchlist, cada lista que você montou e cada nota que você
              deu. Vira pasta aqui dentro na hora, e o que você já viu para de aparecer nas recomendações.
            </p>
          </div>
          <div className="drop-mock" role="img" aria-label="Ilustração: arquivo do Letterboxd sendo solto no Frame">
            <span className="ico" aria-hidden="true">
              <Icon name="upload" size={28} />
            </span>
            <span className="fname">letterboxd-export.zip</span>
            <span className="hint">solte aqui</span>
          </div>
        </Section>

        <Section index={isMobile ? '04' : '05'} eyebrow="O player" className="player-sec">
          <h2 className="sec-title">
            Depois do play, <span className="hl">o resto também funciona.</span>
          </h2>
          <ul className="spec-list">
            {PLAYER.map((p) => (
              <li className="spec" key={p.title}>
                <span className="ico" aria-hidden="true">
                  <Icon name={p.icon} size={20} />
                </span>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section index={isMobile ? '05' : '06'} eyebrow="Explorar" className="showcase reverse">
          <div className="showcase-text">
            <h2>
              Categorias que <span className="hl">se somam.</span>
            </h2>
            <p>
              Animação e Romance ao mesmo tempo, não uma ou outra. São trinta filtros, e gênero que não existe
              na TMDB (anime, zumbi, Natal) vira palavra-chave por baixo, sem você perceber.
            </p>
            <p>A busca acha por título, diretor ou ator, em filme e em série.</p>
          </div>
          <div className="chips-mock" role="img" aria-label="Ilustração: filtros de categoria selecionados em conjunto">
            {CHIPS.map((c, i) => (
              <span className={`chip${i < 2 ? ' on' : ''}`} key={c}>
                {c}
              </span>
            ))}
          </div>
        </Section>

        <Section index={isMobile ? '06' : '07'} eyebrow="Sua conta" className="conta-sec">
          <ul className="spec-list four">
            {CONTA.map((p) => (
              <li className="spec" key={p.title}>
                <span className="ico" aria-hidden="true">
                  <Icon name={p.icon} size={20} />
                </span>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section className="final">
          <div className="final-mark" aria-hidden="true">
            <Logo size={44} strokeWidth={4} />
          </div>
          <h2>
            {isMobile ? 'Baixe e escolha' : 'Entre e escolha'}
            <br />
            <span className="hl">o Frame.</span>
          </h2>
          <div className="final-actions">
            {isMobile ? (
              <button className="btn btn-primary" onClick={irParaApp}>
                <Icon name="download" size={16} />
                Baixar o app
              </button>
            ) : (
              <>
                <button className="btn btn-primary" onClick={() => onEnter('signup')}>
                  Criar conta
                  <Icon name="arrowRight" size={16} />
                </button>
                <button className="btn btn-ghost" onClick={() => onEnter('login')}>
                  Já tenho conta
                </button>
              </>
            )}
          </div>
        </Section>
      </main>

      <footer className="landing-footer">
        <span className="brand">
          <Logo size={20} strokeWidth={5} />
          <span className="wordmark">FRAME</span>
        </span>
        <nav className="foot-links" aria-label="Rodapé">
          <button onClick={irParaApp}>App pra Android</button>
          <button onClick={onDownloads}>Versões</button>
          <a href="/frame-extensao.zip">Extensão do Chrome</a>
          {!isMobile && <button onClick={() => onEnter('login')}>Entrar</button>}
        </nav>
      </footer>
    </div>
  );
}
