/**
 * Gera `public/versao.json` a partir de `src/data/releases.js` — e o que o
 * app consulta pra saber se existe versao mais nova (detector de atualizacao,
 * `Frame/src/services/atualizacao.js`). Roda antes do build.
 *
 * O app compara `versionCode`, nao a string da versao: cada entrada em
 * releases.js precisa do `versionCode` do build (o mesmo do
 * android/app/build.gradle). Entrada sem versionCode nao vira atualizacao.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// fileURLToPath, nao .pathname: a pasta "frame master" tem espaco e o pathname vem como frame%20master
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { RELEASES } = await import(pathToFileURL(path.join(raiz, 'src', 'data', 'releases.js')).href);

const atual = RELEASES.find((r) => r.versionCode && r.files.some((f) => f.platform === 'android' && f.url));
const saida = path.join(raiz, 'public', 'versao.json');
if (!atual) {
  fs.writeFileSync(saida, JSON.stringify({ version: null, versionCode: 0, url: null }, null, 2));
  console.log('versao.json: nenhuma versao publicada com versionCode');
} else {
  const android = atual.files.find((f) => f.platform === 'android' && f.url);
  const json = {
    version: atual.version,
    versionCode: atual.versionCode,
    date: atual.date,
    size: atual.size || null,
    url: android.url,
    changes: (atual.changes || []).map((c) => c.text),
  };
  fs.writeFileSync(saida, JSON.stringify(json, null, 2));
  console.log(`versao.json: ${json.version} (code ${json.versionCode})`);
}
