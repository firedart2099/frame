/**
 * Sondagem de um .mkv pelo cabeçalho — sem tocar nada.
 *
 * A sondagem de sempre (`probe.js`) toca o arquivo num `<video>` escondido e
 * olha contadores de bytes decodificados. Num .mkv de 21 GB isso leva o prazo
 * inteiro e ainda responde errado: o primeiro áudio é AC3, o contador fica em
 * zero, e o release dublado é reprovado — justamente o que o motor toca.
 *
 * Com a extensão dá pra fazer o certo: ler ~2 MB do começo (Tracks) e saber,
 * em um segundo, o codec do vídeo, cada faixa de áudio e se este navegador
 * toca alguma delas — direto ou por transcodificação. `motivo` segue o
 * vocabulário do probe.js ('video que este navegador nao decodifica' etc.)
 * porque o player agrupa as falhas por essas frases.
 */

import { abrir } from './matroska.js';
import { criarFonteHttp } from './fonteHttp.js';
import { codecAvc, codecHevc } from './h264.js';
import { suportaDolbyViaOpus, CODECS_DOLBY } from './audioDolby.js';
import { idiomaDaFaixa } from './motor.js';

export async function sondarMkv(url, { timeoutMs = 8000 } = {}) {
  const corte = new AbortController();
  const prazo = setTimeout(() => corte.abort(), timeoutMs);
  try {
    let fonte;
    try {
      fonte = await criarFonteHttp(url, { sinal: corte.signal });
    } catch (e) {
      // 503 do AllDebrid = conexão anterior ainda aberta; um segundo resolve
      if (corte.signal.aborted) throw e;
      await new Promise((r) => setTimeout(r, 1500));
      fonte = await criarFonteHttp(url, { sinal: corte.signal });
    }
    const info = await abrir(fonte);

    const video = info.faixas.find((f) => f.tipo === 'video');
    if (!video) return { toca: false, motivo: 'arquivo nao abre' };
    const mimeVideo =
      video.codec === 'V_MPEG4/ISO/AVC'
        ? `video/mp4; codecs="${codecAvc(video.codecPrivate)}"`
        : video.codec === 'V_MPEGH/ISO/HEVC'
        ? `video/mp4; codecs="${codecHevc(video.codecPrivate)}"`
        : null;
    if (!mimeVideo || !MediaSource.isTypeSupported(mimeVideo)) {
      return { toca: false, motivo: 'video que este navegador nao decodifica' };
    }

    const dolbyOk = suportaDolbyViaOpus();
    const audios = info.faixas
      .filter((f) => f.tipo === 'audio')
      .map((f) => ({
        numero: f.numero,
        idioma: idiomaDaFaixa(f),
        codec: f.codec.replace(/^A_/, ''),
        canais: f.canais,
        toca:
          (f.codec === 'A_AAC' && !!f.codecPrivate) ||
          f.codec === 'A_OPUS' ||
          (CODECS_DOLBY.has(f.codec) && dolbyOk),
      }));
    if (!audios.some((a) => a.toca)) return { toca: false, motivo: 'audio que este navegador nao decodifica', audios };

    // Aqui o tamanho é o exato (Content-Range) e a duração é a do arquivo:
    // o bitrate sai certo mesmo quando o nome do release não diz o tamanho
    // (sites brasileiros). "1080p" de 1,8 Mbps é 720p com outro nome.
    const duracaoS = info.duracaoMs / 1000;
    const mbps = fonte.tamanho && duracaoS > 60 ? (fonte.tamanho * 8) / duracaoS / 1e6 : null;
    const magro = mbps != null && video.largura >= 1800 && mbps < 2.5;

    return {
      toca: true,
      motivo: null,
      duracao: duracaoS,
      mbps,
      magro,
      video: { codec: video.codec, largura: video.largura, altura: video.altura },
      audios,
      idiomas: [...new Set(audios.filter((a) => a.toca).map((a) => a.idioma))],
    };
  } catch (e) {
    return { toca: false, motivo: corte.signal.aborted ? 'nao comecou a tocar' : 'arquivo nao abre' };
  } finally {
    clearTimeout(prazo);
  }
}
