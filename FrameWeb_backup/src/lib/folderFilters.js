import { GENRES, toTvGenre } from '../services/constants';
import { titleOf, typeOf, yearOf, idOf } from './tmdb';

/**
 * Filtros e ordenação de pasta, no espírito dos do Letterboxd.
 *
 * Ficou de fora tudo que depende da SUA nota ("Your Rating"): o Frame não
 * guarda nota por título, então essas opções existiriam quebradas. "Nota"
 * aqui é a média do público (TMDB), que é o "Average Rating" de lá.
 */

export const DECADES = [
  { id: 'any', label: 'Qualquer década' },
  { id: 'upcoming', label: 'Em breve' },
  ...Array.from({ length: 16 }, (_, i) => {
    const y = 2020 - i * 10;
    return { id: String(y), label: `${y}s` };
  }),
];

export const SORTS = [
  { id: 'added', label: 'Quando salvei' },
  { id: 'added_rev', label: 'Quando salvei (invertido)' },
  { id: 'name', label: 'Nome' },
  { id: 'popularity', label: 'Popularidade' },
  { id: 'release_new', label: 'Lançamento — mais novo' },
  { id: 'release_old', label: 'Lançamento — mais antigo' },
  { id: 'rating_high', label: 'Nota do público — maior' },
  { id: 'rating_low', label: 'Nota do público — menor' },
  { id: 'runtime_short', label: 'Duração — mais curto' },
  { id: 'runtime_long', label: 'Duração — mais longo' },
  { id: 'diary_new', label: 'Data no diário — mais recente' },
  { id: 'diary_old', label: 'Data no diário — mais antiga' },
  { id: 'shuffle', label: 'Aleatório' },
];

export const VISIBILITY = [
  { id: 'hideWatched', label: 'Esconder o que já vi' },
  { id: 'hideWatchlist', label: 'Esconder o que está na Watchlist' },
  { id: 'hideDocs', label: 'Esconder documentários' },
  { id: 'hideShorts', label: 'Esconder curtas (< 40 min)' },
  { id: 'hideTv', label: 'Esconder séries' },
];

export const DEFAULT_FILTERS = {
  decade: 'any',
  genre: 'any',
  sort: 'added',
  hideWatched: false,
  hideWatchlist: false,
  hideDocs: false,
  hideShorts: false,
  hideTv: false,
};

const DOC_GENRE = 99;

const runtimeOf = (item) =>
  item.runtime || (Array.isArray(item.episode_run_time) ? item.episode_run_time[0] : null) || null;

const yearNumber = (item) => {
  const y = yearOf(item) || item.Year;
  const n = Number(y);
  return Number.isFinite(n) && n > 1800 ? n : null;
};

const diaryTime = (item) => {
  const d = item['Watched Date'] || item.Date || item.date;
  const t = d ? Date.parse(d) : NaN;
  return Number.isNaN(t) ? null : t;
};

const genreIdsOf = (item) => {
  const ids = item.genre_ids || (item.genres || []).map((g) => g.id) || [];
  return ids.map(Number).filter(Boolean);
};

/** Aplica filtros + ordenação. `ctx` traz o que o app sabe do usuário. */
export function applyFilters(items, filters, ctx = {}) {
  const { watchedIds = new Set(), watchlistIds = new Set(), query = '' } = ctx;
  const f = { ...DEFAULT_FILTERS, ...filters };
  let list = [...items];

  if (query.trim()) {
    const q = query.trim().toLowerCase();
    list = list.filter((i) => (titleOf(i) || i.Name || '').toLowerCase().includes(q));
  }

  if (f.decade !== 'any') {
    list = list.filter((i) => {
      const y = yearNumber(i);
      if (f.decade === 'upcoming') return y ? y > new Date().getFullYear() : false;
      if (!y) return false;
      const start = Number(f.decade);
      return y >= start && y < start + 10;
    });
  }

  if (f.genre !== 'any') {
    const movieId = Number(f.genre);
    const tvId = toTvGenre(movieId);
    list = list.filter((i) => {
      const ids = genreIdsOf(i);
      // item nunca aberto ainda não tem gênero: não some da lista por isso
      if (!ids.length) return false;
      return ids.includes(typeOf(i) === 'tv' ? tvId : movieId);
    });
  }

  if (f.hideTv) list = list.filter((i) => typeOf(i) !== 'tv');
  if (f.hideDocs) list = list.filter((i) => !genreIdsOf(i).includes(DOC_GENRE));
  if (f.hideShorts) {
    list = list.filter((i) => {
      const r = runtimeOf(i);
      return r === null ? true : r >= 40; // sem duração conhecida, mantém
    });
  }
  if (f.hideWatched) list = list.filter((i) => !watchedIds.has(String(idOf(i))));
  if (f.hideWatchlist) list = list.filter((i) => !watchlistIds.has(String(idOf(i))));

  const byName = (a, b) => (titleOf(a) || a.Name || '').localeCompare(titleOf(b) || b.Name || '', 'pt-BR');
  const num = (v) => (typeof v === 'number' ? v : -1);

  switch (f.sort) {
    case 'added_rev':
      list.reverse();
      break;
    case 'name':
      list.sort(byName);
      break;
    case 'popularity':
      list.sort((a, b) => num(b.popularity) - num(a.popularity));
      break;
    case 'release_new':
      list.sort((a, b) => (yearNumber(b) || 0) - (yearNumber(a) || 0));
      break;
    case 'release_old':
      list.sort((a, b) => (yearNumber(a) || 9999) - (yearNumber(b) || 9999));
      break;
    case 'rating_high':
      list.sort((a, b) => num(b.vote_average) - num(a.vote_average));
      break;
    case 'rating_low':
      list.sort((a, b) => num(a.vote_average) - num(b.vote_average));
      break;
    case 'runtime_short':
      list.sort((a, b) => (runtimeOf(a) || 99999) - (runtimeOf(b) || 99999));
      break;
    case 'runtime_long':
      list.sort((a, b) => (runtimeOf(b) || 0) - (runtimeOf(a) || 0));
      break;
    case 'diary_new':
      list.sort((a, b) => (diaryTime(b) || 0) - (diaryTime(a) || 0));
      break;
    case 'diary_old':
      list.sort((a, b) => (diaryTime(a) || Infinity) - (diaryTime(b) || Infinity));
      break;
    case 'shuffle':
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      break;
    default:
      break; // 'added' = a ordem em que entraram na pasta
  }

  return list;
}

/** Só oferece "data no diário" em pasta que realmente tem essa coluna. */
export const hasDiaryDates = (items) => items.some((i) => diaryTime(i) !== null);

export const GENRE_OPTIONS = [{ id: 'any', name: 'Qualquer gênero' }, ...GENRES];
