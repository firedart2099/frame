/**
 * Escritor de MP4 fragmentado (fMP4) — só o que o MediaSource precisa.
 *
 * Um "segmento de inicialização" por faixa (`ftyp` + `moov` com uma `trak`
 * só) e depois fragmentos (`moof` + `mdat`) com os quadros. Cada SourceBuffer
 * recebe a sua faixa; vídeo e áudio nunca se misturam no mesmo arquivo — é
 * mais simples e deixa trocar o áudio sem tocar no vídeo.
 *
 * Tempos em MICROSSEGUNDOS (timescale 1 000 000, `tfdt` de 64 bits). Não há
 * `stts`/`stsz` no `moov` porque em fMP4 a tabela de amostras vai em cada
 * `trun`; e não há duração no `mvhd` porque quem sabe a duração é o
 * `MediaSource.duration`.
 *
 * Referência: ISO/IEC 14496-12 (caixas), 14496-15 (avcC/hvcC), 14496-14 (esds
 * do AAC) e o "Opus in ISOBMFF" (dOps).
 */

export const TIMESCALE = 1000000;

// ------------------------------------------------------------- utilidades

const enc = new TextEncoder();

function caixa(tipo, ...partes) {
  const corpo = concat(partes);
  const out = new Uint8Array(8 + corpo.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(enc.encode(tipo), 4);
  out.set(corpo, 8);
  return out;
}

/** Caixa "cheia": versão + flags antes do conteúdo. */
function caixaCheia(tipo, versao, flags, ...partes) {
  return caixa(tipo, u8(versao), u24(flags), ...partes);
}

function concat(partes) {
  const planas = partes.flat(Infinity).filter(Boolean);
  const total = planas.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of planas) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

const u8 = (v) => new Uint8Array([v & 0xff]);
const u16 = (v) => new Uint8Array([(v >> 8) & 0xff, v & 0xff]);
const u24 = (v) => new Uint8Array([(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
const u32 = (v) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v >>> 0);
  return b;
};
const i32 = (v) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, v | 0);
  return b;
};
const u64 = (v) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(Math.max(0, Math.round(v))));
  return b;
};
const zeros = (n) => new Uint8Array(n);
const texto = (s) => enc.encode(s);
const fixo1616 = (v) => u32(Math.round(v * 65536));

// --------------------------------------------------------- inicialização

function ftyp() {
  return caixa('ftyp', texto('isom'), u32(0x200), texto('isom'), texto('iso6'), texto('avc1'), texto('mp41'));
}

function mvhd() {
  return caixaCheia(
    'mvhd', 0, 0,
    u32(0), u32(0), // criação, modificação
    u32(TIMESCALE), u32(0), // timescale, duração (desconhecida)
    u32(0x00010000), u16(0x0100), zeros(10), // taxa, volume, reservado
    matrizIdentidade(),
    zeros(24), // pre_defined
    u32(0xffffffff) // next_track_ID
  );
}

function matrizIdentidade() {
  return concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);
}

function tkhd(id, largura, altura, ehAudio) {
  return caixaCheia(
    'tkhd', 0, 0x000007, // enabled | in_movie | in_preview
    u32(0), u32(0), u32(id), u32(0), u32(0), // datas, id, reservado, duração
    zeros(8), u16(0), u16(0), // reservado, layer, alternate_group
    u16(ehAudio ? 0x0100 : 0), u16(0), // volume, reservado
    matrizIdentidade(),
    fixo1616(largura || 0), fixo1616(altura || 0)
  );
}

function mdhd() {
  // idioma 'und' empacotado (3 letras de 5 bits): u-n-d = 0x55C4
  return caixaCheia('mdhd', 0, 0, u32(0), u32(0), u32(TIMESCALE), u32(0), u16(0x55c4), u16(0));
}

function hdlr(ehAudio) {
  return caixaCheia('hdlr', 0, 0, u32(0), texto(ehAudio ? 'soun' : 'vide'), zeros(12), texto(ehAudio ? 'SoundHandler' : 'VideoHandler'), u8(0));
}

function dinf() {
  return caixa('dinf', caixaCheia('dref', 0, 0, u32(1), caixaCheia('url ', 0, 1)));
}

function stblVazio(entradaStsd) {
  return caixa(
    'stbl',
    caixaCheia('stsd', 0, 0, u32(1), entradaStsd),
    caixaCheia('stts', 0, 0, u32(0)),
    caixaCheia('stsc', 0, 0, u32(0)),
    caixaCheia('stsz', 0, 0, u32(0), u32(0)),
    caixaCheia('stco', 0, 0, u32(0))
  );
}

/** Entrada `avc1`/`hvc1`: a caixa avcC/hvcC é o CodecPrivate do Matroska, sem mexer. */
function entradaVideo(tipo, largura, altura, privado) {
  const caixaCodec = tipo === 'hvc1' ? 'hvcC' : 'avcC';
  return caixa(
    tipo,
    zeros(6), u16(1), // reservado, data_reference_index
    u16(0), u16(0), zeros(12), // pre_defined, reservado, pre_defined
    u16(largura), u16(altura),
    u32(0x00480000), u32(0x00480000), // resolução 72 dpi
    u32(0), u16(1), // reservado, frame_count
    zeros(32), // compressorname
    u16(0x0018), u16(0xffff), // depth, pre_defined
    caixa(caixaCodec, privado)
  );
}

/** Descritores do esds (ISO 14496-1): tag, tamanho, conteúdo. */
function descritor(tag, ...partes) {
  const corpo = concat(partes);
  // tamanho em até 4 bytes de 7 bits, com bit de continuação
  const tam = [];
  let n = corpo.length;
  do {
    tam.unshift(n & 0x7f);
    n >>= 7;
  } while (n > 0);
  for (let i = 0; i < tam.length - 1; i++) tam[i] |= 0x80;
  return concat([u8(tag), new Uint8Array(tam), corpo]);
}

/** Entrada `mp4a` + esds com o AudioSpecificConfig (CodecPrivate do A_AAC). */
function entradaAac(taxa, canais, asc) {
  const esds = caixaCheia(
    'esds', 0, 0,
    descritor(
      0x03, // ES_Descriptor
      u16(0), u8(0), // ES_ID, flags
      descritor(
        0x04, // DecoderConfigDescriptor
        u8(0x40), u8(0x15), // MPEG-4 Audio, stream type audio
        u24(0), u32(0), u32(0), // bufferSizeDB, maxBitrate, avgBitrate
        descritor(0x05, asc) // DecoderSpecificInfo
      ),
      descritor(0x06, u8(0x02)) // SLConfigDescriptor
    )
  );
  return caixa(
    'mp4a',
    zeros(6), u16(1),
    zeros(8), // version, revision, vendor
    u16(canais), u16(16), u16(0), u16(0),
    u32(taxa << 16),
    esds
  );
}

/**
 * Entrada `Opus` + dOps. O `cabecalho` é o OpusHead que o AudioEncoder entrega
 * em `decoderConfig.description` (little-endian); a dOps é a mesma coisa em
 * big-endian e sem o "OpusHead".
 */
function entradaOpus(taxa, canais, cabecalho) {
  const dv = cabecalho && cabecalho.length >= 19 ? new DataView(cabecalho.buffer, cabecalho.byteOffset) : null;
  const preSkip = dv ? dv.getUint16(10, true) : 312;
  const taxaEntrada = dv ? dv.getUint32(12, true) : taxa;
  const ganho = dv ? dv.getInt16(16, true) : 0;
  const familia = dv ? cabecalho[18] : 0;
  const dOps = caixa('dOps', u8(0), u8(canais), u16(preSkip), u32(taxaEntrada), u16(ganho & 0xffff), u8(familia));
  return caixa('Opus', zeros(6), u16(1), zeros(8), u16(canais), u16(16), u16(0), u16(0), u32(taxa << 16), dOps);
}

function trak(id, ehAudio, largura, altura, entrada) {
  return caixa(
    'trak',
    tkhd(id, largura, altura, ehAudio),
    caixa(
      'mdia',
      mdhd(),
      hdlr(ehAudio),
      caixa('minf', ehAudio ? caixaCheia('smhd', 0, 0, u16(0), u16(0)) : caixaCheia('vmhd', 0, 1, u16(0), zeros(6)), dinf(), stblVazio(entrada))
    )
  );
}

function mvex(id) {
  return caixa('mvex', caixaCheia('trex', 0, 0, u32(id), u32(1), u32(0), u32(0), u32(0)));
}

/**
 * Segmento de inicialização de uma faixa de vídeo.
 * `codec`: 'avc1' | 'hvc1'; `privado`: avcC/hvcC (CodecPrivate).
 */
export function inicioVideo({ id = 1, codec = 'avc1', largura, altura, privado }) {
  return concat([ftyp(), caixa('moov', mvhd(), trak(id, false, largura, altura, entradaVideo(codec, largura, altura, privado)), mvex(id))]);
}

/**
 * Segmento de inicialização de uma faixa de áudio.
 * `codec`: 'aac' (com `privado` = AudioSpecificConfig) | 'opus' (com `privado` = OpusHead).
 */
export function inicioAudio({ id = 2, codec, taxa, canais, privado }) {
  const entrada = codec === 'opus' ? entradaOpus(taxa, canais, privado) : entradaAac(taxa, canais, privado);
  return concat([ftyp(), caixa('moov', mvhd(), trak(id, true, 0, 0, entrada), mvex(id))]);
}

// -------------------------------------------------------------- fragmento

/**
 * Um fragmento `moof` + `mdat` com as amostras dadas, na ordem de
 * decodificação. Cada amostra: `{ dts, pts, duracao, dados, chave }` (µs).
 */
export function fragmento({ id, sequencia, amostras }) {
  if (!amostras.length) return null;
  const flagsTrun = 0x000001 | 0x000100 | 0x000200 | 0x000400 | 0x000800; // offset, dur, size, flags, cts
  const linhas = amostras.map((a) =>
    concat([
      u32(Math.max(1, Math.round(a.duracao))),
      u32(a.dados.length),
      u32(a.chave ? 0x02000000 : 0x01010000), // depends_on=2 / depends_on=1 + non-sync
      i32(Math.round(a.pts - a.dts)),
    ])
  );
  // o data_offset aponta pro início do mdat; só dá pra preencher depois de
  // saber o tamanho do moof — então monta duas vezes, a segunda com o valor
  const montar = (offset) =>
    caixa(
      'moof',
      caixaCheia('mfhd', 0, 0, u32(sequencia)),
      caixa(
        'traf',
        caixaCheia('tfhd', 0, 0x020000, u32(id)), // default-base-is-moof
        caixaCheia('tfdt', 1, 0, u64(amostras[0].dts)),
        caixaCheia('trun', 0, flagsTrun, u32(amostras.length), i32(offset), ...linhas)
      )
    );
  const moof = montar(montar(0).length + 8);
  const mdat = caixa('mdat', amostras.map((a) => a.dados));
  return concat([moof, mdat]);
}
