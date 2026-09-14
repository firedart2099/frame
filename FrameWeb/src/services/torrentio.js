/**
 * Busca de releases no Torrentio — feita no NAVEGADOR, de propósito.
 *
 * O Torrentio devolve 403 pra requisição vinda do Cloudflare (bloqueio de IP
 * de datacenter), mas responde normal do IP de casa, e manda
 * `Access-Control-Allow-Origin: *` — ele é feito pra ser chamado do browser.
 *
 * Aqui só pedimos a LISTA (infoHash + nome do release). Converter isso em link
 * tocável é trabalho do /api/unlock, no servidor, porque é lá que mora a chave
 * do AllDebrid — ela não pode entrar no bundle, que é público.
 *
 * ATENÇÃO ao mexer na ordenação: ela NÃO é a mesma do app. O app toca no
 * expo-video, que usa o decodificador do aparelho e engole HEVC, AC3 e DTS. O
 * navegador não: x265 dá tela preta e AC3/DTS dá filme mudo, os dois sem erro
 * explícito. Um release lindo de 4K remux é a pior escolha possível aqui.
 */

/**
 * Duas listas, porque nenhuma sozinha resolve.
 *
 * A padrão tem a melhor cobertura do áudio original. A `/brazuca` é uma
 * configuração pronta do próprio Torrentio virada pra trackers brasileiros, e
 * é ela que traz dublagem: em Round 6 são 13 releases com marca de português
 * contra pouquíssimos na padrão, e em Interestelar aparecem os BLUDV.
 * Sterling Point volta zero nas duas — ali a dublagem não existe mesmo.
 */
import { buscarApibay } from './apibay';

const FONTES = [
  { origem: 'geral', base: 'https://torrentio.strem.fun/language=portuguese|qualityfilter=cam,scr' },
  { origem: 'brazuca', base: 'https://torrentio.strem.fun/brazuca' },
  // Mico-Leao Dublado: addon focado SO em dublagem PT-BR, e o unico que
  // etiqueta o audio no proprio nome ("DUBLADO DUAL AUDIO 1080P"). Libera CORS,
  // entao roda no navegador junto com os outros. So tem filme — em serie ele
  // devolve zero, e a chamada e descartada sem custo.
  { origem: 'micoleao', base: 'https://27a5b2bfe3c0-stremio-brazilian-addon.baby-beamup.club', soFilme: true },
];

const PT = /dublado|dublagem|pt-?br|ptbr|portugu|nacional/i;

/**
 * "DUAL" NÃO é português — pelo menos não no navegador, e nem sempre em lugar
 * nenhum.
 *
 * Duas coisas se somam aqui. Em anime, "dual audio" quer dizer **inglês +
 * japonês**: nada de português. E no navegador não existe escolha de faixa (o
 * Chrome não implementa `audioTracks`), então mesmo num DUAL brasileiro quem
 * decide é o arquivo — toca a primeira faixa e pronto.
 *
 * O JoJo's Bizarre Adventure T1E18 mostrou os dois ao mesmo tempo: o menu dizia
 * "Português", o release era DUAL de anime, e o que saía era inglês. Rótulo que
 * mente é pior do que rótulo que admite não saber.
 */
const DUAL_QUALQUER = /\bdual\b|dual[\s._-]?[áa]udio/i;

/**
 * Dublagem em OUTRO idioma.
 *
 * Sem isto, um release italiano não tinha marca de português e caía na
 * categoria "original" — foi assim que a série tocou em italiano.
 */
const OUTRAS_DUBLAGENS = [
  ['it', /\b(ita|italian|italiano)\b/i],
  ['es', /\b(esp|spa|spanish|castellano|latino)\b/i],
  ['fr', /\b(fre|french|truefrench|vf|vf2|vfi|vff|vfq|vostfr)\b/i],
  ['de', /\b(ger|german|deutsch)\b/i],
  ['cs', /\b(cz|cze|czech|dabing)\b/i],
  ['ru', /\b(rus|russian)\b/i],
  ['pl', /\b(pol|polish|lektor|sezon)\b/i],
  ['hu', /\b(hun|hungarian)\b/i],
  ['tr', /\b(tur|turkish|dublaj)\b/i],
  ['hi', /\b(hin|hindi)\b/i],
  ['ko', /\b(kor|korean)\b/i],
  ['ja', /\b(jpn|japanese)\b/i],
];

// Título escrito em cirílico é release russo, e nenhuma marca ASCII avisa
// isso: "Стерлинг-Поинт / Sterling Point ... | P L |" passava como original.
const CIRILICO = /[Ѐ-ӿ]/;
const GREGO = /[Ͱ-Ͽ]/;

// Release que declara duas faixas e uma delas é o áudio original: "ITA.ENG",
// "(CZ/EN)". Jogar fora seria perder o único 1080p H.264 com o idioma original
// de alguns títulos — mas prometer também não dá, porque o navegador toca a
// PRIMEIRA faixa e a ordem não aparece no nome. Fica como incerto.
const TEM_ORIGINAL = /\b(eng|en)\b|\/(en|eng)\b|\b(en|eng)\//i;

/** Nome pra tela. `original` não é um idioma: é o áudio que o título nasceu. */
export const NOMES_IDIOMA = {
  original: 'Original do título',
  multi: 'Dual (o navegador escolhe a faixa)',
  pt: 'Português (dublado)',
  en: 'Inglês (dublado)',
  es: 'Espanhol (dublado)',
  it: 'Italiano (dublado)',
  fr: 'Francês (dublado)',
  de: 'Alemão (dublado)',
  cs: 'Tcheco (dublado)',
  ru: 'Russo (dublado)',
  pl: 'Polonês (dublado)',
  hu: 'Húngaro (dublado)',
  tr: 'Turco (dublado)',
  hi: 'Hindi (dublado)',
  ko: 'Coreano (dublado)',
  ja: 'Japonês (dublado)',
};

const qualidade = (t = '') => {
  const s = t.toLowerCase();
  if (/2160|4k|uhd/.test(s)) return 2160;
  if (/1080/.test(s)) return 1080;
  if (/720/.test(s)) return 720;
  if (/480/.test(s)) return 480;
  return 0;
};

const tamanho = (t = '') => {
  const m = /(\d+(?:[.,]\d+)?)\s*(gb|mb)/i.exec(t);
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  return m[2].toLowerCase() === 'gb' ? n * 1e9 : n * 1e6;
};

const codecDe = (t = '') => {
  const s = t.toLowerCase();
  if (/av1/.test(s)) return 'av1';
  if (/hevc|h\.?265|x265/.test(s)) return 'hevc';
  return 'avc';
};

const audioDe = (t = '') => {
  const s = t.toLowerCase();
  if (/truehd|atmos/.test(s)) return 'truehd';
  if (/\bdts/.test(s)) return 'dts';
  if (/flac/.test(s)) return 'flac';
  if (/eac3|e-ac3|ddp|dd\+/.test(s)) return 'eac3';
  if (/\bac3\b|\bdd5|dolby digital/.test(s)) return 'ac3';
  if (/aac/.test(s)) return 'aac';
  if (/opus/.test(s)) return 'opus';
  return null;
};

/**
 * Código do idioma do release.
 *
 * A ordem importa: as marcas de idioma são testadas ANTES de `MULTi`. Um
 * "MULTi.VF2" é um release francês, e testar MULTi primeiro o classificava
 * como original — foi assim que o Sterling Point veio em francês e em russo.
 *
 * `DUAL` sozinho, vindo da lista brazuca, é PT-BR + original: é assim que
 * uploader brasileiro nomeia. Na lista geral a mesma palavra não quer dizer
 * nada (existe "dual-lat", espanhol), então lá ela não conta.
 */
/**
 * Fontes que são curadoria BRASILEIRA.
 *
 * Nelas, "DUAL" quer dizer português + original — é assim que uploader
 * brasileiro nomeia. Fora delas, DUAL é incerto (em anime, por exemplo,
 * significa inglês + japonês).
 *
 * O Comando e o Baixe Torrents estavam de fora dessa lista, e era por isso que
 * o Thor Ragnarok dublado aparecia na busca mas NÃO aparecia como "Português"
 * no menu: o release chama "Thor Ragnarok 2018 [BluRay] [1080p] [DUAL]", sem a
 * palavra "dublado" em lugar nenhum.
 */
const FONTES_BR = new Set(['brazuca', 'comando', 'baixe']);

function idiomaDe(texto, origem) {
  if (PT.test(texto)) return 'pt';
  if (FONTES_BR.has(origem) && DUAL_QUALQUER.test(texto)) return 'pt';
  // Em qualquer outra lista, DUAL é incerto — pode ser eng+jpn.
  if (DUAL_QUALQUER.test(texto)) return 'multi';

  const estrangeiro = CIRILICO.test(texto)
    ? 'ru'
    : GREGO.test(texto)
      ? 'el'
      : (OUTRAS_DUBLAGENS.find(([, regex]) => regex.test(texto)) || [null])[0];

  if (estrangeiro) return TEM_ORIGINAL.test(texto) ? 'multi' : estrangeiro;
  if (/\bmulti\b/i.test(texto)) return 'multi';
  return 'original';
}

// Quanto o navegador sofre pra tocar cada coisa. Número alto = evite.
const PESO_CODEC = { avc: 0, av1: 6, hevc: 12 };
const PESO_AUDIO = { aac: 0, opus: 0, ac3: 5, eac3: 5, dts: 10, truehd: 12, flac: 8 };

/**
 * Nota do release. Menor é melhor.
 *
 * A ordem de importância é: 1080p, idioma das configurações, e só então o que
 * o navegador decodifica melhor. 1080p é exigência — pesa mais que tudo — e
 * dentro dos 1080p manda o idioma preferido, depois o secundário, depois o
 * áudio original do título.
 */
/**
 * O idioma original de um titulo americano E o ingles.
 *
 * Sem esta traducao, quem escolhe "Ingles" nas preferencias fica sem
 * preferencia nenhuma: os releases em ingles sao classificados como
 * `original`, "en" nao casa com ninguem, e o idioma SECUNDARIO (portugues)
 * assume — o episodio comecava dublado pra quem pediu ingles.
 */
export const normalizarIdioma = (codigo, idiomaOriginal) =>
  codigo && idiomaOriginal && codigo === idiomaOriginal ? 'original' : codigo;

/**
 * Bitrate em Mbps a partir do tamanho e da duração — a medida que o nome do
 * arquivo não conta. "1080p HDRip" de 1,8 GB pra 131 min é 1,8 Mbps: tem a
 * resolução de 1080p e a imagem de 480p. Quem assistia dizia "isso não é
 * 1080", e estava certo. Sem duração ou tamanho, devolve null e a nota ignora.
 */
export function bitrateMbps(bytes, duracaoS) {
  if (!bytes || !duracaoS || duracaoS < 60) return null;
  return (bytes * 8) / duracaoS / 1e6;
}

/** Abaixo disto, "1080p" tem a imagem de 720p; abaixo do segundo, de 480p. */
export const MBPS_MINIMO_1080 = 2.5;
export const MBPS_MINIMO_720 = 1.2;

/**
 * A qualidade que o arquivo ENTREGA, não a que o nome promete. Um "1080p" de
 * 1,8 Mbps vira 720p aqui: some do menu de 1080p e perde pra qualquer 1080p
 * de verdade na escolha automática — sem carregar um byte.
 */
export function qualidadeReal(texto, bytes, duracaoS) {
  const q = qualidade(texto);
  const mbps = bitrateMbps(bytes, duracaoS);
  if (mbps == null) return q;
  if (q >= 1080 && mbps < MBPS_MINIMO_720) return 480;
  if (q >= 1080 && mbps < MBPS_MINIMO_1080) return 720;
  if (q === 720 && mbps < 0.9) return 480;
  return q;
}

function nota(texto, prefs, idioma, idiomaOriginal, semDolby, bytes = null, duracaoS = null) {
  const q = qualidade(texto);
  const codec = codecDe(texto);
  const audio = audioDe(texto);

  // IDIOMA MANDA NA QUALIDADE, nunca o contrário. Antes 1080p pesava -100 e o
  // idioma -30: um release italiano em 1080p ganhava de um original em 720p, e
  // era assim que a série tocava em italiano. Agora o idioma entra numa faixa
  // de milhar — nenhuma diferença de qualidade alcança a faixa de cima.
  const preferido = normalizarIdioma(prefs?.audioLanguage || 'original', idiomaOriginal);
  const secundario = normalizarIdioma(prefs?.secondaryAudioLanguage || null, idiomaOriginal);

  const faixaIdioma =
    idioma === preferido ? 0 : secundario && idioma === secundario ? 1 : idioma === 'original' ? 2 : 9;

  let n = faixaIdioma * 1000;

  // dentro da faixa do idioma, aí sim 1080p é exigência
  n += q === 1080 ? 0 : q === 720 ? 120 : q === 2160 ? 160 : 200;

  // ...mas 1080p magro não é 1080p. Abaixo de 2,5 Mbps cai pra trás de um
  // 720p decente; entre 2,5 e 4 fica atrás de um 1080p de verdade. Acima de
  // 25 Mbps é REMUX/UHD que pesa na banda e no decodificador: leve penalidade.
  const mbps = bitrateMbps(bytes, duracaoS);
  if (mbps != null && q >= 1080) {
    // magro fica ATRAS de todo 1080p de verdade, mas NA FRENTE de qualquer
    // 720p (+120): se houver outro 1080, pega o outro; se nao, o magro vale
    if (mbps < MBPS_MINIMO_1080) n += 100;
    else if (mbps < 4) n += 50;
    else if (mbps > 25) n += 10;
  }

  n += PESO_CODEC[codec] ?? 6;
  n += audio === null ? 2 : PESO_AUDIO[audio] ?? 4;

  // Navegador sem Dolby: release que ANUNCIA aac e a unica garantia de som, e
  // isso vale mais que resolucao — um 720p com audio ganha de um 1080p mudo.
  // O bonus e maior que a distancia entre 1080p e 720p de proposito.
  if (semDolby && audio === 'aac') n -= 150;
  if (semDolby && (audio === 'ac3' || audio === 'eac3')) n += 400;
  if (/remux/i.test(texto)) n += 8; // faixa de áudio intocada = quase sempre DTS/TrueHD
  if (/\.mp4\b/i.test(texto)) n -= 2; // mp4 é o container que todo browser abre
  if (/\b(collection|cole[cç][aã]o|pack|top \d+|\d+ movies|filmografia|anthology)\b/i.test(texto)) n += 15;

  return n;
}

async function buscarNaFonte({ origem, base, soFilme }, tipo, id) {
  if (soFilme && tipo !== 'movie') return [];
  try {
    const resp = await fetch(`${base}/stream/${tipo}/${id}.json`);
    if (!resp.ok) return [];
    const json = await resp.json();
    return (Array.isArray(json.streams) ? json.streams : [])
      .filter((s) => s.infoHash)
      .map((s) => ({ ...s, _origem: origem }));
  } catch (e) {
    return []; // uma lista fora do ar não pode derrubar a outra
  }
}

/**
 * Terceira fonte: o Knaben, via /api/busca (ele nao manda CORS, mas o Worker
 * alcanca ele). O Torrentio nao indexa release de episodio avulso das scenes:
 * o unico 1080p H.264 com audio original do Sterling Point S01E03 so aparece
 * aqui, e e exatamente o que salva quem nao tem decodificador de HEVC.
 *
 * Busca por TEXTO, entao depende do titulo — de preferencia o original, que e
 * como o release e nomeado ("Sterling Point", nao "Ponto Sterling").
 */
async function buscarExtras({ imdbId, titulo, tituloPt, titulosAlt = [], nomesTemporadas = [], type, season, episode, ano }) {
  if (!titulo && !imdbId) return [];
  const alvo =
    type === 'tv'
      ? `${titulo} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
      : `${titulo} ${ano || ''}`.trim();
  const qs = new URLSearchParams({ q: alvo, tipo: type });
  if (tituloPt) qs.set('pt', tituloPt);
  // romaji do anime ("JoJo no Kimyou na Bouken"): e assim que a fansub nomeia
  if (titulosAlt.length) qs.set('alt', titulosAlt.join('|'));
  // nomes das temporadas (TMDB): pack de anime nomeado pela parte cai fora
  if (type === 'tv' && nomesTemporadas.length) qs.set('temporadas', nomesTemporadas.join('|'));
  if (ano) qs.set('ano', String(ano));
  if (type === 'tv' && imdbId) {
    // o EZTV indexa por imdb e sabe o episodio de cada torrent
    qs.set('imdb', imdbId);
    qs.set('season', String(season));
    qs.set('episode', String(episode));
  }
  try {
    const resp = await fetch(`/api/busca?${qs}`);
    if (!resp.ok) return [];
    const { resultados } = await resp.json();
    return (resultados || []).map((r) => ({
      infoHash: r.hash,
      _fonte: r.fonte,
      _bytes: r.bytes || null,
      // fonte brasileira sabe o idioma melhor que o nome do arquivo:
      // "Dub(2026)" nao casa com nenhuma regra geral
      _idioma: r.idioma || null,
      // o Knaben nao diz qual arquivo do torrent e o episodio; o /api/unlock
      // resolve isso casando SxxEyy no nome, como ja faz pros packs
      fileIdx: null,
      name: r.title,
      title: r.title,
      _origem: r.fonte || 'knaben',
    }));
  } catch (e) {
    return [];
  }
}

export async function buscarReleases({
  imdbId,
  type = 'movie',
  season = 1,
  episode = 1,
  prefs = null,
  titulo = null,
  tituloPt = null,
  titulosAlt = [],
  nomesTemporadas = [],
  ano = null,
  idiomaOriginal = null,
  semDolby = false,
  duracaoS = null, // do TMDB (runtime × 60): permite pesar o bitrate
}) {
  if (!imdbId) return [];

  const tipo = type === 'tv' ? 'series' : 'movie';
  const id = type === 'tv' ? `${imdbId}:${season}:${episode}` : imdbId;

  const listas = await Promise.all([
    ...FONTES.map((f) => buscarNaFonte(f, tipo, id)),
    buscarExtras({ imdbId, titulo, tituloPt, titulosAlt, nomesTemporadas, type, season, episode, ano }),
    // The Pirate Bay, só com a extensão: 429 pro Cloudflare, sem CORS pro navegador
    buscarApibay({ imdbId, titulo, type, season, episode, ano }),
  ]);

  // o mesmo torrent aparece nas duas listas; a primeira ocorrência vence
  const vistos = new Set();
  const brutos = [];
  for (const lista of listas) {
    for (const s of lista) {
      if (vistos.has(s.infoHash)) continue;
      vistos.add(s.infoHash);
      brutos.push(s);
    }
  }

  const preferido = normalizarIdioma(prefs?.audioLanguage || 'original', idiomaOriginal);
  const secundario = normalizarIdioma(prefs?.secondaryAudioLanguage || 'pt', idiomaOriginal);

  const ordenados = brutos
    .map((s) => {
      const texto = `${s.name || ''} ${s.title || ''}`;
      // no Mico-Leao a etiqueta de audio vem no `name` do stream, nao no nome
      // do arquivo: "DUBLADO DUAL AUDIO 5.1 MKV BLURAY 1080P"
      const idioma = s._idioma || idiomaDe(texto, s._origem);
      return {
        infoHash: s.infoHash,
        fileIdx: typeof s.fileIdx === 'number' ? s.fileIdx : null,
        release: (s.title || '').split('\n')[0].slice(0, 90),
        origem: s._origem,
        quality: qualidade(texto),
        magro: qualidadeReal(texto, tamanho(s.title || '') || s._bytes || null, duracaoS) < qualidade(texto), // 1080p com bitrate de 720p
        sizeBytes: tamanho(s.title || '') || s._bytes || null,
        idioma,
        pt: idioma === 'pt',
        codec: codecDe(texto),
        audio: audioDe(texto),
        _rank: nota(texto, prefs, idioma, idiomaOriginal, semDolby, tamanho(s.title || '') || s._bytes || null, duracaoS),
      };
    })
    // Dublagem num idioma que você não escolheu fica fora: nem menu, nem
    // sondagem. Só o original, os dois idiomas das suas configurações, e os
    // incertos (que carregam o original junto) como último recurso.
    // 'multi' fora. Ele existia como ultimo recurso por ter o original junto,
    // mas o navegador toca a PRIMEIRA faixa: num "ITA.ENG" isso e italiano. E
    // como esses releases costumam ser H.264 enquanto os originais sao HEVC,
    // ele ganhava por eliminacao na sondagem. Melhor 720p no idioma certo.
    .filter((r) => r.idioma === 'original' || r.idioma === preferido || r.idioma === secundario)
    .sort((a, b) => a._rank - b._rank);

  /**
   * Corte com COTA por idioma.
   *
   * O corte era "os 40 melhores", e a nota põe o idioma preferido na frente.
   * Com a preferência em "original", os 40 primeiros eram 40 releases em
   * inglês — e os dublados, que vinham depois, sumiam antes de chegar na tela.
   * Foi isso que fez Vingadores: Guerra Infinita aparecer sem dublagem mesmo
   * com oito releases dublados na resposta da busca.
   *
   * Agora cada idioma tem lugar garantido: os melhores de cada um entram
   * primeiro, e só depois o resto preenche o que sobrou. Idioma que existe
   * chega no menu.
   */
  const COTA = 10;
  const TOTAL = 50;
  const porIdioma = new Map();
  for (const r of ordenados) {
    const lista = porIdioma.get(r.idioma) || [];
    if (lista.length < COTA) lista.push(r);
    porIdioma.set(r.idioma, lista);
  }
  const escolhidos = [];
  const jaEntrou = new Set();
  for (const lista of porIdioma.values()) {
    for (const r of lista) {
      escolhidos.push(r);
      jaEntrou.add(r.infoHash);
    }
  }
  escolhidos.sort((a, b) => a._rank - b._rank);
  for (const r of ordenados) {
    if (escolhidos.length >= TOTAL) break;
    if (jaEntrou.has(r.infoHash)) continue;
    escolhidos.push(r);
    jaEntrou.add(r.infoHash);
  }
  return escolhidos.slice(0, TOTAL);
}
