/**
 * O motor: um .mkv entrando por HTTP, vídeo e UMA faixa de áudio saindo pro
 * MediaSource. É o que faz um release DUAL tocar dublado no navegador — e
 * trocar de idioma sem trocar de arquivo.
 *
 *   fonteHttp ──► matroska (blocos) ──┬─► vídeo: h264 (DTS) ──► fmp4 ──► SourceBuffer
 *                                      └─► áudio: AAC direto / Dolby→Opus ──► fmp4 ──► SourceBuffer
 *
 * Regras que vieram de medir arquivos reais, não de teoria:
 *
 *  - Depois de qualquer seek (e no início), o vídeo é descartado até o
 *    primeiro keyframe. O release do Apache começa com 1,4 s de quadros P
 *    sem IDR — lixo de corte que o Chrome recusaria em bloco.
 *  - O áudio espera o reordenador medir o atraso dos B-frames, porque o mesmo
 *    deslocamento vai nos dois. Antes disso fica numa fila.
 *  - Nada de segurar o vídeo por causa do áudio: os dois estão no mesmo
 *    MediaSource, com o mesmo relógio. Se o áudio atrasa, o buffer do vídeo
 *    espera sozinho — é o comportamento normal de qualquer player.
 *  - Contrapressão: o demuxer para quando há mais de ~60 s à frente e volta
 *    com menos de ~30 s. Sem isso ele baixaria o filme inteiro pra RAM.
 *  - Seek sempre reinicia a leitura no Cluster do keyframe anterior. O que já
 *    estava no buffer fica; o que chega por cima substitui.
 */

import { abrir, lerBlocos, clusterPara } from './matroska.js';
import { criarFonteHttp } from './fonteHttp.js';
import { codecAvc, codecHevc, criarReordenador } from './h264.js';
import { inicioVideo, inicioAudio, fragmento } from './fmp4.js';
import { criarTranscodificadorDolby, suportaDolbyViaOpus, CODECS_DOLBY } from './audioDolby.js';

const FRAGMENTO_US = 500000; // meio segundo por moof
const FRENTE_MAX_S = 60; // para de ler com isto à frente
const FRENTE_MIN_S = 30; // volta a ler com isto
const ATRAS_S = 45; // mantém isto atrás pra voltar sem baixar de novo

/** 'por', 'pt-BR', 'Portuguese', "POR 5.1", "Dublado" -> 'pt'. */
export function idiomaDaFaixa(f) {
  const t = `${f.idioma || ''} ${f.nome || ''}`.toLowerCase();
  if (/\b(por|pt|pt-br|portugu|dublad|brazil|brasil)\b|portugu|dublad/.test(t)) return 'pt';
  if (/\b(eng|en|en-us|english|ingl[eê]s)\b|english/.test(t)) return 'en';
  if (/\b(jpn|ja|japan)\b/.test(t)) return 'ja';
  if (/\b(spa|es|espa)\b/.test(t)) return 'es';
  if (/\b(fre|fra|fr)\b/.test(t)) return 'fr';
  const iso = (f.idioma || '').toLowerCase().split('-')[0];
  return iso && iso !== 'und' ? iso : 'und';
}

function codecVideoDe(f) {
  if (f.codec === 'V_MPEG4/ISO/AVC') return { caixa: 'avc1', mime: `video/mp4; codecs="${codecAvc(f.codecPrivate)}"` };
  if (f.codec === 'V_MPEGH/ISO/HEVC') return { caixa: 'hvc1', mime: `video/mp4; codecs="${codecHevc(f.codecPrivate)}"` };
  return null;
}

function codecAudioDe(f) {
  if (f.codec === 'A_AAC' && f.codecPrivate) {
    const tipo = f.codecPrivate[0] >> 3;
    return { modo: 'aac', mime: `audio/mp4; codecs="mp4a.40.${tipo || 2}"` };
  }
  if (f.codec === 'A_OPUS' && f.codecPrivate) return { modo: 'opus', mime: 'audio/mp4; codecs="opus"' };
  if (CODECS_DOLBY.has(f.codec)) return { modo: 'dolby', mime: 'audio/mp4; codecs="opus"' };
  return null;
}

/**
 * Abre `url` (um .mkv legível por CORS) no elemento `video`.
 *
 * Opções:
 *   escolherAudio(faixas) -> número da faixa inicial (padrão: pt > padrão do arquivo > primeira)
 *   aoEstado(texto)       -> 'abrindo' | 'tocando' | 'buferizando' | 'fim'
 *   aoErro(erro)
 *
 * Devolve `{ faixasAudio, audioAtivo, trocarAudio(n), destruir(), info }`.
 * `faixasAudio` já vem com `idioma` normalizado e `toca` (false = codec que
 * este navegador não consegue nem por transcodificação).
 */
export async function abrirMotor(video, url, { escolherAudio, aoEstado, aoErro } = {}) {
  const estado = (s) => aoEstado && aoEstado(s);
  estado('abrindo');

  const fonte = await criarFonteHttp(url);
  const info = await abrir(fonte);

  const faixaVideo = info.faixas.find((f) => f.tipo === 'video');
  if (!faixaVideo) throw new Error('arquivo sem vídeo');
  const cv = codecVideoDe(faixaVideo);
  if (!cv || !MediaSource.isTypeSupported(cv.mime)) {
    throw new Error(`vídeo ${faixaVideo.codec} não toca neste navegador`);
  }

  const dolbyOk = suportaDolbyViaOpus();
  const faixasAudio = info.faixas
    .filter((f) => f.tipo === 'audio')
    .map((f) => {
      const ca = codecAudioDe(f);
      const toca = !!ca && MediaSource.isTypeSupported(ca.mime) && (ca.modo !== 'dolby' || dolbyOk) && !f.compressaoDesconhecida;
      return { ...f, idioma: idiomaDaFaixa(f), codecCurto: f.codec.replace(/^A_/, ''), toca, _ca: ca };
    });
  if (!faixasAudio.some((f) => f.toca)) throw new Error('nenhuma faixa de áudio toca neste navegador');

  const padrao = (faixas) => {
    const ok = faixas.filter((f) => f.toca);
    return (ok.find((f) => f.idioma === 'pt') || ok.find((f) => f.padrao) || ok[0]).numero;
  };
  let audioAtivo = (escolherAudio && escolherAudio(faixasAudio)) || padrao(faixasAudio);
  if (!faixasAudio.find((f) => f.numero === audioAtivo && f.toca)) audioAtivo = padrao(faixasAudio);

  // ------------------------------------------------------------ MediaSource
  const ms = new MediaSource();
  const objUrl = URL.createObjectURL(ms);
  await new Promise((res, rej) => {
    ms.addEventListener('sourceopen', res, { once: true });
    video.addEventListener('error', () => rej(new Error('o <video> recusou o MediaSource')), { once: true });
    video.src = objUrl;
  });
  if (info.duracaoMs) ms.duration = info.duracaoMs / 1000;

  const sbV = ms.addSourceBuffer(cv.mime);
  sbV.mode = 'segments';
  let sbA = null;
  let mimeAudio = null;

  const initV = inicioVideo({ id: 1, codec: cv.caixa, largura: faixaVideo.largura, altura: faixaVideo.altura, privado: faixaVideo.codecPrivate });

  /** Fila de appends por SourceBuffer — só um appendBuffer por vez. */
  function criarFila(sb) {
    const fila = [];
    let travada = false;
    const bombear = () => {
      if (travada || sb.updating || !fila.length || ms.readyState !== 'open') return;
      const op = fila.shift();
      try {
        if (op.remover) sb.remove(op.remover[0], op.remover[1]);
        else sb.appendBuffer(op.dados);
      } catch (e) {
        if (e.name === 'QuotaExceededError') {
          // sem espaço: joga fora o que ficou pra trás e tenta de novo
          fila.unshift(op);
          const t = video.currentTime;
          if (sb.buffered.length && sb.buffered.start(0) < t - 10) fila.unshift({ remover: [0, t - 10] });
          else travada = true; // nem atrás tem o que soltar: espera o tempo andar
          setTimeout(() => { travada = false; bombear(); }, 1000);
          return;
        }
        if (aoErro) aoErro(e);
      }
    };
    sb.addEventListener('updateend', bombear);
    sb.addEventListener('error', (e) => aoErro && aoErro(new Error('SourceBuffer recusou um segmento')));
    return {
      anexar(dados) { fila.push({ dados }); bombear(); },
      remover(a, b) { fila.push({ remover: [a, b] }); bombear(); },
      abortar() { fila.length = 0; if (ms.readyState === 'open') { try { sb.abort(); } catch (e) { /* ok */ } } },
      get vazia() { return !fila.length && !sb.updating; },
    };
  }
  const filaV = criarFila(sbV);
  let filaA = null;

  function prepararAudio(faixa) {
    const ca = faixa._ca;
    if (!sbA || mimeAudio !== ca.mime) {
      if (sbA) ms.removeSourceBuffer(sbA);
      sbA = ms.addSourceBuffer(ca.mime);
      sbA.mode = 'segments';
      mimeAudio = ca.mime;
      filaA = criarFila(sbA);
    }
    return ca;
  }

  // ----------------------------------------------------------- reordenação
  const reordenador = criarReordenador(faixaVideo.duracaoQuadroNs / 1000);
  let sequencia = 1;

  // --------------------------------------------------------------- leitura
  let corrida = null; // AbortController da leitura em curso
  let rodando = Promise.resolve();
  let terminou = false; // chegou ao fim do arquivo
  let tentativas = 0; // leituras que falharam seguidas (503 do AllDebrid, conexão cortada)

  const bufferadoAte = (sb) => {
    const t = video.currentTime;
    for (let i = 0; i < sb.buffered.length; i++) {
      if (sb.buffered.start(i) <= t + 0.5 && sb.buffered.end(i) >= t) return sb.buffered.end(i);
    }
    return t;
  };
  const frente = () => Math.min(bufferadoAte(sbV), sbA ? bufferadoAte(sbA) : Infinity) - video.currentTime;

  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

  async function rodar(tempoMs) {
    if (corrida) corrida.abort();
    await rodando;
    const ctrl = new AbortController();
    corrida = ctrl;
    terminou = false;

    rodando = (async () => {
      const faixaA = faixasAudio.find((f) => f.numero === audioAtivo);
      const ca = prepararAudio(faixaA);

      // reinicia os dois parsers e manda o init de novo (barato, e à prova de dúvida)
      filaV.abortar();
      filaA.abortar();
      filaV.anexar(initV);
      reordenador.limpar();

      let initAudioMandado = false;
      const mandarInitAudio = (privado) => {
        if (initAudioMandado) return;
        initAudioMandado = true;
        const taxa = ca.modo === 'dolby' ? 48000 : Math.round(faixaA.taxa || 48000);
        const canais = ca.modo === 'dolby' ? 2 : faixaA.canais || 2;
        filaA.anexar(inicioAudio({ id: 2, codec: ca.modo === 'aac' ? 'aac' : 'opus', taxa, canais, privado }));
      };
      if (ca.modo !== 'dolby') mandarInitAudio(faixaA.codecPrivate);

      let amostrasV = [];
      let amostrasA = [];
      let audioPendente = []; // antes de o reordenador medir o atraso
      let precisaChave = true;
      let descartados = 0;

      const soltarVideo = (forcar) => {
        if (!amostrasV.length) return;
        const dur = amostrasV[amostrasV.length - 1].dts - amostrasV[0].dts;
        if (!forcar && dur < FRAGMENTO_US) return;
        filaV.anexar(fragmento({ id: 1, sequencia: sequencia++, amostras: amostrasV }));
        amostrasV = [];
      };
      const soltarAudio = (forcar) => {
        if (!amostrasA.length) return;
        const dur = amostrasA[amostrasA.length - 1].dts - amostrasA[0].dts;
        if (!forcar && dur < FRAGMENTO_US) return;
        filaA.anexar(fragmento({ id: 2, sequencia: sequencia++, amostras: amostrasA }));
        amostrasA = [];
      };

      let transcod = null;
      if (ca.modo === 'dolby') {
        transcod = await criarTranscodificadorDolby(faixaA, {
          aoChunk: (chunk, descricao) => {
            if (ctrl.signal.aborted) return;
            mandarInitAudio(descricao);
            const dados = new Uint8Array(chunk.byteLength);
            chunk.copyTo(dados);
            amostrasA.push({ dts: chunk.timestamp, pts: chunk.timestamp, duracao: chunk.duration || 20000, dados, chave: true });
            soltarAudio(false);
          },
          aoErro: (e) => aoErro && aoErro(e),
        });
      }

      const entregarAudio = (q) => {
        const tempoUs = q.tempoMs * 1000 + reordenador.atrasoUs;
        if (ca.modo === 'dolby') {
          transcod.empurrar(q.dados, tempoUs);
        } else {
          const duracao = q.duracaoMs ? q.duracaoMs * 1000 : ca.modo === 'aac' ? (1024 / (faixaA.taxa || 48000)) * 1e6 : 20000;
          amostrasA.push({ dts: tempoUs, pts: tempoUs, duracao, dados: q.dados, chave: true });
          soltarAudio(false);
        }
      };

      const querer = new Set([faixaVideo.numero, faixaA.numero]);
      const inicio = clusterPara(info, tempoMs);
      if (typeof console !== 'undefined' && reordenador.pronto) {
        console.info('[frame][motor] lendo de', (tempoMs / 1000).toFixed(1), 's; atraso', reordenador.atrasoQuadros, 'quadros; grampeados', reordenador.grampeados);
      }
      let resultado = null;

      try {
        resultado = await lerBlocos(
          fonte,
          info,
          inicio,
          querer,
          async (q) => {
            if (ctrl.signal.aborted) return false;

            if (q.faixa === faixaVideo.numero) {
              if (precisaChave) {
                if (!q.chave) { descartados++; return true; }
                precisaChave = false;
              }
              const prontos = reordenador.empurrar({ tempoUs: q.tempoMs * 1000, chave: q.chave, dados: q.dados });
              for (const p of prontos) amostrasV.push(p);
              soltarVideo(false);
              if (reordenador.pronto && audioPendente.length) {
                for (const a of audioPendente) entregarAudio(a);
                audioPendente = [];
              }
            } else {
              if (!reordenador.pronto) audioPendente.push(q);
              else entregarAudio(q);
            }

            // contrapressão: bastante à frente? espera o tempo andar
            while (!ctrl.signal.aborted && frente() > FRENTE_MAX_S && !video.paused) await dormir(500);
            while (!ctrl.signal.aborted && frente() > FRENTE_MAX_S + 30) await dormir(500); // pausado: teto maior, mas há teto
            return !ctrl.signal.aborted;
          },
          { sinal: ctrl.signal }
        );

        if (!ctrl.signal.aborted) tentativas = 0; // leu até o fim (ou até ser abortado) sem erro
        if (!ctrl.signal.aborted && resultado && resultado.fim) {
          // fim do arquivo: solta o que ficou
          for (const p of reordenador.esvaziar()) amostrasV.push(p);
          soltarVideo(true);
          if (!reordenador.pronto) for (const a of audioPendente) entregarAudio(a);
          if (transcod) await transcod.esvaziar();
          soltarAudio(true);
          terminou = true;
          // espera as filas esvaziarem e fecha o fluxo
          while (!(filaV.vazia && filaA.vazia) && ms.readyState === 'open') await dormir(100);
          if (ms.readyState === 'open' && !ctrl.signal.aborted) {
            try { ms.endOfStream(); } catch (e) { /* já fechado */ }
          }
          estado('fim');
        }
      } catch (e) {
        if (ctrl.signal.aborted) return;
        // Leitura falhou no meio (503 do AllDebrid, conexão cortada): NÃO é o
        // fim do filme. Espera um pouco e continua de onde o player está — o
        // buffer que já existe segue tocando enquanto isso. Só desiste depois
        // de várias seguidas.
        tentativas += 1;
        if (tentativas <= 6) {
          const espera = Math.min(8000, 1500 * tentativas);
          estado('buferizando');
          setTimeout(() => {
            if (corrida === ctrl && ms.readyState === 'open') rodar(video.currentTime * 1000);
          }, espera);
        } else if (aoErro) {
          aoErro(e);
        }
      } finally {
        if (transcod) transcod.fechar();
      }
    })();
    return rodando;
  }

  // ------------------------------------------------------------- eventos
  const aoSeek = () => {
    if (ms.readyState !== 'open') return;
    rodar(video.currentTime * 1000);
  };
  video.addEventListener('seeking', aoSeek);

  const aoEsperar = () => estado('buferizando');
  const aoTocar = () => estado('tocando');
  video.addEventListener('waiting', aoEsperar);
  video.addEventListener('playing', aoTocar);

  /**
   * Pula lacunas curtas. O arquivo do Apache começa com 1,4 s de quadros sem
   * keyframe: o buffer começa em 1,6 s e o player fica parado em 0 esperando
   * um dado que nunca vem. O mesmo acontece depois de um seek pra dentro de um
   * trecho sem keyframe. Se há dado bufferizado logo à frente (até 3 s), vai.
   */
  const pularLacuna = setInterval(() => {
    if (ms.readyState !== 'open' || video.readyState >= 3 || video.seeking) return;
    const t = video.currentTime;
    const b = video.buffered;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) > t && b.start(i) - t <= 6 && b.end(i) - b.start(i) > 0.5) {
        video.currentTime = b.start(i) + 0.05;
        return;
      }
    }
  }, 500);

  // limpeza do que ficou pra trás, pra não estourar a cota do MediaSource
  const faxina = setInterval(() => {
    if (ms.readyState !== 'open') return;
    const limite = video.currentTime - ATRAS_S;
    if (limite <= 0) return;
    for (const [sb, fila] of [[sbV, filaV], [sbA, filaA]]) {
      if (sb && fila && sb.buffered.length && sb.buffered.start(0) < limite - 5) fila.remover(0, limite);
    }
  }, 10000);

  rodar(0);

  return {
    info,
    faixasAudio: faixasAudio.map(({ _ca, codecPrivate, cabecalhoRemovido, ...f }) => f),
    get audioAtivo() {
      return audioAtivo;
    },
    /** Troca a faixa de áudio mantendo o vídeo e a posição. */
    async trocarAudio(numero) {
      const f = faixasAudio.find((x) => x.numero === numero);
      if (!f || !f.toca || numero === audioAtivo) return;
      audioAtivo = numero;
      if (corrida) corrida.abort();
      await rodando;
      if (filaA) {
        filaA.abortar();
        if (sbA && sbA.buffered.length) filaA.remover(0, ms.duration || 1e9);
      }
      rodar(video.currentTime * 1000);
    },
    /** Diagnóstico: faixas bufferizadas de cada SourceBuffer, separadas. */
    get diagnostico() {
      const faixas = (sb) => {
        if (!sb) return [];
        const out = [];
        for (let i = 0; i < sb.buffered.length; i++) out.push([+sb.buffered.start(i).toFixed(2), +sb.buffered.end(i).toFixed(2)]);
        return out;
      };
      return { video: faixas(sbV), audio: faixas(sbA), atrasoQuadros: reordenador.atrasoQuadros, grampeados: reordenador.grampeados, tentativas, sequencia };
    },

    destruir() {
      clearInterval(faxina);
      clearInterval(pularLacuna);
      video.removeEventListener('seeking', aoSeek);
      video.removeEventListener('waiting', aoEsperar);
      video.removeEventListener('playing', aoTocar);
      if (corrida) corrida.abort();
      try {
        if (ms.readyState === 'open') ms.endOfStream();
      } catch (e) { /* ok */ }
      URL.revokeObjectURL(objUrl);
    },
  };
}
