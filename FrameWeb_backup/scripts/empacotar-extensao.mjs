/**
 * Empacota `extensao/` em `public/frame-extensao.zip`, que o site serve pro
 * convite de instalação. Roda antes do build (`npm run build`).
 *
 * Só o que a extensão precisa entra no zip: manifesto, os dois scripts e o
 * ícone. O LEIA-ME fica de fora — quem instala lê no próprio site.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

// fileURLToPath, nao .pathname: a pasta "frame master" tem espaco e o pathname vem como frame%20master
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pasta = path.join(raiz, 'extensao');
const saida = path.join(raiz, 'public', 'frame-extensao.zip');

const zip = new JSZip();
const dentro = zip.folder('frame-extensao');
for (const nome of ['manifest.json', 'fundo.js', 'sonda.js', 'icone.png']) {
  dentro.file(nome, fs.readFileSync(path.join(pasta, nome)));
}
const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
fs.writeFileSync(saida, bytes);
const versao = JSON.parse(fs.readFileSync(path.join(pasta, 'manifest.json'), 'utf8')).version;
console.log(`frame-extensao.zip v${versao}: ${(bytes.length / 1024).toFixed(1)} KB`);
