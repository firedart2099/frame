// GERADO POR `npm run sync-app` — copia de ../Frame. Nao edite aqui:
// mexa no app e rode o script de novo, senao os dois lados divergem.
// Colecoes: listas editoriais fixas (Marvel, DC, Harry Potter...). Nao sao
// recomendacao — sao catalogo. Por isso NAO passam pelo filtro de "ja vi":
// a prateleira "Senhor dos Aneis" da Home escondia A Sociedade do Anel
// porque o Luiz ja tinha visto, e Star Wars sobrava com 5 filmes.
//
// Cada colecao tem banner (backdrop de um filme-capa da TMDB), descricao e
// secoes. Uma secao e uma fonte:
//   { colecoes: [ids] }            colecoes da TMDB, mescladas
//   { filmes: [ids] }              filmes na ordem dada (ordem da historia)
//   { series: [ids] }              series na ordem dada
//   { discover: 'movie'|'tv', params: '...' }  consulta da TMDB
// e `ordem`: 'dada' (como veio), 'cronologica' (data de lancamento) ou
// 'popularidade'. Tudo passa pelo filtro de lancados (sem data futura).

export const COLECOES = [
  {
    id: 'marvel',
    titulo: 'Marvel',
    subtitulo: 'Do Homem de Ferro ao multiverso',
    descricao: 'Tudo da Marvel num lugar só: o Universo Cinematográfico em ordem de popularidade, os Vingadores, os X-Men, todos os Homens-Aranha, e as séries e desenhos.',
    capa: { type: 'movie', id: 299534 },
    cor: '#E62429',
    secoes: [
      { id: 'mcu', titulo: 'Universo Cinematográfico', fonte: { discover: 'movie', params: 'with_companies=420&vote_count.gte=200' }, ordem: 'popularidade' },
      { id: 'vingadores', titulo: 'Vingadores', fonte: { colecoes: [86311] }, ordem: 'cronologica' },
      { id: 'homem-aranha', titulo: 'Homem-Aranha', fonte: { colecoes: [556, 125574, 531241, 573436, 558216] }, ordem: 'cronologica' },
      { id: 'xmen', titulo: 'X-Men, Wolverine e Deadpool', fonte: { colecoes: [748, 453993, 448150] }, ordem: 'cronologica' },
      { id: 'series', titulo: 'Séries', fonte: { discover: 'tv', params: 'with_companies=420&without_genres=16&vote_count.gte=50' }, ordem: 'popularidade' },
      { id: 'desenhos', titulo: 'Desenhos', fonte: { discover: 'tv', params: 'with_companies=13252|420&with_genres=16&vote_count.gte=30' }, ordem: 'popularidade' },
    ],
  },
  {
    id: 'dc',
    titulo: 'DC',
    subtitulo: 'Gotham, Metrópolis e além',
    descricao: 'Os filmes da DC por popularidade, todos os Batmans e Supermans em ordem, a Mulher-Maravilha, e as séries e desenhos que fizeram escola.',
    capa: { type: 'movie', id: 155 },
    cor: '#0476F2',
    secoes: [
      { id: 'filmes', titulo: 'Filmes', fonte: { discover: 'movie', params: 'with_companies=128064|9993|429&vote_count.gte=300' }, ordem: 'popularidade' },
      { id: 'batman', titulo: 'Batman', fonte: { colecoes: [120794, 263, 948485] }, ordem: 'cronologica' },
      { id: 'superman', titulo: 'Superman', fonte: { colecoes: [8537, 209131] }, ordem: 'cronologica' },
      { id: 'mulher-maravilha', titulo: 'Mulher-Maravilha', fonte: { colecoes: [468552] }, ordem: 'cronologica' },
      { id: 'series', titulo: 'Séries', fonte: { discover: 'tv', params: 'with_companies=429|9993&without_genres=16&vote_count.gte=50' }, ordem: 'popularidade' },
      { id: 'desenhos', titulo: 'Desenhos', fonte: { discover: 'tv', params: 'with_companies=429|9993&with_genres=16&vote_count.gte=20' }, ordem: 'popularidade' },
    ],
  },
  {
    id: 'harry-potter',
    titulo: 'Mundo Mágico',
    subtitulo: 'Harry Potter e Animais Fantásticos',
    descricao: 'Os oito filmes de Harry Potter na ordem certa, da Pedra Filosofal às Relíquias da Morte, e a trilogia de Animais Fantásticos que conta o que veio antes.',
    capa: { type: 'movie', id: 12445 },
    cor: '#B08D57',
    secoes: [
      { id: 'harry-potter', titulo: 'Harry Potter, do primeiro ao último', fonte: { colecoes: [1241] }, ordem: 'cronologica' },
      { id: 'animais', titulo: 'Animais Fantásticos', fonte: { colecoes: [435259] }, ordem: 'cronologica' },
    ],
  },
  {
    id: 'terra-media',
    titulo: 'Terra-média',
    subtitulo: 'O Hobbit e O Senhor dos Anéis',
    descricao: 'A jornada inteira na ordem da história: os três Hobbits, depois a trilogia do Anel. E o que veio depois — a animação dos Rohirrim e Os Anéis de Poder.',
    capa: { type: 'movie', id: 120 },
    cor: '#5E8C3A',
    secoes: [
      { id: 'filmes', titulo: 'Na ordem da história', fonte: { filmes: [49051, 57158, 122917, 120, 121, 122] }, ordem: 'dada' },
      { id: 'mais', titulo: 'Mais da Terra-média', fonte: { filmes: [839033] }, ordem: 'dada' },
      { id: 'series', titulo: 'Séries', fonte: { series: [84773] }, ordem: 'dada' },
    ],
  },
  {
    id: 'star-wars',
    titulo: 'Star Wars',
    subtitulo: 'A galáxia inteira, em ordem',
    descricao: 'A saga Skywalker na ordem da história, os filmes paralelos, e todas as séries live-action e animadas — do Mandaloriano a Clone Wars.',
    capa: { type: 'movie', id: 1891 },
    cor: '#FFE81F',
    secoes: [
      { id: 'saga', titulo: 'A saga Skywalker, na ordem da história', fonte: { filmes: [1893, 1894, 1895, 11, 1891, 1892, 140607, 181808, 181812] }, ordem: 'dada' },
      { id: 'historias', titulo: 'Histórias paralelas', fonte: { filmes: [330459, 348350, 12180, 1228710] }, ordem: 'dada' },
      { id: 'series', titulo: 'Séries', fonte: { series: [82856, 83867, 114461, 92830, 115036, 114479, 202879] }, ordem: 'dada' },
      { id: 'desenhos', titulo: 'Animações', fonte: { series: [4194, 60554, 105971, 114478, 203085, 79093] }, ordem: 'dada' },
    ],
  },
  {
    id: 'pixar',
    titulo: 'Pixar',
    subtitulo: 'Todos os longas, na ordem',
    descricao: 'De Toy Story a hoje: os longas da Pixar na ordem em que saíram, e os curtas que passam antes dos filmes.',
    capa: { type: 'movie', id: 10681 },
    cor: '#1B9CE0',
    secoes: [
      { id: 'longas', titulo: 'Longas, do primeiro ao último', fonte: { discover: 'movie', params: 'with_companies=3&with_runtime.gte=60&vote_count.gte=200', paginas: 2 }, ordem: 'cronologica' },
      { id: 'curtas', titulo: 'Curtas', fonte: { discover: 'movie', params: 'with_companies=3&with_runtime.lte=40&vote_count.gte=100', paginas: 2 }, ordem: 'popularidade' },
    ],
  },
  {
    id: 'ghibli',
    titulo: 'Studio Ghibli',
    subtitulo: 'Miyazaki, Takahata e o estúdio',
    descricao: 'Tudo do Ghibli: os filmes de Hayao Miyazaki, os de Isao Takahata, e o resto do estúdio, na ordem em que foram feitos.',
    capa: { type: 'movie', id: 129 },
    cor: '#5FA8D3',
    secoes: [
      { id: 'miyazaki', titulo: 'Hayao Miyazaki', fonte: { diretor: 608 }, ordem: 'cronologica' },
      { id: 'takahata', titulo: 'Isao Takahata', fonte: { diretor: 628, minimoVotos: 50 }, ordem: 'cronologica' },
      { id: 'estudio', titulo: 'Todo o estúdio', fonte: { discover: 'movie', params: 'with_companies=10342&with_runtime.gte=60&vote_count.gte=50', paginas: 2 }, ordem: 'cronologica' },
    ],
  },
  {
    id: 'disney',
    titulo: 'Disney Animação',
    subtitulo: 'Da Branca de Neve à era 3D',
    descricao: 'Os clássicos da Disney separados por era: a de ouro, o renascimento dos anos 90 e a fase atual em computação.',
    capa: { type: 'movie', id: 8587 },
    cor: '#6DB3F2',
    secoes: [
      { id: 'ouro', titulo: 'Era de ouro e clássicos (1937-1988)', fonte: { discover: 'movie', params: 'with_companies=6125|3166|2&with_genres=16&with_runtime.gte=60&vote_count.gte=300&primary_release_date.gte=1937-01-01&primary_release_date.lte=1988-12-31', paginas: 2 }, ordem: 'cronologica' },
      { id: 'renascimento', titulo: 'Renascimento (1989-1999)', fonte: { discover: 'movie', params: 'with_companies=6125|3166|2&with_genres=16&with_runtime.gte=60&vote_count.gte=300&primary_release_date.gte=1989-01-01&primary_release_date.lte=1999-12-31' }, ordem: 'cronologica' },
      { id: '3d', titulo: 'Era 3D (2000-hoje)', fonte: { discover: 'movie', params: 'with_companies=6125|2&with_genres=16&with_runtime.gte=60&vote_count.gte=300&primary_release_date.gte=2000-01-01', paginas: 2 }, ordem: 'cronologica' },
    ],
  },
  {
    id: 'dreamworks',
    titulo: 'DreamWorks',
    subtitulo: 'Shrek, dragões e pandas',
    descricao: 'As sagas da DreamWorks em ordem — Shrek, Como Treinar o Seu Dragão, Kung Fu Panda, Madagascar — e todos os outros longas.',
    capa: { type: 'movie', id: 10191 },
    cor: '#3DBE9B',
    secoes: [
      { id: 'shrek', titulo: 'Shrek', fonte: { colecoes: [2150] }, ordem: 'cronologica' },
      { id: 'dragao', titulo: 'Como Treinar o Seu Dragão', fonte: { colecoes: [89137] }, ordem: 'cronologica' },
      { id: 'panda', titulo: 'Kung Fu Panda', fonte: { colecoes: [77816] }, ordem: 'cronologica' },
      { id: 'madagascar', titulo: 'Madagascar', fonte: { colecoes: [14740] }, ordem: 'cronologica' },
      { id: 'todos', titulo: 'Todos os longas', fonte: { discover: 'movie', params: 'with_companies=521&with_runtime.gte=60&vote_count.gte=200', paginas: 3 }, ordem: 'cronologica' },
    ],
  },
  {
    id: 'acao',
    titulo: 'Grandes sagas de ação',
    subtitulo: 'Missão Impossível, 007, John Wick e cia.',
    descricao: 'As franquias de ação inteiras, cada uma na ordem: Missão: Impossível, James Bond, Jurassic Park, Velozes e Furiosos, John Wick, Rocky e Creed.',
    capa: { type: 'movie', id: 353081 },
    cor: '#FF6A00',
    secoes: [
      { id: 'mi', titulo: 'Missão: Impossível', fonte: { colecoes: [87359] }, ordem: 'cronologica' },
      { id: 'bond', titulo: '007', fonte: { colecoes: [645] }, ordem: 'cronologica' },
      { id: 'jurassic', titulo: 'Jurassic Park', fonte: { colecoes: [328] }, ordem: 'cronologica' },
      { id: 'velozes', titulo: 'Velozes e Furiosos', fonte: { colecoes: [9485] }, ordem: 'cronologica' },
      { id: 'wick', titulo: 'John Wick', fonte: { colecoes: [404609] }, ordem: 'cronologica' },
      { id: 'rocky', titulo: 'Rocky e Creed', fonte: { colecoes: [1575, 553717] }, ordem: 'cronologica' },
    ],
  },
  {
    id: 'monstros',
    titulo: 'Monstros',
    subtitulo: 'Alien, Predador, Godzilla e Kong',
    descricao: 'As criaturas do cinema em ordem: a saga Alien, os Predadores, o MonsterVerse de Godzilla e Kong, e o Godzilla clássico japonês.',
    capa: { type: 'movie', id: 348 },
    cor: '#7CFC00',
    secoes: [
      { id: 'alien', titulo: 'Alien', fonte: { colecoes: [8091] }, ordem: 'cronologica' },
      { id: 'predador', titulo: 'Predador', fonte: { colecoes: [399] }, ordem: 'cronologica' },
      { id: 'monsterverse', titulo: 'Godzilla e Kong (MonsterVerse)', fonte: { colecoes: [535313] }, ordem: 'cronologica' },
      { id: 'showa', titulo: 'Godzilla clássico (era Showa)', fonte: { colecoes: [374509] }, ordem: 'cronologica' },
    ],
  },
  {
    id: 'nolan',
    titulo: 'Christopher Nolan',
    subtitulo: 'A filmografia completa',
    descricao: 'Tudo que Nolan dirigiu, na ordem: de Seguinte e Amnésia a Oppenheimer e A Odisseia.',
    capa: { type: 'movie', id: 157336 },
    cor: '#C9A227',
    secoes: [
      { id: 'filmes', titulo: 'Como diretor, na ordem', fonte: { diretor: 525 }, ordem: 'cronologica' },
    ],
  },
  {
    id: 'tarantino',
    titulo: 'Quentin Tarantino',
    subtitulo: 'A filmografia completa',
    descricao: 'Os filmes de Tarantino na ordem, de Cães de Aluguel a Era Uma Vez em Hollywood.',
    capa: { type: 'movie', id: 680 },
    cor: '#E8B004',
    secoes: [
      { id: 'filmes', titulo: 'Como diretor, na ordem', fonte: { diretor: 138 }, ordem: 'cronologica' },
    ],
  },
  {
    id: 'dragon-ball',
    titulo: 'Dragon Ball',
    subtitulo: 'Da infância do Goku ao Daima',
    descricao: 'Toda a saga na ordem certa: Dragon Ball, Z, GT, Super e Daima — e os filmes de cada fase.',
    capa: { type: 'tv', id: 12971 },
    cor: '#F58220',
    secoes: [
      { id: 'series', titulo: 'As séries, na ordem', fonte: { series: [12609, 12971, 12697, 62715, 236994] }, ordem: 'dada' },
      { id: 'filmes', titulo: 'Os filmes', fonte: { colecoes: [386410, 425164, 620873] }, ordem: 'cronologica' },
    ],
  },
  {
    id: 'shonen',
    titulo: 'Animes de longa data',
    subtitulo: 'JoJo, One Piece, Naruto e os grandes',
    descricao: 'Os animes que atravessam décadas e os que definiram a geração atual: JoJo, One Piece, Naruto, Bleach, Hunter x Hunter, Fullmetal, Attack on Titan, Demon Slayer, Jujutsu Kaisen e mais.',
    capa: { type: 'tv', id: 45790 },
    cor: '#C71585',
    secoes: [
      { id: 'longos', titulo: 'Os de longa data', fonte: { series: [45790, 37854, 46260, 31910, 70881, 30984, 46298, 31911, 13916] }, ordem: 'dada' },
      { id: 'geracao', titulo: 'A geração atual', fonte: { series: [1429, 85937, 95479, 65930, 114410, 240411] }, ordem: 'dada' },
    ],
  },
  {
    id: 'oscar',
    titulo: 'Oscar de Melhor Filme',
    subtitulo: 'Todos os vencedores',
    descricao: 'Cada filme que levou a estatueta principal, do mais recente ao primeiro, em 1929.',
    capa: { type: 'movie', id: 496243 },
    cor: '#D4AF37',
    secoes: [
      { id: 'vencedores', titulo: 'Vencedores, do mais recente', fonte: { lista: 28 }, ordem: 'recentes' },
    ],
  },
  {
    id: 'brasil',
    titulo: 'Cinema brasileiro',
    subtitulo: 'Do Cinema Novo a Ainda Estou Aqui',
    descricao: 'O essencial do Brasil no cinema: os clássicos de Glauber e Nelson Pereira dos Santos, a retomada de Central do Brasil e Cidade de Deus, e a safra recente de Bacurau a Ainda Estou Aqui.',
    capa: { type: 'movie', id: 598 },
    cor: '#009C3B',
    secoes: [
      { id: 'classicos', titulo: 'Clássicos', fonte: { filmes: [836, 59990, 67612, 67062, 42234, 42148, 42167] }, ordem: 'cronologica' },
      { id: 'retomada', titulo: 'Retomada e anos 2000', fonte: { filmes: [21253, 666, 40096, 53961, 598, 36093, 8440, 40823, 52345, 8443, 49367, 7347, 69335, 47931] }, ordem: 'cronologica' },
      { id: 'recentes', titulo: 'A safra recente', fonte: { filmes: [97989, 310569, 377273, 314029, 446159, 548544, 913816, 1000837, 1099413, 1220564] }, ordem: 'cronologica' },
    ],
  },
];

export const colecaoPorId = (id) => COLECOES.find((c) => c.id === id) || null;
