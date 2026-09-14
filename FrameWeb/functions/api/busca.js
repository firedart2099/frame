/**
 * GET /api/busca?q=<texto>[&imdb=tt123][&season=1][&episode=3]
 *
 * Procura torrents fora do Torrentio, que não indexa release de episódio
 * avulso das scenes. O caso que motivou isto: `Sterling Point S01E03 1080p WEB
 * h264-ETHEL` — o único 1080p em H.264 com o áudio original daquele episódio,
 * e portanto o único que toca numa máquina sem decodificador de HEVC — não
 * existe no Torrentio.
 *
 * Duas fontes, porque cada uma cobre um buraco:
 *
 *   EZTV    indexa série por id do IMDb e entrega `season`/`episode` como
 *           campo, então não há adivinhação de arquivo. É onde vivem os
 *           releases de scene (ETHEL, SYLiX, MeGusta).
 *   Knaben  agregador de vários rastreadores (inclusive Pirate Bay), busca por
 *           texto. Pega filme e o que o EZTV não tem.
 *
 * Roda no servidor porque nenhuma das duas manda `Access-Control-Allow-Origin`.
 * E é preciso servidor DESTE tipo: o Cloudflare fala com EZTV e Knaben (200),
 * mas leva 429 do apibay e 503 do AllDebrid. Cada muro é de um lugar.
 */

const KNABEN = 'https://api.knaben.org/v1';
const EZTV = 'https://eztvx.to/api/get-torrents';

/**
 * Hash de magnet: hex de 40 OU base32 de 32.
 *
 * As duas formas são válidas no BitTorrent e os sites misturam as duas NA MESMA
 * PÁGINA. Medido em 11/09/2026 no post da 9ª temporada de Rick and Morty:
 * episódios 1 a 4 em hex, 5 a 10 em base32 — e como o raspador só aceitava hex,
 * os seis últimos episódios dublados simplesmente não existiam pro Frame.
 * Nenhum erro, nenhuma pista: a lista voltava com quatro.
 *
 * Base32 aqui é RFC 4648 sem padding: 32 caracteres A-Z2-7 que viram os mesmos
 * 20 bytes do hex.
 */
function base32ParaHex(s) {
  const ALFA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let valor = 0;
  let saida = '';
  for (const ch of s.toUpperCase()) {
    const i = ALFA.indexOf(ch);
    if (i < 0) return null;
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      saida += ((valor >> bits) & 0xff).toString(16).padStart(2, '0');
    }
  }
  return saida.length === 40 ? saida : null;
}

/** Devolve sempre hex minúsculo de 40, venha o hash como vier. */
function normalizarHash(bruto) {
  const h = String(bruto || '').trim();
  if (/^[a-fA-F0-9]{40}$/.test(h)) return h.toLowerCase();
  if (/^[a-zA-Z2-7]{32}$/.test(h)) return base32ParaHex(h);
  return null;
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      // a lista de um episódio muda pouco; 10 min evita bater nas fontes a
      // cada play do mesmo título
      'cache-control': 'public, max-age=600',
    },
  });

/**
 * O Knaben busca por TEXTO, entao "Sterling Point S01E03" traz a serie inteira
 * — E01, E02, E04... Deixar isso passar significa tocar o episodio errado, que
 * e pior do que nao achar nada. Pack de temporada (sem marca de episodio)
 * continua valendo: o /api/unlock escolhe o arquivo certo dentro dele.
 */
function ehDoEpisodio(titulo, season, episode) {
  if (!season || !episode) return true;
  const alvoT = Number(season);
  const alvoE = Number(episode);
  const texto = String(titulo);

  // "S01E03", e tambem "S01E01-08" (pack de episodios), que CONTEM o alvo
  const marcas = [...texto.matchAll(/s(\d{1,2})[\s._-]*e(\d{1,3})(?:[\s._-]*-[\s._-]*e?(\d{1,3}))?/gi)];
  if (marcas.length) {
    return marcas.some((m) => {
      if (Number(m[1]) !== alvoT) return false;
      const inicio = Number(m[2]);
      const fim = m[3] ? Number(m[3]) : inicio;
      return alvoE >= inicio && alvoE <= fim;
    });
  }

  // Sem SxxExx, mas com temporada escrita em portugues: "8ª Temporada",
  // "2a Temporada", "Temporada 3". Isto NAO e detalhe — pedindo Rick and Morty
  // S09E05 o Baixe Torrents devolvia dez torrents da 8ª temporada, e como cada
  // um TOCA, a sondagem aprovava e a pessoa assistia o episodio errado achando
  // que era o novo.
  const temporada = texto.match(/(\d{1,2})\s*[ªa]?\s*temporada|temporada\s*(\d{1,2})/i);
  if (temporada) return Number(temporada[1] || temporada[2]) === alvoT;

  // Pack de temporada em ingles: "Season 3 (S03)", "S01-05", "Seasons 1-4".
  // Sem isto o pack da 3ª temporada do JoJo passava pra T4 e o /api/unlock
  // procurava um S04E01 que nao existe no pacote (13/09/2026).
  const faixas = [...texto.matchAll(/\bseasons?\s*(\d{1,2})(?:\s*(?:-|to|a)\s*(\d{1,2}))?\b|\bS(\d{2})(?:\s*(?:-|to)\s*S?(\d{2}))?\b/gi)];
  if (faixas.length) {
    return faixas.some((m) => {
      const inicio = Number(m[1] || m[3]);
      const fim = Number(m[2] || m[4] || inicio);
      return alvoT >= inicio && alvoT <= fim;
    });
  }

  // Sem marca nenhuma: pack ou filme. O /api/unlock escolhe o arquivo certo.
  return true;
}

async function noKnaben(q, limite, season, episode) {
  if (!q || q.length < 2) return [];
  try {
    const resp = await fetch(KNABEN, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        // '100%' casa o texto inteiro. Com 'score' ele ignora a busca e
        // devolve os torrents mais semeados do site — Office e antivírus.
        search_type: '100%',
        search_field: 'title',
        query: q,
        order_by: 'seeders',
        order_direction: 'desc',
        size: limite,
        hide_unsafe: true,
        hide_xxx: true,
      }),
    });
    if (!resp.ok) return [];
    const dados = await resp.json();
    return (dados?.hits || [])
      .filter((h) => h.hash && h.title && ehDoEpisodio(h.title, season, episode))
      .map((h) => ({ hash: String(h.hash).toLowerCase(), title: h.title, seeders: h.seeders || 0, bytes: h.bytes || null, fonte: 'knaben' }));
  } catch (e) {
    return [];
  }
}

async function noEztv(imdb, season, episode) {
  const id = String(imdb || '').replace(/^tt/, '');
  if (!id) return [];
  try {
    const resp = await fetch(`${EZTV}?imdb_id=${id}&limit=100`, { headers: { Accept: 'application/json' } });
    if (!resp.ok) return [];
    const dados = await resp.json();
    const todos = Array.isArray(dados?.torrents) ? dados.torrents : [];
    // o EZTV diz o episódio de cada torrent — melhor que casar nome de arquivo
    const doEpisodio = season
      ? todos.filter((t) => String(t.season) === String(season) && String(t.episode) === String(episode))
      : todos;
    return doEpisodio
      .filter((t) => t.hash && t.title)
      .map((t) => ({
        hash: String(t.hash).toLowerCase(),
        title: String(t.title).replace(/\s+EZTV$/i, ''),
        seeders: t.seeds || 0,
        bytes: t.size_bytes ? Number(t.size_bytes) : null,
        fonte: 'eztv',
      }));
  } catch (e) {
    return [];
  }
}

/**
 * As fontes brasileiras.
 *
 * Elas existem porque dublagem em torrent é um acervo à parte: o Torrentio
 * brazuca traz pouco, o Knaben só acha dublado quando o release usa o título em
 * português, e o EZTV é scene em inglês. Quem tem dublagem são estes sites — e
 * eles têm todos a MESMA forma, porque são todos WordPress com o mesmo tema:
 * `/?s=termo` devolve links de post, e o post traz os magnets.
 *
 * Por isso aqui há um raspador só, e a lista de sites é dado, não código.
 * Antes eram duas funções quase idênticas (Comando e Baixe) e somar uma fonte
 * nova era copiar cinquenta linhas; agora é acrescentar uma linha na lista.
 *
 * Cada site é uma lista de domínios porque eles trocam de endereço o tempo
 * todo — é a natureza do negócio. Medido em 11/09/2026: `comando1.com`, que
 * estava fixo no código, não resolve mais. Com um domínio só, o dia em que ele
 * cai é o dia em que o Frame fica sem dublado e ninguém entende por quê: a
 * busca não dá erro, ela só devolve vazio.
 */
/**
 * `sufixo`: alguns temas não montam a URL do post como `/titulo-ano/`, e sim
 * com um rabo fixo — o Rede usa `/titulo-torrent-dublado-dual-audio-legendado-
 * download/`. Importa porque a busca (`?s=`) do Rede IGNORA o termo e devolve
 * os últimos posts; o único jeito de chegar no filme é adivinhar a URL.
 * Medido em 11/09/2026: `/interestelar-torrent-dublado-...-download/` existe e
 * tem três magnets; `?s=Interestelar` não traz Interestelar.
 */
const SITES_BR = [
  { id: 'comando', dominios: ['https://comandotorrents.to', 'https://comando1.com', 'https://comando.la'] },
  { id: 'baixe', dominios: ['https://www.baixetorrentsv2.net', 'https://baixetorrents.net'] },
  { id: 'starck', dominios: ['https://www.starcktorrents.net', 'https://starckfilmesnet.com', 'https://www.starck-oficial.com'] },
  { id: 'lapumia', dominios: ['https://lapumia.org', 'https://www.lapumiatorrents.net', 'https://lapumia.net'] },
  { id: 'bludv', dominios: ['https://bludvfilmes1.xyz', 'https://bludvfilmes.xyz', 'https://bludv.xyz', 'https://bludvfilmes.com'] },
  { id: 'rede', dominios: ['https://redestorrents.com', 'https://redetorrent.com'], sufixo: '-torrent-dublado-dual-audio-legendado-download' },
  { id: 'apache', dominios: ['https://apachetorrent.com'] },
  { id: 'ondebaixa', dominios: ['https://ondebaixa.com'] },
  { id: 'torrentdosfilmes', dominios: ['https://torrentdosfilmes-v2.xyz', 'https://www.torrentdosfilmes.se', 'https://torrentdosfilmes.org'] },
  { id: 'mundotorrents', dominios: ['https://mundotorrentshd.net', 'https://www.mundotorrentshd.com'] },
  { id: 'xvia', dominios: ['https://www.xviatorrent.com', 'https://thepiratefilmes.net'] }, // ex-ThePirateFilmes; o .net redireciona pra cá (11/09/2026)
  { id: 'wolverdon', dominios: ['https://wolverdonfilmes.com', 'https://www.wolverdonfilmes.net'] },
  { id: 'filmesviatorrent', dominios: ['https://filmesviatorrent.net', 'https://www.filmesviatorrent.com'] },
  { id: 'vamos', dominios: ['https://vamostorrent.com'] },
  { id: 'megatorrentshd', dominios: ['https://megatorrentshd.net', 'https://www.megatorrentshd.com'] },
  { id: 'torrentbrazil', dominios: ['https://www.torrentbrazil.net'] },
];

const semAcento = (t) =>
  String(t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Pontuação quebra a busca desses sites.
 *
 * Medido: `?s=Vingadores: Guerra Infinita` devolve ZERO; `?s=Vingadores Guerra
 * Infinita` devolve doze. O post existe nos dois casos — quem não existe é o
 * resultado. É por isso que "Vingadores: Guerra Infinita" aparecia sem
 * dublagem: a pergunta é que estava errada, não o acervo.
 *
 * Vale pra qualquer título com dois-pontos, travessão ou vírgula, que é metade
 * da Marvel e metade da Pixar.
 */
function termoDeBusca(titulo) {
  return String(titulo || '')
    .replace(/[:;,·–—_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * O post é DESTE filme?
 *
 * A regra antiga olhava só a PRIMEIRA palavra do título. Pedindo "Vingadores:
 * Guerra Infinita" ela aceitava qualquer post que começasse com "vingadores" —
 * e o Comando devolvia **Vingadores: Ultimato**, outro filme, que ainda por
 * cima estava pronto no AllDebrid e tocaria numa boa.
 *
 * Agora todas as palavras que importam do título têm que estar no endereço do
 * post. Palavra curta (de, da, o, a, e) não conta: "Homem de Ferro" e
 * "Homem-Aranha" se separam pelas palavras grandes, não pelas preposições.
 */
function tituloCombina(slug, titulo) {
  const palavras = semAcento(titulo)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  if (!palavras.length) {
    // título só de palavras curtas ("Up", "Her"): usa o que tem
    const curtas = semAcento(titulo).replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean);
    return curtas.every((w) => slug.includes(w));
  }
  return palavras.every((w) => slug.includes(w));
}

/**
 * O release e DESTA serie/filme?
 *
 * Nenhuma fonte de texto (Knaben, Nyaa, apibay) conferia o NOME — so o
 * SxxEyy. Medido em 13/09/2026: o app pedia JoJo pelo titulo original,
 * `ジョジョの奇妙な冒険 S04E01`, o Knaben jogava fora o japones e devolvia
 * 54 torrents de QUALQUER S04E01 (Ted Lasso, Reacher, Dr. Stone...). O
 * Alexandre deu play na Parte 5 e assistiu Dr. Stone.
 *
 * Regra: das palavras que importam do titulo (3+ letras, sem "the"/"of"),
 * ou todas aparecem no release, ou a PRIMEIRA aparece e pelo menos metade.
 * "Star Wars" nao aceita "Star Trek" (falta metade), "JoJos.Bizarre" aceita
 * "JoJo's" (prefixo). Titulo sem letra latina (so kanji) nao conta como
 * alvo — vale o outro (o `pt`), e se nenhum tiver letra, passa tudo.
 */
const PALAVRA_VAZIA = new Set(['the', 'and', 'los', 'las', 'les', 'der', 'die', 'das', 'una', 'uma', 'dos', 'das', 'com', 'para', 'por']);
const palavrasDoTitulo = (t) =>
  semAcento(t)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !PALAVRA_VAZIA.has(w));

function releaseCombina(release, alvos) {
  const tokens = semAcento(release).replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean);
  const tem = (w) => tokens.some((t) => t.startsWith(w));
  let algumAlvo = false;
  for (const alvo of alvos) {
    const palavras = palavrasDoTitulo(alvo);
    if (!palavras.length) continue;
    algumAlvo = true;
    const acertos = palavras.filter(tem).length;
    if (acertos === palavras.length) return true;
    if (tem(palavras[0]) && acertos * 2 >= palavras.length) return true;
  }
  return !algumAlvo;
}

/**
 * Pack de anime nomeado pela PARTE, nao pela temporada: "[Some-Stuffs] JoJo
 * Stone Ocean 01-12" nao tem SxxEyy nem "Season 5" — passava por
 * `ehDoEpisodio` pra qualquer temporada, e o JoJo T1 E18 abria o episodio
 * 18 de Stone Ocean (13/09/2026). Quem sabe o nome de cada temporada e a
 * TMDB: o app manda `?temporadas=Phantom Blood|Stardust Crusaders|...`
 * (na ordem, 1..N) e aqui um release que cita OUTRA temporada pelo nome — e
 * nao cita a pedida — cai fora. Nomes genericos ("Season 2", "Temporada 3",
 * "Specials") nao contam.
 */
function temporadaErrada(release, nomes, season) {
  if (!nomes || !nomes.length || !season) return false;
  const texto = semAcento(release).replace(/[^a-z0-9]+/g, ' ');
  const util = (n) => {
    const t = semAcento(n).replace(/[^a-z0-9]+/g, ' ').trim();
    if (t.length < 4) return null;
    if (/^(season|temporada|series|part|parte|specials|especiais)\s*\d*$/.test(t)) return null;
    return t;
  };
  const pedida = util(nomes[Number(season) - 1] || '');
  if (pedida && texto.includes(pedida)) return false;
  return nomes.some((n, i) => {
    if (i === Number(season) - 1) return false;
    const t = util(n);
    return !!t && texto.includes(t);
  });
}

/** O `q` chega como "Nome S04E01" (serie) ou "Nome 2014" (filme); devolve so o nome. */
const nomeDoAlvo = (q, tipo) =>
  tipo === 'tv'
    ? q.replace(/\s+S\d{1,2}E\d{1,3}\s*$/i, '')
    : q.replace(/\s+(19|20)\d{2}\s*$/, '');

/**
 * O ano do post NÃO é o ano da TMDB.
 *
 * Site brasileiro nomeia pelo lançamento AQUI: Thor Ragnarok estreou nos EUA em
 * 2017 e por aqui em 2018, e o post se chama
 * "thor-ragnarok-torrent-**2018**-dublado-dual-audio...". Exigir o ano exato
 * descartava o post dublado e sobrava o Knaben, que só tem original — foi por
 * isso que "um filme da Marvel" apareceu sem dublagem nenhuma.
 *
 * E o Baixe e o Starck vão além: o ano do slug é o ano do POST, não do filme.
 * Medido em 11/09/2026: "interestelar-2025" e "fonte-da-vida-2024" (A Fonte da
 * Vida é de 2006). Com a tolerância de um ano, os dois sites devolviam zero pra
 * qualquer filme com mais de dois anos — que é a maior parte do catálogo.
 *
 * Por isso o slug só descarta post ANTERIOR ao filme (um post de 2014 não é
 * sobre um filme de 2025). A conferência de verdade fica em `anoDoPost`, no
 * `<title>` da página, que traz o ano certo: "Interestelar (2014) - Baixe...".
 */
function anoCompativel(slug, ano) {
  if (!ano) return true;
  const anos = [...String(slug).matchAll(/(19|20)\d{2}/g)].map((m) => Number(m[0]));
  if (!anos.length) return true; // post sem ano nenhum: o título já filtrou
  return anos.some((a) => a >= Number(ano) - 1);
}

/** O slug traz exatamente o ano pedido? (desempate: esse post vai primeiro) */
const anoExato = (slug, ano) => !!ano && new RegExp(`\\b${ano}\\b`).test(slug);

/** Ano que a PÁGINA declara — "Interestelar (2014)", "Thor: Ragnarok Torrent (2017)". */
function anoDoPost(html) {
  const titulo = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
  const m = titulo.match(/\((19|20)\d{2}\)/);
  return m ? Number(m[0].slice(1, 5)) : null;
}

const slugificar = (t) =>
  semAcento(t)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Prazo por requisição, não só por fonte.
 *
 * Domínio abandonado não responde "morto": ele fica pendurado até o Worker
 * inteiro estourar. Como são dezesseis sites em paralelo, um só pendurado
 * derrubava a busca toda — e a busca cai calada, devolvendo lista vazia.
 */
async function pegar(url, ms = 8000) {
  const { html } = await pegarComUrl(url, ms);
  return html;
}

/**
 * Igual a `pegar`, mas conta ONDE a página acabou parando.
 *
 * Esses sites trocam de domínio e deixam o velho redirecionando: pedir
 * `bludvfilmes.xyz` cai em `bludvfilmes1.xyz`, `redetorrent.com` em
 * `redestorrents.com`, `torrentdosfilmes.se` em `torrentdosfilmes-v2.xyz`.
 * O raspador procurava links absolutos do domínio PEDIDO numa página cheia de
 * links do domínio NOVO, e achava zero — três sites "vivos" que nunca entregavam
 * nada (medido em 11/09/2026 com `?debug=1`: `vivo=true, links=0`).
 */
async function pegarComUrl(url, ms = 8000) {
  const corte = new AbortController();
  const prazo = setTimeout(() => corte.abort(), ms);
  try {
    const r = await fetch(url, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
      signal: corte.signal,
      redirect: 'follow',
    });
    if (!r.ok) return { html: '', url };
    return { html: await r.text(), url: r.url || url };
  } catch (e) {
    return { html: '', url }; // domínio morto, prazo estourado, TLS quebrado: tudo igual aqui
  } finally {
    clearTimeout(prazo);
  }
}

/**
 * Página de desafio, não o site.
 *
 * Lapumia, OndeBaixa e MegaTorrentsHD respondem 200 com um "Redirecting..." de
 * 4,8 KB que testa bloqueador de anúncio por JavaScript; o Wolverdon, com um
 * "Checking your browser..." de 12 KB. Passam do corte de tamanho e o raspador
 * seguia como se fosse a busca — `vivo=true` e nada dentro. Sem JavaScript não
 * há o que fazer com elas: o certo é tratar como domínio morto e tentar o
 * próximo da lista.
 */
const ehDesafio = (html) =>
  html.length < 20000 &&
  /<title>\s*(Redirecting\.\.\.|Checking your browser|Just a moment|Um momento)/i.test(html);

/** Páginas do WordPress que nunca são post de filme. */
const NAO_E_POST = /\/(category|categoria|tag|page|author|genero|generos|serie|series|filmes|search|feed|wp-|comment)/i;

/**
 * Tira os magnets de uma página de post.
 *
 * Duas coisas que o magnet sozinho não conta e a página conta:
 *
 *  - a RESOLUÇÃO. O magnet do Baixe Torrents não diz 1080p, mas o arquivo é —
 *    sem ler a página, o release entrava como "qualidade desconhecida" e ia pro
 *    fim da fila, atrás de um 720p que anuncia o que é.
 *  - o IDIOMA. O nome diz "Dub(2026)", não "Dublado", e a regra geral de idioma
 *    não pega isso. Aqui o site é brasileiro e o post se declara: dá pra marcar.
 */
function extrairDoPost(html, { titulo, fonte }) {
  const texto = html.replace(/<[^>]+>/g, ' ');
  const res = /2160p|\b4k\b/i.test(texto)
    ? '2160p'
    : /1080p/i.test(texto)
    ? '1080p'
    : /720p/i.test(texto)
    ? '720p'
    : '';
  const pagDublada = /dublad|dual\s*[aá]udio|\bdub\b/i.test(texto.slice(0, 3000));

  const achados = [];
  const vistos = new Set();
  for (const m of html.matchAll(/magnet:\?xt=urn:btih:([a-zA-Z0-9]{32,40})[^"'<\s]*/g)) {
    const hash = normalizarHash(m[1]);
    if (!hash || vistos.has(hash)) continue;
    vistos.add(hash);
    const dn = decodeURIComponent(((m[0].match(/dn=([^&]+)/) || [])[1] || '').replace(/\+/g, ' '));
    const nome = dn || titulo;
    achados.push({
      hash,
      // resolução colada no nome só quando ele não a traz
      title: /\d{3,4}p/i.test(nome) || !res ? nome : `${nome} ${res}`,
      seeders: 0,
      bytes: null,
      fonte,
      idioma: /\bdub\b|dublad|dual/i.test(nome) || pagDublada ? 'pt' : null,
    });
  }
  return achados;
}

/**
 * Um site brasileiro, raspado.
 *
 * É raspagem de HTML, então quebra quando eles mudarem o layout — por isso cada
 * passo falha em silêncio e devolve lista vazia em vez de derrubar a busca
 * inteira. E é feita no Worker porque nenhum deles manda CORS (e porque, ao
 * contrário do apibay, eles respondem ao Cloudflare).
 */
async function noSiteBr(site, { titulo, ano, type, season }, diag) {
  const anotar = (o) => { if (diag) Object.assign(diag, o); };
  if (!titulo) return [];
  try {
    let html = '';
    let base = '';
    const pulados = []; // por que cada domínio foi descartado — só aparece no ?debug=1
    for (const dominio of site.dominios) {
      const { html: corpo, url } = await pegarComUrl(`${dominio}/?s=${encodeURIComponent(termoDeBusca(titulo))}`);
      if (corpo.length < 3000) { pulados.push(`${dominio}: ${corpo.length}B`); continue; } // bloqueio, erro ou parqueado
      if (ehDesafio(corpo)) { pulados.push(`${dominio}: desafio`); continue; }
      // domínio parqueado redireciona pra anúncio: o Wolverdon caía em
      // http://anast-nch.com e passava por vivo. O site novo ainda se chama
      // pelo nome (bludvfilmes1, redestorrents, torrentdosfilmes-v2); anúncio não.
      const destino = new URL(url);
      if (destino.protocol !== 'https:' || !destino.hostname.includes(site.id)) { pulados.push(`${dominio} -> ${destino.origin}`); continue; }
      html = corpo;
      base = destino.origin; // o domínio onde a página REALMENTE está
      break;
    }
    anotar({ vivo: !!base, dominio: base || null, bytes: html.length, pulados: pulados.length ? pulados : undefined });

    const slug = slugificar(titulo);
    let posts = [];

    if (html) {
      const anfitriao = base.replace(/^https?:\/\//, '').replace(/\./g, '\\.');
      // aspas simples OU duplas: o Apache escreve href='...' e ficava com zero links
      const absolutos = [...html.matchAll(new RegExp(`href=["'](https?://${anfitriao}/[a-z0-9%-]{8,}/)["']`, 'g'))].map(
        (m) => m[1]
      );
      // tema que usa href relativo ("/o-filme-2024/") é comum o bastante pra valer a pena
      const relativos = [...html.matchAll(/href=["'](\/[a-z0-9%-]{8,}\/)["']/g)].map((m) => base + m[1]);

      posts = [...new Set([...absolutos, ...relativos])].filter((u) => {
        const caminho = u.replace(/^https?:\/\/[^/]+\//, '').replace(/\/$/, '');
        if (NAO_E_POST.test(`/${caminho}`)) return false;
        if (!tituloCombina(caminho, titulo)) return false;
        // dublado é o ponto: post "legendado" não serve pra este uso
        if (/legendado/.test(caminho) && !/dublado|dual/.test(caminho)) return false;
        if (type === 'tv' && season && !new RegExp(`(${season}a?-temporada|s0?${season}\\b)`).test(caminho))
          return false;
        if (type !== 'tv' && !anoCompativel(caminho, ano)) return false;
        return true;
      });
      // só dois posts são lidos: o que traz o ano pedido no endereço vai na frente
      if (type !== 'tv' && ano) {
        posts.sort((a, b) => Number(anoExato(b, ano)) - Number(anoExato(a, ano)));
      }

      const todos = new Set([...absolutos, ...relativos]);
      anotar({
        links: todos.size,
        posts: posts.length,
        amostra: [...new Set([...html.matchAll(/href=["']([^"'#]{12,120})["']/g)].map((m) => m[1]))]
          .filter((u) => !/\.(css|js|png|jpg|jpeg|svg|webp|ico|xml)/i.test(u))
          .slice(0, 14),
      });
    }

    // Sem resultado na busca, o endereço ainda é adivinhável: estes temas
    // montam a URL a partir do título. Foi assim que a 1ª temporada de Sterling
    // Point apareceu — a busca do site não a achava, a URL direta sim.
    if (!posts.length && base) {
      const sufixo = site.sufixo || '';
      posts =
        type === 'tv' && season
          ? sufixo
            ? [`${base}/${slug}-${season}a-temporada${sufixo}/`]
            : [`${base}/${slug}-${season}a-temporada-${ano}/`, `${base}/${slug}-${season}a-temporada/`]
          : sufixo
          ? [`${base}/${slug}${sufixo}/`]
          : [`${base}/${slug}-${ano}/`, `${base}/${slug}/`];
    }

    const paginas = await Promise.all(posts.slice(0, 2).map((u) => pegar(u)));
    // a página sabe o ano de verdade; post de outro filme com o mesmo nome cai aqui
    const certas = paginas.filter((h) => {
      if (!h || ehDesafio(h)) return false;
      if (type === 'tv' || !ano) return true;
      const a = anoDoPost(h);
      return a === null || Math.abs(a - Number(ano)) <= 1;
    });
    anotar({ paginas: certas.length, adivinhou: !html || undefined });
    return certas.flatMap((h) => extrairDoPost(h, { titulo, fonte: site.id }));
  } catch (e) {
    anotar({ erro: String(e && e.message).slice(0, 60) });
    return [];
  }
}

/** Todos os sites brasileiros de uma vez: o tempo é o do mais lento, não a soma. */
async function fontesBr(alvo) {
  const diag = SITES_BR.map(() => ({}));
  const listas = await Promise.all(SITES_BR.map((s, i) => noSiteBr(s, alvo, diag[i])));
  return {
    resultados: listas.flat(),
    porFonte: Object.fromEntries(SITES_BR.map((s, i) => [s.id, { n: listas[i].length, ...diag[i] }])),
  };
}

const NYAA = 'https://nyaa.si';

/**
 * Nyaa — o índice de anime, e o único que responde ao Cloudflare sem desafio.
 *
 * Não é só anime japonês: séries de animação em geral aparecem lá, muitas com
 * faixa dupla. E ele tem RSS, então não é raspagem de HTML — é XML com o
 * infohash num campo próprio (`nyaa:infoHash`), que é exatamente o que o
 * /api/unlock precisa. Fonte que quebra menos é fonte que dura mais.
 */
async function noNyaa(q, season, episode) {
  if (!q || q.length < 2) return [];
  try {
    const busca = season && episode
      ? `${q} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
      : q;
    const r = await fetch(`${NYAA}/?page=rss&q=${encodeURIComponent(busca)}&f=0&c=0_0`, {
      headers: { 'user-agent': 'Mozilla/5.0', Accept: 'application/rss+xml,text/xml' },
    });
    if (!r.ok) return [];
    const xml = await r.text();

    const achados = [];
    for (const item of xml.split('<item>').slice(1)) {
      const hash = (item.match(/<nyaa:infoHash>([a-fA-F0-9]{40})<\/nyaa:infoHash>/) || [])[1];
      if (!hash) continue;
      const titulo = (item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || '';
      const seeders = Number((item.match(/<nyaa:seeders>(\d+)<\/nyaa:seeders>/) || [])[1] || 0);
      const bytesTexto = (item.match(/<nyaa:size>([^<]+)<\/nyaa:size>/) || [])[1] || '';
      const num = parseFloat(String(bytesTexto).replace(',', '.'));
      const bytes = /GiB|GB/i.test(bytesTexto)
        ? Math.round(num * 1024 ** 3)
        : /MiB|MB/i.test(bytesTexto)
        ? Math.round(num * 1024 ** 2)
        : null;
      achados.push({ hash: hash.toLowerCase(), title: titulo.trim(), seeders, bytes, fonte: 'nyaa' });
    }
    return achados.sort((a, b) => b.seeders - a.seeders).slice(0, 15);
  } catch (e) {
    return [];
  }
}

export async function onRequestGet({ request }) {
  const p = new URL(request.url).searchParams;
  const q = (p.get('q') || '').trim();
  const ptTitulo = (p.get('pt') || '').trim();
  const ano = p.get('ano');
  const tipo = p.get('tipo') || 'movie';
  const imdb = p.get('imdb');
  const season = p.get('season');
  const episode = p.get('episode');
  const limite = Math.min(Number(p.get('limit')) || 30, 50);

  // o Knaben so acha dublado quando o release usa o titulo em portugues
  // ("Interestelar dublado" acha 6, "Round 6 dublado" acha 0), entao ele e
  // consultado duas vezes: pelo nome original e pelo nome em portugues
  const [knaben, knabenPt, eztv, br, nyaa] = await Promise.all([
    noKnaben(q, limite, season, episode),
    ptTitulo && ptTitulo.toLowerCase() !== q.toLowerCase()
      ? noKnaben(ptTitulo, limite, season, episode)
      : Promise.resolve([]),
    noEztv(imdb, season, episode),
    fontesBr({ titulo: ptTitulo || q, ano, type: tipo, season }),
    noNyaa(q, season, episode),
  ]);

  // Comando primeiro (é a única fonte de dublado), depois EZTV, que sabe o
  // episódio de cada torrent; o Knaben adivinha pelo texto e fica por último.
  //
  // O filtro de episódio vale pra TODAS as fontes que só têm o nome do arquivo
  // — antes ele rodava só dentro do Knaben, e os sites brasileiros passavam
  // batido: pedindo o episódio 5 da 9ª temporada, voltava a 8ª inteira.
  // `alt`: outros nomes do mesmo titulo (romaji do anime: "JoJo no Kimyou na
  // Bouken"), separados por "|" — o release da fansub usa esse, nao o ingles.
  const alt = (p.get('alt') || '').split('|').map((t) => t.trim()).filter(Boolean);
  const temporadas = (p.get('temporadas') || '').split('|').map((t) => t.trim());
  const alvos = [nomeDoAlvo(q, tipo), ptTitulo, ...alt].filter(Boolean);
  const vistos = new Set();
  const resultados = [];
  for (const r of [...br.resultados, ...eztv, ...knaben, ...knabenPt, ...nyaa]) {
    if (vistos.has(r.hash)) continue;
    if (r.fonte !== 'eztv' && !ehDoEpisodio(r.title, season, episode)) continue;
    // EZTV busca por imdb e os sites BR ja conferem o titulo no slug
    if (['knaben', 'nyaa'].includes(r.fonte) && !releaseCombina(r.title, alvos)) continue;
    if (r.fonte !== 'eztv' && temporadaErrada(r.title, temporadas, season)) continue;
    vistos.add(r.hash);
    resultados.push(r);
  }

  // `?debug=1` conta quantos releases cada site brasileiro entregou. É a única
  // forma de saber quais domínios ainda estão vivos: daqui de casa quase todos
  // parecem mortos (o provedor bloqueia), e de dentro do Cloudflare, não.
  if (p.get('debug')) return json({ resultados, fontesBr: br.porFonte });

  return json({ resultados });
}

export const onRequestOptions = () =>
  new Response(null, {
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
