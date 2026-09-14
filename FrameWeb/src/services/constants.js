// Espelho de src/config/constants.js do app.

export const TMDB_API_KEY = '9cfddb984190a8787820822d4c78ac32';
export const TMDB = 'https://api.themoviedb.org/3';
export const IMG = 'https://image.tmdb.org/t/p';

export const poster = (path, size = 'w500') => (path ? `${IMG}/${size}${path}` : null);
export const backdrop = (path, size = 'original') => (path ? `${IMG}/${size}${path}` : null);

/**
 * Últimos recursos, em ordem de confiança. Só entram quando NENHUM release
 * direto do AllDebrid tocou — são iframes de terceiros, sem os nossos
 * controles e sem escolha de legenda.
 *
 * O SuperFlix vem primeiro por dois motivos: é brasileiro, então normalmente
 * já abre dublado (que é o que falta quando não existe torrent dublado), e
 * indexa por id da TMDB, o que erra menos de título. O AutoEmbed fica atrás
 * porque, quando não tem o título, ele serve OUTRO filme sem avisar — foi ele
 * que entregou um obscuro de 1960 no lugar do Invencível.
 */
export const SERVERS = [
  {
    name: 'SuperFlix',
    dica: 'fonte brasileira — normalmente dublado',
    getUrl: (id, type, s, e) =>
      type === 'tv'
        ? `https://superflixapi.baby/serie/${id}/${s}/${e}`
        : `https://superflixapi.baby/filme/${id}`,
  },
  {
    name: 'AutoEmbed',
    dica: 'pode servir outro título',
    getUrl: (id, type, s, e) =>
      type === 'tv'
        ? `https://autoembed.co/tv/tmdb/${id}-${s}-${e}`
        : `https://autoembed.co/movie/tmdb/${id}`,
  },
];

export const GENRES = [
  { id: 28, name: 'Ação' }, { id: 12, name: 'Aventura' }, { id: 16, name: 'Animação' },
  { id: 35, name: 'Comédia' }, { id: 80, name: 'Crime' }, { id: 99, name: 'Documentário' },
  { id: 18, name: 'Drama' }, { id: 10751, name: 'Família' }, { id: 14, name: 'Fantasia' },
  { id: 36, name: 'História' }, { id: 27, name: 'Terror' }, { id: 10402, name: 'Música' },
  { id: 9648, name: 'Mistério' }, { id: 10749, name: 'Romance' }, { id: 878, name: 'Ficção Científica' },
  { id: 10770, name: 'Cinema TV' }, { id: 53, name: 'Thriller' }, { id: 10752, name: 'Guerra' },
  { id: 37, name: 'Faroeste' },
];

/** IDs de genero de serie sao diferentes dos de filme na TMDB. */
const TV_GENRE_MAP = { 28: 10759, 12: 10759, 14: 10765, 878: 10765, 36: 10768, 10752: 10768, 27: 9648 };
export const toTvGenre = (id) => TV_GENRE_MAP[id] || id;

export const tmdb = async (path, params = {}) => {
  const qs = new URLSearchParams({ api_key: TMDB_API_KEY, language: 'pt-BR', ...params });
  const res = await fetch(`${TMDB}${path}?${qs}`);
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
};
