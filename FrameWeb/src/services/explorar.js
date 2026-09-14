import { tmdb, GENRES, toTvGenre } from './constants';

/**
 * Catálogo aberto: o que existe, não o que combina com você.
 *
 * A Home inteira é recomendação — prateleiras montadas a partir do seu gosto.
 * Isto aqui é o contrário de propósito: categorias e filtros crus da TMDB, sem
 * nada personalizado no meio. É pra quando a pessoa chega dizendo "quero ver
 * animação" e não quer negociar com um algoritmo.
 *
 * Toda categoria é um preset de `/discover` — não um endpoint diferente — pra
 * que ela CONTINUE valendo quando você marca um gênero ou uma década por cima.
 * A única exceção é "Em alta", que só existe em `/trending`: com filtro junto,
 * ela cai pro discover por popularidade.
 */

const hoje = () => new Date().toISOString().slice(0, 10);
const anosAtras = (n) => new Date(Date.now() - n * 365.25 * 864e5).toISOString().slice(0, 10);

export const TIPOS = [
  { id: 'tudo', label: 'Tudo' },
  { id: 'movie', label: 'Filmes' },
  { id: 'tv', label: 'Séries' },
];

export const CATEGORIAS = [
  { id: 'populares', label: 'Populares' },
  { id: 'alta', label: 'Em alta' },
  { id: 'recentes', label: 'Lançados recentemente' },
  { id: 'cartaz', label: 'Nos cinemas', tipo: 'movie' },
  { id: 'noar', label: 'No ar agora', tipo: 'tv' },
  { id: 'breve', label: 'Em breve' },
  { id: 'melhores', label: 'Melhores avaliados' },
  { id: 'votados', label: 'Mais falados de sempre' },
  { id: 'joias', label: 'Joias escondidas' },
  { id: 'classicos', label: 'Clássicos' },
  { id: 'bilheteria', label: 'Campeões de bilheteria', tipo: 'movie' },
  { id: 'curtos', label: 'Cabe numa noite', tipo: 'movie' },
  { id: 'nacional', label: 'Brasileiros' },
  { id: 'anime', label: 'Anime', tipo: 'tv' },
];

export const DECADAS = [
  { id: 'any', label: 'Qualquer época' },
  { id: 'novos', label: 'Últimos 12 meses' },
  { id: '2020', label: 'Anos 2020' },
  { id: '2010', label: 'Anos 2010' },
  { id: '2000', label: 'Anos 2000' },
  { id: '1990', label: 'Anos 90' },
  { id: '1980', label: 'Anos 80' },
  { id: '1970', label: 'Anos 70' },
  { id: '1960', label: 'Anos 60' },
  { id: '1950', label: 'Anos 50 e antes' },
];

export const ORDENS = [
  { id: 'padrao', label: 'Da categoria' },
  { id: 'popularity.desc', label: 'Mais populares' },
  { id: 'data.desc', label: 'Mais recentes' },
  { id: 'data.asc', label: 'Mais antigos' },
  { id: 'vote_average.desc', label: 'Melhor nota' },
  { id: 'vote_count.desc', label: 'Mais votados' },
  { id: 'revenue.desc', label: 'Maior bilheteria' },
];

export const NOTAS = [
  { id: 0, label: 'Qualquer nota' },
  { id: 6, label: 'Nota 6+' },
  { id: 7, label: 'Nota 7+' },
  { id: 8, label: 'Nota 8+' },
];

export const GENEROS = GENRES;

export const FILTROS_PADRAO = {
  tipo: 'tudo',
  categoria: 'populares',
  generos: [],
  decada: 'any',
  nota: 0,
  ordem: 'padrao',
};

export const contarFiltros = (f) =>
  (f.generos.length ? 1 : 0) + (f.decada !== 'any' ? 1 : 0) + (f.nota ? 1 : 0) + (f.ordem !== 'padrao' ? 1 : 0);

/** Categoria que só existe num tipo manda no tipo. */
export const categoriaVale = (cat, tipo) => !cat.tipo || tipo === 'tudo' || tipo === cat.tipo;

const limpar = (lista, tipo) =>
  (lista || [])
    .filter((m) => m && m.poster_path && !m.adult)
    .map((m) => ({ ...m, media_type: m.media_type || tipo }));

/**
 * Monta os parâmetros do /discover. O campo de data muda entre filme e série
 * (`primary_release_date` x `first_air_date`), e errar isso devolve lista
 * vazia sem dar erro nenhum.
 */
function parametros(filtros, tipo) {
  const serie = tipo === 'tv';
  const data = serie ? 'first_air_date' : 'primary_release_date';
  const p = {
    include_adult: 'false',
    sort_by: 'popularity.desc',
    'vote_count.gte': 40,
    [`${data}.lte`]: hoje(),
  };

  switch (filtros.categoria) {
    case 'recentes':
      p.sort_by = `${data}.desc`;
      p[`${data}.gte`] = anosAtras(1);
      p['vote_count.gte'] = 12;
      break;
    case 'cartaz':
      p[`${data}.gte`] = anosAtras(0.2);
      p['vote_count.gte'] = 5;
      break;
    case 'noar':
      p[`${data}.gte`] = anosAtras(0.5);
      p['vote_count.gte'] = 5;
      break;
    case 'breve':
      p.sort_by = `${data}.asc`;
      p[`${data}.gte`] = hoje();
      delete p[`${data}.lte`];
      delete p['vote_count.gte'];
      break;
    case 'melhores':
      p.sort_by = 'vote_average.desc';
      p['vote_count.gte'] = serie ? 400 : 1200;
      break;
    case 'votados':
      p.sort_by = 'vote_count.desc';
      break;
    case 'joias':
      p.sort_by = 'vote_average.desc';
      p['vote_average.gte'] = 7;
      p['vote_count.gte'] = serie ? 60 : 150;
      p['vote_count.lte'] = serie ? 900 : 2500;
      break;
    case 'classicos':
      p.sort_by = 'vote_count.desc';
      p[`${data}.lte`] = '1999-12-31';
      p['vote_average.gte'] = 7;
      break;
    case 'bilheteria':
      p.sort_by = 'revenue.desc';
      break;
    case 'curtos':
      p['with_runtime.lte'] = 100;
      p['with_runtime.gte'] = 60;
      p['vote_count.gte'] = 150;
      break;
    case 'nacional':
      p.with_original_language = 'pt';
      p.with_origin_country = 'BR';
      p['vote_count.gte'] = 5;
      break;
    case 'anime':
      p.with_original_language = 'ja';
      p.with_genres = String(toTvGenre(16));
      p['vote_count.gte'] = 20;
      break;
    default:
      p['vote_count.gte'] = 60;
      break;
  }

  if (filtros.generos.length) {
    const ids = filtros.generos.map((g) => (serie ? toTvGenre(Number(g)) : Number(g)));
    const jaTinha = p.with_genres ? [Number(p.with_genres)] : [];
    p.with_genres = [...new Set([...jaTinha, ...ids])].join('|');
  }

  if (filtros.decada !== 'any') {
    if (filtros.decada === 'novos') {
      p[`${data}.gte`] = anosAtras(1);
    } else {
      const ini = Number(filtros.decada);
      p[`${data}.gte`] = ini === 1950 ? '1900-01-01' : `${ini}-01-01`;
      p[`${data}.lte`] = `${ini + 9}-12-31`;
    }
  }

  if (filtros.nota) {
    p['vote_average.gte'] = filtros.nota;
    p['vote_count.gte'] = Math.max(Number(p['vote_count.gte']) || 0, 100);
  }

  if (filtros.ordem !== 'padrao') {
    p.sort_by = filtros.ordem.startsWith('data.') ? `${data}.${filtros.ordem.split('.')[1]}` : filtros.ordem;
    if (p.sort_by === 'revenue.desc' && serie) p.sort_by = 'vote_count.desc';
  }

  return p;
}

const umTipo = async (filtros, tipo, page) => {
  const semFiltro =
    !filtros.generos.length && filtros.decada === 'any' && !filtros.nota && filtros.ordem === 'padrao';
  try {
    if (filtros.categoria === 'alta' && semFiltro) {
      const j = await tmdb(`/trending/${tipo}/week`, { page });
      return limpar(j.results, tipo);
    }
    const j = await tmdb(`/discover/${tipo}`, { ...parametros(filtros, tipo), page });
    return limpar(j.results, tipo);
  } catch (e) {
    return [];
  }
};

/**
 * Uma página do catálogo. Em "Tudo", filme e série vêm intercalados — duas
 * chamadas, não uma: a TMDB não tem discover que misture os dois.
 */
export async function buscarExplorar(filtros, page = 1) {
  const cat = CATEGORIAS.find((c) => c.id === filtros.categoria);
  const tipo = cat && cat.tipo ? cat.tipo : filtros.tipo;

  if (tipo !== 'tudo') return umTipo(filtros, tipo, page);

  const [filmes, series] = await Promise.all([umTipo(filtros, 'movie', page), umTipo(filtros, 'tv', page)]);
  const juntos = [];
  for (let i = 0; i < Math.max(filmes.length, series.length); i += 1) {
    if (filmes[i]) juntos.push(filmes[i]);
    if (series[i]) juntos.push(series[i]);
  }
  return juntos;
}
