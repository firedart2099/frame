/**
 * Acrescenta os cabeçalhos de CORS nas respostas dos servidores de download
 * do AllDebrid — só neles, e só pra pedidos feitos por script (fetch), que é
 * como o motor DUAL do site lê o arquivo.
 *
 * É uma regra DINÂMICA registrada no arranque, em vez de um ruleset estático
 * no manifesto: medido em 11/09/2026, o ruleset estático carregava, o
 * `testMatchOutcome` dizia que casava, e nenhum pedido real era alterado. A
 * regra dinâmica, com o mesmo conteúdo, funcionou de primeira — é o desenho
 * das extensões "CORS Unblock", e é o que fica.
 */
const DOMINIOS = ['debrid.it', 'alldebrid.com', 'debrid.link'];
const REGRA = {
  id: 1,
  priority: 1,
  action: {
    type: 'modifyHeaders',
    responseHeaders: [
      { header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' },
      { header: 'Access-Control-Allow-Methods', operation: 'set', value: 'GET, HEAD, OPTIONS' },
      { header: 'Access-Control-Allow-Headers', operation: 'set', value: 'Range' },
      { header: 'Access-Control-Expose-Headers', operation: 'set', value: 'Content-Length, Content-Range, Accept-Ranges, Content-Type' },
    ],
  },
  condition: { requestDomains: DOMINIOS, resourceTypes: ['xmlhttprequest'] },
};

async function instalar() {
  const atuais = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: atuais.map((r) => r.id), addRules: [REGRA] });
}
chrome.runtime.onInstalled.addListener(instalar);
chrome.runtime.onStartup.addListener(instalar);
instalar().catch(() => {});

/**
 * Busca por procuração (desde a 1.2.0).
 *
 * O site pede um endereço; o pedido sai DAQUI, do service worker da
 * extensão, e a resposta volta inteira (status, cabeçalhos, corpo). Dentro da
 * extensão não existe CORS pros domínios em `host_permissions`, e o IP é o
 * da pessoa — que é o ponto: a API do MovieBox responde 440 pra qualquer IP
 * de datacenter (o `/api/resolve` do site nunca achou nada por isso) e não
 * manda CORS pro navegador. Com isto, o MovieBox passa a existir no site,
 * igual ao app.
 *
 * Só destinos da lista, só https, corpo em texto (as APIs falam JSON). Não é
 * um proxy geral: cada domínio novo entra aqui E em `host_permissions`.
 */
const DESTINOS_DE_BUSCA = [
  /(^|\.)aoneroom\.com$/, // MovieBox: API e CDN
  /(^|\.)inmoviebox\.com$/,
  /(^|\.)apibay\.org$/, // The Pirate Bay: 429 pro Cloudflare, sem CORS
  /(^|\.)debrid\.it$/,
  /(^|\.)alldebrid\.com$/,
  /(^|\.)debrid\.link$/,
];
const PRAZO_MAX_MS = 20000;
const CORPO_MAX_BYTES = 8 * 1024 * 1024;

async function buscar(pedido) {
  let url;
  try {
    url = new URL(String(pedido.url || ''));
  } catch (e) {
    return { erro: 'endereço inválido' };
  }
  if (url.protocol !== 'https:' || !DESTINOS_DE_BUSCA.some((re) => re.test(url.hostname))) {
    return { erro: `destino fora da lista: ${url.hostname}` };
  }
  const corte = new AbortController();
  const prazo = setTimeout(() => corte.abort(), Math.min(Number(pedido.prazoMs) || 12000, PRAZO_MAX_MS));
  try {
    const metodo = String(pedido.method || 'GET').toUpperCase();
    const r = await fetch(url, {
      method: metodo,
      headers: pedido.headers || {},
      body: metodo === 'GET' || metodo === 'HEAD' ? undefined : pedido.body ?? undefined,
      signal: corte.signal,
      credentials: 'omit',
      redirect: 'follow',
    });
    const tamanho = Number(r.headers.get('content-length')) || 0;
    if (metodo !== 'HEAD' && tamanho > CORPO_MAX_BYTES) return { erro: 'corpo grande demais' };
    const cabecalhos = {};
    r.headers.forEach((v, k) => {
      cabecalhos[k] = v;
    });
    const corpo = metodo === 'HEAD' ? '' : await r.text();
    return { status: r.status, cabecalhos, corpo, url: r.url };
  } catch (e) {
    return { erro: e && e.name === 'AbortError' ? 'prazo' : String((e && e.message) || e) };
  } finally {
    clearTimeout(prazo);
  }
}

// o site pergunta "você está aí?" e pede buscas pelo script de sonda
chrome.runtime.onMessage.addListener((msg, remetente, responder) => {
  // só o nosso content script (que só roda nos sites do manifesto)
  if (!remetente || remetente.id !== chrome.runtime.id) return false;

  if (msg === 'estado') {
    (async () => {
      let regras = [];
      try {
        regras = (await chrome.declarativeNetRequest.getDynamicRules()).map((r) => r.id);
      } catch (e) { /* sem permissão? o site trata como ausente */ }
      responder({ versao: chrome.runtime.getManifest().version, ok: regras.includes(1), busca: true });
    })();
    return true;
  }

  if (msg && msg.tipo === 'buscar') {
    buscar(msg).then(responder, (e) => responder({ erro: String((e && e.message) || e) }));
    return true;
  }

  return false;
});
