/**
 * The Pirate Bay (apibay) pela extensão.
 *
 * O apibay responde 429 pro Cloudflare — por isso ele NÃO está no `/api/busca`
 * do site, que é de onde o app e o site tiram EZTV, Knaben e os sites BR. E
 * não manda CORS, então o navegador sozinho também não lê. Pela busca por
 * procuração da extensão o pedido sai do computador da pessoa, e a lista do
 * TPB entra como mais uma fonte de hashes, no mesmo formato que o
 * `/api/busca` devolve (`buscarExtras` em torrentio.js). O `/api/unlock`
 * destrava o hash como qualquer outro.
 *
 * Só entra o que é vídeo (categoria 2xx), com seeder, e que bate com o que
 * foi pedido: quando o apibay traz o `imdb` do torrent, ele é a prova; sem
 * ele, o nome tem que trazer o episódio (série) ou o ano (filme).
 */
import { buscarPelaExtensao, extensaoBusca } from './extensao';

const CATEGORIA_VIDEO = /^2\d\d$/; // 201 filme, 205 série, 207 filme HD, 208 série HD, ...
const pad2 = (n) => String(n).padStart(2, '0');

async function consultar(q) {
  const r = await buscarPelaExtensao(`https://apibay.org/q.php?q=${encodeURIComponent(q)}&cat=0`);
  if (!r.ok) return [];
  const lista = await r.json();
  // "sem resultado" é um item com id "0", não uma lista vazia
  return (Array.isArray(lista) ? lista : []).filter((t) => t && t.id !== '0' && t.info_hash);
}

export async function buscarApibay({ imdbId = null, titulo, type = 'movie', season = 1, episode = 1, ano = null }) {
  if (!extensaoBusca() || !titulo) return [];

  const episodioTag = type === 'tv' ? `S${pad2(season)}E${pad2(episode)}` : null;
  const temporadaTag = type === 'tv' ? `S${pad2(season)}` : null;
  const consultas =
    type === 'tv'
      ? [`${titulo} ${episodioTag}`]
      : [`${titulo} ${ano || ''}`.trim(), ...(ano ? [titulo] : [])];

  const vistos = new Set();
  const saida = [];
  for (const q of consultas) {
    let lista = [];
    try {
      lista = await consultar(q);
    } catch (e) {
      continue; // extensão fora, apibay fora: sem essa fonte, com as outras
    }
    for (const t of lista) {
      const hash = String(t.info_hash).toLowerCase();
      if (vistos.has(hash)) continue;
      if (!CATEGORIA_VIDEO.test(String(t.category))) continue;
      if (Number(t.seeders) < 1) continue;
      const nome = String(t.name || '');
      const imdbCasa = imdbId && t.imdb ? t.imdb === imdbId : null;
      if (imdbCasa === false) continue;
      if (imdbCasa === null) {
        if (type === 'tv') {
          // o episódio, ou o pack da temporada (o /api/unlock acha o arquivo)
          const re = new RegExp(`\b${episodioTag}\b|\b${temporadaTag}\b(?!E\d)|season[ ._-]*0?${season}\b|temporada[ ._-]*0?${season}\b`, 'i');
          if (!re.test(nome)) continue;
        } else if (ano && !nome.includes(String(ano))) {
          continue;
        }
      }
      vistos.add(hash);
      saida.push({
        infoHash: hash,
        _fonte: 'apibay',
        _bytes: Number(t.size) || null,
        _idioma: null, // o nome do release diz (idiomaDe)
        fileIdx: null,
        name: nome,
        title: nome,
        _origem: 'apibay',
      });
    }
    if (saida.length) break; // a consulta mais específica bastou
  }
  return saida;
}
