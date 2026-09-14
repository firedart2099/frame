import { lazy, Suspense, useState } from 'react';
import useIsMobile from './lib/useIsMobile';
import { useHashRoute } from './lib/router';
import Landing from './pages/Landing';
import Downloads from './pages/Downloads';
import './styles/theme.css';
import './styles/app.css';
import './styles/colecao.css';

/**
 * Duas caras, um código:
 *
 *   celular -> landing + downloads. Assistir no telefone é trabalho do app,
 *              e o site existe pra levar a pessoa até ele.
 *   PC      -> o Frame inteiro, com miniplayer. Sem aba de downloads: quem
 *              está no computador já está no lugar certo.
 *
 * Só a landing e a página de downloads vêm no primeiro carregamento. Todo o
 * resto — incluindo o supabase-js, que sozinho é maior que a landing inteira
 * — está atrás de um import dinâmico. Assim o visitante de celular baixa uma
 * fração do que baixaria, e ele é justamente quem mais paga por byte.
 *
 * Rota por hash (#/downloads) porque o host é estático: o link fica
 * compartilhável e o botão "voltar" do navegador funciona.
 */

const AppShell = lazy(() => import('./AppShell'));

/**
 * Já existe sessão salva? Dá pra saber sem carregar o supabase-js: ele guarda
 * o token no localStorage com uma chave previsível. Serve só pra decidir se
 * pulamos a landing — quem valida o token é o próprio supabase depois.
 */
function hasStoredSession() {
  try {
    return Object.keys(window.localStorage).some((k) => /^sb-.*-auth-token$/.test(k));
  } catch (e) {
    return false;
  }
}

export default function App() {
  const isMobile = useIsMobile();
  const route = useHashRoute();
  const [enter, setEnter] = useState(() => (hasStoredSession() ? 'login' : null));

  const go = (r) => {
    window.location.hash = r === 'home' ? '' : `/${r}`;
    window.scrollTo(0, 0);
  };

  if (route.name === 'downloads') return <Downloads onBack={() => go('home')} />;

  if (isMobile) {
    return <Landing isMobile onDownloads={() => go('downloads')} onEnter={() => go('downloads')} />;
  }

  // link direto pra um título (#/filme/603) entra no app, não na landing
  if (!enter && route.name !== 'title') {
    return <Landing onEnter={setEnter} onDownloads={() => go('downloads')} />;
  }

  return (
    <Suspense
      fallback={
        <div className="center-screen">
          <span className="spinner" />
        </div>
      }
    >
      <AppShell initialAuthMode={enter || 'login'} onLeave={() => setEnter(null)} />
    </Suspense>
  );
}
