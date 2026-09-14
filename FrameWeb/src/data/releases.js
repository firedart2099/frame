/**
 * Versões do app do Frame — é isso aqui que alimenta a página /downloads.
 *
 * Pra publicar uma versão nova: coloca ela no TOPO do array e roda o deploy.
 * A primeira da lista é sempre tratada como a atual.
 *
 * Sobre o `url` do arquivo:
 *   O Cloudflare Pages recusa arquivo acima de ~25 MB, e APK passa disso
 *   fácil. Então NÃO coloque o .apk em public/. Sobe ele num GitHub Release
 *   (ou num bucket R2) e aponta a URL pra lá — o botão de baixar é um link
 *   comum, funciona igual.
 *
 * Campos:
 *   version   "1.2.0"
 *   versionCode 7     (o do build.gradle; e o que o app compara pra atualizar)
 *   date      "2026-09-07"  (ISO; vira "7 de setembro de 2026" na tela)
 *   size      "38 MB"       (opcional, texto livre)
 *   channel   "estavel" | "beta"
 *   files     [{ label, platform, url, note? }]
 *   changes   [{ kind: 'novo'|'melhor'|'correcao', text }]
 */

export const RELEASES = [
  {
    version: '1.5.0',
    versionCode: 23,
    date: '2026-09-13',
    size: '27 MB',
    channel: 'estavel',
    files: [
      {
        label: 'Android & Android TV',
        platform: 'android',
        url: 'https://github.com/firedart2099/frame/releases/download/v1.5.0/frame-1.5.0.apk',
        note: 'Celular, tablet e TV (D-pad)  Android 8+',
      },
    ],
    changes: [
      { kind: 'novo', text: 'Aplicativo 100% nativo para Android TV! Código de pareamento na tela e D-pad otimizado.' },
      { kind: 'novo', text: 'Ícone de Cast (TV) na barra superior do celular para conectar rapidamente e controlar a reprodução.' },
      { kind: 'melhor', text: 'Atualização nativa OTA. Agora a versão baixada no celular carrega a assinatura correta e o update loop infinito foi corrigido.' }
    ]
  },
  {
    version: '1.3.4',
    versionCode: 21,
    date: '2026-09-13',
    size: '26 MB',
    channel: 'estavel',
    files: [
      {
        label: 'Android',
        platform: 'android',
        url: 'https://viigaxgbimmjudbuhoqh.supabase.co/storage/v1/object/public/app/frame-1.3.4.apk',
        note: 'Celular e tablet · Android 8+',
      },
    ],
    changes: [
      { kind: 'correcao', text: '"O Frame foi fechado devido a um erro interno" ao dar play num arquivo cujo som não toca no aparelho (JoJo): o player tentava trocar de arquivo e caía numa função que não tinha sido importada. Agora troca.' },
      { kind: 'correcao', text: 'JoJo T1 abria "Stone Ocean" (que é a T5): pack de anime nomeado pela parte, sem número de temporada, passava por qualquer temporada. Agora a busca sabe o nome de cada temporada pela TMDB e descarta o release que cita outra — no app e no site.' },
      { kind: 'correcao', text: 'O cartão da coleção não pisca mais o filme anterior na troca de fundo: são duas camadas fixas, a nova entra por cima e a antiga só apaga por baixo.' },
    ],
  },
  {
    version: '1.3.2',
    versionCode: 19,
    date: '2026-09-13',
    size: '26 MB',
    channel: 'estavel',
    files: [
      {
        label: 'Android',
        platform: 'android',
        url: 'https://viigaxgbimmjudbuhoqh.supabase.co/storage/v1/object/public/app/frame-1.3.2.apk',
        note: 'Celular e tablet · Android 8+',
      },
    ],
    changes: [
      { kind: 'novo', text: 'Buscar "marvel", "star wars", "harry potter", "batman" ou "jojo" mostra a coleção antes dos filmes — no app e no site.' },
      { kind: 'novo', text: 'As coleções chegaram ao site: cartões na Home, página própria (frametv.pages.dev/#/colecao/marvel) e "Salvar coleção" que vira pasta na Biblioteca.' },
    ],
  },
  {
    version: '1.3.1',
    versionCode: 18,
    date: '2026-09-13',
    size: '26 MB',
    channel: 'estavel',
    files: [
      {
        label: 'Android',
        platform: 'android',
        url: 'https://viigaxgbimmjudbuhoqh.supabase.co/storage/v1/object/public/app/frame-1.3.1.apk',
        note: 'Celular e tablet · Android 8+',
      },
    ],
    changes: [
      { kind: 'melhor', text: 'O cartão da coleção na Home virou um slideshow: o fundo passa pelos filmes da coleção, um a cada 3 segundos, com fade suave. Os três posters em leque saíram.' },
    ],
  },
  {
    version: '1.3.0',
    versionCode: 17,
    date: '2026-09-13',
    size: '26 MB',
    channel: 'estavel',
    files: [
      {
        label: 'Android',
        platform: 'android',
        url: 'https://viigaxgbimmjudbuhoqh.supabase.co/storage/v1/object/public/app/frame-1.3.0.apk',
        note: 'Celular e tablet · Android 8+',
      },
    ],
    changes: [
      { kind: 'novo', text: 'Doze coleções novas: Pixar, Studio Ghibli, Disney Animação (por era), DreamWorks, Grandes sagas de ação (Missão: Impossível, 007, Jurassic, Velozes, John Wick, Rocky e Creed), Monstros (Alien, Predador, Godzilla e Kong), Christopher Nolan, Quentin Tarantino, Dragon Ball, Animes de longa data (JoJo, One Piece, Naruto e cia.), Oscar de Melhor Filme e Cinema brasileiro.' },
      { kind: 'melhor', text: 'O cartão da coleção na Home ganhou vida: banner com zoom lento, três posters em leque e o fio da cor da coleção.' },
      { kind: 'correcao', text: 'Banner e posters das coleções não carregavam: o app pedia tudo à TMDB de uma vez e levava bloqueio. Agora vai em fila e repete quando o servidor pede calma.' },
    ],
  },
  {
    version: '1.2.9',
    versionCode: 16,
    date: '2026-09-13',
    size: '26 MB',
    channel: 'estavel',
    files: [
      {
        label: 'Android',
        platform: 'android',
        url: 'https://viigaxgbimmjudbuhoqh.supabase.co/storage/v1/object/public/app/frame-1.2.9.apk',
        note: 'Celular e tablet · Android 8+',
      },
    ],
    changes: [
      { kind: 'novo', text: 'Coleções: Marvel, DC, Mundo Mágico (Harry Potter), Terra-média e Star Wars ganharam cartões próprios na Home, com banner, descrição e seções (Vingadores, X-Men, Batman, a saga na ordem da história, séries, desenhos). Nada é escondido por já ter sido visto: coleção é catálogo, e o que você viu ganha um selo.' },
      { kind: 'novo', text: '"Salvar coleção" transforma a coleção numa pasta em Salvos, com a contagem de vistos.' },
      { kind: 'correcao', text: 'Nota do IMDb em série recém-lançada (Sterling Point, O Rato): o app agora pergunta ao próprio IMDb quando o OMDb ainda não tem.' },
      { kind: 'melhor', text: 'As prateleiras antigas de franquia (que escondiam A Sociedade do Anel e deixavam Star Wars com 5 filmes e o Howard, o Pato) saíram da Home — viraram as coleções.' },
    ],
  },
  {
    version: '1.2.8',
    versionCode: 15,
    date: '2026-09-13',
    size: '26 MB',
    channel: 'estavel',
    files: [
      {
        label: 'Android',
        platform: 'android',
        url: 'https://viigaxgbimmjudbuhoqh.supabase.co/storage/v1/object/public/app/frame-1.2.8.apk',
        note: 'Celular e tablet · Android 8+',
      },
    ],
    changes: [
      { kind: 'correcao', text: 'A 1.2.7 instalava e continuava se achando 1.2.6, pedindo pra atualizar de novo. Esta sabe quem é.' },
      { kind: 'correcao', text: 'Episódio errado em anime, resolvido: JoJo tocava Dr. Stone porque a busca casava só o "S04E01" e aceitava qualquer série. Agora o nome do arquivo tem que ser da série pedida, e animes são procurados também pelo nome em romaji.' },
      { kind: 'correcao', text: 'A temporada no cabeçalho do player (e no progresso salvo) era sempre a primeira. Agora é a que você escolheu.' },
      { kind: 'correcao', text: 'Categorias de franquia (Star Wars, Harry Potter, Marvel, Homem-Aranha, Senhor dos Anéis...) vêm das coleções oficiais: acabaram os fan-films, curtas e filmes que ainda nem foram lançados.' },
      { kind: 'correcao', text: 'A Home não recomenda mais o que você já viu no Letterboxd: o diário inteiro é reconhecido em segundo plano, não só 60 títulos por abertura.' },
      { kind: 'correcao', text: 'A Home parou de piscar e reembaralhar as categorias toda vez que você abre e fecha um título.' },
      { kind: 'melhor', text: 'Categorias carregando mostram posters vazios no lugar do spinner, sem a lista pular quando os filmes chegam.' },
    ],
  },
  {
    version: '1.2.6',
    versionCode: 13,
    date: '2026-09-13',
    size: '26 MB',
    channel: 'estavel',
    files: [
      {
        label: 'Android',
        platform: 'android',
        url: 'https://viigaxgbimmjudbuhoqh.supabase.co/storage/v1/object/public/app/frame-1.2.6.apk',
        note: 'Celular e tablet · Android 8+',
      },
    ],
    changes: [
      { kind: 'correcao', text: 'TV muda, resolvido de verdade: o app agora lê o cabeçalho de cada arquivo antes de transmitir e sabe o codec de som real (o Cowboy Bebop era Opus, que TV não toca — e o nome não dizia). Arquivo com som que a TV decodifica vem primeiro.' },
      { kind: 'correcao', text: 'Os idiomas na janela de TV são os que estão DENTRO do arquivo, lidos dele — "Dual Audio" de anime é japonês + inglês, não português, e o app parava de prometer dublagem que não existe.' },
      { kind: 'melhor', text: 'A lista "Arquivo" mostra codec e idiomas de cada release, com aviso nos que podem ficar mudos.' },
    ],
  },
  {
    version: '1.2.5',
    versionCode: 12,
    date: '2026-09-12',
    size: '26 MB',
    channel: 'estavel',
    files: [
      {
        label: 'Android',
        platform: 'android',
        url: 'https://viigaxgbimmjudbuhoqh.supabase.co/storage/v1/object/public/app/frame-1.2.5.apk',
        note: 'Celular e tablet · Android 8+',
      },
    ],
    changes: [
      { kind: 'correcao', text: 'Legenda na TV de verdade: o link do OpenSubtitles expirava antes de o Web Video Caster buscar. Agora o site entrega a legenda pronta e o app confere antes de transmitir.' },
      { kind: 'novo', text: 'Na janela de TV dá pra abrir "Arquivo" e escolher outro release à mão — pra quando um episódio chega mudo na TV (o nome diz o som: AAC e Dolby tocam, DTS/TrueHD/FLAC nem sempre).' },
    ],
  },
  {
    version: '1.2.4',
    versionCode: 11,
    date: '2026-09-12',
    size: '26 MB',
    channel: 'estavel',
    files: [
      {
        label: 'Android',
        platform: 'android',
        url: 'https://viigaxgbimmjudbuhoqh.supabase.co/storage/v1/object/public/app/frame-1.2.4.apk',
        note: 'Celular e tablet · Android 8+',
      },
    ],
    changes: [
      { kind: 'melhor', text: 'Nas janelas de TV e de download, a legenda mostra uma opção por idioma (a melhor de cada), em vez de cinco "Português".' },
    ],
  },
  {
    version: '1.2.3',
    versionCode: 10,
    date: '2026-09-12',
    size: '26 MB',
    channel: 'estavel',
    files: [
      {
        label: 'Android',
        platform: 'android',
        url: 'https://viigaxgbimmjudbuhoqh.supabase.co/storage/v1/object/public/app/frame-1.2.3.apk',
        note: 'Celular e tablet · Android 8+',
      },
    ],
    changes: [
      { kind: 'correcao', text: 'Legenda na TV: o Web Video Caster recebia um .vtt com nome de .srt e abria o seletor dele. Agora vai um .srt de verdade e a legenda escolhida entra sozinha.' },
      { kind: 'correcao', text: 'Episódio mudo na TV: o arquivo escolhido pra transmitir passa a preferir som que a TV decodifica (AAC/Dolby) em vez de DTS/TrueHD/FLAC, e a janela avisa quando só há esses.' },
    ],
  },
  {
    version: '1.2.2',
    versionCode: 9,
    date: '2026-09-12',
    size: '26 MB',
    channel: 'estavel',
    files: [
      {
        label: 'Android',
        platform: 'android',
        url: 'https://viigaxgbimmjudbuhoqh.supabase.co/storage/v1/object/public/app/frame-1.2.2.apk',
        note: 'Celular e tablet · Android 8+',
      },
    ],
    changes: [
      { kind: 'correcao', text: 'O botão Assistir sumia em vários filmes (a linha estourava quando tinha trailer). Agora ele ocupa a linha inteira, e Salvar, Baixar, TV e Trailer ficam numa fileira embaixo.' },
      { kind: 'correcao', text: 'Banners: ao voltar da tela de um título, a logo de um filme aparecia em cima do fundo de outro. Corrigido.' },
      { kind: 'correcao', text: 'Banner sem logo mostra o nome do título em vez de ficar só com o fundo.' },
    ],
  },
  {
    version: '1.2.1',
    versionCode: 8,
    date: '2026-09-12',
    size: '26 MB',
    channel: 'estavel',
    files: [
      {
        label: 'Android',
        platform: 'android',
        url: 'https://viigaxgbimmjudbuhoqh.supabase.co/storage/v1/object/public/app/frame-1.2.1.apk',
        note: 'Celular e tablet · Android 8+',
      },
    ],
    changes: [
      { kind: 'correcao', text: 'Excluir pasta agora pergunta antes (com o nome e quantos títulos vão junto) e dá pra desfazer logo depois. Era um toque só.' },
      { kind: 'correcao', text: 'Pasta apagada guarda os filmes no servidor: desfazer traz tudo de volta, com pôster e nota.' },
      { kind: 'melhor', text: 'Banners da Home: filme só entra com nota 4,0 ou mais no Letterboxd.' },
    ],
  },
  {
    version: '1.2.0',
    versionCode: 7,
    date: '2026-09-12',
    size: '26 MB',
    channel: 'estavel',
    files: [
      {
        label: 'Android',
        platform: 'android',
        url: 'https://viigaxgbimmjudbuhoqh.supabase.co/storage/v1/object/public/app/frame-1.2.0.apk',
        note: 'Celular e tablet · Android 8+',
      },
    ],
    changes: [
      { kind: 'novo', text: 'Botão de TV na tela do filme e de cada episódio: escolhe os idiomas (vários, se o arquivo tiver), a qualidade e a legenda, e manda direto pro Web Video Caster — sem as limitações de codec do celular.' },
      { kind: 'correcao', text: 'Escolher um idioma no player agora troca o arquivo inteiro em vez de puxar o som de outro por cima da imagem — era isso que travava ao escolher Português e impedia voltar pro inglês.' },
      { kind: 'correcao', text: 'Episódio que ainda não foi lançado avisa a data de estreia em vez de tocar outra coisa com o mesmo nome.' },
      { kind: 'correcao', text: 'A legenda vai pra TV num formato que o Web Video Caster lê (antes ia um .zip e ele não abria).' },
      { kind: 'correcao', text: 'O aviso de versão nova volta a cada abertura do app; "Depois" não esconde mais pra sempre.' },
    ],
  },
  {
    version: '1.1.4',
    versionCode: 6,
    date: '2026-09-12',
    size: '26 MB',
    channel: 'estavel',
    files: [
      {
        label: 'Android',
        platform: 'android',
        url: 'https://viigaxgbimmjudbuhoqh.supabase.co/storage/v1/object/public/app/frame-1.1.4.apk',
        note: 'Celular e tablet · Android 8+',
      },
    ],
    changes: [
      { kind: 'novo', text: 'Atualização pelo próprio app: quando sai versão nova, ele avisa e baixa. Esta é a última que precisa instalar pelo site.' },
      { kind: 'novo', text: 'Em Opções aparece a versão instalada, com "conferir atualização".' },
    ],
  },
  {
    version: '1.1.3',
    versionCode: 5,
    date: '2026-09-12',
    size: '26 MB',
    channel: 'estavel',
    files: [
      {
        label: 'Android',
        platform: 'android',
        url: 'https://viigaxgbimmjudbuhoqh.supabase.co/storage/v1/object/public/app/frame-1.1.3.apk',
        note: 'Celular e tablet · Android 8+',
      },
    ],
    changes: [
      { kind: 'melhor', text: 'O app lembra qual codec o seu aparelho não decodifica (HEVC 10-bit em celular de entrada) e deixa esses arquivos pro fim: cada um custava 10s de espera antes de falhar.' },
      { kind: 'correcao', text: 'O aviso "este arquivo não tem áudio em português" aparece uma vez, não a cada 10s.' },
    ],
  },
  {
    version: '1.1.2',
    versionCode: 4,
    date: '2026-09-12',
    size: '26 MB',
    channel: 'estavel',
    files: [
      {
        label: 'Android',
        platform: 'android',
        url: 'https://viigaxgbimmjudbuhoqh.supabase.co/storage/v1/object/public/app/frame-1.1.2.apk',
        note: 'Celular e tablet · Android 8+',
      },
    ],
    changes: [
      { kind: 'correcao', text: 'O player parou de puxar o áudio dublado de outro arquivo por conta própria: agora escolhe o arquivo pelo idioma e usa o som dele. Som de fora só pelo menu, ou quando o arquivo está mudo.' },
      { kind: 'correcao', text: 'Sem rede, o som de fora não fica tentando pra sempre com a imagem parada.' },
    ],
  },
  {
    version: '1.1.1',
    versionCode: 3,
    date: '2026-09-12',
    size: '26 MB',
    channel: 'estavel',
    files: [
      {
        label: 'Android',
        platform: 'android',
        // Storage do Supabase (bucket publico "app"): o R2 nao esta ligado na
        // conta e o Pages recusa arquivo acima de 25 MB. Build so arm64 (todo
        // celular desde 2017); o universal tem 62 MB e nao cabe nos 50 MB do
        // plano gratis. Subir versao nova: scripts em Frame (upload-apk).
        url: 'https://viigaxgbimmjudbuhoqh.supabase.co/storage/v1/object/public/app/frame-1.1.1.apk',
        note: 'Celular e tablet · Android 8+',
      },
    ],
    changes: [
      { kind: 'correcao', text: 'Sem internet o app abre em segundos e diz que está offline, em vez de ficar carregando.' },
      { kind: 'correcao', text: 'Série no Continuar Assistindo abria como filme (outro título, com elenco errado).' },
      { kind: 'correcao', text: 'Download escolhe arquivo que o celular decodifica: anime em HEVC 10-bit não tocava offline.' },
      { kind: 'melhor', text: 'Home e Explorar sem rede levam direto pros downloads.' },
    ],
  },
  {
    version: '1.1.0',
    versionCode: 2,
    date: '2026-09-09',
    size: '62 MB',
    channel: 'estavel',
    files: [
      {
        label: 'Android',
        platform: 'android',
        url: null, // nunca foi publicada; a 1.1.1 substitui
        note: 'Celular e tablet \u00b7 Android 8+',
      },
    ],
    changes: [
      { kind: 'novo', text: 'Assistir na TV: manda o filme pro Web Video Caster (ou VLC, MX Player) direto do player.' },
      { kind: 'novo', text: 'Salvar em um toque, com Desfazer. Tocar de novo abre as pastas.' },
      { kind: 'novo', text: 'Progresso e epis\u00f3dio no pr\u00f3prio cartaz: barra do quanto voc\u00ea viu e o T1 \u00b7 E4.' },
      { kind: 'novo', text: 'Fonte nova de dublado: Mico-Le\u00e3o Dublado.' },
      { kind: 'correcao', text: 'O app parou de escolher o arquivo 4K mais pesado da lista, que celular nenhum consegue tocar.' },
      { kind: 'correcao', text: 'Sua watchlist voltou a ser salva de verdade \u2014 antes ela sumia ao fechar o app.' },
      { kind: 'melhor', text: 'O que voc\u00ea j\u00e1 viu para de aparecer nas recomenda\u00e7\u00f5es.' },
      { kind: 'melhor', text: '\u00cdcone de salvar em todo cartaz, sem precisar abrir a descri\u00e7\u00e3o.' },
    ],
  },
  {
    version: '1.0.0',
    versionCode: 1,
    date: '2026-09-07',
    size: null,
    channel: 'estavel',
    files: [
      {
        label: 'Android',
        platform: 'android',
        url: null, // <- cola aqui o link do .apk quando tiver
        note: 'Celular e tablet · Android 8+',
      },
      {
        label: 'Android TV',
        platform: 'tv',
        url: null,
        note: 'TV Box, Chromecast com Google TV, Fire TV',
      },
    ],
    changes: [
      { kind: 'novo', text: 'Sincronização entre aparelhos: listas, pastas, ajustes e onde você parou.' },
      { kind: 'novo', text: 'Import do Letterboxd com diário, watchlist, listas e notas.' },
      { kind: 'novo', text: 'Prateleiras montadas a partir do seu gosto, diferentes a cada visita.' },
      { kind: 'melhor', text: 'Banners do topo sempre com 5 filmes e 5 séries, sem repetir o que você já viu.' },
    ],
  },
];

/** iOS ainda não tem build — a página mostra isso em vez de esconder. */
export const COMING_SOON = [{ label: 'iPhone e iPad', note: 'Em breve' }];

export const latest = () => RELEASES[0] || null;
export const hasDownloads = () => RELEASES.some((r) => r.files.some((f) => f.url));
