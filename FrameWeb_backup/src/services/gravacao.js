// GERADO POR `npm run sync-app` — copia de ../Frame. Nao edite aqui:
// mexa no app e rode o script de novo, senao os dois lados divergem.
/**
 * Gravação de cinema: fora.
 *
 * CAM é alguém filmando a tela com o celular — cabeça de gente na frente, som
 * da sala, imagem torta. TS/TELESYNC é o mesmo vídeo com o áudio pego direto da
 * poltrona do surdo. TELECINE e SCREENER são cópias de trabalho com marca
 * d'água e aviso de "propriedade de". Nada disso é filme, é registro de que o
 * filme existe.
 *
 * Antes eles eram só PENALIZADOS: iam pro fim da fila e, quando nada melhor
 * tocava, subiam sozinhos — o pior arquivo possível ganhava por desistência.
 * Agora saem da lista.
 *
 * O cuidado que o filtro exige: **o nome do filme não pode virar prova.** "Cam"
 * (2018) é um filme de verdade, e "Scream" tem "scr" no meio. Por isso o título
 * é retirado do texto antes do teste, e as marcas são testadas com borda de
 * palavra — não como pedaço de outra.
 */

const MARCAS = [
  'cam', 'camrip', 'cam-rip', 'hdcam', 'hqcam', 'camhd',
  'ts', 'hdts', 'telesync', 'ts-rip', 'tsrip',
  'tc', 'hdtc', 'telecine',
  'scr', 'dvdscr', 'bdscr', 'screener',
  'workprint', 'wp', 'predvd', 'pdvd',
];

const RE = new RegExp(`(^|[^a-z0-9])(${MARCAS.join('|')})([^a-z0-9]|$)`, 'i');

const semAcento = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * @param nome    nome do arquivo/release
 * @param titulo  título do filme (pra não confundir "Cam" o filme com CAM o formato)
 */
export function ehGravacaoDeCinema(nome, titulo = '') {
  const texto = semAcento(nome);
  if (!texto) return false;

  // Tira o título do começo: "Cam.2018.1080p.WEB-DL" não é CAM.
  let resto = texto;
  const alvo = semAcento(titulo).replace(/[^a-z0-9 ]+/g, ' ').trim();
  if (alvo) {
    for (const palavra of alvo.split(/\s+/)) {
      if (palavra.length < 2) continue;
      resto = resto.replace(new RegExp(`(^|[^a-z0-9])${palavra}([^a-z0-9]|$)`, 'i'), '$1 $2');
    }
  }

  return RE.test(resto);
}

/** Tira as gravações de uma lista de streams/releases. */
export function semGravacoes(lista, titulo = '', campo = 'title') {
  const limpa = (lista || []).filter(
    (x) => !ehGravacaoDeCinema(`${x?.[campo] || ''} ${x?.name || ''} ${x?.release || ''}`, titulo)
  );
  // Se TUDO era gravação, é isso que existe: melhor um CAM do que nada na tela.
  return limpa.length ? limpa : lista || [];
}
