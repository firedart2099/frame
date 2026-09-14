// GERADO POR `npm run sync-app` — copia de ../Frame. Nao edite aqui:
// mexa no app e rode o script de novo, senao os dois lados divergem.
// Carrega as secoes de uma colecao (src/config/colecoes.js) da TMDB.
// Cache em memoria por secao: abrir a colecao de novo e instantaneo.
import { TMDB_API_KEY } from './constants';

const BASE = 'https://api.themoviedb.org/3';
const K = TMDB_API_KEY;

const hoje = () => new Date().toISOString().slice(0, 10);
const dataDe = (m) => m.release_date || m.first_air_date || '';
const jaLancou = (m) => { const d = dataDe(m); return !!d && d <= hoje(); };

// A TMDB corta em ~40-50 requests por segundo por IP (429). Abrir a
// colecao Star Wars sao 26 pedidos de uma vez, no meio da Home carregando
// as prateleiras — era por isso que o banner e metade dos posters nao
// vinham (13/09/2026). Fila de 6 por vez e, no 429, espera e repete.
const MAX_PARALELO = 6;
let rodando = 0;
const fila = [];
const vaga = () => new Promise((ok) => {
  const tentar = () => {
    if (rodando < MAX_PARALELO) { rodando++; ok(); } else fila.push(tentar);
  };
  tentar();
});
const soltar = () => { rodando--; const prox = fila.shift(); if (prox) prox(); };
const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));

const pegar = async (url, tentativas = 3) => {
  await vaga();
  try {
    for (let i = 0; i < tentativas; i++) {
      try {
        const r = await fetch(url);
        if (r.ok) return await r.json();
        if (r.status !== 429) return null;
        const espera = Number(r.headers.get('retry-after')) || 1 + i;
        await dormir(espera * 1000);
      } catch (e) {
        if (i === tentativas - 1) return null;
        await dormir(500 * (i + 1));
      }
    }
    return null;
  } finally {
    soltar();
  }
};

const comTipo = (m, type) => ({ ...m, media_type: type });

async function daColecaoTmdb(ids) {
  const jsons = await Promise.all(ids.map((id) => pegar(`${BASE}/collection/${id}?api_key=${K}&language=pt-BR`)));
  const itens = [];
  for (const j of jsons) for (const p of (j && j.parts) || []) itens.push(comTipo(p, 'movie'));
  return itens;
}

async function porIds(ids, type) {
  const jsons = await Promise.all(ids.map((id) => pegar(`${BASE}/${type}/${id}?api_key=${K}&language=pt-BR`)));
  return jsons.filter((j) => j && j.id).map((j) => comTipo(j, type));
}

async function doDiscover(type, params, paginas = 2) {
  // Quem ja limita a data (eras da Disney) nao ganha outro `.lte` — a TMDB
  // fica com o ultimo e a era sumia. O de lancados vale so quando falta.
  const chaveData = type === 'tv' ? 'first_air_date' : 'primary_release_date';
  const dataMax = params.includes(`${chaveData}.lte`) ? '' : `&${chaveData}.lte=${hoje()}`;
  const ordemTmdb = params.includes('sort_by=') ? '' : '&sort_by=popularity.desc';
  const urls = [];
  for (let p = 1; p <= paginas; p++) {
    urls.push(`${BASE}/discover/${type}?api_key=${K}&${params}${dataMax}${ordemTmdb}&language=pt-BR&page=${p}`);
  }
  const jsons = await Promise.all(urls.map((u) => pegar(u))); // nao `map(pegar)`: o indice viraria `tentativas`
  const itens = [];
  for (const j of jsons) for (const r of (j && j.results) || []) itens.push(comTipo(r, type));
  return itens;
}

// Filmografia como DIRETOR (nao produtor/roteirista): Nolan produz Homem de
// Aco, Villeneuve nao dirigiu Sicario 2. Curtas e compilacoes caem pelo
// vote_count.
async function doDiretor(personId, minimoVotos = 100) {
  const j = await pegar(`${BASE}/person/${personId}/movie_credits?api_key=${K}&language=pt-BR`);
  return ((j && j.crew) || [])
    .filter((c) => c.job === 'Director' && (c.vote_count || 0) >= minimoVotos)
    .map((c) => comTipo(c, 'movie'));
}

// Lista publica da TMDB (ex.: 28 = vencedores do Oscar de Melhor Filme),
// todas as paginas.
async function daLista(listId) {
  const primeira = await pegar(`${BASE}/list/${listId}?api_key=${K}&language=pt-BR&page=1`);
  if (!primeira) return [];
  const paginas = Math.min(primeira.total_pages || 1, 10);
  const resto = [];
  for (let p = 2; p <= paginas; p++) resto.push(`${BASE}/list/${listId}?api_key=${K}&language=pt-BR&page=${p}`);
  const jsons = [primeira, ...(await Promise.all(resto.map((u) => pegar(u))))];
  const itens = [];
  for (const j of jsons) for (const it of (j && j.items) || []) itens.push(comTipo(it, it.media_type || (it.first_air_date ? 'tv' : 'movie')));
  return itens;
}

function ordenar(itens, ordem) {
  if (ordem === 'cronologica') return [...itens].sort((a, b) => (dataDe(a) < dataDe(b) ? -1 : dataDe(a) > dataDe(b) ? 1 : 0));
  if (ordem === 'recentes') return [...itens].sort((a, b) => (dataDe(a) > dataDe(b) ? -1 : dataDe(a) < dataDe(b) ? 1 : 0));
  if (ordem === 'popularidade') return [...itens].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  return itens;
}

const cacheSecao = new Map();

export async function carregarSecao(colecaoId, secao) {
  const chave = `${colecaoId}/${secao.id}`;
  if (cacheSecao.has(chave)) return cacheSecao.get(chave);
  const f = secao.fonte || {};
  let itens = [];
  if (f.colecoes) itens = await daColecaoTmdb(f.colecoes);
  else if (f.filmes) itens = await porIds(f.filmes, 'movie');
  else if (f.series) itens = await porIds(f.series, 'tv');
  else if (f.discover) itens = await doDiscover(f.discover, f.params || '', f.paginas || 2);
  else if (f.diretor) itens = await doDiretor(f.diretor, f.minimoVotos);
  else if (f.lista) itens = await daLista(f.lista);

  const vistos = new Set();
  itens = itens.filter((m) => {
    if (!m || !m.id || vistos.has(m.id)) return false;
    vistos.add(m.id);
    return jaLancou(m);
  });
  itens = ordenar(itens, secao.ordem);
  if (itens.length) cacheSecao.set(chave, itens); // vazio (rede fora) nao vira cache
  return itens;
}

export async function carregarColecao(colecao) {
  const secoes = await Promise.all(
    colecao.secoes.map(async (s) => ({ ...s, itens: await carregarSecao(colecao.id, s) }))
  );
  return secoes.filter((s) => s.itens.length > 0);
}

/** Todos os itens da colecao, sem repetir — pra salvar como pasta. */
export function itensDaColecao(secoes) {
  const vistos = new Set();
  const todos = [];
  for (const s of secoes) {
    for (const m of s.itens) {
      if (vistos.has(m.id)) continue;
      vistos.add(m.id);
      todos.push(m);
    }
  }
  return todos;
}

// Banner: backdrop SEM texto do filme-capa (include_image_language=null),
// senao vem o poster horizontal com logo em ingles em cima.
const cacheCapa = new Map();
export async function capaDaColecao(colecao) {
  const { type, id } = colecao.capa || {};
  if (!id) return null;
  const chave = `${type}/${id}`;
  if (cacheCapa.has(chave)) return cacheCapa.get(chave);
  let path = null;
  const imgs = await pegar(`${BASE}/${type}/${id}/images?api_key=${K}&include_image_language=null`);
  const semTexto = ((imgs && imgs.backdrops) || []).sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))[0];
  if (semTexto) path = semTexto.file_path;
  if (!path) {
    const det = await pegar(`${BASE}/${type}/${id}?api_key=${K}`);
    path = det && det.backdrop_path;
  }
  const url = path ? `https://image.tmdb.org/t/p/w780${path}` : null;
  if (url) cacheCapa.set(chave, url);
  return url;
}

/**
 * Fundos do cartao da Home: a capa da colecao e depois os backdrops dos
 * primeiros titulos da 1ª secao (w780). O cartao troca entre eles a cada
 * 3 s com fade — pedido do Luiz em 13/09/2026, no lugar do leque de posters.
 */
export async function fundosDaColecao(colecao, n = 6) {
  const capa = await capaDaColecao(colecao);
  const primeira = colecao.secoes[0];
  const itens = primeira ? await carregarSecao(colecao.id, primeira) : [];
  const fundos = itens
    .filter((m) => m.backdrop_path)
    .slice(0, n)
    .map((m) => `https://image.tmdb.org/t/p/w780${m.backdrop_path}`);
  return [...new Set([capa, ...fundos].filter(Boolean))];
}

/** Primeiros posters da colecao (1ª secao) — a faixa de posters do cartao. */
export async function postersDaColecao(colecao, n = 4) {
  const primeira = colecao.secoes[0];
  if (!primeira) return [];
  const itens = await carregarSecao(colecao.id, primeira);
  return itens.filter((m) => m.poster_path).slice(0, n).map((m) => `https://image.tmdb.org/t/p/w185${m.poster_path}`);
}

/**
 * Busca de coleções pelo texto: "marvel" acha Marvel, "harry potter" acha
 * Mundo Mágico (pelo subtítulo), "batman" acha DC (pela seção), "toy story"
 * acha Pixar (pela descrição). Todas as palavras da busca têm que aparecer
 * em algum lugar da coleção; quem bate no título vem primeiro.
 */
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function buscarColecoes(colecoes, query, limite = 2) {
  const q = semAcento(query).trim();
  if (q.length < 2) return [];
  const palavras = q.split(/\s+/).filter((w) => w.length >= 2);
  if (!palavras.length) return [];
  const achadas = [];
  for (const c of colecoes) {
    const titulo = semAcento(c.titulo);
    const sub = semAcento(c.subtitulo);
    const secoes = semAcento((c.secoes || []).map((x) => x.titulo).join(' '));
    const tudo = `${titulo} ${sub} ${secoes} ${semAcento(c.descricao)}`;
    if (!palavras.every((w) => tudo.includes(w))) continue;
    const peso = titulo.includes(q) ? 3 : sub.includes(q) ? 2 : secoes.includes(q) ? 1.5 : 1;
    achadas.push({ colecao: c, peso });
  }
  return achadas.sort((a, b) => b.peso - a.peso).slice(0, limite).map((a) => a.colecao);
}
