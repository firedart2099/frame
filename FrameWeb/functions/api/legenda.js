/**
 * GET /api/legenda?url=<url da legenda>
 *
 * Devolve a legenda como texto puro (.srt/.vtt) em UTF-8, venha ela de onde
 * vier: .zip do Yify e do Podnapisi (abre e pega o .srt de dentro), .srt
 * direto, .vtt do OpenSubtitles.
 *
 * Pra que serve: "assistir na TV". O app manda o vídeo pro Web Video Caster
 * por Intent com um extra `subtitle` = URL de um .srt — e o WVC só sabe
 * baixar .srt/.vtt puro. As fontes de legenda do app entregam .zip (Yify,
 * Podnapisi) ou link temporário (OpenSubtitles), então o WVC recebia um zip,
 * não conseguia ler e a pessoa tinha que procurar a legenda na mão dentro
 * dele (12/09/2026). Aqui o zip vira .srt, e o link fica estável.
 *
 * Sem dependência: zip é lido à mão (diretório central + `DecompressionStream`
 * 'deflate-raw', que o Workers tem). Encoding: tenta UTF-8 estrito; legenda
 * brasileira antiga é Windows-1252, e isso vira UTF-8 na saída.
 */

const ALLOWED_PROTO = /^https?:$/;
const LEGENDA = /\.(srt|vtt|ass|ssa|sub)$/i;

const cors = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'content-type,content-disposition',
};

const bad = (msg, status = 400) =>
  new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'content-type': 'application/json', ...cors },
  });

// ------------------------------------------------------------------ zip

const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/** Lista as entradas pelo diretório central (o único lugar com tamanhos confiáveis). */
function entradasDoZip(bytes) {
  // EOCD: assinatura 0x06054b50, vindo do fim (o comentário do zip pode ter até 64 KB)
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65536); i--) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip sem diretório central');
  const total = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const out = [];
  for (let n = 0; n < total && p + 46 <= bytes.length; n++) {
    if (u32(bytes, p) !== 0x02014b50) break;
    const metodo = u16(bytes, p + 10);
    const tamComp = u32(bytes, p + 20);
    const tamOrig = u32(bytes, p + 24);
    const nomeLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const comentLen = u16(bytes, p + 32);
    const offsetLocal = u32(bytes, p + 42);
    const nome = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + nomeLen));
    out.push({ nome, metodo, tamComp, tamOrig, offsetLocal });
    p += 46 + nomeLen + extraLen + comentLen;
  }
  return out;
}

async function extrair(bytes, entrada) {
  const h = entrada.offsetLocal;
  if (u32(bytes, h) !== 0x04034b50) throw new Error('cabeçalho local inválido');
  const nomeLen = u16(bytes, h + 26);
  const extraLen = u16(bytes, h + 28);
  const inicio = h + 30 + nomeLen + extraLen;
  const comp = bytes.subarray(inicio, inicio + entrada.tamComp);
  if (entrada.metodo === 0) return comp;
  if (entrada.metodo !== 8) throw new Error(`método de compressão ${entrada.metodo} não suportado`);
  const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ------------------------------------------------------------- encoding

function decodificar(bytes) {
  // BOM UTF-8
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  // BOM UTF-16
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    return new TextDecoder(bytes[0] === 0xff ? 'utf-16le' : 'utf-16be').decode(bytes);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (e) {
    try {
      return new TextDecoder('windows-1252').decode(bytes);
    } catch (e2) {
      return new TextDecoder('latin1').decode(bytes);
    }
  }
}

/**
 * WebVTT -> SRT. O OpenSubtitles entrega .vtt (o app pede `sub_format:
 * webvtt`), e o Web Video Caster olha extensão/tipo: um "legenda.srt" com
 * WEBVTT dentro não carrega — ele mostra "baixando legendas" e abre o próprio
 * seletor (12/09/2026). Aqui tudo sai como SRT de verdade: sem cabeçalho,
 * vírgula nos milissegundos, numeração garantida, sem as tags de posição.
 */
function vttParaSrt(texto) {
  const linhas = texto.replace(/\r/g, '').split('\n');
  const blocos = [];
  let atual = [];
  let pulando = false;
  for (const l of linhas) {
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(l)) { pulando = true; continue; }
    if (l.trim() === '') { pulando = false; if (atual.length) { blocos.push(atual); atual = []; } continue; }
    if (pulando) continue;
    atual.push(l);
  }
  if (atual.length) blocos.push(atual);

  let n = 0;
  const out = [];
  for (const b of blocos) {
    const iTempo = b.findIndex((l) => /-->/.test(l));
    if (iTempo === -1) continue;
    const [ini, fimBruto] = b[iTempo].split('-->');
    const tempo = (t) => {
      const m = /(?:(\d+):)?(\d+):(\d+)[.,](\d{1,3})/.exec(t.trim());
      if (!m) return null;
      const h = String(m[1] || '0').padStart(2, '0');
      return `${h}:${m[2].padStart(2, '0')}:${m[3].padStart(2, '0')},${m[4].padEnd(3, '0')}`;
    };
    const a = tempo(ini);
    const z = tempo(fimBruto || '');
    if (!a || !z) continue;
    const falas = b.slice(iTempo + 1).map((l) => l.replace(/<\/?(c|v|ruby|rt|lang)[^>]*>/g, ''));
    if (!falas.join('').trim()) continue;
    n += 1;
    out.push(`${n}\n${a} --> ${z}\n${falas.join('\n')}`);
  }
  return out.join('\n\n') + '\n';
}

// --------------------------------------------------------------- handler

/**
 * Link temporário de download do OpenSubtitles a partir do `file_id`.
 *
 * O link que o app pega expira em minutos (e parece valer uma vez): o Web
 * Video Caster busca a legenda DEPOIS, às vezes duas vezes, e recebia 404 —
 * aí mostrava o seletor dele. Com `?os=<file_id>` quem pede o link é o
 * servidor, na hora, com a chave em `OPENSUBTITLES_KEY` (segredo do Pages).
 */
async function linkDoOpenSubtitles(fileId, env) {
  const chave = env?.OPENSUBTITLES_KEY;
  if (!chave) throw new Error('OPENSUBTITLES_KEY nao configurada no Pages');
  const r = await fetch('https://api.opensubtitles.com/api/v1/download', {
    method: 'POST',
    headers: { 'Api-Key': chave, 'Content-Type': 'application/json', 'User-Agent': 'FrameApp v1.0', Accept: 'application/json' },
    body: JSON.stringify({ file_id: Number(fileId), sub_format: 'srt' }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.link) throw new Error(`OpenSubtitles respondeu ${r.status}: ${j?.message || 'sem link'}`);
  return j.link;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const alvo = url.searchParams.get('url');
  const os = url.searchParams.get('os');
  if (!alvo && !os) return bad('faltou o parametro url (ou os=file_id)');

  // O WVC pode pedir a mesma URL mais de uma vez (HEAD + GET, retry): a
  // resposta pronta fica no cache do Cloudflare por um dia, e a fonte (que
  // pode ser link de uso único) só é consultada na primeira.
  const cache = caches.default;
  const chaveCache = new Request(url.toString(), { method: 'GET' });
  const emCache = await cache.match(chaveCache);
  if (emCache) return emCache;

  let dest;
  try {
    dest = new URL(os ? await linkDoOpenSubtitles(os, env) : alvo);
  } catch (e) {
    return bad(os ? `sem link do OpenSubtitles: ${e.message}` : 'url invalida', os ? 502 : 400);
  }
  if (!ALLOWED_PROTO.test(dest.protocol)) return bad('so http e https');

  let upstream;
  try {
    upstream = await fetch(dest.toString(), {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
        Accept: '*/*',
        Referer: `${dest.protocol}//${dest.host}/`,
      },
    });
  } catch (e) {
    return bad(`nao consegui buscar a legenda: ${e.message}`, 502);
  }
  if (!upstream.ok) return bad(`a fonte respondeu ${upstream.status}`, 502);

  const bytes = new Uint8Array(await upstream.arrayBuffer());
  if (!bytes.length) return bad('legenda vazia', 502);

  let nome = (dest.pathname.split('/').pop() || 'legenda.srt').replace(/[^\w.-]+/g, '_');
  let conteudo = bytes;

  // Zip pela assinatura, não pela extensão: o Podnapisi entrega zip sem ".zip".
  if (bytes.length > 4 && u32(bytes, 0) === 0x04034b50) {
    try {
      const entradas = entradasDoZip(bytes).filter((e) => LEGENDA.test(e.nome) && e.tamComp > 0);
      if (!entradas.length) return bad('o zip nao tem legenda dentro', 502);
      // Um zip com várias: a maior é a legenda completa (as outras são
      // "forced"/só as placas).
      entradas.sort((a, b) => b.tamOrig - a.tamOrig);
      conteudo = await extrair(bytes, entradas[0]);
      nome = entradas[0].nome.split('/').pop();
    } catch (e) {
      return bad(`nao consegui abrir o zip: ${e.message}`, 502);
    }
  }

  let texto = decodificar(conteudo).replace(/^﻿/, '');
  if (!/\d+:\d\d(:\d\d)?[.,]\d+\s*-->|\[Script Info\]/i.test(texto.slice(0, 4000))) {
    return bad('isso nao parece uma legenda', 502);
  }
  if (/^\s*WEBVTT/.test(texto)) texto = vttParaSrt(texto);

  // Nome sempre .srt (é o que o conteúdo é agora). O nome vindo da URL do
  // OpenSubtitles é um hash: vira "legenda.srt".
  nome = nome.replace(LEGENDA, '');
  if (!nome || /^[0-9a-f]{20,}$/i.test(nome)) nome = 'legenda';
  const resposta = new Response(texto, {
    headers: {
      ...cors,
      'content-type': 'application/x-subrip; charset=utf-8',
      'content-disposition': `inline; filename="${nome}.srt"`,
      'cache-control': 'public, max-age=86400',
    },
  });
  try { await cache.put(chaveCache, resposta.clone()); } catch (e) {}
  return resposta;
}

export const onRequestOptions = () =>
  new Response(null, {
    headers: {
      ...cors,
      'access-control-allow-methods': 'GET,HEAD,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
