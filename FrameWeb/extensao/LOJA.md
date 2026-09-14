# Publicar na Chrome Web Store

1. https://chrome.google.com/webstore/devconsole — taxa única de US$ 5 na
   primeira vez (conta Google).
2. **Novo item** → enviar `public/frame-extensao.zip` (gerado por
   `npm run zip-extensao`; contém só manifesto, dois scripts e ícone).
3. Ficha da loja (colar):

**Nome:** Frame — áudio dublado

**Resumo:** Deixa o site do Frame escolher a faixa de áudio (dublado ou
original) e tocar Dolby/DTS no navegador.

**Descrição:**
O Frame é um site pessoal de filmes e séries. Muitos arquivos trazem mais de
um áudio (dublado e original) no mesmo arquivo, mas o Chrome sozinho toca só o
primeiro e não decodifica Dolby (AC3/E-AC3) nem DTS. Esta extensão permite que
o site leia o arquivo de vídeo e escolha a faixa certa, decodificando o áudio
no próprio navegador. Ela só acrescenta cabeçalhos de CORS nas respostas dos
servidores de download usados pelo site (AllDebrid) e não interfere em
nenhuma outra página.

**Categoria:** Entretenimento · **Idioma:** Português (Brasil)

4. **Privacidade** (a loja pergunta):
   - Finalidade única: liberar CORS nos servidores do AllDebrid pro site do Frame.
   - Justificativa de `declarativeNetRequest` / `declarativeNetRequestWithHostAccess`:
     acrescentar cabeçalhos de CORS nas respostas de `*.debrid.it` e
     `*.alldebrid.com`, só pra pedidos originados em `frametv.pages.dev`.
   - Justificativa dos `host_permissions`: os domínios do AllDebrid (destino)
     e o site do Frame (origem — o Chrome exige os dois pra modificar cabeçalhos).
   - Não coleta dados. Não usa código remoto.
5. Imagens: ícone 128×128 (`icone.png`) e ao menos uma captura de 1280×800
   (o menu "Áudio deste arquivo" do player serve).
6. Visibilidade: **Não listada** basta — quem tem o link instala; ninguém
   precisa achar na busca. A revisão leva de horas a alguns dias.

Depois de aprovada, trocar no `PainelExtensao.jsx` o passo a passo do modo
do desenvolvedor por um botão "Instalar na Chrome Web Store" com o link.
