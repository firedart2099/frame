// GERADO POR `npm run sync-app` — copia de ../Frame. Nao edite aqui:
// mexa no app e rode o script de novo, senao os dois lados divergem.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../supabase';

/**
 * Nucleo do sync com o Supabase.
 *
 * Regras do jogo:
 *  - AsyncStorage continua sendo a fonte de leitura instantanea (offline, boot).
 *  - Toda escrita local tambem vira uma operacao na "outbox", drenada assim que
 *    houver rede. Se o app fechar antes, a outbox sobrevive no AsyncStorage.
 *  - Conflito entre dois aparelhos: ultima escrita vence (updated_at do servidor
 *    para linhas; client_ts para progresso de reproducao).
 *  - Apagar nao e DELETE: e `deleted_at` (tombstone), senao o outro aparelho
 *    ressuscitaria a linha no proximo pull.
 */

const OUTBOX_KEY = '@frame_sync_outbox';
const MAX_TRIES = 5;
const CHUNK = 400;

let inFlight = null;
let flushAgain = false;

// ---------------------------------------------------------------- utilidades

export const nowIso = () => new Date().toISOString();

/** JSON com chaves ordenadas: dois objetos iguais geram sempre o mesmo texto. */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  // undefined some no JSON: ignorar aqui tambem, senao o hash muda sozinho
  // depois do round-trip pelo jsonb do Postgres.
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

/** djb2: hash curto so pra detectar "mudou desde o ultimo push". */
export function hashOf(value) {
  const str = stableStringify(value === undefined ? null : value);
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function chunked(list, size = CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// ------------------------------------------------------------------- outbox

async function readOutbox() {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

async function writeOutbox(ops) {
  try {
    await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(ops));
  } catch (e) {
    // silencioso: sync nunca pode derrubar a UI
  }
}

/**
 * Enfileira upserts. Cada op: { table, onConflict, row, group? }.
 * `group` separa o lote: o PostgREST exige o MESMO conjunto de colunas em
 * todas as linhas de um upsert, e tombstone (so deleted_at) nao tem a forma
 * da linha viva — vai em lote proprio em vez de carregar colunas vazias.
 * Ops para a mesma linha (mesma table + mesma chave de conflito) se fundem,
 * entao segurar 200 toques no mesmo item nao vira 200 requests.
 */
export async function enqueue(ops) {
  if (!ops || ops.length === 0) return;
  const outbox = await readOutbox();
  const indexOf = new Map();
  outbox.forEach((op, i) => indexOf.set(opIdentity(op), i));

  ops.forEach((op) => {
    const id = opIdentity(op);
    const existing = indexOf.get(id);
    if (existing !== undefined) {
      outbox[existing] = { ...op, tries: outbox[existing].tries || 0 };
    } else {
      indexOf.set(id, outbox.length);
      outbox.push({ ...op, tries: 0 });
    }
  });

  await writeOutbox(outbox);
}

function opIdentity(op) {
  const keys = (op.onConflict || 'id').split(',').map((k) => k.trim());
  return op.table + '|' + keys.map((k) => String(op.row?.[k])).join('|');
}

/** Chaves com escrita pendente numa tabela — o pull nao pode sobrescrever essas. */
export async function pendingKeys(table, keyField) {
  const outbox = await readOutbox();
  return new Set(
    outbox.filter((op) => op.table === table).map((op) => String(op.row?.[keyField]))
  );
}

/**
 * Drena a outbox. Erro de rede: mantem tudo e tenta de novo depois.
 * Erro do banco (RLS, coluna faltando): tenta MAX_TRIES vezes e descarta,
 * pra uma linha ruim nao travar a fila inteira pra sempre.
 */
export function flushOutbox() {
  // Ja tem um flush rodando: entra de carona nele (e garante mais uma volta,
  // porque a fila pode ter crescido depois que ele comecou). Assim `await
  // flushOutbox()` de verdade espera a fila esvaziar.
  if (inFlight) {
    flushAgain = true;
    return inFlight;
  }
  inFlight = drain().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function drain() {
  let result = { ok: true, sent: 0, pending: 0 };
  do {
    flushAgain = false;
    result = await flushOnce();
  } while (flushAgain);
  return result;
}

async function flushOnce() {
  const outbox = await readOutbox();
  if (outbox.length === 0) return { ok: true, sent: 0, pending: 0 };

  // agrupa por tabela + chave de conflito pra mandar em lote
  const groups = new Map();
  outbox.forEach((op) => {
    const key = op.table + '::' + (op.onConflict || '') + '::' + (op.group || '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(op);
  });

  const failed = [];
  let sent = 0;

  for (const [, ops] of groups) {
    const { table, onConflict } = ops[0];
    for (const batch of chunked(ops)) {
      const rows = batch.map((op) => op.row);
      let error = null;
      try {
        const query = supabase.from(table).upsert(rows, onConflict ? { onConflict } : undefined);
        const res = await query;
        error = res.error;
      } catch (e) {
        error = { message: String(e && e.message ? e.message : e), network: true };
      }

      if (!error) {
        sent += rows.length;
        continue;
      }

      const isNetwork = error.network || /network|fetch|timeout|offline/i.test(error.message || '');
      batch.forEach((op) => {
        const tries = (op.tries || 0) + (isNetwork ? 0 : 1);
        if (tries < MAX_TRIES) failed.push({ ...op, tries });
        else console.warn('[sync] descartando op apos falhas:', table, error.message);
      });
    }
  }

  await writeOutbox(failed);
  return { ok: failed.length === 0, sent, pending: failed.length };
}

export async function outboxSize() {
  return (await readOutbox()).length;
}

// -------------------------------------------------------------------- leitura

/**
 * SELECT paginado. O PostgREST corta em 1000 linhas por request e uma
 * biblioteca importada do Letterboxd passa disso fácil.
 */
export async function selectAll(table, columns, applyFilters, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    let query = supabase.from(table).select(columns);
    if (applyFilters) query = applyFilters(query);
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}
