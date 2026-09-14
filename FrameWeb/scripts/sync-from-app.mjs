/**
 * Copia do app (../Frame) tudo que os dois lados compartilham.
 *
 *   npm run sync-app
 *
 * Duas coisas acontecem aqui:
 *
 * 1. src/services/  — a camada de sincronização e os helpers de TMDB são
 *    idênticos nos dois. Só o caminho de alguns imports muda; AsyncStorage e
 *    AppState viram shims web por alias no vite.config.js.
 *
 * 2. functions/_providers/ — os provedores de vídeo (MovieBox, 4KHDHub) são
 *    CommonJS e rodam no runtime do React Native. No Cloudflare Worker eles
 *    precisam ser ESM, e `Buffer` não existe lá. A conversão é mecânica e
 *    está aqui embaixo, pra não virar um fork editado à mão que diverge do
 *    app na primeira mudança.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '..');
const app = path.resolve(web, '..', 'Frame');

const BANNER =
  '// GERADO POR `npm run sync-app` — copia de ../Frame. Nao edite aqui:\n' +
  '// mexa no app e rode o script de novo, senao os dois lados divergem.\n';

/* ------------------------------------------------------------ 1. services */

const SERVICES = [
  'src/services/sync/core.js',
  'src/services/sync/folders.js',
  'src/services/sync/settings.js',
  'src/services/sync/progress.js',
  'src/services/sync/media.js',
  'src/services/sync/index.js',
  'src/services/watchProgress.js',
  'src/services/playbackPrefs.js',
  'src/services/shelves.js',
  'src/services/recomendacoes.js',
  'src/services/gravacao.js',
  'src/services/ratings.js',
  // colecoes (Marvel, Pixar...): a config e o carregador sao os mesmos do app
  'src/config/colecoes.js',
  'src/services/colecoes.js',
];

const SERVICE_REWRITES = [
  // no app o supabase.js fica na raiz; aqui ele mora em src/
  [/from '\.\.\/\.\.\/\.\.\/supabase'/g, "from '../../supabase'"],
  [/from '\.\.\/config\/constants'/g, "from './constants'"],
];

/* ---------------------------------------------------------- 2. provedores */

const PROVIDERS = [
  ['src/services/moviebox/crypto.js', 'functions/_providers/crypto.js'],
  ['src/services/moviebox/client.js', 'functions/_providers/mbclient.js'],
  ['src/services/moviebox/index.js', 'functions/_providers/moviebox.js'],
  ['src/services/fourkhdhub.js', 'functions/_providers/fourkhdhub.js'],
  // stremio.js ja e ESM e so usa fetch: passa sem transformacao nenhuma
  ['src/services/stremio.js', 'functions/_providers/stremio.js'],
];

function toEsm(code) {
  // require -> import
  code = code.replace(
    /const\s*\{([^}]+)\}\s*=\s*require\(['"]\.\/crypto['"]\);?/g,
    "import {$1} from './crypto.js';"
  );
  code = code.replace(
    /const\s*\{([^}]+)\}\s*=\s*require\(['"]\.\/client['"]\);?/g,
    "import {$1} from './mbclient.js';"
  );

  // module.exports = { a, b } -> export { a, b }
  code = code.replace(/module\.exports\s*=\s*\{([\s\S]*?)\};?/g, (_m, inner) => `export {${inner}};`);

  // Buffer não existe no Worker. O único uso é ler magic bytes, e pra isso
  // Uint8Array serve igual (indexação + length).
  code = code.replace(
    /Buffer\.from\(await resp\.arrayBuffer\(\)\.catch\(\(\) => new ArrayBuffer\(0\)\)\)/g,
    'new Uint8Array(await resp.arrayBuffer().catch(() => new ArrayBuffer(0)))'
  );
  code = code.replace(/Buffer\.from\(/g, 'new Uint8Array(');

  return code;
}

/* ------------------------------------------------------------------ run */

if (!fs.existsSync(app)) {
  console.error(`Nao achei o app em ${app}.`);
  console.error('Esperado: FrameWeb e Frame lado a lado na mesma pasta.');
  process.exit(1);
}

const write = (rel, code) => {
  const dest = path.join(web, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, BANNER + code);
  console.log(`  ok ${rel}`);
};

let n = 0;
console.log('services:');
for (const rel of SERVICES) {
  const src = path.join(app, rel);
  if (!fs.existsSync(src)) {
    console.warn(`  ! ${rel} nao existe no app, pulando`);
    continue;
  }
  let code = fs.readFileSync(src, 'utf8').replace(/^﻿/, '');
  for (const [re, sub] of SERVICE_REWRITES) code = code.replace(re, sub);
  write(rel, code);
  n++;
}

console.log('\nprovedores (CommonJS -> ESM do Worker):');
for (const [from, to] of PROVIDERS) {
  const src = path.join(app, from);
  if (!fs.existsSync(src)) {
    console.warn(`  ! ${from} nao existe no app, pulando`);
    continue;
  }
  const code = toEsm(fs.readFileSync(src, 'utf8').replace(/^﻿/, ''));
  if (/require\(|module\.exports|Buffer\./.test(code)) {
    console.warn(`  ! ${to} ainda tem require/module.exports/Buffer — confere na mao`);
  }
  write(to, code);
  n++;
}

console.log(`\n${n} arquivo(s) sincronizado(s) do app.`);
