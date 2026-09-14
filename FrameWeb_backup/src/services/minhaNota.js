import { getSetting, SETTING_LBXD_RATINGS } from './sync/settings';

/**
 * A SUA nota do Letterboxd, vinda do CSV que você importou.
 *
 * A nota pública do Letterboxd deixou de ser obtível: o site está atrás de um
 * desafio do Cloudflare (`cf-mitigated: challenge`, a página "Just a
 * moment..."), que só passa quem executa o JavaScript do desafio num
 * navegador de verdade. Nem o nosso servidor nem a máquina do usuário
 * conseguem ler aquela página — dá 403 nos dois.
 *
 * O que sobra é melhor: o `ratings.csv` do seu export tem a nota que VOCÊ deu.
 * Ela é mais útil que a média de estranhos, já está sincronizada em
 * `profile_settings` e não depende de raspar nada.
 *
 * O casamento é por nome + ano, porque o CSV do Letterboxd não traz id da
 * TMDB. É a mesma chave que o resto do import usa.
 */

const semAcento = (t) =>
  String(t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const chave = (nome, ano) => `${semAcento(nome)}|${String(ano || '').slice(0, 4)}`;

let cache = { perfil: null, mapa: null };

async function mapaDeNotas(profileId) {
  if (cache.perfil === profileId && cache.mapa) return cache.mapa;
  const lista = (await getSetting(profileId, SETTING_LBXD_RATINGS, [])) || [];
  const mapa = new Map();
  for (const r of lista) {
    const nota = Number(r.Rating);
    if (!r.Name || !Number.isFinite(nota)) continue;
    mapa.set(chave(r.Name, r.Year), nota);
  }
  cache = { perfil: profileId, mapa };
  return mapa;
}

/**
 * Devolve a sua nota (0..5) ou null. Tenta o título em português e o
 * original: o CSV guarda o nome em inglês, e a TMDB devolve o traduzido.
 */
export async function minhaNotaLetterboxd(profileId, item) {
  if (!profileId || !item) return null;
  const mapa = await mapaDeNotas(profileId);
  if (!mapa.size) return null;

  const ano = String(item.release_date || item.first_air_date || '').slice(0, 4);
  const candidatos = [item.original_title, item.title, item.name, item.original_name].filter(Boolean);

  for (const nome of candidatos) {
    const achou = mapa.get(chave(nome, ano));
    if (achou !== undefined) return achou;
  }

  // ano da TMDB às vezes difere um ano do Letterboxd (lançamento vs estreia)
  for (const nome of candidatos) {
    for (const delta of [-1, 1]) {
      const achou = mapa.get(chave(nome, String(Number(ano) + delta)));
      if (achou !== undefined) return achou;
    }
  }
  return null;
}

/** Esquece o cache — usar depois de reimportar. */
export const limparCacheDeNotas = () => {
  cache = { perfil: null, mapa: null };
};
