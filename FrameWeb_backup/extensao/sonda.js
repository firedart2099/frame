// Roda no site do Frame e deixa um atributo no <html> dizendo que a extensão
// está aqui e funcionando. O player lê isso antes de decidir como abrir o
// arquivo. O site pode pedir de novo com
// `window.dispatchEvent(new Event('frame-extensao-pedir'))`.
function perguntar() {
  chrome.runtime.sendMessage('estado', (estado) => {
    const e = chrome.runtime.lastError ? { ok: false, erro: chrome.runtime.lastError.message } : estado;
    document.documentElement.setAttribute('data-frame-extensao', JSON.stringify(e || { ok: false }));
    window.dispatchEvent(new CustomEvent('frame-extensao', { detail: e }));
  });
}
perguntar();
window.addEventListener('frame-extensao-pedir', perguntar);

// Ponte da busca por procuração: a página manda
//   window.postMessage({ frameExtensao: 'buscar', id, pedido }, origem)
// e recebe de volta
//   { frameExtensao: 'resposta', id, resposta }
// O service worker (fundo.js) é quem faz o pedido; aqui só se repassa. Só se
// aceita mensagem da PRÓPRIA janela — iframe de terceiro não entra.
window.addEventListener('message', (ev) => {
  if (ev.source !== window || !ev.data || ev.data.frameExtensao !== 'buscar') return;
  const { id, pedido } = ev.data;
  const devolver = (resposta) =>
    window.postMessage({ frameExtensao: 'resposta', id, resposta }, window.location.origin);
  try {
    chrome.runtime.sendMessage({ tipo: 'buscar', ...(pedido || {}) }, (resposta) => {
      devolver(chrome.runtime.lastError ? { erro: chrome.runtime.lastError.message } : resposta || { erro: 'sem resposta' });
    });
  } catch (e) {
    // extensão recarregada com a página aberta: o contexto morre e o
    // `sendMessage` estoura. A página trata como "não deu" e segue sem.
    devolver({ erro: String((e && e.message) || e) });
  }
});
