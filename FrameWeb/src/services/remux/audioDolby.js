/**
 * Faz o Chrome tocar AC3, E-AC3 e DTS.
 *
 * O Chrome não licencia Dolby nem DTS: não há decodificador em caminho
 * nenhum — nem `<audio>`, nem MediaSource, nem WebCodecs. E é o que a maior
 * parte dos releases DUAL brasileiros traz ("DUAL 5.1" quase sempre é AC3).
 *
 * O caminho, então, é por fora: decodificar em WASM (`@audio/decode-eac3`,
 * que é o `ac3dec` do FFmpeg; `@audio/decode-dts`, o libdcadec) pra PCM,
 * misturar pra estéreo, e RECODIFICAR em Opus com o `AudioEncoder` nativo —
 * que vai pro MediaSource como qualquer faixa. O ganho de fazer assim, em vez
 * de tocar o PCM por Web Audio: o som fica no MESMO relógio do vídeo. Pausa,
 * seek, velocidade e sincronia vêm de graça, sem relógio de 1 s corrigindo
 * deriva — que era o que engasgava na versão anterior.
 *
 * Custo medido (Node, WASM): AC3 e E-AC3 a ~200× tempo real, DTS a ~60×. O
 * Opus a 128 kb/s é transparente pra fala e trilha.
 */

const TAXA_OPUS = 48000;
const BITRATE = 128000;

/** O navegador tem o que este caminho precisa? */
export function suportaDolbyViaOpus() {
  return (
    typeof AudioEncoder !== 'undefined' &&
    typeof MediaSource !== 'undefined' &&
    MediaSource.isTypeSupported('audio/mp4; codecs="opus"')
  );
}

export const CODECS_DOLBY = new Set(['A_AC3', 'A_EAC3', 'A_DTS']);

async function carregarDecoder(codec) {
  if (codec === 'A_DTS') {
    const m = await import('@audio/decode-dts');
    return m.decoder();
  }
  const m = await import('@audio/decode-eac3'); // AC3 e E-AC3
  return m.decoder();
}

/**
 * Mistura pra estéreo. Canais em ordem WAV: FL FR FC LFE BL BR [SL SR].
 * Centro e surrounds entram com -3 dB / -6 dB; o LFE fica de fora (é
 * subwoofer, e num fone só faz "bum"). Depois um limitador macio pra não
 * estourar quando tudo toca junto.
 */
function paraEstereo(canais) {
  const n = canais[0].length;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const [fl, fr, fc, , bl, br, sl, sr] = canais;
  const c = canais.length;
  for (let i = 0; i < n; i++) {
    let l = fl[i];
    let r = c > 1 ? fr[i] : fl[i];
    if (c >= 3 && fc) {
      l += 0.707 * fc[i];
      r += 0.707 * fc[i];
    }
    if (c >= 6) {
      l += 0.5 * bl[i];
      r += 0.5 * br[i];
    }
    if (c >= 8) {
      l += 0.5 * sl[i];
      r += 0.5 * sr[i];
    }
    // limitador: linear até 0,8, comprime suave acima
    L[i] = l > 0.8 || l < -0.8 ? Math.tanh(l) : l;
    R[i] = r > 0.8 || r < -0.8 ? Math.tanh(r) : r;
  }
  return [L, R];
}

/** Reamostragem linear (só se a faixa não for 48 kHz, o que em filme é raro). */
function reamostrar(canal, de, para) {
  if (de === para) return canal;
  const n = Math.round((canal.length * para) / de);
  const out = new Float32Array(n);
  const passo = de / para;
  for (let i = 0; i < n; i++) {
    const p = i * passo;
    const j = Math.floor(p);
    const f = p - j;
    out[i] = canal[j] * (1 - f) + (canal[Math.min(j + 1, canal.length - 1)] || 0) * f;
  }
  return out;
}

/**
 * Cria o transcodificador de uma faixa.
 *
 * `aoChunk(chunk, descricao)`: recebe cada `EncodedAudioChunk` Opus (timestamp
 * e duração em µs) e, junto com o primeiro, a `description` (OpusHead) pra
 * montar a `dOps`. `aoErro(e)` se o encoder morrer.
 */
export async function criarTranscodificadorDolby(faixa, { aoChunk, aoErro }) {
  const dec = await carregarDecoder(faixa.codec);
  let descricao = null;
  let fechado = false;

  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      if (fechado) return;
      if (meta && meta.decoderConfig && meta.decoderConfig.description && !descricao) {
        descricao = new Uint8Array(meta.decoderConfig.description);
      }
      aoChunk(chunk, descricao);
    },
    error: (e) => {
      if (aoErro) aoErro(e);
    },
  });
  enc.configure({ codec: 'opus', sampleRate: TAXA_OPUS, numberOfChannels: 2, bitrate: BITRATE });

  // O encoder recebe PCM contínuo com timestamps contínuos: o relógio é o
  // número de amostras desde o primeiro frame, não o tempo de cada bloco do
  // .mkv (que pode ter jitter de arredondamento).
  let inicioUs = null;
  let amostrasDesdeInicio = 0;

  return {
    /** Um frame AC3/E-AC3/DTS cru, com o tempo do bloco em µs. */
    empurrar(dados, tempoUs) {
      if (fechado) return;
      const r = dec.decode(dados);
      if (!r.channelData.length || !r.channelData[0].length) return;
      if (inicioUs === null) inicioUs = tempoUs;
      let [L, R] = paraEstereo(r.channelData);
      if (r.sampleRate !== TAXA_OPUS) {
        L = reamostrar(L, r.sampleRate, TAXA_OPUS);
        R = reamostrar(R, r.sampleRate, TAXA_OPUS);
      }
      const n = L.length;
      const plano = new Float32Array(n * 2);
      plano.set(L, 0);
      plano.set(R, n);
      const ad = new AudioData({
        format: 'f32-planar',
        sampleRate: TAXA_OPUS,
        numberOfFrames: n,
        numberOfChannels: 2,
        timestamp: inicioUs + Math.round((amostrasDesdeInicio / TAXA_OPUS) * 1e6),
        data: plano,
      });
      amostrasDesdeInicio += n;
      try {
        enc.encode(ad);
      } finally {
        ad.close();
      }
    },

    async esvaziar() {
      if (fechado) return;
      try {
        await enc.flush();
      } catch (e) {
        /* já fechado */
      }
    },

    fechar() {
      if (fechado) return;
      fechado = true;
      try {
        enc.close();
      } catch (e) {
        /* já fechado */
      }
      dec.free();
    },
  };
}
