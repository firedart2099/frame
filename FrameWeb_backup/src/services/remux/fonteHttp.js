/**
 * Fonte de bytes por HTTP com Range — o que o demuxer (`matroska.js`) lê.
 *
 * Cada `ler(inicio, fim)` é um pedido `Range: bytes=inicio-(fim-1)`. Nada fica
 * guardado aqui: quem decide quanto trazer de cada vez é a janela do demuxer.
 *
 * Só funciona se a resposta for LEGÍVEL pelo JavaScript, o que exige
 * `Access-Control-Allow-Origin` — e o AllDebrid não manda. É pra isso que
 * existe a extensão em `extensao/`: ela acrescenta o cabeçalho. `temCors(url)`
 * testa exatamente isso com um pedido de 1 byte, e é como o player decide se
 * abre o arquivo pelo motor ou pelo `<video>` de sempre.
 */

export async function criarFonteHttp(url, { sinal } = {}) {
  const fonte = {
    url,
    tamanho: null,
    async ler(inicio, fim) {
      const r = await fetch(url, {
        headers: { Range: `bytes=${inicio}-${fim - 1}` },
        signal: sinal,
        cache: 'no-store',
      });
      if (r.status !== 206) {
        // 200 = servidor ignorou o Range e mandaria o arquivo inteiro: não dá
        throw new Error(`Range não aceito (HTTP ${r.status})`);
      }
      const total = (r.headers.get('content-range') || '').split('/')[1];
      if (total && fonte.tamanho == null) fonte.tamanho = Number(total);
      return new Uint8Array(await r.arrayBuffer());
    },
  };
  // primeiro pedido, só pra saber o tamanho (e falhar cedo se não houver CORS)
  await fonte.ler(0, 1);
  return fonte;
}

/**
 * O navegador consegue LER esta URL? (CORS + Range)
 * Devolve em ~1 pedido de 1 byte; falha rápido e em silêncio.
 */
export async function temCors(url, { timeoutMs = 6000 } = {}) {
  const corte = new AbortController();
  const prazo = setTimeout(() => corte.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal: corte.signal, cache: 'no-store' });
    return r.status === 206 && !!r.headers.get('content-range');
  } catch (e) {
    return false; // TypeError de CORS, prazo, rede: tudo "não dá"
  } finally {
    clearTimeout(prazo);
  }
}
