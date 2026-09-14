// GERADO POR `npm run sync-app` — copia de ../Frame. Nao edite aqui:
// mexa no app e rode o script de novo, senao os dois lados divergem.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { enqueue, flushOutbox, hashOf, nowIso, selectAll } from './core';

/**
 * Sync das pastas ("Salvos"): Watchlist do app, pastas manuais, pastas
 * importadas do Letterboxd (Diario, Watchlist, listas customizadas).
 *
 * O app continua guardando o mesmo formato de sempre no AsyncStorage
 * (`localFolders` / `localFolderItems`) — este modulo so espelha isso em
 * `folders` / `folder_items` no Supabase e devolve o estado fundido.
 */

export const LOCAL_FOLDERS_KEY = 'localFolders';
export const LOCAL_ITEMS_KEY = 'localFolderItems';

const snapKey = (profileId) => `@frame_sync_snap_folders_${profileId}`;

// ------------------------------------------------------------------- chaves

const slug = (text) =>
  String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

/**
 * Chave estavel do item dentro da pasta.
 * Item vindo de CSV do Letterboxd guarda a chave `lbxd:` PARA SEMPRE, mesmo
 * depois de `resolveFolderItems` achar o id no TMDB — se virasse `tmdb:` no
 * meio do caminho, o Supabase ganharia uma linha duplicada do mesmo filme.
 */
export function folderItemKey(item) {
  if (!item) return null;
  if (item.Name) return `lbxd:${slug(item.Name)}|${item.Year || ''}`;
  const id = item.id || item.tmdbId;
  if (id) return `tmdb:${id}`;
  if (item.title || item.name) return `title:${slug(item.title || item.name)}`;
  return `raw:${hashOf(item)}`;
}

const isSyncable = (folder) => !!folder && !folder.isTemp && !!folder.id;

const folderHash = (folder) =>
  hashOf({
    name: folder.name || '',
    description: folder.description || null,
    isAuto: !!folder.isAuto,
    autoType: folder.autoType || null,
  });

// `position` de proposito fora do hash: apagar um item no meio da lista
// mudaria o indice de todos os seguintes e re-subiria a pasta inteira.
const itemHash = (item) => hashOf(item);

/**
 * Linha de "apagado". Mesmas colunas da linha viva de proposito: o upsert em
 * lote do PostgREST recusa um array com objetos de formatos diferentes.
 */
function itemTombstone(profileId, folderKey, itemKey, stamp) {
  // So `deleted_at`: o upsert parcial preserva `metadata` e `media_id` da
  // linha. Ate 12/09/2026 o tombstone zerava as duas ("metadata: {}") e a
  // watchlist do Letterboxd apagada sem querer virou 222 chaves sem filme —
  // apagar tem que ser reversivel, e isso so e possivel se o dado ficar.
  return {
    table: 'folder_items',
    onConflict: 'profile_id,folder_key,item_key',
    group: 'tombstone',
    row: {
      profile_id: profileId,
      folder_key: folderKey,
      item_key: itemKey,
      deleted_at: stamp,
      updated_at: stamp,
    },
  };
}

async function readSnapshot(profileId) {
  try {
    const raw = await AsyncStorage.getItem(snapKey(profileId));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.folders ? parsed : { folders: {}, items: {} };
  } catch (e) {
    return { folders: {}, items: {} };
  }
}

async function writeSnapshot(profileId, snap) {
  try {
    await AsyncStorage.setItem(snapKey(profileId), JSON.stringify(snap));
  } catch (e) {}
}

// ------------------------------------------------------------------ escrita

/**
 * Grava pastas + itens no AsyncStorage (como sempre) e enfileira no Supabase
 * so o que mudou desde o ultimo push. Substitui os pares de
 * `AsyncStorage.setItem('localFolders'/'localFolderItems')` do App.js.
 */
export async function persistFolders(profileId, folders, itemsMap) {
  const safeFolders = Array.isArray(folders) ? folders : [];
  const safeItems = itemsMap && typeof itemsMap === 'object' ? itemsMap : {};

  // Pasta temporaria (colecao de um ator/diretor aberta na tela) nunca foi
  // gravada em disco e continua assim — some ao fechar o app, como antes.
  const keptFolders = safeFolders.filter(isSyncable);
  const keptKeys = new Set(keptFolders.map((f) => f.id));
  const keptItems = {};
  Object.keys(safeItems).forEach((key) => {
    if (keptKeys.has(key)) keptItems[key] = safeItems[key];
  });

  try {
    await AsyncStorage.setItem(LOCAL_FOLDERS_KEY, JSON.stringify(keptFolders));
    await AsyncStorage.setItem(LOCAL_ITEMS_KEY, JSON.stringify(keptItems));
  } catch (e) {}

  if (!profileId) return;

  try {
    const snap = await readSnapshot(profileId);
    const nextSnap = { folders: {}, items: {} };
    const ops = [];
    const stamp = nowIso();

    keptFolders.forEach((folder, index) => {
      const key = folder.id;
      const h = folderHash(folder);
      nextSnap.folders[key] = h;
      if (snap.folders[key] !== h) {
        ops.push({
          table: 'folders',
          onConflict: 'profile_id,folder_key',
          row: {
            profile_id: profileId,
            folder_key: key,
            name: folder.name || key,
            description: folder.description || null,
            is_auto: !!folder.isAuto,
            auto_type: folder.autoType || null,
            position: index,
            deleted_at: null,
            updated_at: stamp,
          },
        });
      }

      const items = Array.isArray(keptItems[key]) ? keptItems[key] : [];
      const prevItems = snap.items[key] || {};
      const nextItems = {};

      items.forEach((item, itemIndex) => {
        const itemKey = folderItemKey(item);
        if (!itemKey || nextItems[itemKey]) return; // ignora duplicata na mesma pasta
        const ih = itemHash(item);
        nextItems[itemKey] = ih;
        if (prevItems[itemKey] !== ih) {
          const mediaId = Number(item.id || item.tmdbId);
          ops.push({
            table: 'folder_items',
            onConflict: 'profile_id,folder_key,item_key',
            row: {
              profile_id: profileId,
              folder_key: key,
              item_key: itemKey,
              media_id: Number.isFinite(mediaId) ? mediaId : null,
              media_type: item.media_type || item.type || null,
              metadata: item,
              position: itemIndex,
              deleted_at: null,
              updated_at: stamp,
            },
          });
        }
      });

      // itens que sumiram da pasta -> tombstone
      Object.keys(prevItems).forEach((itemKey) => {
        if (nextItems[itemKey]) return;
        ops.push(itemTombstone(profileId, key, itemKey, stamp));
      });

      nextSnap.items[key] = nextItems;
    });

    // pastas que sumiram -> tombstone (na pasta e nos itens dela)
    Object.keys(snap.folders).forEach((key) => {
      if (nextSnap.folders[key]) return;
      // idem: nome e descricao ficam na linha, so marca deleted_at
      ops.push({
        table: 'folders',
        onConflict: 'profile_id,folder_key',
        group: 'tombstone',
        row: {
          profile_id: profileId,
          folder_key: key,
          deleted_at: stamp,
          updated_at: stamp,
        },
      });
      Object.keys(snap.items[key] || {}).forEach((itemKey) => {
        ops.push(itemTombstone(profileId, key, itemKey, stamp));
      });
    });

    await writeSnapshot(profileId, nextSnap);
    if (ops.length > 0) {
      await enqueue(ops);
      flushOutbox();
    }
  } catch (e) {
    console.warn('[sync] persistFolders:', e && e.message);
  }
}

// ------------------------------------------------------------------ leitura

export async function readLocalFolders() {
  try {
    const [rawFolders, rawItems] = await Promise.all([
      AsyncStorage.getItem(LOCAL_FOLDERS_KEY),
      AsyncStorage.getItem(LOCAL_ITEMS_KEY),
    ]);
    return {
      folders: rawFolders ? JSON.parse(rawFolders) : [],
      itemsMap: rawItems ? JSON.parse(rawItems) : {},
    };
  } catch (e) {
    return { folders: [], itemsMap: {} };
  }
}

/**
 * Baixa as pastas do perfil e funde com o que ha localmente.
 *
 * Nuvem manda nas linhas que ela conhece (inclusive nos tombstones — pasta
 * apagada no celular tem que sumir na TV). O que existe so no aparelho e a
 * nuvem nunca viu e coisa criada offline: fica e sobe no fim.
 */
export async function pullFolders(profileId) {
  if (!profileId) return readLocalFolders();

  const [folderRows, itemRows] = await Promise.all([
    selectAll('folders', 'folder_key,name,description,is_auto,auto_type,position,deleted_at', (q) =>
      q.eq('profile_id', profileId)
    ),
    selectAll(
      'folder_items',
      'folder_key,item_key,media_id,media_type,metadata,position,deleted_at',
      (q) => q.eq('profile_id', profileId)
    ),
  ]);

  const knownFolders = new Set(folderRows.map((r) => r.folder_key));
  const liveFolderRows = folderRows
    .filter((r) => !r.deleted_at)
    .sort((a, b) => (a.position || 0) - (b.position || 0));

  const knownItems = {};
  const liveItems = {};
  itemRows.forEach((row) => {
    if (!knownItems[row.folder_key]) knownItems[row.folder_key] = new Set();
    knownItems[row.folder_key].add(row.item_key);
    if (row.deleted_at) return;
    if (!liveItems[row.folder_key]) liveItems[row.folder_key] = [];
    liveItems[row.folder_key].push(row);
  });

  const cloudFolders = liveFolderRows.map((r) => ({
    id: r.folder_key,
    name: r.name,
    description: r.description || undefined,
    isAuto: !!r.is_auto,
    autoType: r.auto_type || undefined,
  }));

  const cloudItemsMap = {};
  Object.keys(liveItems).forEach((folderKey) => {
    cloudItemsMap[folderKey] = liveItems[folderKey]
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .map((r) => r.metadata || {});
  });

  // snapshot = exatamente o que a nuvem tem agora
  const snap = { folders: {}, items: {} };
  cloudFolders.forEach((folder) => {
    snap.folders[folder.id] = folderHash(folder);
    const items = cloudItemsMap[folder.id] || [];
    const map = {};
    items.forEach((item) => {
      const key = folderItemKey(item);
      if (key) map[key] = itemHash(item);
    });
    snap.items[folder.id] = map;
  });

  // sobras locais: nunca vistas pela nuvem
  const local = await readLocalFolders();
  const mergedFolders = [...cloudFolders];
  const mergedItems = { ...cloudItemsMap };

  local.folders.filter(isSyncable).forEach((folder) => {
    if (knownFolders.has(folder.id)) return;
    mergedFolders.push(folder);
    mergedItems[folder.id] = local.itemsMap[folder.id] || [];
  });

  cloudFolders.forEach((folder) => {
    const localItems = local.itemsMap[folder.id] || [];
    const seen = knownItems[folder.id] || new Set();
    const extras = localItems.filter((item) => {
      const key = folderItemKey(item);
      return key && !seen.has(key);
    });
    if (extras.length) mergedItems[folder.id] = [...(mergedItems[folder.id] || []), ...extras];
  });

  await writeSnapshot(profileId, snap);
  // sobe as sobras (o diff contra o snapshot da nuvem so enxerga elas)
  await persistFolders(profileId, mergedFolders, mergedItems);

  return { folders: mergedFolders, itemsMap: mergedItems };
}
