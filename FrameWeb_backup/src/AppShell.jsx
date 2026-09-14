import { Component, lazy, Suspense, useState } from 'react';
import { FrameProvider, useFrame } from './lib/FrameContext';
import { useHashRoute, navigate, titlePath } from './lib/router';
import Header from './components/Header';

/**
 * O Frame logado.
 *
 * Este arquivo é carregado sob demanda: quem só abre a landing (todo mundo
 * no celular, e qualquer visitante de primeira viagem) nunca baixa o
 * supabase-js nem as telas daqui. Ver o comentário em App.jsx.
 */

/**
 * `lazy` que sobrevive a um deploy com a aba aberta.
 *
 * O nome de cada pedaço tem hash, e o deploy apaga os antigos. Uma aba que
 * ficou aberta continua com o index.html velho na memória e pede um arquivo
 * que não existe mais: o import() rejeita, o Suspense nunca resolve e a tela
 * fica com a rodinha girando pra sempre — sem erro visível. Recarregar uma vez
 * resolve, porque aí vem o index.html novo. A marca na sessionStorage existe
 * pra isso não virar laço infinito quando a falha for outra (rede caída).
 */
const MARCA = 'frame:recarga-de-chunk';

const lazyResiliente = (carregar) =>
  lazy(() =>
    carregar()
      .then((mod) => {
        sessionStorage.removeItem(MARCA);
        return mod;
      })
      .catch((erro) => {
        if (!sessionStorage.getItem(MARCA)) {
          sessionStorage.setItem(MARCA, '1');
          window.location.reload();
        }
        throw erro;
      })
  );

const Auth = lazyResiliente(() => import('./pages/Auth'));
const Profiles = lazyResiliente(() => import('./pages/Profiles'));
const Onboarding = lazyResiliente(() => import('./pages/Onboarding'));
const Home = lazyResiliente(() => import('./pages/Home'));
const Explore = lazyResiliente(() => import('./pages/Explore'));
const Library = lazyResiliente(() => import('./pages/Library'));
const Settings = lazyResiliente(() => import('./pages/Settings'));
const Title = lazyResiliente(() => import('./pages/Title'));
const Person = lazyResiliente(() => import('./pages/Person'));
const Colecao = lazyResiliente(() => import('./pages/Colecao'));
const Player = lazyResiliente(() => import('./components/Player'));

const Loading = () => (
  <div className="center-screen">
    <span className="spinner" />
  </div>
);

/**
 * Tela branca com rodinha girando pra sempre nao e diagnostico de nada.
 *
 * Quando um pedaco do site nao carrega, o Suspense fica suspenso e o erro
 * morre no console — que ninguem abre. Isto transforma a rodinha eterna numa
 * mensagem com o motivo e um botao que limpa o estado e recarrega.
 */
class Fronteira extends Component {
  constructor(props) {
    super(props);
    this.state = { erro: null };
  }

  static getDerivedStateFromError(erro) {
    return { erro };
  }

  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div className="center-screen" style={{ flexDirection: 'column', gap: 18, padding: 28 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Nao consegui carregar esta parte do Frame.</div>
        <div style={{ fontSize: 12.5, color: 'var(--fg-muted)', maxWidth: 460, textAlign: 'center' }}>
          {String(this.state.erro?.message || this.state.erro).slice(0, 220)}
        </div>
        <button
          className="btn btn-light"
          onClick={() => {
            try {
              sessionStorage.clear();
            } catch (e) {
              /* aba anonima com storage bloqueado */
            }
            window.location.reload();
          }}
        >
          Recarregar
        </button>
      </div>
    );
  }
}

function Inner({ initialAuthMode, onLeave }) {
  const { booting, session, activeProfile, isOnboarded, playing, mini } = useFrame();
  const route = useHashRoute();
  const [tab, setTab] = useState('home');
  const [query, setQuery] = useState('');

  // abrir um título é navegar, não abrir uma janela: cada filme e cada série
  // tem endereço próprio (#/filme/603), com botão voltar funcionando
  const open = (item) => navigate(titlePath(item));

  if (booting) return <Loading />;

  if (!session) {
    return (
      <Fronteira>
      <Suspense fallback={<Loading />}>
        <Auth initialMode={initialAuthMode || 'login'} onBack={onLeave} />
      </Suspense>
      </Fronteira>
    );
  }

  if (!activeProfile) {
    return (
      <Fronteira>
      <Suspense fallback={<Loading />}>
        <Profiles />
      </Suspense>
      </Fronteira>
    );
  }

  // isOnboarded === null é "ainda não sei": não mandar pro onboarding antes do
  // sync responder, senão a pessoa refaz a calibração à toa
  const needsOnboarding =
    isOnboarded === false || (isOnboarded === null && !activeProfile?.taste_profile?.analytics);
  if (needsOnboarding) {
    return (
      <Fronteira>
      <Suspense fallback={<Loading />}>
        <Onboarding />
      </Suspense>
      </Fronteira>
    );
  }

  return (
    <>
      {/* o player vive fora da troca de abas: minimizar não remonta o vídeo */}
      <div style={playing && !mini ? { display: 'none' } : undefined}>
        <Header
          tab={route.name === 'title' || route.name === 'colecao' ? null : tab}
          onTab={(t) => {
            setTab(t);
            setQuery('');
            navigate('/'); // sai da página de um título de volta pro feed
          }}
          query={query}
          onQuery={(q) => {
            setQuery(q);
            // Buscar e explorar sao a mesma aba: quem digita quer sair do que
            // for que estiver vendo e cair no resultado, inclusive de dentro
            // da pagina de um titulo (onde a aba continua sendo a de antes).
            if (q && (tab !== 'explore' || route.name !== 'home')) {
              setTab('explore');
              navigate('/');
            }
          }}
        />

        <Fronteira>
      <Suspense fallback={<Loading />}>
          {route.name === 'title' ? (
            <Title id={route.id} type={route.type} />
          ) : route.name === 'person' ? (
            <Person id={route.id} />
          ) : route.name === 'colecao' ? (
            <Colecao id={route.id} onOpen={open} />
          ) : (
            <>
              {tab === 'home' && <Home onOpen={open} />}
              {tab === 'explore' && <Explore query={query} onOpen={open} />}
              {tab === 'library' && <Library onOpen={open} />}
              {tab === 'settings' && <Settings />}
            </>
          )}
        </Suspense>
      </Fronteira>
      </div>

      <Fronteira>
        <Suspense fallback={null}>
          <Player />
        </Suspense>
      </Fronteira>
    </>
  );
}

export default function AppShell(props) {
  return (
    <FrameProvider>
      <Inner {...props} />
    </FrameProvider>
  );
}
