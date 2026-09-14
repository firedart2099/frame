/**
 * Som de um arquivo, imagem de outro.
 *
 * O navegador não implementa `HTMLMediaElement.audioTracks`: num mkv com cinco
 * áudios ele toca o primeiro e ponto. E o Chrome não licencia Dolby, então
 * release AC3/E-AC3 aparece e não fala. O resultado é o mesmo dos dois jeitos —
 * filme mudo, sem erro nenhum.
 *
 * A saída é literal: dois elementos. O `<video>` continua com a imagem, mudo,
 * e um `<audio>` escondido toca OUTRO release só pelo som — um `<audio>`
 * apontado pra um mp4/mkv toca a faixa de áudio e nem monta pipeline de vídeo,
 * que é o mais perto de "separar o áudio do vídeo" que dá pra fazer sem
 * transcodificar nada.
 *
 * O trabalho todo é manter os dois no mesmo instante:
 *
 *  - play, pause, seek e velocidade são espelhados na hora;
 *  - um relógio de 1s corrige a deriva, mas só quando ela já dá pra notar:
 *    reposicionar o áudio custa um buffer novo, e ficar consertando 80 ms é
 *    pior do que os 80 ms;
 *  - enquanto o áudio está buferizando, a IMAGEM ESPERA. Sem isso o vídeo
 *    corre na frente, o relógio puxa o áudio, que buferiza de novo, e o filme
 *    vira uma sequência de engasgos.
 *
 * Releases diferentes não começam no mesmo quadro (logo de estúdio, cortes),
 * por isso existe o ajuste manual (`definirOffset`).
 */

export const TOLERANCIA = 0.35; // segundos; fora disso a boca não bate

export function criarAudioSeparado(video, { aoFalhar, aoBuferizar } = {}) {
  if (!video) return null;

  const el = document.createElement('audio');
  el.preload = 'auto';
  el.crossOrigin = null; // link do AllDebrid não manda CORS — com o atributo, nem carrega
  el.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.appendChild(el);

  let ligado = false;
  let offset = 0;
  let mudoAntes = video.muted;
  let seguramos = false; // fomos NÓS que pausamos o vídeo pra esperar o som
  let relogio = null;

  const alvo = () => Math.max(0, video.currentTime + offset);

  const casar = () => {
    if (!ligado) return;
    try {
      el.currentTime = alvo();
    } catch (e) {
      /* ainda sem metadata: o 'loadedmetadata' refaz */
    }
  };

  const tocar = () => {
    if (!ligado) return;
    el.playbackRate = video.playbackRate;
    el.volume = video.volume;
    const p = el.play();
    if (p && p.catch) p.catch(() => {});
  };

  /**
   * Segurar a imagem na primeira engasgada do som deixa o filme em CÂMERA
   * LENTA: o áudio pede buffer, pausamos, ele recebe um pedaço, soltamos, ele
   * pede de novo — e o vídeo anda aos trancos. Um segundo e meio de tolerância
   * separa "engasgou" de "parou".
   */
  const ESPERA_ANTES_DE_SEGURAR = 1500;
  let timerSegurar = null;

  const segurarImagem = () => {
    if (!ligado || video.paused || timerSegurar) return;
    timerSegurar = setTimeout(() => {
      timerSegurar = null;
      if (!ligado || video.paused) return;
      // ainda faltando? aí sim segura
      if (el.readyState >= 3) return;
      seguramos = true;
      video.pause();
      if (aoBuferizar) aoBuferizar(true);
    }, ESPERA_ANTES_DE_SEGURAR);
  };

  const soltarImagem = () => {
    if (timerSegurar) {
      clearTimeout(timerSegurar);
      timerSegurar = null;
    }
    if (aoBuferizar) aoBuferizar(false);
    if (!ligado || !seguramos) return;
    seguramos = false;
    const p = video.play();
    if (p && p.catch) p.catch(() => {});
  };

  // ---- o vídeo manda, o áudio segue
  const noPlay = () => { casar(); tocar(); };
  const noPause = () => { if (!seguramos) el.pause(); };
  const noSeek = () => { casar(); if (!video.paused) tocar(); };
  const naVelocidade = () => { el.playbackRate = video.playbackRate; };
  const noVolume = () => { el.volume = video.volume; el.muted = video.muted && !ligado; };

  // ---- o áudio pede socorro
  const noWaiting = () => segurarImagem();
  const noPlaying = () => soltarImagem();
  const noCanPlay = () => soltarImagem();
  const noMeta = () => { casar(); if (!video.paused) tocar(); };
  const noErro = () => {
    if (!ligado) return;
    if (aoFalhar) aoFalhar(el.error?.message || 'o áudio não abriu');
  };

  video.addEventListener('play', noPlay);
  video.addEventListener('pause', noPause);
  video.addEventListener('seeked', noSeek);
  video.addEventListener('ratechange', naVelocidade);
  video.addEventListener('volumechange', noVolume);
  el.addEventListener('waiting', noWaiting);
  el.addEventListener('playing', noPlaying);
  el.addEventListener('canplay', noCanPlay);
  el.addEventListener('loadedmetadata', noMeta);
  el.addEventListener('error', noErro);

  const tick = () => {
    if (!ligado) return;
    if (video.paused && !seguramos) {
      if (!el.paused) el.pause();
      return;
    }
    const diff = el.currentTime - alvo();
    if (Math.abs(diff) > TOLERANCIA) casar();
    if (el.paused && !video.paused) tocar();
  };

  return {
    elemento: el,

    ligar(url) {
      if (!url) return;
      if (!ligado) {
        mudoAntes = video.muted;
        ligado = true;
      }
      video.muted = true; // o som deste arquivo sai de cena inteiro
      el.muted = false;
      el.volume = video.volume;
      el.src = url;
      el.load();
      casar();
      if (!video.paused) tocar();
      if (!relogio) relogio = setInterval(tick, 1000);
    },

    desligar() {
      ligado = false;
      seguramos = false;
      if (timerSegurar) {
        clearTimeout(timerSegurar);
        timerSegurar = null;
      }
      if (relogio) { clearInterval(relogio); relogio = null; }
      try {
        el.pause();
        el.removeAttribute('src');
        el.load(); // encerra a conexão em vez de continuar baixando de graça
      } catch (e) { /* já parado */ }
      video.muted = mudoAntes;
      if (aoBuferizar) aoBuferizar(false);
    },

    definirOffset(segundos) {
      offset = segundos;
      casar();
    },

    get offset() {
      return offset;
    },

    get ativo() {
      return ligado;
    },

    destruir() {
      this.desligar();
      video.removeEventListener('play', noPlay);
      video.removeEventListener('pause', noPause);
      video.removeEventListener('seeked', noSeek);
      video.removeEventListener('ratechange', naVelocidade);
      video.removeEventListener('volumechange', noVolume);
      el.removeEventListener('waiting', noWaiting);
      el.removeEventListener('playing', noPlaying);
      el.removeEventListener('canplay', noCanPlay);
      el.removeEventListener('loadedmetadata', noMeta);
      el.removeEventListener('error', noErro);
      el.remove();
    },
  };
}

/**
 * Este arquivo consegue entregar SOM neste navegador?
 *
 * Mesma ideia do `testarRelease` do probe.js, mas olhando só o contador de
 * áudio: um `<audio>` de verdade tocando um instante, e os bytes decodificados.
 * Serve pra não oferecer como "som de outro arquivo" um release que também é
 * AC3 — trocar mudo por mudo.
 */
export function testarSomente(url, { timeoutMs = 9000, espera = 900 } = {}) {
  return new Promise((resolve) => {
    const a = document.createElement('audio');
    a.preload = 'auto';
    a.volume = 0;
    a.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0';

    let terminou = false;
    const acabar = (r) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(prazo);
      try {
        a.pause();
        a.removeAttribute('src');
        a.load();
        a.remove();
      } catch (e) { /* já removido */ }
      resolve(r);
    };

    const prazo = setTimeout(() => acabar({ toca: false, motivo: 'nao comecou a tocar' }), timeoutMs);
    a.addEventListener('error', () => acabar({ toca: false, motivo: 'arquivo nao abre' }));
    a.addEventListener('playing', () => {
      setTimeout(() => {
        if (terminou) return;
        const bytes = a.webkitAudioDecodedByteCount;
        if (bytes === undefined) return acabar({ toca: true, motivo: null }); // navegador não conta
        return bytes > 0
          ? acabar({ toca: true, motivo: null })
          : acabar({ toca: false, motivo: 'audio que este navegador nao decodifica' });
      }, espera);
    });

    document.body.appendChild(a);
    a.src = url;
    const p = a.play();
    if (p && p.catch) p.catch(() => acabar({ toca: true, motivo: null }));
  });
}
