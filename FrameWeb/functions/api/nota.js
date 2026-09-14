/**
 * GET /api/nota?imdb=tt35618070
 *
 * Nota do IMDb, com o OMDb como primeira opcao e o GraphQL do IMDb como
 * segunda. O OMDb atrasa semanas pra titulo novo ("Sterling Point" estreou
 * em 08/2026: IMDb ja mostra 7.4, OMDb devolve N/A) — e a nota do IMDb e o
 * selo das SERIES no app, entao serie nova aparecia sem nota nenhuma.
 *
 * Se nenhuma das duas tiver, devolve nota null (cache de 1h).
 *
 * Roda no servidor porque nem OMDb (chave) nem IMDb (CORS/WAF) servem
 * pra chamar do app.
 */
const OMDB_KEY = 'thewdb';

const json = (data, status = 200, cache = 'public, max-age=86400') =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': cache,
    },
  });

async function noOmdb(imdb) {
  try {
    const r = await fetch(`https://www.omdbapi.com/?i=${imdb}&apikey=${OMDB_KEY}`, { signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    if (j && j.imdbRating && j.imdbRating !== 'N/A') {
      return { nota: Number(j.imdbRating), votos: Number(String(j.imdbVotes || '').replace(/,/g, '')) || null, fonte: 'omdb' };
    }
  } catch (e) {}
  return null;
}

// A pagina do IMDb (JSON-LD) esta atras do WAF da Amazon tambem de dentro do
// Cloudflare (202 com desafio em JS, testado em 13/09/2026). O que responde
// e o GraphQL que a propria pagina usa, desde que va com os cabecalhos do
// site. Sem eles: 403.
async function noGraphqlDoImdb(imdb) {
  try {
    const r = await fetch('https://api.graphql.imdb.com/', {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
      headers: {
        'content-type': 'application/json',
        'x-imdb-client-name': 'imdb-web-next-localized',
        'x-imdb-user-country': 'US',
        'x-imdb-user-language': 'en-US',
        origin: 'https://www.imdb.com',
        referer: 'https://www.imdb.com/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
      },
      body: JSON.stringify({ query: `{ title(id:"${imdb}") { ratingsSummary { aggregateRating voteCount } } }` }),
    });
    if (r.status !== 200) return { _debug: { status: r.status } };
    const j = await r.json();
    const rs = j && j.data && j.data.title && j.data.title.ratingsSummary;
    if (!rs || !rs.aggregateRating) return null;
    return { nota: Number(rs.aggregateRating), votos: Number(rs.voteCount) || null, fonte: 'imdb' };
  } catch (e) {
    return { _debug: { erro: String((e && e.message) || e) } };
  }
}

export async function onRequestGet({ request }) {
  const imdb = (new URL(request.url).searchParams.get('imdb') || '').trim();
  if (!/^tt\d{5,10}$/.test(imdb)) return json({ erro: 'imdb invalido' }, 400, 'no-store');

  const doOmdb = await noOmdb(imdb);
  if (doOmdb) return json({ imdb, ...doOmdb });

  const doImdb = await noGraphqlDoImdb(imdb);
  if (doImdb && doImdb.nota) return json({ imdb, ...doImdb });
  if (new URL(request.url).searchParams.get('debug')) return json({ imdb, debug: doImdb }, 200, 'no-store');

  // sem nota em lugar nenhum: cache curto, pra tentar de novo amanha cedo
  return json({ imdb, nota: null, votos: null, fonte: null }, 200, 'public, max-age=3600');
}

export const onRequestOptions = () =>
  new Response(null, {
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
