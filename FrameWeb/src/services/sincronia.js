/**
 * Sincronizar uma legenda usando OUTRA como régua.
 *
 * O caso que motivou isto: Thor Ragnarok. As dez legendas em português do
 * OpenSubtitles são de CAM/HDTS — a primeira fala cai aos 46,4s. A inglesa,
 * casada pelo hash do arquivo que está tocando, cai aos 54,9s. As duas contam o
 * mesmo filme, então as falas acontecem nos MESMOS instantes: o que separa as
 * duas listas é uma constante, não o acaso.
 *
 * Duas tentativas anteriores morreram no teste, e as duas ensinaram algo:
 *
 *  1. **Detectar taxa de quadros pela duração do vídeo.** A razão entre a
 *     última fala e o fim do arquivo varia de 90% a 99% por causa dos créditos,
 *     e a diferença entre 23,976 e 25 fps (4,3%) cabe dentro dessa variação.
 *     Não havia prova ali — a função marcava legenda boa como torta.
 *
 *  2. **Casar cada fala com a mais próxima da régua.** Quando o deslocamento
 *     (8,5s) é maior que o intervalo entre falas (3 a 15s), cada fala casa com
 *     a VIZINHA errada e as diferenças viram ruído em torno de zero. O teste
 *     devolveu -1,4s para um deslocamento real de 8,5s.
 *
 * O que funciona é olhar todas as diferenças de uma vez: se existe um
 * deslocamento verdadeiro, ele aparece como um PICO — centenas de pares caindo
 * no mesmo intervalo de 0,1s. Ruído não faz pico. É por isso que este método
 * também sabe dizer quando NÃO há relação nenhuma entre as duas listas, que é a
 * parte que impede de estragar uma legenda que já estava boa.
 */

const inicioDe = (c) => c.inicio ?? c.start ?? 0;

const BIN = 0.1; // resolução do pico, em segundos
const MAX = 90; // deslocamento máximo que faz sentido procurar

function mediana(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * @returns { deslocamento, confianca, pares } — confiança 0..1
 */
export function estimarDeslocamento(alvo, referencia, { minimo = 20 } = {}) {
  const nada = { deslocamento: 0, confianca: 0, pares: 0 };
  if (!alvo?.length || !referencia?.length) return nada;
  if (alvo.length < minimo || referencia.length < minimo) return nada;

  const ref = referencia.map(inicioDe).sort((a, b) => a - b);
  const alvos = alvo.map(inicioDe).sort((a, b) => a - b);

  // histograma das diferenças dentro da janela
  const hist = new Map();
  let i0 = 0;
  for (const t of alvos) {
    while (i0 < ref.length && ref[i0] < t - MAX) i0 += 1;
    for (let i = i0; i < ref.length && ref[i] <= t + MAX; i += 1) {
      const k = Math.round((ref[i] - t) / BIN);
      hist.set(k, (hist.get(k) || 0) + 1);
    }
  }
  if (!hist.size) return nada;

  // o pico, somando os vizinhos imediatos (uma fala pode cair na borda do bin)
  let melhorK = 0;
  let melhorPeso = -1;
  for (const [k, n] of hist) {
    const peso = n + (hist.get(k - 1) || 0) + (hist.get(k + 1) || 0);
    if (peso > melhorPeso) {
      melhorPeso = peso;
      melhorK = k;
    }
  }

  // refino: mediana das diferenças que caíram perto do pico
  const centro = melhorK * BIN;
  const perto = [];
  i0 = 0;
  for (const t of alvos) {
    while (i0 < ref.length && ref[i0] < t - MAX) i0 += 1;
    for (let i = i0; i < ref.length && ref[i] <= t + MAX; i += 1) {
      const d = ref[i] - t;
      if (Math.abs(d - centro) <= 0.35) perto.push(d);
    }
  }
  if (perto.length < minimo) return nada;

  // FORÇA DO PICO, não "quantas falas casaram".
  //
  // Contar falas casadas engana: um CAM tem corte diferente do WEB-DL, então só
  // um terço das falas casa num deslocamento constante — as três legendas do
  // Thor deram 30% e ainda assim as três concordaram em +10,91s, que é
  // claramente o valor certo. O que separa sinal de ruído não é a altura do
  // pico, é o quanto ele se destaca DO FUNDO: num histograma de listas sem
  // relação nenhuma, todos os intervalos têm peso parecido.
  const pesos = [...hist.values()].sort((a, b) => a - b);
  const fundo = pesos[Math.floor(pesos.length * 0.95)] || 1;
  const forca = melhorPeso / fundo;
  // 4x o fundo é folgado: no teste, listas sem relação ficam abaixo de 2.
  const confianca = Math.min(1, forca / 8);

  return { deslocamento: mediana(perto), confianca, forca, pares: perto.length };
}

/** Move as falas no tempo. Devolve lista nova. */
export function deslocarFalas(falas, segundos) {
  if (!segundos) return falas;
  return (falas || []).map((c) => {
    const novo = { ...c };
    if ('inicio' in c) novo.inicio = c.inicio + segundos;
    if ('termino' in c) novo.termino = c.termino + segundos;
    if ('start' in c) novo.start = c.start + segundos;
    if ('end' in c) novo.end = c.end + segundos;
    return novo;
  });
}
