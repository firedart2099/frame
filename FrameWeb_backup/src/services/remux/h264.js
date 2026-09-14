/**
 * O que o vídeo H.264/HEVC do .mkv precisa pra virar fMP4.
 *
 * 1. A string de codec do MediaSource (`avc1.640028`, `hvc1.1.6.L120.90`),
 *    derivada do CodecPrivate — que no Matroska JÁ É a caixa avcC/hvcC do MP4,
 *    byte a byte. Por isso o vídeo passa sem ser tocado.
 *
 * 2. A ORDEM DE DECODIFICAÇÃO. O Matroska guarda os quadros na ordem em que o
 *    decodificador os recebe, mas cada bloco só diz o tempo de EXIBIÇÃO (PTS).
 *    Com B-frames as duas ordens diferem, e o MP4 exige as duas: o `tfdt`/
 *    `trun` levam o tempo de decodificação (DTS) e um deslocamento até o de
 *    exibição. Um DTS inválido (não crescente, ou depois do PTS) faz o Chrome
 *    recusar o segmento inteiro, em silêncio.
 *
 *    A conta: em ordem de decodificação, o i-ésimo DTS é o i-ésimo MENOR PTS
 *    do fluxo. Isso é sempre crescente e sempre ≤ ao PTS certo, desde que o
 *    PTS seja deslocado por `atraso` = profundidade de reordenação × duração
 *    do quadro. O atraso é medido nos primeiros quadros (quantas posições um
 *    quadro chega "adiantado") e vale pro arquivo inteiro — é o mesmo atraso
 *    que o codificador impôs. O mesmo deslocamento é somado ao áudio, então
 *    a sincronia não muda; só o zero do relógio.
 */

const hex2 = (b) => b.toString(16).padStart(2, '0');

/** `avc1.PPCCLL` a partir da avcC (profile, compat, level). */
export function codecAvc(avcC) {
  if (!avcC || avcC.length < 4) return 'avc1.42E01E';
  return `avc1.${hex2(avcC[1])}${hex2(avcC[2])}${hex2(avcC[3])}`;
}

/** `hvc1.<perfil>.<compat>.<tier><nível>.<restrições>` a partir da hvcC (ISO 14496-15 anexo E). */
export function codecHevc(hvcC) {
  if (!hvcC || hvcC.length < 13) return 'hvc1.1.6.L93.B0';
  const espaco = hvcC[1] >> 6;
  const tier = (hvcC[1] >> 5) & 1;
  const perfil = hvcC[1] & 0x1f;
  // flags de compatibilidade: 32 bits com a ordem dos bits invertida
  let compat = (hvcC[2] << 24) | (hvcC[3] << 16) | (hvcC[4] << 8) | hvcC[5];
  let inv = 0;
  for (let i = 0; i < 32; i++) {
    inv = (inv << 1) | (compat & 1);
    compat >>>= 1;
  }
  const nivel = hvcC[12];
  const restricoes = [];
  for (let i = 6; i < 12; i++) restricoes.push(hvcC[i]);
  while (restricoes.length && restricoes[restricoes.length - 1] === 0) restricoes.pop();
  const partes = [
    'hvc1',
    `${['', 'A', 'B', 'C'][espaco]}${perfil}`,
    (inv >>> 0).toString(16).toUpperCase(),
    `${tier ? 'H' : 'L'}${nivel}`,
    ...restricoes.map((b) => b.toString(16).toUpperCase()),
  ];
  return partes.join('.');
}

/**
 * Reordenador: recebe quadros na ordem do arquivo (decodificação) e devolve,
 * com um pequeno atraso, cada um com `dts`, `pts` (já deslocado) e `duracao`,
 * em microssegundos.
 *
 * Como o DTS de um quadro só é conhecido quando chegaram os `atraso` quadros
 * seguintes, ele segura essa quantidade. Primeiro mede o atraso em `AMOSTRA`
 * quadros (nada sai antes disso — meio segundo a 24 fps), depois escoa.
 */
// 48 quadros (2 s a 24 fps): o Thor Ragnarok do xRG exibe o segundo quadro
// decodificado 9 quadros à frente, e com 16 de amostra o atraso saía curto —
// PTS grampeado, "quadro fora de ordem" pro Chrome, e o buffer virava um
// pedacinho por GOP. A folga de 3 quadros cobre o que a amostra não viu.
const AMOSTRA = 48;
const FOLGA = 3;

export function criarReordenador(duracaoQuadroUs) {
  const dur = duracaoQuadroUs || 41708; // 24 fps se o arquivo não disser
  let fila = []; // quadros na ordem de chegada, ainda sem DTS
  let ptsPendentes = []; // PTS dos quadros da fila, ordenados
  let atrasoQuadros = null; // medido
  let atrasoUs = 0;
  let ultimoDts = -Infinity;
  let grampeados = 0;

  function medir() {
    // quanto cada quadro chegou antes da sua posição na ordem de exibição
    const ordenados = fila.map((q) => q.tempoUs).sort((a, b) => a - b);
    let maior = 0;
    fila.forEach((q, i) => {
      const posExibicao = ordenados.indexOf(q.tempoUs);
      maior = Math.max(maior, i - posExibicao);
    });
    atrasoQuadros = Math.max(2, maior + FOLGA);
    atrasoUs = atrasoQuadros * dur;
  }

  function inserirOrdenado(v) {
    let lo = 0;
    let hi = ptsPendentes.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (ptsPendentes[m] < v) lo = m + 1;
      else hi = m;
    }
    ptsPendentes.splice(lo, 0, v);
  }

  /** Solta o primeiro da fila com DTS = menor PTS pendente. */
  function soltar() {
    const q = fila.shift();
    let dts = ptsPendentes.shift();
    if (dts <= ultimoDts) dts = ultimoDts + 1; // segurança: nunca repete DTS
    ultimoDts = dts;
    let pts = q.tempoUs + atrasoUs;
    if (pts < dts) {
      // a reordenação ficou mais funda do que a amostra mediu: grampeia (o
      // quadro exibe um tiquinho tarde) e conta, pra aparecer no diagnóstico
      grampeados++;
      pts = dts;
    }
    const proximo = ptsPendentes.length ? Math.max(ptsPendentes[0], dts + 1) : dts + dur;
    return { ...q, dts, pts, duracao: proximo - dts };
  }

  return {
    get atrasoUs() {
      return atrasoUs;
    },
    get pronto() {
      return atrasoQuadros !== null;
    },
    get grampeados() {
      return grampeados;
    },
    get atrasoQuadros() {
      return atrasoQuadros;
    },

    /** Entra um quadro `{ tempoUs, chave, dados }`; saem 0 ou mais prontos. */
    empurrar(q) {
      fila.push(q);
      inserirOrdenado(q.tempoUs);
      if (atrasoQuadros === null) {
        if (fila.length < AMOSTRA) return [];
        medir();
      }
      const prontos = [];
      while (fila.length > atrasoQuadros) prontos.push(soltar());
      return prontos;
    },

    /** Fim do fluxo (ou de um trecho): solta o que ficou. */
    esvaziar() {
      if (atrasoQuadros === null && fila.length) medir();
      const prontos = [];
      while (fila.length) prontos.push(soltar());
      return prontos;
    },

    /** Depois de um seek: esquece a fila, mas mantém o atraso medido. */
    limpar() {
      fila = [];
      ptsPendentes = [];
      ultimoDts = -Infinity;
    },
  };
}
