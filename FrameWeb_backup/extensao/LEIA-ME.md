# Extensão "Frame — áudio dublado"

O link do AllDebrid não manda `Access-Control-Allow-Origin`, e sem isso o
navegador deixa o `<video>` tocar o arquivo mas não deixa o site LER os bytes.
Ler os bytes é o que permite escolher a faixa de áudio de um release DUAL
(dublado ou original no mesmo arquivo) e decodificar AC3/E-AC3/DTS, que o
Chrome não toca sozinho — o motor em `src/services/remux/`. Passar pelo
servidor não dá: o AllDebrid responde 503 pra IP de datacenter.

A extensão faz duas coisas:

1. **CORS no AllDebrid** — acrescenta os cabeçalhos de CORS nas respostas de
   `*.debrid.it` / `*.alldebrid.com`, pra pedidos feitos por script.
2. **Busca por procuração** (desde a 1.2.0) — o site manda um endereço pelo
   `sonda.js` (`window.postMessage`), o service worker (`fundo.js`) faz o
   pedido de dentro da extensão e devolve status, cabeçalhos e corpo. O pedido
   sai do IP da pessoa, e dentro da extensão não existe CORS. Só destinos da
   lista `DESTINOS_DE_BUSCA` (e do `host_permissions`), só https, corpo em
   texto. É o que dá ao site:
   - **The Pirate Bay** (`apibay.org`): 429 pro Cloudflare, sem CORS.
     `src/services/apibay.js` entra na mesma lista de hashes do `/api/busca`.
   - **MovieBox** (`aoneroom.com`): a API responde 440 pra datacenter — o
     `/api/resolve` nunca achou nada por isso. `src/services/movieboxNavegador.js`
     usa o cliente do app com a extensão como transporte (`usarTransporte`).
     Medido em 12/09/2026: a API devolvia o MESMO .mp4 de 930 KB pra qualquer
     filme (stub anti-abuso), então cada link passa por um HEAD e menos de
     3 MB é descartado. Quando o MovieBox voltar a servir arquivo, aparece
     sozinho.

Não lê, não altera e não vê o conteúdo de nenhuma página. O `sonda.js` avisa
o site que ela está instalada (atributo `data-frame-extensao` no `<html>`,
com `busca: true` quando sabe buscar) e repassa os pedidos de busca.

## O que foi medido em 11/09/2026 (e não está na documentação do Chrome)

- **Ruleset estático não aplicou; regra dinâmica aplicou.** Mesmo conteúdo,
  mesma condição; `getEnabledRulesets` dizia carregado e `testMatchOutcome`
  dizia que casava, e nenhum pedido real era alterado. Com
  `updateDynamicRules` no arranque do service worker, funcionou de primeira.
- **`host_permissions` precisa incluir a ORIGEM do pedido**, não só o destino.
  Só `*.debrid.it` → nada acontece. `*.debrid.it` + `frametv.pages.dev` +
  `localhost` → funciona. É o que evita pedir "todos os sites".
- O AllDebrid **limita conexões simultâneas por link**: pedidos além do
  limite recebem 503. Por isso o motor lê em sequência e a sondagem de .mkv
  roda um de cada vez.

## Instalar (enquanto não está na Web Store)

1. `chrome://extensions` → **Modo do desenvolvedor** → **Carregar sem
   compactação** → esta pasta (ou a pasta extraída de `frame-extensao.zip`,
   que o site oferece em `/frame-extensao.zip`).
2. Recarregar o site. O menu de áudio passa a listar "Áudio deste arquivo".

Mudou algo aqui? Suba a `version` no `manifest.json` — o `npm run build`
regenera o zip que o site distribui.

## Publicar na Web Store

Ver `LOJA.md`.
