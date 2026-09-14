import { tmdb } from './constants';

// JSZip e Papa pesam ~100 kB juntos e so servem pra esta tela. Carregados sob
// demanda, eles saem do bundle que todo mundo baixa — inclusive quem so abre
// a landing no celular.
let JSZip;
let Papa;
async function loadParsers() {
  if (JSZip && Papa) return;
  const [zip, papa] = await Promise.all([import('jszip'), import('papaparse')]);
  JSZip = zip.default;
  Papa = papa.default;
}

/**
 * Import do export do Letterboxd, versão web.
 *
 * Gera exatamente as mesmas estruturas do app:
 *  - pastas `lbxd_watched`, `lbxd_watchlist` e uma por lista customizada,
 *    com os itens crus do CSV (o TMDB é resolvido depois, sob demanda);
 *  - um `taste_profile` no formato que as prateleiras já sabem ler.
 *
 * Assim o perfil montado aqui vale no celular na mesma hora.
 */

const MAX_ANALYZED = 80; // teto de títulos que viram análise de gosto
const CONCURRENCY = 6;

const parseCsv = (text) =>
  new Promise((resolve) => {
    Papa.parse(text, { header: true, skipEmptyLines: true, complete: (r) => resolve(r.data || []) });
  });

async function pooled(items, worker, size = CONCURRENCY, onTick) {
  const out = [];
  let i = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        try {
          const r = await worker(items[idx]);
          if (r) out.push(r);
        } catch (e) {}
        onTick?.(++done, items.length);
      }
    })
  );
  return out;
}

const bump = (map, key, by = 1) => {
  if (key === undefined || key === null || key === '') return;
  map[key] = (map[key] || 0) + by;
};

/**
 * @param {File} file  o .zip do letterboxd.com/data/export/
 * @param {(step: string, pct: number) => void} onProgress
 */
export async function importLetterboxdZip(file, onProgress = () => {}) {
  onProgress('Abrindo o arquivo', 0.02);
  await loadParsers();
  const zip = await JSZip.loadAsync(file);

  const readCsv = async (name) => {
    const entry = zip.file(name);
    if (!entry) return [];
    return parseCsv(await entry.async('string'));
  };

  onProgress('Lendo seu diário', 0.08);
  const watched = await readCsv('watched.csv');
  const watchlist = await readCsv('watchlist.csv');
  const ratings = await readCsv('ratings.csv');

  /** Slug estavel a partir do nome da lista — a chave da pasta no banco. */
  const idDaLista = (nome) =>
    String(nome || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'sem-nome';

  const folders = [];
  const items = {};
  const addFolder = (id, name, description, isAuto, autoType, rows) => {
    folders.push({ id, name, description, isAuto, autoType });
    items[id] = rows;
  };

  if (watched.length) addFolder('lbxd_watched', 'Diário do Letterboxd', 'Histórico importado', true, 'watched', watched);
  if (watchlist.length) addFolder('lbxd_watchlist', 'Watchlist do Letterboxd', 'Watchlist importada', true, 'watchlist', watchlist);

  // listas customizadas: o CSV tem 3 linhas de cabeçalho antes dos itens
  onProgress('Lendo suas listas', 0.14);
  const listPaths = Object.keys(zip.files).filter((k) => k.startsWith('lists/') && k.endsWith('.csv'));
  for (const path of listPaths) {
    const content = await zip.file(path).async('string');
    const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length <= 4) continue;
    const meta = await parseCsv(`${lines[1]}\n${lines[2]}`);
    const listName = meta[0]?.Name || path.split('/').pop().replace('.csv', '');
    const rows = await parseCsv(lines.slice(3).join('\n'));
    if (!rows.length) continue;
    // Id derivado do NOME, nao do relogio.
    //
    // Antes era `list_${Date.now()}${aleatorio}`: cada importacao gerava um id
    // novo, entao reimportar criava "20 Animacoes muito fodas" de novo em vez
    // de atualizar a que existia — o usuario acabava com pastas repetidas e o
    // banco com linhas duplicadas. Com o id vindo do nome, a segunda
    // importacao cai na MESMA pasta e so atualiza o conteudo.
    const id = `list_${idDaLista(listName)}`;
    addFolder(id, listName, meta[0]?.Description || 'Lista do Letterboxd', false, null, rows);
  }

  // ------------------------------------------------------ análise de gosto
  const byKey = new Map();
  ratings.forEach((r) => r.Name && byKey.set(r.Name + r.Year, { ...r }));
  watched.forEach((w) => {
    if (!w.Name) return;
    const k = w.Name + w.Year;
    if (!byKey.has(k)) byKey.set(k, { ...w });
  });

  const history = [...byKey.values()];
  const favorites = history
    .filter((h) => h.Rating && parseFloat(h.Rating) >= 3.5)
    .sort((a, b) => parseFloat(b.Rating) - parseFloat(a.Rating));
  const analyze = (favorites.length >= 12 ? favorites : history).slice(0, MAX_ANALYZED);

  const top_genres = {};
  const top_directors = {};
  const top_cast = {};
  const top_keywords = {};
  const raw_genre_ids = [];
  const years = [];
  let ratingSum = 0;
  let ratingCount = 0;

  onProgress('Analisando seu gosto', 0.2);
  await pooled(
    analyze,
    async (row) => {
      const found = await tmdb('/search/movie', {
        query: row.Name,
        ...(row.Year ? { year: row.Year } : {}),
      });
      const hit = found.results?.[0];
      if (!hit) return null;

      const weight = row.Rating ? Math.max(0.5, parseFloat(row.Rating) - 2) : 1;
      if (row.Rating) {
        ratingSum += parseFloat(row.Rating);
        ratingCount++;
      }
      (hit.genre_ids || []).forEach((g) => {
        bump(top_genres, g, weight);
        raw_genre_ids.push(g);
      });
      if (hit.release_date) years.push(Number(hit.release_date.slice(0, 4)));

      const full = await tmdb(`/movie/${hit.id}`, { append_to_response: 'credits,keywords' });
      (full.credits?.crew || []).filter((c) => c.job === 'Director').forEach((d) => bump(top_directors, d.id, weight));
      (full.credits?.cast || []).slice(0, 4).forEach((c) => bump(top_cast, c.id, weight));
      (full.keywords?.keywords || []).slice(0, 6).forEach((k) => bump(top_keywords, k.id, weight));
      return hit.id;
    },
    CONCURRENCY,
    (done, total) => onProgress('Analisando seu gosto', 0.2 + 0.72 * (done / total))
  );

  const topGenreId = Object.entries(top_genres).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  const taste_profile = {
    analytics: {
      avg_rating_preference: ratingCount ? Number((ratingSum / ratingCount).toFixed(2)) : 4.0,
      release_year_trend: years.length ? Math.round(years.reduce((a, b) => a + b, 0) / years.length) : 0,
      top_genres,
      top_directors,
      top_cast,
      top_keywords,
      tv_ratio: 0.05, // o Letterboxd só tem filme
      raw_genre_ids,
      recent_genre_shift: topGenreId,
    },
    context: { preferred_device: 'web', prime_watch_time: 'unknown' },
    is_cinephile: true,
  };

  onProgress('Pronto', 1);
  return {
    folders,
    items,
    ratings,
    taste_profile,
    stats: {
      watched: watched.length,
      watchlist: watchlist.length,
      lists: listPaths.length,
      analyzed: analyze.length,
    },
  };
}
