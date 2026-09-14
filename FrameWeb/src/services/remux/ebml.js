/**
 * EBML — o formato binário por baixo do Matroska (.mkv).
 *
 * É uma árvore de elementos `[id][tamanho][dados]`, onde id e tamanho são
 * inteiros de comprimento variável ("vint"): o número de zeros à esquerda do
 * primeiro byte diz quantos bytes o número ocupa. Só isso. Todo o resto do
 * .mkv (faixas, blocos, índice) é convenção sobre quais ids aparecem onde —
 * e mora em `matroska.js`.
 *
 * Este arquivo não sabe nada de mídia: lê ids, tamanhos, inteiros, floats e
 * strings de um Uint8Array, e caminha pelos filhos de um elemento.
 */

/** Tamanho "desconhecido" (só 1s): Segment/Cluster escritos ao vivo usam isso. */
export const TAMANHO_DESCONHECIDO = -1;

/**
 * Lê um vint em `pos`. Devolve `{ valor, bytes }` — ou null se faltar dado.
 *
 * `comMarca` mantém o bit de comprimento (é assim que o ID é comparado, ex.
 * 0x1A45DFA3); sem ele o bit é removido (é assim que o TAMANHO é lido).
 */
export function lerVint(buf, pos, comMarca) {
  if (pos >= buf.length) return null;
  const primeiro = buf[pos];
  if (primeiro === 0) return null; // vint inválido (mais de 8 bytes)
  let bytes = 1;
  let mascara = 0x80;
  while (!(primeiro & mascara)) {
    mascara >>= 1;
    bytes++;
  }
  if (pos + bytes > buf.length) return null;

  let valor = comMarca ? primeiro : primeiro & (mascara - 1);
  let todosUns = valor === mascara - 1;
  for (let i = 1; i < bytes; i++) {
    const b = buf[pos + i];
    if (b !== 0xff) todosUns = false;
    // acima de 2^53 a precisão vai embora, mas tamanho de arquivo cabe folgado
    valor = valor * 256 + b;
  }
  if (!comMarca && todosUns) return { valor: TAMANHO_DESCONHECIDO, bytes };
  return { valor, bytes };
}

/**
 * Lê o cabeçalho de um elemento em `pos`: id, tamanho e onde começam os dados.
 * Devolve null se o buffer acabar no meio — quem chama busca mais bytes.
 */
export function lerElemento(buf, pos) {
  const id = lerVint(buf, pos, true);
  if (!id) return null;
  const tam = lerVint(buf, pos + id.bytes, false);
  if (!tam) return null;
  return {
    id: id.valor,
    tamanho: tam.valor,
    dados: pos + id.bytes + tam.bytes, // offset do primeiro byte de conteúdo
    cabecalho: id.bytes + tam.bytes,
  };
}

export function lerUint(buf, pos, tam) {
  let v = 0;
  for (let i = 0; i < tam; i++) v = v * 256 + buf[pos + i];
  return v;
}

export function lerInt(buf, pos, tam) {
  if (!tam) return 0;
  let v = lerUint(buf, pos, tam);
  const limite = 2 ** (8 * tam - 1);
  if (v >= limite) v -= 2 * limite;
  return v;
}

export function lerFloat(buf, pos, tam) {
  const dv = new DataView(buf.buffer, buf.byteOffset + pos, tam);
  if (tam === 4) return dv.getFloat32(0);
  if (tam === 8) return dv.getFloat64(0);
  return 0;
}

const utf8 = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
export function lerString(buf, pos, tam) {
  const fatia = buf.subarray(pos, pos + tam);
  // strings do Matroska podem vir com zeros de enchimento no fim
  let fim = fatia.length;
  while (fim > 0 && fatia[fim - 1] === 0) fim--;
  return utf8 ? utf8.decode(fatia.subarray(0, fim)) : String.fromCharCode(...fatia.subarray(0, fim));
}

/**
 * Percorre os filhos de um elemento já inteiro em memória.
 * `visitar(id, buf, dados, tamanho)` recebe cada filho; devolver `false` para.
 */
export function paraCadaFilho(buf, inicio, fim, visitar) {
  let pos = inicio;
  while (pos < fim) {
    const el = lerElemento(buf, pos);
    if (!el) return;
    const tam = el.tamanho === TAMANHO_DESCONHECIDO ? fim - el.dados : el.tamanho;
    if (visitar(el.id, buf, el.dados, tam) === false) return;
    pos = el.dados + tam;
  }
}
