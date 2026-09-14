// GERADO POR `npm run sync-app` — copia de ../Frame. Nao edite aqui:
// mexa no app e rode o script de novo, senao os dois lados divergem.
import { TMDB_API_KEY } from './constants';

/**
 * As recomendações, iguais no app e no site.
 *
 * Este arquivo existe porque as duas casas divergiram: o site tinha o filtro
 * de "já vi" e a prateleira de rever, o app tinha as duas linhas do Letterboxd
 * e o "porque você assistiu". Cada um com metade — e nenhuma das metades
 * funcionando direito.
 *
 * O bug que estragava tudo era o mesmo nos dois: **o CSV do Letterboxd não tem
 * id do TMDB**, só nome e ano. Quem resolvia o id resolvia na hora de desenhar
 * e jogava fora em seguida, então o conjunto de "já assistidos" ficava quase
 * vazio — e a Home recomendava, com toda a confiança, o filme que a pessoa viu
 * ano passado. Aqui a resolução é feita uma vez, aos poucos, e guardada num
 * mapa que **sincroniza** (`profile_settings`), então o trabalho vale pro
 * celular, pro site e pra TV.
 */

const BASE = 'https://api.themoviedb.org/3';

/** Id do TMDB de qualquer formato de item que circula por aqui. */
export const idDe = (item) =>
  item?.id || item?.tmdbId || item?.tmdb_id || item?.media_id || null;

/** Chave estável de um filme do CSV: nome e ano, que é tudo o que ele tem. */
export const chaveLbxd = (item) => {
  const nome = String(item?.Name || item?.name || item?.title || '').trim().toLowerCase();
  if (!nome) return null;
  const ano = String(item?.Year || item?.year || '').trim();
  return ano ? `${nome}|${ano}` : nome;
};

const nota = (item) => {
  const n = parseFloat(item?.Rating ?? item?.rating);
  return Number.isFinite(n) ? n : null;
};

/**
 * Resolve os ids que faltam, aos poucos.
 *
 * `limite` existe porque um diário do Letterboxd tem milhares de linhas: sair
 * pedindo tudo de uma vez é castigar a TMDB e o boot do app. Cada sessão
 * resolve um pedaço e o mapa cresce; da segunda ou terceira abertura em diante
 * já não sobra nada pra resolver.
 */
export async function resolverIdsLbxd(itens, mapaAtual = {}, { limite = 60 } = {}) {
  const mapa = { ...mapaAtual };
  const pendentes = [];

  for (const item of itens || []) {
    const id = idDe(item);
    const chave = chaveLbxd(item);
    if (!chave) continue;
    if (id) { mapa[chave] = Number(id); continue; }
    if (mapa[chave] !== undefined) continue; // já resolvido (ou já deu não-achei)
    pendentes.push({ chave, item });
  }

  const fila = pendentes.slice(0, limite);
  if (!fila.length) return { mapa, resolvidos: 0, faltam: Math.max(0, pendentes.length - fila.length) };

  // de 8 em 8: paralelo o bastante pra ser rápido, contido o bastante pra não
  // tomar 429 da TMDB no meio do boot
  let resolvidos = 0;
  for (let i = 0; i < fila.length; i += 8) {
    const lote = fila.slice(i, i + 8);
    await Promise.all(
      lote.map(async ({ chave, item }) => {
        try {
          const nome = encodeURIComponent(item.Name || item.name || item.title || '');
          const ano = item.Year || item.year;
          const url = `${BASE}/search/movie?api_key=${TMDB_API_KEY}&query=${nome}${ano ? `&year=${ano}` : ''}&language=pt-BR`;
          const json = await (await fetch(url)).json();
          const achado = (json.results || [])[0];
          // 0 = "procurei e não existe": evita procurar de novo pra sempre
          mapa[chave] = achado?.id ? Number(achado.id) : 0;
          if (achado?.id) resolvidos += 1;
        } catch (e) {
          /* deixa pendente: tenta na próxima sessão */
        }
      })
    );
  }

  return { mapa, resolvidos, faltam: Math.max(0, pendentes.length - fila.length) };
}

/** Ids de uma pasta importada, usando o mapa pra quem ainda não tem id. */
export function idsDaPasta(itens, mapa = {}) {
  const ids = [];
  for (const item of itens || []) {
    const direto = Number(idDe(item));
    if (direto) { ids.push(direto); continue; }
    const chave = chaveLbxd(item);
    const doMapa = chave ? Number(mapa[chave]) : 0;
    if (doMapa) ids.push(doMapa);
  }
  return ids;
}

/**
 * Tudo que a pessoa já viu — o conjunto que NÃO pode voltar como recomendação.
 *
 * Três fontes, e as três importam: o diário do Letterboxd (o que ela viu antes
 * do Frame existir), o que terminou aqui dentro, e a taxa de conclusão que o
 * perfil de gosto guarda.
 */
export function idsJaVistos({ itemsMap = {}, taste = null, continueWatching = [], mapaLbxd = {} } = {}) {
  const ids = new Set();
  const add = (v) => { const n = Number(v); if (n) ids.add(n); };

  const conclusao = taste?.implicit_interactions?.completion_rate;
  if (conclusao) Object.keys(conclusao).forEach(add);

  for (const pasta of ['lbxd_watched', 'lbxd_diary', 'native_history']) {
    idsDaPasta(itemsMap[pasta], mapaLbxd).forEach(add);
  }

  for (const item of continueWatching || []) {
    if (item?.progressCompleted || Number(item?.progressRatio) >= 0.9) add(idDe(item));
  }

  return ids;
}

/** Tira da prateleira o que já foi visto. */
export function semVistos(itens, vistos) {
  if (!vistos || !vistos.size) return itens || [];
  return (itens || []).filter((m) => !vistos.has(Number(idDe(m))));
}

/**
 * "Vale a pena ver de novo": os ÚNICOS títulos que merecem reaparecer depois
 * de vistos — favoritos declarados no perfil e o que levou nota alta no
 * Letterboxd. Sem esse corte, a prateleira vira "tudo que você já viu".
 */
export function idsParaRever({ itemsMap = {}, taste = null, mapaLbxd = {}, limite = 18 } = {}) {
  const ids = [];
  const vistos = new Set();
  const add = (v) => {
    const n = Number(v);
    if (n && !vistos.has(n)) { vistos.add(n); ids.push(n); }
  };

  (taste?.explicit_interactions?.liked || []).forEach(add);

  const bemAvaliados = (itemsMap.lbxd_watched || [])
    .filter((m) => (nota(m) ?? 0) >= 3.5)
    .sort((a, b) => (nota(b) ?? 0) - (nota(a) ?? 0));
  idsDaPasta(bemAvaliados, mapaLbxd).forEach(add);

  return ids.slice(0, limite);
}

/** "Sua watchlist do Letterboxd": o que ela marcou pra ver e ainda não viu. */
export function idsDaWatchlistLbxd({ itemsMap = {}, mapaLbxd = {}, vistos = null, limite = 20 } = {}) {
  const ids = idsDaPasta(itemsMap.lbxd_watchlist, mapaLbxd);
  const filtrados = vistos ? ids.filter((id) => !vistos.has(id)) : ids;
  return filtrados.slice(0, limite);
}

/** Busca uma lista de ids na TMDB (filme). Ignora o que não existe mais. */
export async function buscarFilmes(ids, { limite = 18 } = {}) {
  const alvo = (ids || []).slice(0, limite);
  const itens = await Promise.all(
    alvo.map(async (id) => {
      try {
        const json = await (await fetch(`${BASE}/movie/${id}?api_key=${TMDB_API_KEY}&language=pt-BR`)).json();
        return json?.poster_path ? { ...json, media_type: 'movie' } : null;
      } catch (e) {
        return null;
      }
    })
  );
  return itens.filter(Boolean);
}

/**
 * "Porque você assistiu X" — a partir do que a pessoa terminou ou salvou.
 *
 * Usa `/similar` do próprio título, que é a recomendação que tem contexto:
 * ela vem com o motivo escrito no rótulo, e motivo é o que faz a pessoa clicar.
 */
export async function linhasPorqueAssistiu({ bases = [], vistos = null, limite = 3 } = {}) {
  const escolhidas = (bases || []).filter((b) => idDe(b)).slice(0, limite);
  const linhas = await Promise.all(
    escolhidas.map(async (base) => {
      const id = idDe(base);
      const nome = base.title || base.name;
      const tipo =
        base.type === 'tv' || base.media_type === 'tv' || base.first_air_date ? 'tv' : 'movie';
      try {
        const json = await (await fetch(`${BASE}/${tipo}/${id}/similar?api_key=${TMDB_API_KEY}&language=pt-BR&page=1`)).json();
        const itens = semVistos((json.results || []).filter((m) => m.poster_path), vistos);
        if (itens.length < 6) return null;
        return { id: `similar-${tipo}-${id}`, title: `Porque você assistiu ${nome}`, reason: `Porque você assistiu ${nome}`, type: tipo, items: itens, movies: itens };
      } catch (e) {
        return null;
      }
    })
  );
  return linhas.filter(Boolean);
}
