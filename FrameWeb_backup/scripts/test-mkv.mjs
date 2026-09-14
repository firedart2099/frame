/**
 * Teste do demuxer Matroska contra pedaços reais de um .mkv.
 *
 *   node scripts/test-mkv.mjs <cabeca.bin> <rabo.bin> <tamanho total>
 *   node scripts/test-mkv.mjs <arquivo.mkv>
 *
 * Com cabeça + rabo (baixados por Range do link do AllDebrid), a fonte serve
 * só esses trechos e reclama se o demuxer pedir fora deles — que é o jeito de
 * garantir que a abertura lê pouco e no lugar certo.
 */
import fs from 'node:fs';
import { abrir, lerBlocos, clusterPara } from '../src/services/remux/matroska.js';

const [a, b, total] = process.argv.slice(2);

function fonteDePedacos(pedacos, tamanho) {
  return {
    tamanho,
    lidos: 0,
    async ler(inicio, fim) {
      for (const p of pedacos) {
        if (inicio >= p.inicio && fim <= p.inicio + p.buf.length) {
          this.lidos += fim - inicio;
          return p.buf.subarray(inicio - p.inicio, fim - p.inicio);
        }
      }
      throw new Error(`pedido fora dos pedaços: ${inicio}-${fim}`);
    },
  };
}

let fonte;
if (b) {
  const cab = fs.readFileSync(a);
  const rabo = fs.readFileSync(b);
  const tam = Number(total);
  fonte = fonteDePedacos(
    [
      { inicio: 0, buf: new Uint8Array(cab) },
      { inicio: tam - rabo.length, buf: new Uint8Array(rabo) },
    ],
    tam
  );
} else {
  const todo = new Uint8Array(fs.readFileSync(a));
  fonte = fonteDePedacos([{ inicio: 0, buf: todo }], todo.length);
}

const info = await abrir(fonte);
console.log('duração', (info.duracaoMs / 60000).toFixed(1), 'min  escala', info.escalaNs, 'ns');
console.log('primeiro cluster @', info.primeiroCluster, ' cues:', info.cues.length);
for (const f of info.faixas) {
  console.log(
    ` #${f.numero} ${f.tipo.padEnd(8)} ${f.codec.padEnd(18)} ${f.idioma.padEnd(6)} ${f.nome.slice(0, 30).padEnd(30)}`,
    f.tipo === 'video' ? `${f.largura}x${f.altura} quadro=${(f.duracaoQuadroNs / 1e6).toFixed(3)}ms` : '',
    f.tipo === 'audio' ? `${f.taxa}Hz ${f.canais}ch` : '',
    f.codecPrivate ? `priv=${f.codecPrivate.length}B` : '',
    f.cabecalhoRemovido ? `strip=${f.cabecalhoRemovido.length}B` : '',
    f.padrao ? 'padrão' : ''
  );
}
console.log('bytes lidos na abertura:', fonte.lidos);

// primeiros blocos de cada faixa
const querer = new Set(info.faixas.filter((f) => f.tipo !== 'subtitle').map((f) => f.numero));
const contagem = {};
const primeiros = {};
let n = 0;
await lerBlocos(fonte, info, info.primeiroCluster, querer, (q) => {
  contagem[q.faixa] = (contagem[q.faixa] || 0) + 1;
  (primeiros[q.faixa] ||= []).length < 6 && primeiros[q.faixa].push(`${q.tempoMs.toFixed(1)}${q.chave ? 'K' : ''}/${q.dados.length}B`);
  return ++n < 400;
});
for (const [faixa, c] of Object.entries(contagem)) console.log(`faixa ${faixa}: ${c} quadros —`, primeiros[faixa].join('  '));
if (info.cues.length) {
  const meio = info.duracaoMs / 2;
  console.log('cluster pra', (meio / 60000).toFixed(1), 'min @', clusterPara(info, meio));
}
