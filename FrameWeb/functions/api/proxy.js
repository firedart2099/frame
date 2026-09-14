/**
 * GET /api/proxy?url=<url do vídeo>
 *
 * Encaminha o vídeo (ou a playlist HLS) acrescentando os cabeçalhos de CORS
 * que o <video> exige e o Referer que a origem costuma cobrar. Sem isso o
 * navegador recusa o stream mesmo quando o link está perfeito.
 *
 * Repassa Range, então seek e barra de progresso funcionam normalmente.
 * Numa playlist .m3u8 as URLs internas são reescritas pra passarem por aqui
 * também — senão o player pediria os segmentos direto e esbarraria no mesmo
 * bloqueio.
 */

const ALLOWED_PROTO = /^https?:$/;
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-encoding',
  'content-security-policy', 'x-frame-options',
]);

const cors = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'content-length,content-range,accept-ranges,content-type',
};

const bad = (msg, status = 400) =>
  new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'content-type': 'application/json', ...cors },
  });

const proxied = (base, target) => `${base}/api/proxy?url=${encodeURIComponent(target)}`;

/** Reescreve as URLs de dentro de um .m3u8 pra continuarem passando pelo proxy. */
function rewriteManifest(text, sourceUrl, base) {
  const src = new URL(sourceUrl);
  return text
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (!t) return line;

      // URI="..." dentro de tags (chave, mídia alternativa, mapa de init)
      if (t.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (m, uri) => `URI="${proxied(base, new URL(uri, src).toString())}"`);
      }
      return proxied(base, new URL(t, src).toString());
    })
    .join('\n');
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const target = url.searchParams.get('url');
  if (!target) return bad('faltou o parametro url');

  let dest;
  try {
    dest = new URL(target);
  } catch (e) {
    return bad('url invalida');
  }
  if (!ALLOWED_PROTO.test(dest.protocol)) return bad('so http e https');

  const headers = new Headers({
    'User-Agent':
      request.headers.get('user-agent') ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
    Accept: '*/*',
    Referer: `${dest.protocol}//${dest.host}/`,
    Origin: `${dest.protocol}//${dest.host}`,
  });
  const range = request.headers.get('range');
  if (range) headers.set('Range', range);

  let upstream;
  try {
    upstream = await fetch(dest.toString(), { headers, redirect: 'follow' });
  } catch (e) {
    return bad(`nao consegui buscar o video: ${e.message}`, 502);
  }

  const type = upstream.headers.get('content-type') || '';
  const isManifest = /mpegurl|m3u8/i.test(type) || /\.m3u8(\?|$)/i.test(dest.pathname);

  const out = new Headers();
  upstream.headers.forEach((v, k) => {
    if (!HOP_BY_HOP.has(k.toLowerCase())) out.set(k, v);
  });
  Object.entries(cors).forEach(([k, v]) => out.set(k, v));

  if (isManifest) {
    const text = await upstream.text();
    const body = rewriteManifest(text, upstream.url || dest.toString(), url.origin);
    out.set('content-type', 'application/vnd.apple.mpegurl');
    out.delete('content-length');
    out.set('cache-control', 'no-store');
    return new Response(body, { status: upstream.status, headers: out });
  }

  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export const onRequestOptions = () =>
  new Response(null, {
    headers: {
      ...cors,
      'access-control-allow-methods': 'GET,HEAD,OPTIONS',
      'access-control-allow-headers': 'range,content-type',
    },
  });
