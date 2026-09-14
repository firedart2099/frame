import { useEffect, useState } from 'react';

/**
 * Roteador por hash.
 *
 * O host é estático (Cloudflare Pages), então rota por hash é a que funciona
 * sem configuração de servidor e sem quebrar o F5. Em troca, cada filme e
 * cada série ganha um endereço de verdade — dá pra mandar o link pra alguém,
 * favoritar, e o botão "voltar" do navegador faz o que se espera.
 *
 *   #/                 início
 *   #/downloads        baixar o app
 *   #/filme/603        um filme
 *   #/serie/1396       uma série
 *   #/pessoa/525       tudo de um diretor ou ator
 *   #/colecao/marvel   uma colecao (Marvel, Pixar, Star Wars...)
 */

export const parseHash = (hash = window.location.hash) => {
  const path = hash.replace(/^#\/?/, '').split('?')[0];
  const [head, id] = path.split('/');

  if (head === 'filme' && id) return { name: 'title', type: 'movie', id: Number(id) };
  if (head === 'serie' && id) return { name: 'title', type: 'tv', id: Number(id) };
  if (head === 'pessoa' && id) return { name: 'person', id: Number(id) };
  if (head === 'colecao' && id) return { name: 'colecao', id };
  if (head === 'downloads') return { name: 'downloads' };
  return { name: 'home' };
};

/** Caminho canônico de um título — uma função só, pra não divergir. */
export const titlePath = (item) => {
  const id = item?.id || item?.tmdbId;
  const isTv =
    item?.type === 'tv' ||
    item?.media_type === 'tv' ||
    (!!item?.first_air_date && !item?.release_date) ||
    (!!item?.name && !item?.title);
  return `/${isTv ? 'serie' : 'filme'}/${id}`;
};

export function navigate(path) {
  const next = path === '/' || !path ? '' : `#${path.startsWith('/') ? path : `/${path}`}`;
  if (window.location.hash === next) return;
  window.location.hash = next;
}

/** Volta na história do navegador; se não houver de onde voltar, vai pro início. */
export function back() {
  if (window.history.length > 1) window.history.back();
  else navigate('/');
}

export function useHashRoute() {
  const [route, setRoute] = useState(() => parseHash());

  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash());
      // rota nova começa do topo — menos na volta, que o navegador restaura
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}
