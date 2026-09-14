/**
 * GET /api/letterboxd?tmdb=157336&titulo=Interstellar&ano=2014[&pt=Interestelar]
 *
 * Nota PÚBLICA do Letterboxd (0..5).
 *
 * O caminho óbvio — `letterboxd.com/tmdb/{id}`, que redireciona pro filme —
 * está atrás de um desafio do Cloudflare: devolve 403 com a página "Just a
 * moment...", tanto pro nosso servidor quanto pela máquina de casa. Foi por
 * isso que a nota sumiu do site.
 *
 * Mas a PÁGINA DO FILME (`letterboxd.com/film/{slug}/`) responde 200 normal.
 * Só o atalho é protegido. Então o trabalho aqui é descobrir o slug a partir
 * do id da TMDB — e, principalmente, CONFERIR que acertamos: a página traz
 * `data-tmdb-id`, então dá pra validar em vez de torcer. Sem essa conferência,
 * "The Thing" de 1982 devolveria a nota do de 2011.
 *
 * Roda no servidor porque o letterboxd.com não manda CORS.
 */

const BASE = 'https://letterboxd.com/film';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      // nota de filme muda devagar; um dia de cache poupa o Letterboxd e nós
      'cache-control': 'public, max-age=86400',
    },
  });

const slug = (t) =>
  String(t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

async function tentar(caminho, tmdbId) {
  try {
    const r = await fetch(`${BASE}/${caminho}/`, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!r.ok) return null;
    const html = await r.text();

    // confere que e o filme certo antes de acreditar na nota
    const id = html.match(/data-tmdb-id="(\d+)"/);
    if (!id || (tmdbId && id[1] !== String(tmdbId))) return null;

    const nota =
      html.match(/([\d.]+)\s*out of 5/) ||
      html.match(/"ratingValue":\s*([\d.]+)/) ||
      html.match(/twitter:data2"[^>]*content="([\d.]+)/);
    return nota ? { nota: Number(nota[1]).toFixed(2).replace(/\.?0+$/, ''), slug: caminho } : null;
  } catch (e) {
    return null;
  }
}

export async function onRequestGet({ request }) {
  const p = new URL(request.url).searchParams;
  const tmdbId = p.get('tmdb');
  const titulo = p.get('titulo') || '';
  const pt = p.get('pt') || '';
  const ano = p.get('ano') || '';

  // Sem titulo, o proprio endpoint pergunta a TMDB. Assim o app pode chamar so
  // com o id, sem mudar a assinatura que ja existe la.
  let nomeOriginal = titulo;
  let nomePt = pt;
  let anoFinal = ano;
  if (!nomeOriginal && !nomePt && tmdbId) {
    try {
      const r = await fetch(
        `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=9cfddb984190a8787820822d4c78ac32&language=pt-BR`
      );
      if (r.ok) {
        const d = await r.json();
        nomeOriginal = d.original_title || '';
        nomePt = d.title || '';
        anoFinal = anoFinal || String(d.release_date || '').slice(0, 4);
      }
    } catch (e) {
      /* segue sem titulo: devolve nota nula */
    }
  }

  if (!nomeOriginal && !nomePt) return json({ nota: null });

  // O Letterboxd desambigua remake pelo ano no slug ("the-thing-2011"), entao
  // as duas formas entram na fila — a sem ano primeiro, que e o caso comum.
  const candidatos = [];
  for (const nome of [nomeOriginal, nomePt].filter(Boolean)) {
    const s = slug(nome);
    if (!s) continue;
    if (!candidatos.includes(s)) candidatos.push(s);
    if (anoFinal && !candidatos.includes(`${s}-${anoFinal}`)) candidatos.push(`${s}-${anoFinal}`);
  }

  for (const c of candidatos.slice(0, 4)) {
    const achado = await tentar(c, tmdbId);
    if (achado) return json(achado);
  }

  return json({ nota: null });
}

export const onRequestOptions = () =>
  new Response(null, {
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
