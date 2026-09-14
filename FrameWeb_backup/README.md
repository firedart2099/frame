# Frame — site

Versão web do Frame. Mesmo Supabase, mesma conta, mesmas listas do app.

    Documents/
      Frame/        <- o app (React Native + Expo)
      FrameWeb/     <- este projeto

Os dois precisam ficar lado a lado: `npm run sync-app` copia os arquivos
compartilhados de `../Frame`.

## Rodar

    npm install
    npm run dev          # http://localhost:5173

`npm run dev` não serve as funções de `/api` (Vite não sabe delas). Pra testar
o player com as fontes do MovieBox/4KHDHub, use o runtime do Cloudflare:

    npm run build
    npx wrangler pages dev dist

Sem isso, o `/api/resolve` responde 404 e o player cai no AutoEmbed — que é
justamente o comportamento de segurança pretendido.

## Publicar (Cloudflare Pages)

    npm run build
    npx wrangler pages deploy dist --project-name=frametv --branch=main

Na primeira vez ele pede login e o nome do projeto. Sai um endereço
`frametv.pages.dev`, sem domínio nem cartão.

Alternativa pelo painel: **Cloudflare → Workers & Pages → Create → Pages →
Upload assets** e arrastar a pasta `dist`. As funções de `/api` sobem junto
porque moram em `functions/`.

## Antes de abrir pra alguém

1. **Rodar `db/allowlist.sql`** no SQL Editor do Supabase e colocar os e-mails
   dos convidados. Sem isso, ou ninguém entra, ou entra qualquer um — depende
   de você ter rodado o arquivo. A trava é um gatilho em `auth.users`, não uma
   checagem no navegador: não tem como furar chamando a API direto.
2. **Rodar `../Frame/db/schema.sql`**, se ainda não rodou. É o que cria as
   tabelas de sincronização que o site e o app compartilham.
3. Em **Authentication → URL Configuration**, adicionar o endereço do site em
   *Site URL* e *Redirect URLs*. Sem isso o link de confirmação do e-mail
   volta pro lugar errado.

Pra convidar alguém depois:

```sql
insert into public.allowed_emails (email, note)
values ('fulano@email.com', 'quem é')
on conflict (email) do nothing;
```

## Downloads dos APKs

A página `/#/downloads` lê `src/data/releases.js`. Pra publicar uma versão,
coloque-a no topo do array e faça o deploy — a primeira é sempre tratada como
a atual.

O APK **não** vai em `public/`: o Cloudflare Pages recusa arquivo acima de
~25 MB. Desde 12/09/2026 ele mora no **Storage do Supabase** (bucket público
`app`, mesmo projeto do site): o R2 não está ligado na conta e não há GitHub
na máquina. O plano grátis aceita 50 MB por arquivo, então o build é **só
arm64** (`gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a`,
26 MB; o universal tem 62 MB). Subir versão nova:

    cd ../Frame
    NODE_PATH=node_modules node ../FrameWeb/scripts/upload-apk.cjs app-release.apk frame-X.Y.Z.apk

(o script usa `SUPABASE_SERVICE_ROLE_KEY` do `.env` do app e imprime a URL
pública; cole-a em `src/data/releases.js`). A landing mostra a versão mais
nova direto no cartão "O app", nas duas caras.

## Como o projeto está dividido

    src/
      App.jsx              rota + a decisão celular/PC
      AppShell.jsx         o Frame logado (carregado sob demanda)
      lib/FrameContext.jsx estado do usuário — o equivalente ao App.js do app
      lib/tmdb.js          TMDB: busca, detalhes, banner
      pages/               Landing, Downloads, Auth, Profiles, Onboarding,
                           Home, Library, Settings
      components/          Header, Card/Row, DetailsModal, Player, import
      services/            copiados do app (ver abaixo) + letterboxd.js
      shims/               AsyncStorage -> localStorage, AppState -> visibilidade
      styles/              theme.css (tokens), landing.css, app.css, downloads.css
    functions/
      api/resolve.js       procura links de vídeo (roda no servidor por CORS)
      api/proxy.js         repassa o vídeo com CORS e Referer; reescreve HLS
      api/legenda.js       url de legenda (.zip Yify/Podnapisi, .srt, .vtt) ->
                           .srt em UTF-8. Existe pro "assistir na TV" do app:
                           o Web Video Caster só lê .srt puro
      _providers/          MovieBox e 4KHDHub convertidos pra ESM

### O que vem do app

`npm run sync-app` copia e adapta:

- `src/services/sync/*`, `watchProgress.js`, `playbackPrefs.js` — a camada de
  sincronização, igualzinha à do app. Os imports nativos são resolvidos pelos
  shims via alias no `vite.config.js`.
- `src/services/shelves.js`, `ratings.js` — as prateleiras e as notas.
- `functions/_providers/*` — os provedores de vídeo, convertidos de CommonJS
  pra ESM (o Worker não tem `require` nem `Buffer`).

**Não edite esses arquivos aqui.** Eles têm um aviso no topo. Mexa no app e
rode o script de novo, senão os dois lados divergem.

## Decisões que valem lembrar

**Celular é só landing + downloads.** Assistir no telefone é trabalho do app.
O site no celular existe pra levar a pessoa até ele — e por isso o primeiro
carregamento não traz o supabase-js nem nenhuma tela interna (68 kB gzip no
total, contra 190 kB se viesse tudo junto).

**Sem aba de downloads no PC.** Quem está no computador já está no lugar
certo. A rota continua funcionando por link direto, pra quando você quiser
mandar o APK pra alguém.

**O player é montado uma vez só.** Ele alterna entre tela cheia e janelinha
flutuante trocando de classe CSS, nunca remontando o `<video>`/`<iframe>` —
senão o filme voltava do zero a cada minimizada, que é exatamente o que o
miniplayer existe pra evitar.

**Todo vídeo passa pelo `/api/proxy`.** Não é frescura: o navegador barra o
stream por CORS e a origem quase sempre exige `Referer`. O proxy também
reescreve as playlists `.m3u8`, senão o player pediria os segmentos direto e
esbarraria no mesmo bloqueio.

**As fontes do MovieBox/4KHDHub NÃO funcionam a partir do Worker.** Medido em
2026-09-08, com `/api/resolve?...&debug=1`:

- MovieBox devolve `status 440` pra qualquer host do pool quando a chamada sai
  do Cloudflare. O mesmo código, com a mesma assinatura, funciona rodando na
  máquina local — ou seja, a API recusa IP de datacenter, não é bug nosso.
- O 4KHDHub devolveu `HTTP 502` inclusive fora do Worker: o site estava fora
  do ar (esses domínios rodam bastante).

O resolver ficou no lugar de propósito: ele custa nada quando não acha nada, e
volta a servir se algum provedor parar de bloquear ou se você plugar outro.
Mas hoje, na prática, **quem toca vídeo no site é o AutoEmbed**. Pra reproduzir
o diagnóstico: `curl "https://frametv.pages.dev/api/resolve?type=movie&title=The%20Matrix&year=1999&debug=1"`.

**O AutoEmbed é sempre a primeira opção.** É iframe, funciona sem servidor
nenhum. As fontes do MovieBox/4KHDHub entram por cima quando o `/api/resolve`
acha alguma — se elas caírem, ninguém fica sem assistir.

**Design: horizontal, não é o app espremido.** O banner usa o backdrop 16:9
com o logo do título e o texto ancorado à esquerda; "Continuar assistindo" usa
still deitado em vez de pôster (mostra a cena onde você parou e ocupa melhor a
largura); as fileiras ganharam setas, porque no PC não existe arrastar com o
dedo.

## Áudio dublado num arquivo só: o motor DUAL (`src/services/remux/`)

Um release DUAL traz o vídeo 1080p com o áudio original E o dublado no mesmo
arquivo. O Chrome sozinho toca o primeiro áudio que encontra e não decodifica
Dolby (AC3/E-AC3) nem DTS — que é o que "DUAL 5.1" brasileiro quase sempre é.
O motor resolve os dois sem transcodificar vídeo em lugar nenhum:

    fonteHttp.js   bytes por Range (precisa de CORS — ver extensão)
    ebml.js        leitor EBML
    matroska.js    demuxer .mkv por pedaços: faixas, Cues, blocos
    h264.js        string de codec + DTS a partir do PTS (B-frames)
    fmp4.js        escritor de fMP4 (init + moof/mdat) pro MediaSource
    audioDolby.js  AC3/E-AC3/DTS -> PCM (WASM, @audio/decode-*) -> Opus (AudioEncoder)
    sonda.js       sondagem pelo cabeçalho (2 MB, ~1 s): codec e faixas
    motor.js       orquestra tudo num MediaSource; trocarAudio() troca a faixa

Vídeo H.264 vai direto pro decodificador de hardware via MediaSource; só o
áudio Dolby passa por WASM (AC3 a ~200x tempo real). Áudio e vídeo ficam no
MESMO relógio — pausa, seek, velocidade e sincronia vêm de graça. É o que
substituiu o "som de outro arquivo" (`audioSeparado.js`), que dividia a banda
em dois downloads e engasgava.

**Precisa da extensão** (`extensao/`): o AllDebrid não manda CORS, e 503 pro
Cloudflare — o site só consegue LER os bytes com ela. Sem ela, o player toca
como antes (primeiro áudio do arquivo) e convida a instalar uma vez
(`PainelExtensao.jsx`). `npm run build` gera `public/frame-extensao.zip`.

Desde a 1.2.0 a extensão também faz **busca por procuração**
(`buscarPelaExtensao` em `services/extensao.js`): um `fetch` que roda dentro
do service worker dela, do IP da pessoa, sem CORS. Duas fontes só existem no
site por causa disso — **The Pirate Bay** (`services/apibay.js`, entra na
lista de hashes junto com o `/api/busca`) e **MovieBox**
(`services/movieboxNavegador.js`, o cliente do app com a extensão como
transporte). Ver `extensao/LEIA-ME.md` pro que foi medido — inclusive que o
MovieBox estava devolvendo um stub de 930 KB pra tudo em 12/09/2026.

Regras medidas em arquivos reais (11/09/2026):

- Vídeo é descartado até o primeiro keyframe depois de qualquer seek — há
  release que começa com 1,4 s de quadros P sem IDR.
- O AllDebrid limita conexões simultâneas por link (503 pras demais): o motor
  lê em sequência e a sondagem de .mkv roda um de cada vez.
- Leitura HTTP que falha no meio NÃO é fim de arquivo: o motor espera e
  continua de onde o player está. Tratar como fim fechava o fluxo e a duração
  "virava" o que estava bufferizado — daí "este arquivo parece outro filme".
- Qualidade medida é pela LARGURA: filme 2.40:1 em 1080p vem 1920×800.
- Num pack de vários filmes, o `/api/unlock` recebe `titulo`/`original` e
  escolhe o arquivo que casa — o maior era Era de Ultron.

Teste do demuxer sem navegador: `node scripts/test-mkv.mjs cabeca.bin rabo.bin
<tamanho>` (pedaços baixados por Range). Teste no navegador:
`npx vite` → `http://localhost:5173/teste-motor.html` (com a extensão).
