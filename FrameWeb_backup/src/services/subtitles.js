/**
 * Legendas — versão web.
 *
 * Fonte: o addon OpenSubtitles v3 do Stremio. Não pede chave e responde
 * `Access-Control-Allow-Origin: *` tanto na busca quanto no arquivo em si,
 * então tudo acontece no navegador — sem passar pelo Worker.
 *
 * Dois detalhes que derrubam quem copia isso do app:
 *   - o caminho é `/subtitles/` (plural). No singular ele devolve 404 em HTML.
 *   - o idioma vem em ISO 639-2 (`por`, `eng`), não no código de duas letras
 *     que as preferências usam.
 *
 * O <track> do HTML só aceita WebVTT, e o que chega é SubRip. A conversão é
 * feita aqui e virada num blob: URL.
 */

const BASE = 'https://opensubtitles-v3.strem.io';

// código das preferências -> códigos que o OpenSubtitles usa
const ISO3 = {
  pt: ['por', 'pob', 'pb'],
  en: ['eng'],
  es: ['spa'],
  fr: ['fre', 'fra'],
  de: ['ger', 'deu'],
  it: ['ita'],
  ja: ['jpn'],
  ko: ['kor'],
  zh: ['chi', 'zho'],
  hi: ['hin'],
  ar: ['ara'],
  ru: ['rus'],
  tr: ['tur'],
};

export const LEGENDA_NOMES = {
  por: 'Português',
  pob: 'Português (BR)',
  eng: 'Inglês',
  spa: 'Espanhol',
  fre: 'Francês',
  fra: 'Francês',
  ger: 'Alemão',
  deu: 'Alemão',
  ita: 'Italiano',
  jpn: 'Japonês',
  kor: 'Coreano',
  chi: 'Chinês',
  hin: 'Hindi',
  ara: 'Árabe',
  rus: 'Russo',
  tur: 'Turco',
};

/**
 * `pt-br` no nome do arquivo vale mais que `pt-pt` pra quem está no Brasil, e
 * o OpenSubtitles não separa os dois no campo de idioma.
 */
const ehBrasileira = (s) =>
  /pt[-_.]?br|bra[sz]il|pob/i.test(`${s.subtitleFileName || ''} ${s.releaseGroup || ''}`);

// Legenda feita pra CAM/telecine esta minutos fora de sincronia com um WEB-DL:
// os cortes e a abertura do estudio nao batem. Sem isto a primeira sugestao do
// Interestelar era de um CAM (e uma de um documentario do Discovery).
// Legenda de material bonus vem no mesmo resultado do filme e passa por todos
// os filtros de idioma: o topo do Interestelar era o "The Science of
// Interstellar", do Discovery, que nao tem nada a ver com o filme.
const EXTRA = /discovery|making[.\s_-]?of|behind[.\s_-]?the[.\s_-]?scenes|featurette|the[.\s_-]?science[.\s_-]?of|bonus|\bextras?\b|commentary|coment[aá]rio|sample|trailer/i;

const FORMATO_RUIM = /\bcam\b|hdcam|telesync|telecine|screener|dvdscr|\bscr\b|\bts\b|\bhdts\b|\bhc\b|\br[56]\b|workprint/i;

const fonteDoVideo = (nome = '') => {
  const t = nome.toLowerCase();
  if (/blu-?ray|bdrip|brrip|remux/.test(t)) return 'bluray';
  if (/web-?dl|web-?rip|webdl|\bweb\b|\bamzn\b|\bnf\b/.test(t)) return 'web';
  if (/hdtv|hdrip/.test(t)) return 'hdtv';
  if (/dvdrip|dvd/.test(t)) return 'dvd';
  return null;
};

const fonteDaLegenda = (formato = '') => fonteDoVideo(String(formato)) || null;

/**
 * Busca as legendas do título, já ordenadas: idioma preferido primeiro e,
 * dentro dele, as que casam com o release do vídeo.
 *
 * @param releaseName nome do arquivo que está tocando — casar legenda com
 *   release é o que evita aquela legenda 3 segundos fora de sincronia.
 */
/**
 * O hash do OpenSubtitles, calculado do próprio arquivo que está tocando.
 *
 * É o único jeito de pedir "a legenda DESTE release" em vez de "uma legenda
 * deste episódio". Legenda casada por hash está em sincronia porque foi feita
 * pra este corte; casada por título é sorte — e é por isso que ela aparece
 * atrasada meio minuto.
 *
 * A conta é simples: tamanho do arquivo somado aos primeiros e aos últimos
 * 64 KB, em inteiros de 64 bits. Os dois pedaços vêm por Range, que o link do
 * AllDebrid atende (206). Dois pedidos de 64 KB — não baixa o filme.
 */
export async function hashDoArquivo(url, tamanhoBytes) {
  const PEDACO = 65536;
  if (!url || !tamanhoBytes || tamanhoBytes < PEDACO * 2) return null;
  try {
    const [ini, fim] = await Promise.all([
      fetch(url, { headers: { Range: `bytes=0-${PEDACO - 1}` } }),
      fetch(url, { headers: { Range: `bytes=${tamanhoBytes - PEDACO}-${tamanhoBytes - 1}` } }),
    ]);
    if (!ini.ok || !fim.ok) return null;
    const [a, b] = await Promise.all([ini.arrayBuffer(), fim.arrayBuffer()]);
    const va = new DataView(a);
    const vb = new DataView(b);
    let h = BigInt(Math.floor(tamanhoBytes));
    for (let i = 0; i + 8 <= va.byteLength; i += 8) h = BigInt.asUintN(64, h + va.getBigUint64(i, true));
    for (let i = 0; i + 8 <= vb.byteLength; i += 8) h = BigInt.asUintN(64, h + vb.getBigUint64(i, true));
    return h.toString(16).padStart(16, '0');
  } catch (e) {
    return null;
  }
}

export async function buscarLegendas({
  imdbId,
  type = 'movie',
  season = 1,
  episode = 1,
  prefs,
  releaseName = '',
  movieHash = null,
}) {
  if (!imdbId) return [];

  const tipo = type === 'tv' ? 'series' : 'movie';
  const id = type === 'tv' ? `${imdbId}:${season}:${episode}` : imdbId;

  // videoHash no id: é assim que o provedor aceita o casamento por arquivo.
  const idComHash = movieHash ? `${id}%7CvideoHash=${movieHash}` : id;
  const resp = await fetch(`${BASE}/subtitles/${tipo}/${idComHash}.json`);
  if (!resp.ok) return [];
  const json = await resp.json().catch(() => null);
  const brutas = Array.isArray(json?.subtitles) ? json.subtitles : [];

  const preferido = ISO3[prefs?.subtitleLanguage] || [];
  const segundo = ISO3[prefs?.secondaryAudioLanguage] || ISO3.pt;
  const releaseSlug = String(releaseName).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const fonteVideo = fonteDoVideo(releaseName);
  const videoEhRuim = FORMATO_RUIM.test(releaseName);

  return brutas
    .filter((s) => s.url && s.lang)
    .map((s) => {
      const grupo = String(s.releaseGroup || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
      return {
        id: String(s.id),
        url: s.url,
        lang: s.lang,
        label:
          (ehBrasileira(s) ? 'Português (BR)' : LEGENDA_NOMES[s.lang] || s.lang.toUpperCase()) +
          (s.releaseGroup ? ` · ${s.releaseGroup}` : ''),
        arquivo: s.subtitleFileName || s.movieReleaseName || '',
        // Casada pelo hash do arquivo = está em sincronia com ELE. Serve de
        // régua pra estimar o quanto as outras estão deslocadas.
        hashCasado: !!movieHash && (String(s.id || '').includes(movieHash) || s.matchedBy === 'moviehash'),
        _rank:
          (preferido.includes(s.lang) ? -100 : segundo.includes(s.lang) ? -50 : 0) +
          (preferido.includes(s.lang) && ehBrasileira(s) ? -10 : 0) +
          // Casada pelo HASH do arquivo: não é "costuma estar em sincronia",
          // é "foi feita pra este arquivo". Ganha de tudo.
          (movieHash && String(s.id || '').includes(movieHash) ? -500 : 0) +
          (movieHash && s.matchedBy === 'moviehash' ? -500 : 0) +
          // legenda do mesmo release costuma estar em sincronia com o vídeo
          (grupo && releaseSlug.includes(grupo) ? -25 : 0) +
          (fonteVideo && fonteDaLegenda(s.releaseFormat) === fonteVideo ? -15 : 0) +
          (!videoEhRuim && FORMATO_RUIM.test(`${s.releaseFormat || ''} ${s.subtitleFileName || ''}`)
            ? 40
            : 0) +
          (EXTRA.test(`${s.subtitleFileName || ''} ${s.movieReleaseName || ''}`) ? 80 : 0),
      };
    })
    .sort((a, b) => a._rank - b._rank)
    .slice(0, 40);
}

/** A que entra sozinha, respeitando "Sem legenda" nas preferências. */
export function legendaPadrao(lista, prefs) {
  if (!lista.length || prefs?.subtitleLanguage === 'off') return null;
  const preferido = ISO3[prefs?.subtitleLanguage] || [];
  return lista.find((s) => preferido.includes(s.lang)) || null;
}

/**
 * SubRip -> WebVTT. Além do cabeçalho, troca a vírgula do milissegundo por
 * ponto: com a vírgula o navegador aceita o arquivo e não mostra nada.
 */
export function srtParaVtt(texto) {
  const corpo = String(texto)
    .replace(/^﻿/, '')
    .replace(/\r\n|\r/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${corpo}`;
}

/** Baixa a legenda e devolve um blob: URL pronto pro <track>. */
export async function carregarLegenda(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`legenda HTTP ${resp.status}`);
  const texto = await resp.text();
  const vtt = /^\s*WEBVTT/.test(texto) ? texto : srtParaVtt(texto);
  return URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
}

/**
 * Converte o texto da legenda numa lista de falas.
 *
 * Existe porque o <track> nativo nao serve aqui: ele desenha a legenda dentro
 * da CAIXA do <video>, e com `object-fit: contain` a tarja preta faz parte
 * dessa caixa — a legenda aparecia por cima da tarja, "embaixo do filme". Alem
 * disso as faixas se acumulavam a cada troca de release e apareciam varias ao
 * mesmo tempo. Desenhando por conta, isso tudo deixa de existir.
 */
const paraSegundos = (marca) => {
  const m = String(marca).trim().match(/(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/);
  if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
  const curto = String(marca).trim().match(/(\d{1,2}):(\d{2})[.,](\d{1,3})/);
  if (curto) return +curto[1] * 60 + +curto[2] + +curto[3] / 1000;
  return null;
};

/**
 * ASS/SSA — o formato que fazia a legenda "não aparecer".
 *
 * O leitor só entendia SRT/VTT, que marcam tempo com "-->" . Legenda em ASS
 * (comum em anime e em muita legenda brasileira) não tem isso: ela tem linhas
 * `Dialogue: 0,0:00:12.34,0:00:15.67,Default,,0,0,0,,texto`. Resultado: zero
 * falas, nenhum erro, tela limpa — exatamente o que você viu na legenda em
 * português enquanto a inglesa (SRT) funcionava.
 */
/**
 * O tempo do ASS e "0:00:12.34", e esse .34 sao CENTESIMOS de segundo — nao
 * milesimos como no SRT. Reaproveitar o leitor do SRT dava 12,034s em vez de
 * 12,34s: um terco de segundo de erro por fala, crescendo ao longo do filme.
 */
function tempoAss(bruto) {
  const m = String(bruto).trim().match(/(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,2})/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 100;
}

function lerFalasAss(texto) {
  const falas = [];
  for (const linha of String(texto).split(/\r?\n/)) {
    if (!linha.startsWith('Dialogue:')) continue;
    const campos = linha.slice(9).split(',');
    if (campos.length < 10) continue;
    const inicio = tempoAss(campos[1]);
    const termino = tempoAss(campos[2]);
    if (inicio === null || termino === null) continue;
    const corpo = campos
      .slice(9)
      .join(',')
      // {\an8}, {\i1} e afins são instruções de estilo, não texto
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N/gi, '\n')
      .replace(/\\h/gi, ' ')
      .trim();
    if (corpo) falas.push({ inicio, termino, texto: corpo });
  }
  return falas.sort((a, b) => a.inicio - b.inicio);
}

export function lerFalas(texto) {
  if (!texto) return [];
  // sem "-->" em lugar nenhum: ou é ASS, ou não é legenda
  if (!String(texto).includes('-->') && /^\s*Dialogue:/m.test(String(texto))) {
    return lerFalasAss(texto);
  }
  const limpo = String(texto).replace(/^﻿/, '').replace(/\r/g, '');
  const falas = [];

  for (const bloco of limpo.split(/\n{2,}/)) {
    const linhas = bloco.split('\n').map((l) => l.trimEnd()).filter(Boolean);
    if (!linhas.length) continue;
    if (/^(WEBVTT|NOTE|STYLE|REGION)/.test(linhas[0].trim())) continue;

    const iTempo = linhas.findIndex((l) => l.includes('-->'));
    if (iTempo === -1) continue;

    const [ini, fim] = linhas[iTempo].split('-->');
    const inicio = paraSegundos(ini);
    const termino = paraSegundos(fim);
    if (inicio === null || termino === null) continue;

    const corpo = linhas
      .slice(iTempo + 1)
      .join('\n')
      // tags do SubRip (<i>, {\an8}) nao sao pra aparecer como texto
      .replace(/<[^>]+>/g, '')
      .replace(/\{\[^}]*\}/g, '')
      .trim();
    if (corpo) falas.push({ inicio, termino, texto: corpo });
  }

  return falas.sort((a, b) => a.inicio - b.inicio);
}

/** Baixa e ja devolve as falas prontas. */
/**
 * Texto da legenda, com a codificação certa.
 *
 * `resp.text()` assume UTF-8 sempre. Legenda brasileira antiga costuma vir em
 * windows-1252, e aí "ação" vira "aÃ§Ã£o" — ou, quando o decodificador é
 * estrito, não vira nada. Aqui o UTF-8 é tentado em modo estrito primeiro; se
 * ele reclamar, o mesmo byte a byte em windows-1252.
 */
function decodificar(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (e) {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

export async function carregarFalas(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`legenda HTTP ${resp.status}`);
  const falas = lerFalas(decodificar(await resp.arrayBuffer()));
  if (!falas.length) throw new Error('legenda sem falas (formato nao reconhecido)');
  return falas;
}

/**
 * Fala ativa num instante. Busca binaria porque isso roda a cada `timeupdate`
 * num filme com duas mil falas.
 */
export function falaEm(falas, segundos) {
  let baixo = 0;
  let alto = falas.length - 1;
  while (baixo <= alto) {
    const meio = (baixo + alto) >> 1;
    const f = falas[meio];
    if (segundos < f.inicio) alto = meio - 1;
    else if (segundos > f.termino) baixo = meio + 1;
    else return f;
  }
  return null;
}
