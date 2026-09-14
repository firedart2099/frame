/**
 * GET /api/unlock?hash=<infoHash>[&idx=<fileIdx>][&debug=1]
 *
 * Converte um torrent do Torrentio num link HTTP tocável, usando a conta
 * AllDebrid. Roda no servidor por um motivo só: a chave é paga e pessoal, e
 * não pode entrar no bundle do site, que qualquer um baixa.
 *
 * Só entrega torrent que JÁ ESTÁ EM CACHE no AllDebrid — se não estiver, o
 * download levaria minutos e ninguém vai esperar isso olhando pra tela. Nesse
 * caso devolve 404 e o player passa pro próximo release da lista.
 *
 * A chave vem de `env.ALLDEBRID_KEY`:
 *   npx wrangler pages secret put ALLDEBRID_KEY --project-name=frametv
 */

// v4.1 e POST de proposito: a AllDebrid descontinuou o GET com `apikey` na
// query — /magnet/upload responde "please migrate to newest API". Só /user
// continuou atendendo do jeito antigo, o que mascarava a quebra.
const API = 'https://api.alldebrid.com/v4.1';
const AGENT = 'frame';
const VIDEO = /\.(mkv|mp4|avi|m4v|mov|webm|ts)$/i;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  });

const call = async (path, params, key) => {
  const body = new URLSearchParams({ agent: AGENT });
  for (const [k, v] of Object.entries(params)) {
    for (const item of Array.isArray(v) ? v : [v]) body.append(k, item);
  }
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'content-type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  const j = await r.json().catch(() => null);
  if (!j) throw new Error(`AllDebrid HTTP ${r.status}`);
  if (j.status === 'error') throw new Error(j.error?.message || j.error?.code || 'erro do AllDebrid');
  return j.data;
};

/** Achata a árvore de arquivos do magnet (a API aninha pastas em `e`). */
function arquivos(node, saida = []) {
  for (const f of node || []) {
    if (Array.isArray(f.e)) arquivos(f.e, saida);
    else if (f.l) saida.push({ nome: f.n || '', tamanho: f.s || 0, link: f.l });
  }
  return saida;
}

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const hash = (q.get('hash') || '').trim().toLowerCase();
  const idx = q.get('idx');
  const season = Number(q.get('season')) || 0;
  const episode = Number(q.get('episode')) || 0;
  const debug = q.get('debug') === '1';
  const titulo = q.get('titulo') || '';
  const ano = q.get('ano') || '';
  const tituloOriginal = q.get('original') || '';

  if (!hash) return json({ error: 'faltou o hash' }, 400);
  // .trim(): secret gravado por pipe vem com quebra de linha grudada no fim
  // e a AllDebrid recusa a chave por causa do caractere invisivel
  const key = (env?.ALLDEBRID_KEY || '').trim();
  if (!key) return json({ error: 'ALLDEBRID_KEY não configurada no Cloudflare' }, 503);

  try {
    // 1) manda o magnet. Se já estiver em cache, ele volta pronto na hora.
    const up = await call('/magnet/upload', { 'magnets[]': hash }, key);
    const magnet = up?.magnets?.[0];
    if (!magnet) return json({ error: 'AllDebrid não aceitou o magnet' }, 502);
    if (magnet.error) return json({ error: magnet.error.message || 'magnet recusado' }, 502);

    // 2) estado atual
    const st = await call('/magnet/status', { id: String(magnet.id) }, key);
    const info = st?.magnets || st;
    const pronto = info?.statusCode === 4 || info?.status === 'Ready' || magnet.ready === true;

    if (!pronto) {
      return json(
        {
          error: 'nao_cacheado',
          detalhe: 'Esse release não está em cache no AllDebrid — baixar levaria minutos.',
          ...(debug ? { status: info?.status, statusCode: info?.statusCode } : {}),
        },
        404
      );
    }

    // 3) escolhe o arquivo dentro do torrent.
    // Em pack de temporada isso decide entre entregar o episódio certo e o
    // errado, então a ordem é: casar SxxEyy no nome > índice do Torrentio >
    // maior vídeo. O índice é aplicado na lista CRUA: ele conta os arquivos do
    // torrent, incluindo .nfo e legenda, e some do lugar se filtrar antes.
    let crua = arquivos(info?.files);
    if (!crua.length) {
      const fl = await call('/magnet/files', { 'id[]': String(magnet.id) }, key);
      crua = arquivos(fl?.magnets?.[0]?.files);
    }
    const lista = crua.filter((f) => VIDEO.test(f.nome));
    if (!lista.length) return json({ error: 'nenhum arquivo de vídeo no torrent' }, 404);

    // Cena deletada, "sample" e making-of carregam o mesmo SxxEyy do episodio
    // de verdade: um release do Breaking Bad devolvia "S01E01 Deleted Scene",
    // de 3 minutos. Entre os que casam, o episodio e o maior arquivo.
    const EXTRA = /deleted|sample|extra|featurette|making|behind|trailer|bonus|comment/i;

    // As bordas sao escritas na mao, com classe de caractere, em vez de \b e
    // \s: dentro de template literal esses dois viram backspace e a letra "s",
    // e o casamento passa a valer nada sem dar erro nenhum.
    const BORDA_ESQ = '(^|[^a-z0-9])';
    const BORDA_DIR = '([^0-9]|$)';

    const porEpisodio = () => {
      if (!season || !episode) return null;
      const alvo = new RegExp(
        `(s0*${season}[ ._-]*e0*${episode}|${season}x0*${episode})${BORDA_DIR}`,
        'i'
      );
      const casam = lista.filter((f) => alvo.test(f.nome));
      const bons = casam.filter((f) => !EXTRA.test(f.nome));
      const pool = bons.length ? bons : casam;
      return pool.sort((a, b) => b.tamanho - a.tamanho)[0] || null;
    };

    // Pack legendado em outra lingua costuma nomear "Ep 01 - Titulo", sem
    // SxxEyy nenhum. Ai o unico sinal seria o fileIdx do Torrentio, que ja
    // errou duas vezes aqui (apontou o episodio 2 quando pedimos o 1).
    const porEpisodioSolto = () => {
      if (!season || !episode) return null;
      const alvo = new RegExp(
        `${BORDA_ESQ}(ep|epis[oó]dio)[ ._-]?0*${episode}${BORDA_DIR}`,
        'i'
      );
      const casam = lista.filter((f) => alvo.test(f.nome) && !EXTRA.test(f.nome));
      return casam.sort((a, b) => b.tamanho - a.tamanho)[0] || null;
    };

    /**
     * Filme dentro de um PACK (coleção "Vingadores 1-4", trilogia, box): o
     * maior arquivo é outro filme. Medido em 11/09/2026: pedindo Guerra
     * Infinita, o torrent DUAL do Comando era a coleção inteira e o maior
     * arquivo era Era de Ultron — que tocou, dublado, com toda a confiança.
     * Se o player mandou `titulo` (e `ano`), o arquivo tem que casar com ele.
     */
    const semAcento = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const palavras = (t) => semAcento(t).replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length >= 3);
    const porTitulo = () => {
      if (!titulo || lista.length < 2) return null;
      // o arquivo pode estar em português ("Vingadores - Guerra Infinita") ou
      // no original ("Avengers.Infinity.War"): qualquer um dos dois serve
      const alvos = [palavras(titulo), palavras(tituloOriginal)].filter((a) => a.length);
      if (!alvos.length) return null;
      const casam = lista.filter((f) => {
        const nome = semAcento(f.nome).replace(/[^a-z0-9]+/g, ' ');
        return alvos.some((alvo) => alvo.every((w) => nome.includes(w))) && !EXTRA.test(f.nome);
      });
      // com ano, prefere o arquivo que traz o ano (separa remake de original)
      const comAno = ano ? casam.filter((f) => new RegExp(`(^|[^0-9])${ano}([^0-9]|$)`).test(f.nome)) : [];
      const pool = comAno.length ? comAno : casam;
      return pool.sort((a, b) => b.tamanho - a.tamanho)[0] || null;
    };

    const porIndice = () => {
      if (idx === null || idx === '') return null;
      const f = crua[Number(idx)];
      return f && VIDEO.test(f.nome) ? f : null;
    };

    // O maior arquivo é um bom palpite pra FILME, e um palpite péssimo pra
    // episódio: num pack de temporada ele é *algum* episódio, e o pedido era
    // o episódio 5. Melhor devolver 404 e deixar o player ir pra próxima fonte
    // do que tocar o episódio errado com toda a confiança — quem está vendo só
    // descobre dez minutos depois, quando a cena não bate com a série.
    const escolhido =
      porEpisodio() ||
      porEpisodioSolto() ||
      porTitulo() ||
      porIndice() ||
      // pack de vários filmes sem casar o título: não chuta — o maior é OUTRO filme
      (season && episode ? null : titulo && lista.length > 1 && palavras(titulo).length ? null : lista.slice().sort((a, b) => b.tamanho - a.tamanho)[0]);

    if (!escolhido) {
      const oque = season && episode ? `o S${season}E${episode}` : `"${titulo}"`;
      return json(
        {
          error: `nao achei ${oque} dentro deste torrent`,
          ...(debug ? { arquivos: lista.map((f) => f.nome).slice(0, 20) } : {}),
        },
        404
      );
    }

    // 4) link protegido -> link direto
    const unlocked = await call('/link/unlock', { link: escolhido.link }, key);
    const url = unlocked?.link || unlocked?.streaming?.[0]?.link;
    if (!url) return json({ error: 'AllDebrid não devolveu link' }, 502);

    return json({
      url,
      nome: escolhido.nome,
      tamanho: escolhido.tamanho,
      ...(debug ? { arquivos: lista.length, total: crua.length, streams: unlocked?.streams || null, streaming: unlocked?.streaming || null } : {}),
    });
  } catch (e) {
    return json({ error: String(e.message || e) }, 502);
  }
}

export const onRequestOptions = () =>
  new Response(null, {
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
