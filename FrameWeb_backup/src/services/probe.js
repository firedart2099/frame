
/**
 * Este navegador decodifica Dolby (AC3/E-AC3)?
 *
 * O Chrome nao licencia Dolby; o Edge no Windows sim. Isso muda a estrategia
 * inteira de escolha: num navegador sem Dolby, um release que ANUNCIA aac e
 * quase a unica garantia de som, e vale mais que resolucao.
 */
import { temExtensao, navegadorServe } from './extensao.js';
import { sondarMkv } from './remux/sonda.js';

let cacheDolby = null;
export function suportaDolby() {
  if (cacheDolby !== null) return cacheDolby;
  const testa = (mime) => {
    try {
      if (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(mime)) return true;
    } catch (e) {
      /* sem MediaSource */
    }
    try {
      return document.createElement('video').canPlayType(mime) !== '';
    } catch (e) {
      return false;
    }
  };
  cacheDolby = testa('audio/mp4; codecs="ec-3"') || testa('audio/mp4; codecs="ac-3"');
  return cacheDolby;
}
/**
 * Descobre se o navegador toca um release ANTES de ele aparecer na tela.
 *
 * O nome do release quase nunca diz o codec de áudio, e o navegador não avisa
 * que não sabe decodificar — ele mostra o vídeo e o som simplesmente não
 * existe. Descobrir isso no player significa o episódio começar e reiniciar
 * dez vezes na cara de quem só queria assistir.
 *
 * A tentativa óbvia — baixar os primeiros KB com `Range` e ler o codec no
 * cabeçalho do container — NÃO funciona, e vale registrar por quê: o link do
 * AllDebrid não manda `Access-Control-Allow-Origin`, e `fetch()` obedece CORS.
 * Toda leitura volta bloqueada. (Em Node, onde não há CORS, o mesmo código
 * funciona lindamente — foi assim que a armadilha passou batida nos testes.)
 *
 * O que enxerga aquele arquivo é o `<video>`, que toca mídia de outra origem
 * sem CORS. Então a sondagem é um `<video>` de 1 pixel, fora da tela e com
 * volume zero: deixa decodificar um instante e olha os contadores de bytes.
 * Vídeo decodificando com áudio em zero é exatamente o caso AC3/DTS.
 */

const ESPERA_DECODE = 900; // tempo tocando antes de ler os contadores
// 9s, nao 5: um 1080p de 3 GB demora mais pra entregar o primeiro quadro que
// um 720p de 1,4 GB, e reprovar por isso e reprovar por tamanho
const PRAZO_SONDAGEM = 9000;

/**
 * @returns {Promise<{toca: boolean, motivo: string|null}>}
 */
/**
 * Arquivo curto demais não é o filme.
 *
 * Thor Ragnarok tocou com **59 segundos** de duração: era um "sample", aqueles
 * trechos de um minuto que vêm junto do torrent, ou o stub que o CDN devolve
 * quando não tem o arquivo. Tocava liso, passava na sondagem de vídeo e áudio,
 * e a pessoa descobria no minuto seguinte, quando a tela ficava preta.
 *
 * A TMDB sabe quanto o filme dura, então dá pra comparar. Sem esse dado, vale
 * um piso: nada abaixo de cinco minutos é um filme ou um episódio.
 */
/**
 * Duração como prova de identidade.
 *
 * Trocar o idioma e cair em OUTRO FILME é a pior falha possível, e foi o que
 * aconteceu: pedindo Vingadores: Guerra Infinita dublado, veio Os Vingadores
 * (2012). O torrent tinha o nome certo e o conteúdo errado — nome, tamanho e
 * fonte não denunciam nada disso.
 *
 * A duração denuncia. Dois releases do MESMO filme diferem em menos de 1,5%
 * (vinheta de estúdio, créditos cortados); filmes diferentes diferem muito
 * mais — Guerra Infinita tem 149 minutos e Os Vingadores, 143: 4%.
 *
 * Por isso a régua preferida é o ARQUIVO QUE JÁ ESTÁ TOCANDO, não o runtime da
 * TMDB: ele é medido, não arredondado, e já provou ser o filme certo.
 */
function duracaoSuspeita(duracao, esperada, referencia) {
  if (!Number.isFinite(duracao) || duracao <= 0) return null; // o navegador não soube dizer
  if (duracao < 300) return 'arquivo de 1 minuto (amostra, não o filme)';

  if (referencia && referencia > 300) {
    const erro = Math.abs(duracao - referencia) / referencia;
    if (erro > 0.03) {
      const min = (d) => Math.round(d / 60);
      return `outro filme: ${min(duracao)} min contra ${min(referencia)} do que você está vendo`;
    }
    return null;
  }

  if (!esperada) return null;
  if (duracao < esperada * 0.6) return 'muito mais curto que o filme';
  if (duracao > esperada * 2.5) return 'muito mais longo que o filme';
  return null;
}

export function testarRelease(url, { timeoutMs = PRAZO_SONDAGEM, duracaoEsperada = null, duracaoReferencia = null, aceitarMagro = false } = {}) {
  // .mkv com a extensão: sonda pelo cabeçalho (2 MB, ~1 s, exata), não tocando.
  // O <video> escondido leva o prazo inteiro num arquivo grande e reprova AC3.
  if (temExtensao() && navegadorServe() && /\.mkv(\?|$)/i.test(url)) {
    return sondarMkv(url, { timeoutMs }).then((r) => {
      if (!r.toca) return r;
      const motivo = duracaoSuspeita(r.duracao, duracaoEsperada, duracaoReferencia);
      if (motivo) return { toca: false, motivo };
      // "1080p" com bitrate de 480p: reprova e deixa pro próximo — a menos
      // que seja a segunda passada, sem mais ninguém
      if (r.magro && !aceitarMagro) {
        return { toca: false, magro: true, motivo: `imagem fraca (${r.mbps.toFixed(1)} Mbps num 1080p)` };
      }
      return r;
    });
  }
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'auto';
    v.playsInline = true;
    // volume 0 em vez de muted: com `muted` o Chrome pode nem montar o
    // pipeline de áudio, e aí o contador ficaria em zero pra todo mundo —
    // a sondagem reprovaria até os arquivos bons.
    v.volume = 0;
    v.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';

    let terminou = false;
    const acabar = (resultado) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(prazo);
      try {
        v.pause();
        v.removeAttribute('src');
        v.load(); // encerra a conexão em vez de deixar baixando de graça
        v.remove();
      } catch (e) {
        /* já removido */
      }
      resolve(resultado);
    };

    const prazo = setTimeout(() => acabar({ toca: false, motivo: 'nao comecou a tocar' }), timeoutMs);

    v.addEventListener('error', () => acabar({ toca: false, motivo: 'arquivo nao abre' }));

    v.addEventListener('loadedmetadata', () => {
      const motivo = duracaoSuspeita(v.duration, duracaoEsperada, duracaoReferencia);
      if (motivo) acabar({ toca: false, motivo });
    });

    v.addEventListener('playing', () => {
      setTimeout(() => {
        if (terminou) return;
        const bytesVideo = v.webkitVideoDecodedByteCount;
        const bytesAudio = v.webkitAudioDecodedByteCount;

        // navegador que não expõe os contadores (Firefox, Safari): não dá pra
        // saber, e reprovar por não saber seria pior — deixa tentar.
        if (bytesVideo === undefined) return acabar({ toca: true, motivo: null });

        if (bytesVideo === 0) return acabar({ toca: false, motivo: 'video que este navegador nao decodifica' });
        // Áudio que o navegador não decodifica (AC3, DTS) num .mkv NÃO é
        // reprovação quando a extensão está instalada: o motor DUAL
        // (services/remux) decodifica em WASM. Sem isso, todo release
        // dublado brasileiro — que é AC3 quase sempre — morria aqui, e o
        // player caía num 720p em inglês dizendo que "não há outro arquivo".
        if (bytesAudio === 0 && !(temExtensao() && navegadorServe() && /\.mkv(\?|$)/i.test(url))) {
          return acabar({ toca: false, motivo: 'audio que este navegador nao decodifica' });
        }
        return acabar({ toca: true, motivo: null });
      }, ESPERA_DECODE);
    });

    document.body.appendChild(v);
    v.src = url;
    const p = v.play();
    if (p && p.catch) {
      p.catch(() => {
        // política de autoplay: sem gesto do usuário só toca mudo
        v.muted = true;
        v.play().catch(() => acabar({ toca: true, motivo: null }));
      });
    }
  });
}

/**
 * Corrida com prazo: devolve o PRIMEIRO release que tocar, assim que tocar.
 *
 * Nada de esperar a rodada inteira antes de decidir — foi isso que deixou a
 * tela dois minutos em "liberando no AllDebrid". Aqui vale a regra oposta:
 * quem terminar primeiro e prestar, ganha; assim que alguém ganha, o resto é
 * abortado. E existe um prazo total, porque é melhor tentar tocar um arquivo
 * duvidoso do que segurar a pessoa olhando uma rodinha.
 *
 * @param candidatos [{ o, obterUrl: () => Promise<{url, nome, erro}> }]
 */
/**
 * O primeiro colocado testa SOZINHO, com mais tempo.
 *
 * Sondar seis ao mesmo tempo divide a banda: um 1080p de 3,3 GB nao consegue
 * entregar o primeiro quadro enquanto cinco outros baixam junto, e um 720p de
 * 1,4 GB consegue. O resultado era o melhor release sendo reprovado por
 * tamanho — de novo, por outro caminho. Aqui ele corre sozinho antes.
 */
export async function acharTocavel(candidatos, opcoes = {}) {
  // Duas passadas: a primeira recusa "1080p" magro (bitrate de 480p); se
  // ninguém passar, a segunda aceita os magros — imagem fraca é melhor que
  // tela preta, mas só quando é a única opção.
  const magros = [];
  const n1080 = candidatos.filter((c) => (c.o && c.o.quality) >= 1080).length;
  const primeira = await acharTocavelUmaVez(candidatos, {
    ...opcoes,
    aceitarMagro: n1080 < 2, // magro e o unico 1080? entao vale
    aoReprovar: (t) => {
      // magro fica em espera: se for escolhido na segunda passada, o player
      // NAO pode te-lo marcado como indisponivel no meio do caminho
      if (t.magro) magros.push(t);
      else if (opcoes.aoReprovar) opcoes.aoReprovar(t);
    },
  });
  if (primeira || !magros.length) {
    if (opcoes.aoReprovar) for (const m of magros) opcoes.aoReprovar(m);
    return primeira;
  }
  const deNovo = candidatos.filter((c) => magros.some((m) => m.o === c.o));
  const segunda = await acharTocavelUmaVez(deNovo, { ...opcoes, aceitarMagro: true });
  if (opcoes.aoReprovar) for (const m of magros) if (!segunda || m.o !== segunda.o) opcoes.aoReprovar(m);
  return segunda;
}

async function acharTocavelUmaVez(candidatos, opcoes = {}) {
  const { aoReprovar, aoProgredir, duracaoEsperada = null, duracaoReferencia = null, aceitarMagro = false } = opcoes;
  if (!candidatos.length) return null;

  const [primeiro, ...resto] = candidatos;
  if (aoProgredir) aoProgredir(1, candidatos.length);
  try {
    const { url, nome, erro } = await primeiro.obterUrl();
    if (url) {
      const r = await testarRelease(url, { timeoutMs: 12000, duracaoEsperada, duracaoReferencia, aceitarMagro });
      if (r.toca) return { ...primeiro, url, nome };
      if (aoReprovar) aoReprovar({ ...primeiro, motivo: r.motivo, magro: !!r.magro });
    } else if (aoReprovar) {
      aoReprovar({ ...primeiro, motivo: erro || 'nao destravou' });
    }
  } catch (e) {
    if (aoReprovar) aoReprovar({ ...primeiro, motivo: 'erro na sondagem' });
  }

  // Com a extensão a sondagem lê o cabeçalho (1 s) em vez de tocar, então
  // não há o que ganhar em paralelo — e há o que perder: o AllDebrid limita
  // conexões simultâneas e responde 503 às demais, que a sondagem lia como
  // "arquivo nao abre". Medido em 11/09/2026: três DUAL bons reprovados de
  // uma vez, e o mesmo arquivo abrindo em 2,5 s quando testado sozinho.
  const simultaneos = temExtensao() && navegadorServe() ? 1 : 4;
  return emParalelo(resto, { ...opcoes, simultaneos, jaFeitos: 1, total: candidatos.length });
}

function emParalelo(
  candidatos,
  { simultaneos = 4, prazoTotal = 45000, aoReprovar, aoProgredir, jaFeitos = 0, total = 0, duracaoEsperada = null, duracaoReferencia = null, aceitarMagro = false } = {}
) {
  return new Promise((resolve) => {
    // Resultado por POSICAO, nao por ordem de chegada.
    //
    // A corrida por quem termina primeiro premiava arquivo pequeno: um 720p de
    // 1,4 GB comeca a tocar antes de um 1080p de 3,3 GB, entao o pior release
    // ganhava. Aqui o vencedor e o mais bem colocado no ranking que tocou —
    // so se resolve quando ninguem melhor ainda esta em teste.
    const estado = candidatos.map(() => 'espera'); // espera | testando | toca | falha
    const dados = new Array(candidatos.length);
    let proximoIndice = 0;
    let ativos = 0;
    let encerrado = false;

    const prazo = setTimeout(() => {
      // acabou o tempo: vale o melhor colocado que ja tocou
      const i = estado.indexOf('toca');
      encerrar(i >= 0 ? dados[i] : null);
    }, prazoTotal);

    const encerrar = (r) => {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(prazo);
      resolve(r);
    };

    const talvezEncerrar = () => {
      for (let i = 0; i < estado.length; i += 1) {
        if (estado[i] === 'toca') return encerrar(dados[i]);
        if (estado[i] === 'espera' || estado[i] === 'testando') return; // ainda ha melhor em jogo
      }
      encerrar(null);
    };

    const puxar = () => {
      if (encerrado) return;
      if (proximoIndice >= candidatos.length) {
        if (ativos === 0) talvezEncerrar();
        return;
      }
      const indice = proximoIndice;
      const c = candidatos[indice];
      proximoIndice += 1;
      ativos += 1;
      estado[indice] = 'testando';
      if (aoProgredir) aoProgredir(jaFeitos + proximoIndice, total || candidatos.length);

      (async () => {
        try {
          const { url, nome, erro } = await c.obterUrl();
          if (encerrado) return;
          if (!url) {
            estado[indice] = 'falha';
            if (aoReprovar) aoReprovar({ ...c, motivo: erro || 'nao destravou' });
            return;
          }
          const r = await testarRelease(url, { duracaoEsperada, duracaoReferencia, aceitarMagro });
          if (encerrado) return;
          if (r.toca) {
            estado[indice] = 'toca';
            dados[indice] = { ...c, url, nome };
            return;
          }
          estado[indice] = 'falha';
          if (aoReprovar) aoReprovar({ ...c, motivo: r.motivo, magro: !!r.magro });
        } catch (e) {
          estado[indice] = 'falha';
          if (aoReprovar) aoReprovar({ ...c, motivo: 'erro na sondagem' });
        } finally {
          ativos -= 1;
          talvezEncerrar();
          puxar();
        }
      })();
    };

    if (!candidatos.length) return encerrar(null);
    for (let i = 0; i < simultaneos; i += 1) puxar();
  });
}
