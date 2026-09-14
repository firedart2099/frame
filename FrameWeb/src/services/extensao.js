/**
 * A extensão do Chrome ("Frame — áudio dublado", em `extensao/`).
 *
 * Ela nasceu por um motivo só: o link do AllDebrid não manda
 * `Access-Control-Allow-Origin`, então o site consegue TOCAR o arquivo no
 * `<video>` mas não consegue LER os bytes — e ler os bytes é o que permite
 * escolher a faixa de áudio de um release DUAL e decodificar AC3/DTS
 * (`services/remux/`). A extensão acrescenta o cabeçalho nas respostas do
 * AllDebrid.
 *
 * Desde a 1.2.0 ela também faz **busca por procuração**
 * (`buscarPelaExtensao`): o pedido sai do service worker dela, do IP da
 * pessoa, e volta inteiro pro site. É o que deixa o MovieBox existir aqui —
 * a API dele responde 440 pra datacenter (o `/api/resolve` nunca achou nada)
 * e não manda CORS pro navegador.
 *
 * Como o site sabe que ela está instalada: o script de sonda dela roda em
 * cada página do Frame e deixa `data-frame-extensao='{"ok":true,...}'` no
 * `<html>`. Não é adivinhação por fetch — fetch falha por mil motivos.
 */

const CHAVE_NAO_MOSTRAR = 'frame:extensao:nao-mostrar';

function ler() {
  try {
    const bruto = document.documentElement.getAttribute('data-frame-extensao');
    return bruto ? JSON.parse(bruto) : null;
  } catch (e) {
    return null;
  }
}

/** Instalada e com a regra ativa? (síncrono: lê o que a sonda já deixou) */
export function temExtensao() {
  const e = ler();
  return !!(e && e.ok);
}

/** Pede à sonda pra conferir de novo e espera a resposta (até `ms`). */
export function conferirExtensao(ms = 400) {
  return new Promise((resolve) => {
    let feito = false;
    const acabar = () => {
      if (feito) return;
      feito = true;
      window.removeEventListener('frame-extensao', acabar);
      resolve(temExtensao());
    };
    window.addEventListener('frame-extensao', acabar);
    window.dispatchEvent(new Event('frame-extensao-pedir'));
    setTimeout(acabar, ms);
  });
}

/** A extensão instalada sabe buscar por procuração? (1.2.0 em diante) */
export function extensaoBusca() {
  const e = ler();
  return !!(e && e.ok && e.busca);
}

// ---------------------------------------------------------------- busca
// Cada pedido ganha um id; a resposta chega por `message` e casa pelo id.
let proximoId = 0;
const pendentes = new Map();
let ouvindo = false;
function ouvirRespostas() {
  if (ouvindo || typeof window === 'undefined') return;
  ouvindo = true;
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.frameExtensao !== 'resposta') return;
    const feito = pendentes.get(ev.data.id);
    if (!feito) return;
    pendentes.delete(ev.data.id);
    feito(ev.data.resposta);
  });
}

// Cabeçalho que o navegador nem deixaria mandar e que o service worker
// também não aceita: fora antes de atravessar a ponte.
const CABECALHOS_PROIBIDOS = new Set(['connection', 'host', 'content-length', 'user-agent', 'accept-encoding']);

/**
 * `fetch` que roda dentro da extensão. Mesma assinatura, devolve um
 * `Response` de verdade (status, headers, json(), text()) — dá pra entregar
 * a qualquer cliente que espere `fetch`, como o do MovieBox
 * (`usarTransporte`). Corpo só em texto: as APIs que interessam falam JSON.
 */
export function buscarPelaExtensao(url, init = {}) {
  ouvirRespostas();
  return new Promise((resolve, reject) => {
    if (!extensaoBusca()) {
      reject(new Error('extensão sem busca por procuração'));
      return;
    }
    const headers = {};
    const brutos = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : init.headers || {};
    for (const [k, v] of Object.entries(brutos)) {
      if (!CABECALHOS_PROIBIDOS.has(String(k).toLowerCase()) && v != null) headers[k] = String(v);
    }
    const id = ++proximoId;
    const prazo = setTimeout(() => {
      pendentes.delete(id);
      reject(new Error('a extensão não respondeu'));
    }, 25000);
    const abortar = () => {
      clearTimeout(prazo);
      pendentes.delete(id);
      reject(new DOMException('cancelado', 'AbortError'));
    };
    if (init.signal) {
      if (init.signal.aborted) {
        abortar();
        return;
      }
      init.signal.addEventListener('abort', abortar, { once: true });
    }
    pendentes.set(id, (r) => {
      clearTimeout(prazo);
      if (init.signal) init.signal.removeEventListener('abort', abortar);
      if (!r || r.erro) {
        reject(new Error(r?.erro || 'a extensão falhou'));
        return;
      }
      // Response não aceita corpo em 204/304 — nem precisa
      const semCorpo = r.status === 204 || r.status === 304 || !r.corpo;
      resolve(new Response(semCorpo ? null : r.corpo, { status: r.status, headers: r.cabecalhos || {} }));
    });
    window.postMessage(
      {
        frameExtensao: 'buscar',
        id,
        pedido: {
          url: String(url),
          method: init.method || 'GET',
          headers,
          body: init.body == null ? null : typeof init.body === 'string' ? init.body : String(init.body),
          prazoMs: 12000,
        },
      },
      window.location.origin
    );
  });
}

/** O navegador tem o que o motor precisa, além da extensão? */
export function navegadorServe() {
  return typeof MediaSource !== 'undefined' && typeof AudioEncoder !== 'undefined';
}

export function naoMostrarConvite() {
  try {
    return localStorage.getItem(CHAVE_NAO_MOSTRAR) === '1';
  } catch (e) {
    return false;
  }
}

export function marcarNaoMostrarConvite() {
  try {
    localStorage.setItem(CHAVE_NAO_MOSTRAR, '1');
  } catch (e) {
    /* sem localStorage: mostra de novo na próxima, paciência */
  }
}

/** Escolhe a faixa do arquivo pro idioma pedido ('pt', 'en', 'original'...). */
export function escolherFaixa(faixas, codigo, idiomaOriginal) {
  const ok = faixas.filter((f) => f.toca);
  if (!ok.length) return null;
  const alvo = codigo === 'original' ? idiomaOriginal || 'en' : codigo;
  const doIdioma = ok.find((f) => f.idioma === alvo);
  if (doIdioma) return doIdioma.numero;
  // idioma pedido não existe no arquivo: fica no padrão do arquivo
  return (ok.find((f) => f.padrao) || ok[0]).numero;
}
