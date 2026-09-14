/**
 * Demuxer de Matroska (.mkv) lendo por pedaços — nunca o arquivo inteiro.
 *
 * Por que existe: o Chrome não escolhe faixa de áudio (`audioTracks` não é
 * implementado) e o MediaSource não aceita H.264 dentro de .mkv. Um release
 * DUAL — imagem 1080p com o áudio original E o dublado no mesmo arquivo — é
 * exatamente o que a pessoa quer, e o navegador sozinho toca o primeiro áudio
 * que encontra, ou nada. Então o site abre o .mkv por conta própria: lê as
 * faixas, escolhe a de áudio, e entrega vídeo e áudio ao MediaSource já
 * reempacotados em fMP4 (`fmp4.js`). Um download só, sincronia do próprio
 * arquivo, troca de idioma sem mexer no vídeo.
 *
 * O que sai daqui: `abrir(fonte)` devolve as faixas, a duração e o índice
 * (Cues); `lerBlocos(fonte, posicao, faixas)` percorre os Clusters a partir de
 * uma posição e devolve os quadros/frames de cada faixa, com timestamp em ms.
 *
 * `fonte` é qualquer coisa com `{ tamanho, ler(inicio, fim) -> Uint8Array }`
 * — HTTP com Range no navegador (`fonteHttp.js`), arquivo local nos testes.
 */

import { lerElemento, lerUint, lerInt, lerFloat, lerString, paraCadaFilho, TAMANHO_DESCONHECIDO } from './ebml.js';

// ids dos elementos que interessam (spec: matroska.org/technical/elements)
export const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  SeekPosition: 0x53ac,
  Info: 0x1549a966,
  TimestampScale: 0x2ad7b1,
  Duration: 0x4489,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  FlagDefault: 0x88,
  FlagForced: 0x55aa,
  DefaultDuration: 0x23e383,
  Name: 0x536e,
  Language: 0x22b59c,
  LanguageIETF: 0x22b59d,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  CodecDelay: 0x56aa,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Audio: 0xe1,
  SamplingFrequency: 0xb5,
  Channels: 0x9f,
  ContentEncodings: 0x6d80,
  ContentEncoding: 0x6240,
  ContentCompression: 0x5034,
  ContentCompAlgo: 0x4254,
  ContentCompSettings: 0x4255,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueTrack: 0xf7,
  CueClusterPosition: 0xf1,
  Cluster: 0x1f43b675,
  Timestamp: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  BlockDuration: 0x9b,
  Attachments: 0x1941a469,
  Chapters: 0x1043a770,
  Tags: 0x1254c367,
  Void: 0xec,
  CRC32: 0xbf,
};

const TIPO_FAIXA = { 1: 'video', 2: 'audio', 17: 'subtitle' };

/**
 * Janela deslizante sobre a fonte: pede bytes por posição absoluta e mantém
 * um pedaço em memória. Ao avançar, guarda o rabo do pedaço anterior em vez de
 * baixar de novo — o cabeçalho de um bloco costuma cair bem na emenda.
 */
export function criarJanela(fonte, pedaco = 4 << 20) {
  let base = 0;
  let buf = new Uint8Array(0);

  async function bytes(pos, n) {
    if (pos >= base && pos + n <= base + buf.length) return buf.subarray(pos - base, pos - base + n);

    const limite = fonte.tamanho != null ? fonte.tamanho : Infinity;
    if (pos + n > limite) return null; // pediram além do fim
    const fim = Math.min(limite, pos + Math.max(n, pedaco));

    if (pos >= base && pos < base + buf.length) {
      // avançou: aproveita o que sobrou e baixa só o que falta
      const sobra = buf.subarray(pos - base);
      const novo = await fonte.ler(base + buf.length, fim);
      const junto = new Uint8Array(sobra.length + novo.length);
      junto.set(sobra, 0);
      junto.set(novo, sobra.length);
      buf = junto;
    } else {
      buf = await fonte.ler(pos, fim);
    }
    base = pos;
    if (buf.length < n) {
      // Pediu dentro do arquivo e veio menos: conexão cortada no meio (o
      // AllDebrid faz isso sob carga). NÃO é fim de arquivo — tratar como fim
      // fazia o motor fechar o fluxo e a duração do filme "virar" 59 minutos.
      throw new Error(`leitura curta em ${pos}: ${buf.length} de ${n} bytes`);
    }
    return buf.subarray(0, n);
  }

  /** Cabeçalho de elemento em `pos` (id + tamanho), ou null no fim. */
  async function elemento(pos) {
    const cab = await bytes(pos, Math.min(16, (fonte.tamanho != null ? fonte.tamanho : Infinity) - pos));
    if (!cab || !cab.length) return null;
    const el = lerElemento(cab, 0);
    if (!el) return null;
    return { id: el.id, tamanho: el.tamanho, dados: pos + el.cabecalho };
  }

  return { bytes, elemento };
}

// ---------------------------------------------------------------- cabeçalho

function lerFaixa(buf, ini, fim) {
  const f = {
    numero: 0,
    tipo: 'other',
    codec: '',
    codecPrivate: null,
    idioma: 'und',
    nome: '',
    padrao: true,
    forcada: false,
    duracaoQuadroNs: 0,
    codecDelayNs: 0,
    largura: 0,
    altura: 0,
    taxa: 0,
    canais: 0,
    cabecalhoRemovido: null, // ContentCompression "header stripping": bytes a repor em cada quadro
  };
  paraCadaFilho(buf, ini, fim, (id, b, p, t) => {
    switch (id) {
      case ID.TrackNumber: f.numero = lerUint(b, p, t); break;
      case ID.TrackType: f.tipo = TIPO_FAIXA[lerUint(b, p, t)] || 'other'; break;
      case ID.FlagDefault: f.padrao = lerUint(b, p, t) !== 0; break;
      case ID.FlagForced: f.forcada = lerUint(b, p, t) !== 0; break;
      case ID.DefaultDuration: f.duracaoQuadroNs = lerUint(b, p, t); break;
      case ID.Name: f.nome = lerString(b, p, t); break;
      case ID.Language: if (f.idioma === 'und') f.idioma = lerString(b, p, t); break;
      case ID.LanguageIETF: f.idioma = lerString(b, p, t); break; // BCP 47 vence o ISO 639-2
      case ID.CodecID: f.codec = lerString(b, p, t); break;
      case ID.CodecPrivate: f.codecPrivate = b.slice(p, p + t); break;
      case ID.CodecDelay: f.codecDelayNs = lerUint(b, p, t); break;
      case ID.Video:
        paraCadaFilho(b, p, p + t, (id2, b2, p2, t2) => {
          if (id2 === ID.PixelWidth) f.largura = lerUint(b2, p2, t2);
          if (id2 === ID.PixelHeight) f.altura = lerUint(b2, p2, t2);
        });
        break;
      case ID.Audio:
        paraCadaFilho(b, p, p + t, (id2, b2, p2, t2) => {
          if (id2 === ID.SamplingFrequency) f.taxa = lerFloat(b2, p2, t2);
          if (id2 === ID.Channels) f.canais = lerUint(b2, p2, t2);
        });
        break;
      case ID.ContentEncodings:
        paraCadaFilho(b, p, p + t, (idE, bE, pE, tE) => {
          if (idE !== ID.ContentEncoding) return;
          paraCadaFilho(bE, pE, pE + tE, (idC, bC, pC, tC) => {
            if (idC !== ID.ContentCompression) return;
            let algo = 0;
            let settings = null;
            paraCadaFilho(bC, pC, pC + tC, (idS, bS, pS, tS) => {
              if (idS === ID.ContentCompAlgo) algo = lerUint(bS, pS, tS);
              if (idS === ID.ContentCompSettings) settings = bS.slice(pS, pS + tS);
            });
            // 3 = header stripping (o único "compressão" que o mkvmerge usa por
            // padrão); zlib/bzip/lzo não têm vez em release de vídeo
            if (algo === 3 && settings) f.cabecalhoRemovido = settings;
            else if (algo !== 3) f.compressaoDesconhecida = algo;
          });
        });
        break;
      default:
    }
  });
  return f;
}

/**
 * Lê o cabeçalho do arquivo: Info, Tracks, SeekHead e — quando estão antes
 * dos Clusters, como o mkvmerge escreve — as Cues. Se as Cues ficaram no fim
 * (ffmpeg faz assim), vai buscar lá pelo SeekHead.
 *
 * Devolve `{ faixas, duracaoMs, escalaNs, cues, primeiroCluster, segmento }`.
 * As posições das Cues já vêm ABSOLUTAS (no arquivo), não relativas ao Segment.
 */
export async function abrir(fonte) {
  const janela = criarJanela(fonte, 1 << 20);

  const ebml = await janela.elemento(0);
  if (!ebml || ebml.id !== ID.EBML) throw new Error('não é um arquivo Matroska');
  const seg = await janela.elemento(ebml.dados + ebml.tamanho);
  if (!seg || seg.id !== ID.Segment) throw new Error('sem Segment');

  const info = {
    faixas: [],
    duracaoMs: 0,
    escalaNs: 1000000,
    cues: [],
    primeiroCluster: null,
    segmento: seg.dados, // as posições do SeekHead e das Cues são relativas a isto
    tamanho: fonte.tamanho,
  };
  let posCues = null;
  let duracaoTicks = 0;

  let pos = seg.dados;
  const fimSeg = seg.tamanho === TAMANHO_DESCONHECIDO ? Infinity : seg.dados + seg.tamanho;
  while (pos < fimSeg) {
    const el = await janela.elemento(pos);
    if (!el) break;
    if (el.id === ID.Cluster) {
      info.primeiroCluster = pos;
      break;
    }
    if (el.tamanho === TAMANHO_DESCONHECIDO) break;
    const proximo = el.dados + el.tamanho;

    if (el.id === ID.SeekHead || el.id === ID.Info || el.id === ID.Tracks || el.id === ID.Cues) {
      const b = await janela.bytes(el.dados, el.tamanho);
      if (!b) break;
      if (el.id === ID.SeekHead) {
        paraCadaFilho(b, 0, b.length, (id, bb, p, t) => {
          if (id !== ID.Seek) return;
          let alvo = 0;
          let onde = 0;
          paraCadaFilho(bb, p, p + t, (id2, b2, p2, t2) => {
            if (id2 === ID.SeekID) alvo = lerUint(b2, p2, t2);
            if (id2 === ID.SeekPosition) onde = lerUint(b2, p2, t2);
          });
          if (alvo === ID.Cues) posCues = info.segmento + onde;
        });
      } else if (el.id === ID.Info) {
        paraCadaFilho(b, 0, b.length, (id, bb, p, t) => {
          if (id === ID.TimestampScale) info.escalaNs = lerUint(bb, p, t);
          if (id === ID.Duration) duracaoTicks = lerFloat(bb, p, t);
        });
      } else if (el.id === ID.Tracks) {
        paraCadaFilho(b, 0, b.length, (id, bb, p, t) => {
          if (id === ID.TrackEntry) info.faixas.push(lerFaixa(bb, p, p + t));
        });
      } else if (el.id === ID.Cues) {
        info.cues = lerCues(b, info.segmento);
      }
    }
    pos = proximo;
  }

  info.duracaoMs = (duracaoTicks * info.escalaNs) / 1e6;

  // Cues no fim do arquivo: um pedido a mais, só na abertura
  if (!info.cues.length && posCues != null) {
    const el = await janela.elemento(posCues);
    if (el && el.id === ID.Cues && el.tamanho !== TAMANHO_DESCONHECIDO) {
      const b = await janela.bytes(el.dados, el.tamanho);
      if (b) info.cues = lerCues(b, info.segmento);
    }
  }

  return info;
}

/** Índice: `[{ tempoMs, posicao }]` ordenado por tempo — posição absoluta do Cluster. */
function lerCues(b, segmento) {
  const cues = [];
  paraCadaFilho(b, 0, b.length, (id, bb, p, t) => {
    if (id !== ID.CuePoint) return;
    let ticks = 0;
    let cluster = null;
    let faixa = 0;
    paraCadaFilho(bb, p, p + t, (id2, b2, p2, t2) => {
      if (id2 === ID.CueTime) ticks = lerUint(b2, p2, t2);
      if (id2 === ID.CueTrackPositions && cluster == null) {
        paraCadaFilho(b2, p2, p2 + t2, (id3, b3, p3, t3) => {
          if (id3 === ID.CueClusterPosition) cluster = lerUint(b3, p3, t3);
          if (id3 === ID.CueTrack) faixa = lerUint(b3, p3, t3);
        });
      }
    });
    if (cluster != null) cues.push({ ticks, posicao: segmento + cluster, faixa });
  });
  return cues.sort((a, b) => a.ticks - b.ticks);
}

/**
 * Só os pontos de índice da faixa de VÍDEO. Muxer que indexa o áudio também
 * (o xRG faz) aponta pra clusters sem keyframe de vídeo: o seek caía lá, o
 * vídeo só começava 3 s depois e o player ficava parado esperando.
 */
export function cuesDoVideo(info) {
  const video = info.faixas.find((f) => f.tipo === 'video');
  const doVideo = video ? info.cues.filter((c) => c.faixa === video.numero) : [];
  const lista = doVideo.length ? doVideo : info.cues;
  const vistos = new Set();
  return lista.filter((c) => !vistos.has(c.posicao) && vistos.add(c.posicao));
}

/** Posição do Cluster onde começar pra tocar a partir de `tempoMs` (o keyframe anterior). */
export function clusterPara(info, tempoMs) {
  const ticks = (tempoMs * 1e6) / info.escalaNs;
  let melhor = null;
  if (!info._cuesVideo) info._cuesVideo = cuesDoVideo(info);
  for (const c of info._cuesVideo) {
    if (c.ticks <= ticks) melhor = c;
    else break;
  }
  return melhor ? melhor.posicao : info.primeiroCluster;
}

// ------------------------------------------------------------------ blocos

/**
 * Abre um Block/SimpleBlock: número da faixa, timestamp relativo, flags e os
 * quadros (um só, ou vários quando há "lacing" — áudio costuma vir laçado).
 */
function abrirBloco(b, ini, fim) {
  let p = ini;
  // número da faixa é um vint SEM marca; quase sempre 1 byte (0x81 = faixa 1)
  let primeiro = b[p];
  let nBytes = 1;
  let mascara = 0x80;
  while (!(primeiro & mascara) && nBytes < 8) {
    mascara >>= 1;
    nBytes++;
  }
  let faixa = primeiro & (mascara - 1);
  for (let i = 1; i < nBytes; i++) faixa = faixa * 256 + b[p + i];
  p += nBytes;

  const relTicks = lerInt(b, p, 2);
  p += 2;
  const flags = b[p++];
  const chave = !!(flags & 0x80);
  const lacing = (flags & 0x06) >> 1;

  const quadros = [];
  if (!lacing) {
    quadros.push(b.subarray(p, fim));
  } else {
    const n = b[p++] + 1;
    const tamanhos = [];
    if (lacing === 1) {
      // Xiph: cada tamanho é uma soma de bytes 255 terminada por um < 255
      for (let i = 0; i < n - 1; i++) {
        let t = 0;
        let v;
        do {
          v = b[p++];
          t += v;
        } while (v === 255);
        tamanhos.push(t);
      }
    } else if (lacing === 3) {
      // EBML: o primeiro tamanho é um vint; os seguintes são diferenças assinadas
      const lerVintSemMarca = () => {
        let pri = b[p];
        let nb = 1;
        let m = 0x80;
        while (!(pri & m) && nb < 8) {
          m >>= 1;
          nb++;
        }
        let v = pri & (m - 1);
        for (let i = 1; i < nb; i++) v = v * 256 + b[p + i];
        p += nb;
        return { v, nb };
      };
      const { v: primeiroTam } = lerVintSemMarca();
      tamanhos.push(primeiroTam);
      for (let i = 1; i < n - 1; i++) {
        const { v, nb } = lerVintSemMarca();
        const delta = v - (2 ** (7 * nb - 1) - 1);
        tamanhos.push(tamanhos[i - 1] + delta);
      }
    } else {
      // fixo: n pedaços iguais
      const cada = (fim - p) / n;
      for (let i = 0; i < n - 1; i++) tamanhos.push(cada);
    }
    const usado = tamanhos.reduce((s, t) => s + t, 0);
    tamanhos.push(fim - p - usado);
    for (const t of tamanhos) {
      quadros.push(b.subarray(p, p + t));
      p += t;
    }
  }
  return { faixa, relTicks, chave, quadros };
}

/**
 * Percorre Clusters a partir de `posicao` (absoluta, um Cluster) e chama
 * `entregar({ faixa, tempoMs, chave, dados, duracaoMs })` por quadro das
 * faixas em `querer` (Set de números). Para quando `entregar` devolve false,
 * no fim do arquivo, ou em `ateMs`.
 *
 * Quadros de blocos laçados recebem tempo = bloco + i × duração do quadro da
 * faixa (DefaultDuration); sem ela, ficam todos com o tempo do bloco — e o
 * consumidor espaça pelo codec.
 */
export async function lerBlocos(fonte, info, posicao, querer, entregar, { ateMs = Infinity, sinal } = {}) {
  const janela = criarJanela(fonte, 4 << 20);
  const porNumero = new Map(info.faixas.map((f) => [f.numero, f]));
  const msPorTick = info.escalaNs / 1e6;
  const fim = fonte.tamanho != null ? fonte.tamanho : Infinity;

  let pos = posicao;
  while (true) {
    if (sinal && sinal.aborted) return { fim: false, pos };
    if (pos >= fim) return { fim: true, pos }; // chegou ao fim DE VERDADE
    const cl = await janela.elemento(pos);
    if (!cl) return { fim: pos >= fim - 16, pos }; // lixo no rabo do arquivo conta como fim
    if (cl.id !== ID.Cluster) {
      // Cues, Tags, Attachments... no meio ou no fim: pula
      if (cl.tamanho === TAMANHO_DESCONHECIDO) return { fim: true, pos };
      pos = cl.dados + cl.tamanho;
      continue;
    }

    const fimCluster = cl.tamanho === TAMANHO_DESCONHECIDO ? Infinity : cl.dados + cl.tamanho;
    let baseTicks = 0;
    let p = cl.dados;
    while (p < fimCluster) {
      if (sinal && sinal.aborted) return { fim: false, pos: p };
      const el = await janela.elemento(p);
      if (!el) return { fim: p >= fim - 16, pos: p };
      // Cluster de tamanho desconhecido termina quando aparece o próximo
      if (el.id === ID.Cluster || el.id === ID.Cues || el.id === ID.Tags || el.id === ID.Attachments) break;
      if (el.tamanho === TAMANHO_DESCONHECIDO) return { fim: true, pos: p };
      const proximo = el.dados + el.tamanho;

      if (el.id === ID.Timestamp) {
        const b = await janela.bytes(el.dados, el.tamanho);
        baseTicks = lerUint(b, 0, el.tamanho);
      } else if (el.id === ID.SimpleBlock || el.id === ID.BlockGroup) {
        const b = await janela.bytes(el.dados, el.tamanho);
        if (!b) return { fim: true, pos: p };
        let bloco;
        let duracaoTicks = null;
        if (el.id === ID.SimpleBlock) {
          bloco = abrirBloco(b, 0, b.length);
        } else {
          paraCadaFilho(b, 0, b.length, (id, bb, pp, t) => {
            if (id === ID.Block) bloco = abrirBloco(bb, pp, pp + t);
            if (id === ID.BlockDuration) duracaoTicks = lerUint(bb, pp, t);
          });
          // Block (sem ser SimpleBlock) não tem flag de keyframe: é keyframe
          // quando não há ReferenceBlock — que só aparece em quadro que referencia
          if (bloco) {
            let temRef = false;
            paraCadaFilho(b, 0, b.length, (id) => { if (id === 0xfb) temRef = true; });
            bloco.chave = !temRef;
          }
        }
        if (bloco && querer.has(bloco.faixa)) {
          const faixa = porNumero.get(bloco.faixa);
          const tempoBloco = (baseTicks + bloco.relTicks) * msPorTick;
          if (tempoBloco > ateMs) return { fim: false, pos: p };
          const passoMs = faixa && faixa.duracaoQuadroNs ? faixa.duracaoQuadroNs / 1e6 : 0;
          const n = bloco.quadros.length;
          for (let i = 0; i < n; i++) {
            let dados = bloco.quadros[i];
            if (faixa && faixa.cabecalhoRemovido) {
              const junto = new Uint8Array(faixa.cabecalhoRemovido.length + dados.length);
              junto.set(faixa.cabecalhoRemovido, 0);
              junto.set(dados, faixa.cabecalhoRemovido.length);
              dados = junto;
            } else {
              dados = dados.slice(); // desprende do buffer da janela, que vai embora
            }
            const duracaoMs =
              duracaoTicks != null && n === 1 ? duracaoTicks * msPorTick : passoMs || null;
            const segue = await entregar({
              faixa: bloco.faixa,
              tempoMs: tempoBloco + i * passoMs,
              chave: bloco.chave,
              dados,
              duracaoMs,
            });
            if (segue === false) return { fim: false, pos: p };
          }
        }
      }
      p = proximo;
    }
    pos = fimCluster === Infinity ? p : fimCluster;
  }
}
