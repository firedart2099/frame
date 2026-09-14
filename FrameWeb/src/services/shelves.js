// GERADO POR `npm run sync-app` — copia de ../Frame. Nao edite aqui:
// mexa no app e rode o script de novo, senao os dois lados divergem.
// Extraido de App.js — mantenha este arquivo focado em uma responsabilidade.
// Catalogo de prateleiras da Home: pool infinito + prateleiras do perfil.
import { TMDB_API_KEY, GENRES } from './constants';

// O TMDB usa IDs de genero DIFERENTES para filme e para serie.
// Sem esse mapa, "Series de Acao" (28) voltava vazio.
const TV_GENRE_MAP = {
  '28': '10759', '12': '10759', '14': '10765', '878': '10765',
  '10752': '10768', '36': '10768', '53': '9648', '27': '9648',
  '16': '16', '35': '35', '80': '80', '99': '99', '18': '18',
  '10751': '10751', '9648': '9648', '37': '37', '10749': '18', '10770': '18'
};
const toTvGenre = (id) => TV_GENRE_MAP[String(id)] || null;

const INFINITE_SHELF_POOL = (() => {
    const K_PLACEHOLDER = '__KEY__';
    const b = 'https://api.themoviedb.org/3/discover';
    
    // Todos os generos do TMDB
    const allGenres = [
        { id: 28, name: 'Acao' }, { id: 12, name: 'Aventura' }, { id: 16, name: 'Animacao' },
        { id: 35, name: 'Comedia' }, { id: 80, name: 'Crime' }, { id: 99, name: 'Documentario' },
        { id: 18, name: 'Drama' }, { id: 10751, name: 'Familia' }, { id: 14, name: 'Fantasia' },
        { id: 36, name: 'Historia' }, { id: 27, name: 'Terror' }, { id: 10402, name: 'Musica' },
        { id: 9648, name: 'Misterio' }, { id: 10749, name: 'Romance' }, { id: 878, name: 'Ficcao Cientifica' },
        { id: 10770, name: 'Cinema TV' }, { id: 53, name: 'Thriller' }, { id: 10752, name: 'Guerra' },
        { id: 37, name: 'Faroeste' }
    ];
    
    const langs = [
        { code: 'fr', name: 'Frances' }, { code: 'ja', name: 'Japones' }, { code: 'ko', name: 'Coreano' },
        { code: 'de', name: 'Alemao' }, { code: 'it', name: 'Italiano' }, { code: 'es', name: 'Espanhol' },
        { code: 'pt', name: 'Brasileiro' }, { code: 'hi', name: 'Indiano' }, { code: 'zh', name: 'Chines' },
        { code: 'ru', name: 'Russo' }, { code: 'sv', name: 'Sueco' }, { code: 'da', name: 'Dinamarques' },
        { code: 'pl', name: 'Polones' }, { code: 'tr', name: 'Turco' }, { code: 'th', name: 'Tailandes' },
        { code: 'ar', name: 'Arabe' }, { code: 'fa', name: 'Iraniano' }
    ];
    
    const keywords = [
        { id: 9672, name: 'Baseados em Historia Real' }, { id: 699, name: 'Filmes de Estrada' },
        { id: 4565, name: 'Viagens no Tempo' }, { id: 672, name: 'Cinema Independente' },
        { id: 4458, name: 'Distopias' }, { id: 9748, name: 'Thriller Psicologico' },
        { id: 818, name: 'Baseado em Romance' }, { id: 10181, name: 'Baseado em Quadrinhos' },
        { id: 3691, name: 'Conspiracao' }, { id: 1721, name: 'Vinganca' },
        { id: 6149, name: 'Sobrevivencia' }, { id: 11322, name: 'Femme Fatale' },
        { id: 9715, name: 'Super-Heroi' }, { id: 188957, name: 'Assombrado' },
        { id: 10527, name: 'Velho Oeste' }, { id: 2964, name: 'Futuro' },
        { id: 14602, name: 'Hitman' }, { id: 5562, name: 'Espionagem' },
        { id: 207268, name: 'Inteligencia Artificial' }, { id: 4344, name: 'Musical' },
        { id: 163053, name: 'Virus' }, { id: 276130, name: 'Cassino' },
        { id: 10084, name: 'Mafia' }, { id: 6054, name: 'Motocicleta' },
        { id: 282, name: 'Video Game' }
    ];
    
    const decades = [
        { y: 1950, l: 'anos 50' }, { y: 1960, l: 'anos 60' }, { y: 1970, l: 'anos 70' },
        { y: 1980, l: 'anos 80' }, { y: 1990, l: 'anos 90' }, { y: 2000, l: 'anos 2000' },
        { y: 2010, l: 'anos 2010' }, { y: 2020, l: 'anos 2020' }
    ];
    
    const pool = [];
    
    // Tipo 1: Genero puro (todos) — titulo varia pra nao ficar tudo "O melhor do X"
    const T1_TEMPLATES = [
        g => `O melhor do ${g}`,
        g => `Essenciais de ${g}`,
        g => `${g} pra maratonar`,
        g => `Clássicos de ${g}`,
    ];
    allGenres.forEach((g, i) => {
        const title = T1_TEMPLATES[i % T1_TEMPLATES.length](g.name);
        pool.push({ title, type: 'movie', url: `${b}/movie?api_key=${K_PLACEHOLDER}&with_genres=${g.id}&vote_average.gte=7.0&vote_count.gte=500&sort_by=vote_count.desc&language=pt-BR`, _score: 0.5 });
    });
    
    // Generos proprios de TV (IDs do TMDB para series)
    const tvGenres = [
        { id: 10759, name: 'Acao e Aventura' }, { id: 16, name: 'Animacao' },
        { id: 35, name: 'Comedia' }, { id: 80, name: 'Crime' },
        { id: 99, name: 'Documentario' }, { id: 18, name: 'Drama' },
        { id: 10751, name: 'Familia' }, { id: 9648, name: 'Misterio' },
        { id: 10764, name: 'Reality' }, { id: 10765, name: 'Ficcao Cientifica e Fantasia' },
        { id: 10768, name: 'Guerra e Politica' }, { id: 37, name: 'Faroeste' }
    ];

    // Tipo 2: Series por genero — titulo varia
    const T2_TEMPLATES = [
        g => `Series de ${g}`,
        g => `${g} em serie`,
        g => `Pra maratonar: ${g}`,
    ];
    tvGenres.forEach((g, i) => {
        const title = T2_TEMPLATES[i % T2_TEMPLATES.length](g.name);
        pool.push({ title, type: 'tv', url: `${b}/tv?api_key=${K_PLACEHOLDER}&with_genres=${g.id}&vote_average.gte=7.0&vote_count.gte=200&sort_by=vote_count.desc&language=pt-BR`, _score: 0.55 });
    });

    // Tipo 2b: Series por pais
    langs.forEach(l => {
        pool.push({ title: `Series em ${l.name}`, type: 'tv', url: `${b}/tv?api_key=${K_PLACEHOLDER}&with_original_language=${l.code}&vote_average.gte=7.0&vote_count.gte=50&sort_by=vote_count.desc&language=pt-BR`, _score: 0.45 });
    });

    // Tipo 2c: Series por genero x decada — titulo varia
    const T2C_TEMPLATES = [
        (g, d) => `Series de ${g} dos ${d}`,
        (g, d) => `${g} raiz: series dos ${d}`,
        (g, d) => `De volta aos ${d}: series de ${g}`,
    ];
    tvGenres.forEach((g, gi) => {
        decades.slice(3).forEach((d, di) => {
            const title = T2C_TEMPLATES[(gi + di) % T2C_TEMPLATES.length](g.name, d.l);
            pool.push({ title, type: 'tv', url: `${b}/tv?api_key=${K_PLACEHOLDER}&with_genres=${g.id}&first_air_date.gte=${d.y}-01-01&first_air_date.lte=${d.y+9}-12-31&vote_count.gte=40&sort_by=vote_count.desc&language=pt-BR`, _score: 0.35 });
        });
    });

    // Tipo 2d: Series subestimadas (nota alta, poucos votos) — titulo varia
    const T2D_TEMPLATES = [
        g => `Series subestimadas: ${g}`,
        g => `Ninguem viu, mas deveria: ${g}`,
        g => `${g} escondidas do algoritmo`,
    ];
    tvGenres.forEach((g, i) => {
        const title = T2D_TEMPLATES[i % T2D_TEMPLATES.length](g.name);
        pool.push({ title, type: 'tv', url: `${b}/tv?api_key=${K_PLACEHOLDER}&with_genres=${g.id}&vote_average.gte=7.5&vote_count.gte=30&vote_count.lte=300&sort_by=vote_average.desc&language=pt-BR`, _score: 0.3 });
    });
    
    // Tipo 3: Cinema por pais
    langs.forEach(l => {
        pool.push({ title: `Cinema ${l.name}`, type: 'movie', url: `${b}/movie?api_key=${K_PLACEHOLDER}&with_original_language=${l.code}&vote_average.gte=7.0&vote_count.gte=100&sort_by=vote_count.desc&language=pt-BR`, _score: 0.4 });
    });
    
    // Tipo 4: Keywords tematicos
    keywords.forEach(k => {
        pool.push({ title: k.name, type: 'movie', url: `${b}/movie?api_key=${K_PLACEHOLDER}&with_keywords=${k.id}&vote_average.gte=6.5&vote_count.gte=100&sort_by=vote_count.desc&language=pt-BR`, _score: 0.3 });
    });
    
    // Tipo 5: Genero x Decada — titulo varia
    const T5_TEMPLATES = [
        (g, d) => `${g} dos ${d}`,
        (g, d) => `${g} raiz: ${d}`,
        (g, d) => `De volta aos ${d}: ${g}`,
        (g, d) => `${g} old school (${d})`,
    ];
    allGenres.forEach((g, gi) => {
        decades.forEach((d, di) => {
            const title = T5_TEMPLATES[(gi + di) % T5_TEMPLATES.length](g.name, d.l);
            pool.push({ title, type: 'movie', url: `${b}/movie?api_key=${K_PLACEHOLDER}&with_genres=${g.id}&primary_release_date.gte=${d.y}-01-01&primary_release_date.lte=${d.y+9}-12-31&vote_count.gte=100&sort_by=vote_count.desc&language=pt-BR`, _score: 0.2 });
        });
    });
    
    // Tipo 6: Combinacoes de 2 generos — titulo varia
    const T6_TEMPLATES = [
        (a, c) => `${a} e ${c}`,
        (a, c) => `Quando ${a} vira ${c}`,
        (a, c) => `${a} com tempero de ${c}`,
    ];
    for (let i = 0; i < allGenres.length; i++) {
        for (let j = i+1; j < allGenres.length; j++) {
            const title = T6_TEMPLATES[(i + j) % T6_TEMPLATES.length](allGenres[i].name, allGenres[j].name);
            pool.push({ title, type: 'movie', url: `${b}/movie?api_key=${K_PLACEHOLDER}&with_genres=${allGenres[i].id},${allGenres[j].id}&vote_count.gte=100&sort_by=vote_count.desc&language=pt-BR`, _score: 0.2 });
        }
    }
    
    // Tipo 7: Joias escondidas por genero — titulo varia
    const T7_TEMPLATES = [
        g => `Joias escondidas: ${g}`,
        g => `Ninguem viu, mas deveria: ${g}`,
        g => `${g} fora do radar`,
    ];
    allGenres.forEach((g, i) => {
        const title = T7_TEMPLATES[i % T7_TEMPLATES.length](g.name);
        pool.push({ title, type: 'movie', url: `${b}/movie?api_key=${K_PLACEHOLDER}&with_genres=${g.id}&vote_average.gte=7.5&vote_count.gte=50&vote_count.lte=500&sort_by=vote_average.desc&language=pt-BR`, _score: 0.1 });
    });
    
    // Tipo 8: Filmes por pais e genero
    langs.slice(0, 8).forEach(l => {
        allGenres.slice(0, 6).forEach(g => {
            pool.push({ title: `${g.name} ${l.name}`, type: 'movie', url: `${b}/movie?api_key=${K_PLACEHOLDER}&with_original_language=${l.code}&with_genres=${g.id}&vote_count.gte=50&sort_by=vote_count.desc&language=pt-BR`, _score: 0.1 });
        });
    });
    
    return pool;
})();

const generateDynamicShelves = (tasteProfile) => {
    let formulas = [];
    const K = TMDB_API_KEY;
    const b = 'https://api.themoviedb.org/3/discover';
    
    const { top_genres = {}, top_directors = {}, top_cast = {}, top_keywords = {} } = tasteProfile?.analytics || {};

    // O analytics guarda so a CONTAGEM por id ({ "18": 42 }), sem o nome. O
    // `name: id` de antes fazia o titulo sair como "Obras-primas: 18" e
    // "A assinatura de 240 no 18". Genero tem tabela local, entao da pra
    // resolver; pessoa so tem nome na TMDB, e prateleira sem nome nao vai
    // pra tela.
    const nomeDoGenero = (id) => (GENRES.find((g) => String(g.id) === String(id)) || {}).name || null;

    const getTop = (obj, limit, resolver) => {
        return Object.entries(obj)
            .map(([id, val]) => {
                const base = typeof val === 'number' ? { id, score: val } : { id, ...val };
                const nome = base.name && isNaN(Number(base.name)) ? base.name : (resolver ? resolver(id) : null);
                return { ...base, name: nome };
            })
            .filter((x) => !!x.name)
            .sort((a,b) => b.score - a.score)
            .slice(0, limit);
    };

    const topGenres = getTop(top_genres, 5, nomeDoGenero);
    const topDirs = getTop(top_directors, 7);
    const topActors = getTop(top_cast, 6);

    const usedTitles = new Set();
    const hashStr = (str) => {
        let h = 5381;
        for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
        return (h >>> 0).toString(36);
    };
    const addF = (obj) => {
        if (usedTitles.has(obj.title)) return;
        usedTitles.add(obj.title);
        // id sai da URL, nao da ordem: se o taste_profile muda e a ordem dos
        // generos troca, a prateleira continua sendo "a mesma" pro FlatList
        // (mantem os filmes carregados em vez de remontar e piscar).
        formulas.push({ id: 'dyn_' + hashStr((obj.url || (obj.urls || []).join('|')) + obj.type), ...obj });
    };

    const isCinephile = tasteProfile?.is_cinephile === true || (tasteProfile?.analytics && Object.keys(tasteProfile.analytics.top_directors || {}).length > 0);

    // --- BLOCO 1: GENEROS FAVORITOS (Obras-Primas + Series) ---
    topGenres.forEach(g => {
        if (isNaN(parseInt(g.id))) return;
        addF({
            title: `Obras-primas: ${g.name}`, type: 'movie',
            url: `${b}/movie?api_key=${K}&with_genres=${g.id}&vote_average.gte=7.5&vote_count.gte=1000&sort_by=vote_count.desc&language=pt-BR`,
            _score: (g.score || 1) * 1.2
        });
        const tvgA = toTvGenre(g.id);
        if (tvgA) addF({
            title: `Series consagradas de ${g.name}`, type: 'tv',
            url: `${b}/tv?api_key=${K}&with_genres=${tvgA}&vote_average.gte=7.5&vote_count.gte=300&sort_by=vote_count.desc&language=pt-BR`,
            _score: (g.score || 1) * 1.1
        });
    });

    // --- BLOCO 2: DIRETORES ---
    if (isCinephile) {
        topDirs.forEach(d => {
            if (isNaN(parseInt(d.id))) return;
            addF({
                title: `A visao de ${d.name}`, type: 'movie',
                url: `${b}/movie?api_key=${K}&with_crew=${d.id}&sort_by=vote_count.desc&language=pt-BR`,
                _score: (d.score || 1) * 1.5
            });
        });

        // Assinatura: Top 1 Diretor x Top 1 Genero
        if (topDirs.length > 0 && topGenres.length > 0) {
            const d = topDirs[0]; const g = topGenres[0];
            if (!isNaN(parseInt(d.id)) && !isNaN(parseInt(g.id))) {
                addF({
                    title: `A assinatura de ${d.name} no ${g.name}`, type: 'movie',
                    url: `${b}/movie?api_key=${K}&with_crew=${d.id}&with_genres=${g.id}&sort_by=vote_count.desc&language=pt-BR`,
                    _score: (d.score || 1) + (g.score || 1)
                });
            }
        }

        // Cinefilo exclusivas
        addF({ title: "Aclamacao Francesa", type: 'movie', url: `${b}/movie?api_key=${K}&with_original_language=fr&without_genres=16,10751&vote_average.gte=7.5&vote_count.gte=200&sort_by=vote_count.desc&language=pt-BR`, _score: 5.0 });
        addF({ title: "Beleza em Preto e Branco", type: 'movie', url: `${b}/movie?api_key=${K}&with_keywords=12999&vote_average.gte=7.5&vote_count.gte=300&sort_by=vote_count.desc&language=pt-BR`, _score: 4.5 });
        addF({ title: "Obras-Primas do Japao", type: 'movie', url: `${b}/movie?api_key=${K}&with_original_language=ja&without_genres=16&vote_average.gte=7.5&sort_by=vote_count.desc&vote_count.gte=200&language=pt-BR`, _score: 5.5 });
        addF({ title: "Cinema Coreano", type: 'movie', url: `${b}/movie?api_key=${K}&with_original_language=ko&without_genres=16&vote_average.gte=7.0&vote_count.gte=200&sort_by=vote_count.desc&language=pt-BR`, _score: 4.0 });
        addF({ title: "Neorrealismo Italiano", type: 'movie', url: `${b}/movie?api_key=${K}&with_original_language=it&vote_average.gte=7.5&vote_count.gte=100&primary_release_date.lte=1980-12-31&sort_by=vote_count.desc&language=pt-BR`, _score: 3.5 });
        addF({ title: "Novo Cinema Alemao", type: 'movie', url: `${b}/movie?api_key=${K}&with_original_language=de&vote_average.gte=7.0&vote_count.gte=100&sort_by=vote_count.desc&language=pt-BR`, _score: 3.0 });
    }

    // --- BLOCO 3: ATORES ---
    topActors.forEach(a => {
        if (isNaN(parseInt(a.id))) return;
        addF({
            title: `Atuacoes de ${a.name}`, type: 'movie',
            url: `${b}/movie?api_key=${K}&with_cast=${a.id}&sort_by=vote_count.desc&language=pt-BR`,
            _score: (a.score || 1) * 0.8
        });
    });

    // --- BLOCO 4: DECADAS x GENEROS (cada genero com SUA melhor decada) ---
    const decades = [
        { y: 1970, label: 'anos 70' }, { y: 1980, label: 'anos 80' },
        { y: 1990, label: 'anos 90' }, { y: 2000, label: 'anos 2000' },
        { y: 2010, label: 'anos 2010' }
    ];
    topGenres.forEach((g, gi) => {
        if (isNaN(parseInt(g.id))) return;
        // Cada genero pega 2 decadas distintas para nao repetir
        const d1 = decades[gi % decades.length];
        const d2 = decades[(gi + 2) % decades.length];
        [d1, d2].forEach(dec => {
            addF({
                title: `Classicos: ${g.name} dos ${dec.label}`, type: 'movie',
                url: `${b}/movie?api_key=${K}&with_genres=${g.id}&primary_release_date.gte=${dec.y}-01-01&primary_release_date.lte=${dec.y+9}-12-31&vote_count.gte=300&sort_by=vote_count.desc&language=pt-BR`,
                _score: (g.score || 1) * 0.6
            });
        });
    });

    // --- BLOCO 5: JOIAS ESCONDIDAS (nota alta, poucos votos) ---
    topGenres.forEach(g => {
        if (isNaN(parseInt(g.id))) return;
        addF({
            title: `Joias escondidas: ${g.name}`, type: 'movie',
            url: `${b}/movie?api_key=${K}&with_genres=${g.id}&vote_average.gte=7.5&vote_count.gte=50&vote_count.lte=500&sort_by=vote_average.desc&language=pt-BR`,
            _score: (g.score || 1) * 0.5
        });
    });

    // --- BLOCO 6: COMBINACOES DE GENERO ---
    if (topGenres.length >= 2) {
        for (let i = 0; i < topGenres.length - 1; i++) {
            const g1 = topGenres[i]; const g2 = topGenres[i+1];
            if (isNaN(parseInt(g1.id)) || isNaN(parseInt(g2.id))) continue;
            addF({
                title: `${g1.name} encontra ${g2.name}`, type: 'movie',
                url: `${b}/movie?api_key=${K}&with_genres=${g1.id},${g2.id}&vote_count.gte=200&sort_by=vote_count.desc&language=pt-BR`,
                _score: ((g1.score || 1) + (g2.score || 1)) * 0.5
            });
        }
    }

    // --- BLOCO 7: SERIES EXTRAS ---
    topGenres.forEach(g => {
        if (isNaN(parseInt(g.id))) return;
        const tvgB = toTvGenre(g.id);
        if (tvgB) addF({
            title: `Series de ${g.name} em alta`, type: 'tv',
            url: `${b}/tv?api_key=${K}&with_genres=${tvgB}&sort_by=popularity.desc&vote_count.gte=100&language=pt-BR`,
            _score: (g.score || 1) * 0.8
        });
    });

    // --- BLOCO 7b: SERIES UNIVERSAIS (aparecem mesmo sem taste profile) ---
    addF({ title: "Series em alta esta semana", type: 'tv', url: `https://api.themoviedb.org/3/trending/tv/week?api_key=${K}&language=pt-BR`, _score: 6.0 });
    addF({ title: "Series aclamadas de todos os tempos", type: 'tv', url: `${b}/tv?api_key=${K}&vote_average.gte=8.0&vote_count.gte=800&sort_by=vote_count.desc&language=pt-BR`, _score: 5.5 });
    addF({ title: "Minisseries imperdiveis", type: 'tv', url: `${b}/tv?api_key=${K}&with_type=2&vote_average.gte=7.5&vote_count.gte=80&sort_by=vote_count.desc&language=pt-BR`, _score: 4.5 });
    addF({ title: "Doramas coreanos", type: 'tv', url: `${b}/tv?api_key=${K}&with_original_language=ko&vote_average.gte=7.5&vote_count.gte=50&sort_by=vote_count.desc&language=pt-BR`, _score: 4.2 });
    addF({ title: "Animes essenciais", type: 'tv', url: `${b}/tv?api_key=${K}&with_original_language=ja&with_genres=16&vote_average.gte=7.5&vote_count.gte=80&sort_by=vote_count.desc&language=pt-BR`, _score: 4.0 });
    addF({ title: "Series britanicas", type: 'tv', url: `${b}/tv?api_key=${K}&with_origin_country=GB&vote_average.gte=7.5&vote_count.gte=80&sort_by=vote_count.desc&language=pt-BR`, _score: 3.6 });
    addF({ title: "Series brasileiras", type: 'tv', url: `${b}/tv?api_key=${K}&with_original_language=pt&vote_count.gte=15&sort_by=vote_count.desc&language=pt-BR`, _score: 3.2 });
    addF({ title: "Documentarios em serie", type: 'tv', url: `${b}/tv?api_key=${K}&with_genres=99&vote_average.gte=7.0&vote_count.gte=25&sort_by=vote_count.desc&language=pt-BR`, _score: 2.8 });
    addF({ title: "Comedias em serie", type: 'tv', url: `${b}/tv?api_key=${K}&with_genres=35&vote_average.gte=7.5&vote_count.gte=200&sort_by=vote_count.desc&language=pt-BR`, _score: 3.4 });
    addF({ title: "Crime e investigacao (series)", type: 'tv', url: `${b}/tv?api_key=${K}&with_genres=80&vote_average.gte=7.5&vote_count.gte=150&sort_by=vote_count.desc&language=pt-BR`, _score: 3.4 });

    // --- BLOCO 8: TEMATICOS UNIVERSAIS ---
    addF({ title: "Baseados em Historia Real", type: 'movie', url: `${b}/movie?api_key=${K}&with_keywords=9672&vote_average.gte=7.0&vote_count.gte=500&sort_by=vote_count.desc&language=pt-BR`, _score: 3.0 });
    addF({ title: "Filmes de Estrada", type: 'movie', url: `${b}/movie?api_key=${K}&with_keywords=699&vote_average.gte=7.0&vote_count.gte=200&sort_by=vote_count.desc&language=pt-BR`, _score: 2.5 });
    addF({ title: "Viagens no Tempo", type: 'movie', url: `${b}/movie?api_key=${K}&with_keywords=4565&vote_average.gte=7.0&vote_count.gte=200&sort_by=vote_count.desc&language=pt-BR`, _score: 2.0 });
    addF({ title: "Cinema Independente", type: 'movie', url: `${b}/movie?api_key=${K}&with_keywords=672&vote_average.gte=7.0&vote_count.gte=100&sort_by=vote_count.desc&language=pt-BR`, _score: 2.5 });
    addF({ title: "Distopias e Futuros Sombrios", type: 'movie', url: `${b}/movie?api_key=${K}&with_keywords=4458&vote_average.gte=7.0&vote_count.gte=200&sort_by=vote_count.desc&language=pt-BR`, _score: 2.0 });
    addF({ title: "Documentarios Essenciais", type: 'movie', url: `${b}/movie?api_key=${K}&with_genres=99&vote_average.gte=7.5&vote_count.gte=100&sort_by=vote_count.desc&language=pt-BR`, _score: 1.5 });
    addF({ title: "Thrillers Psicologicos", type: 'movie', url: `${b}/movie?api_key=${K}&with_genres=53&with_keywords=9748&vote_average.gte=7.0&vote_count.gte=200&sort_by=vote_count.desc&language=pt-BR`, _score: 2.5 });
    addF({ title: "Animacao para Adultos", type: 'movie', url: `${b}/movie?api_key=${K}&with_genres=16&without_genres=10751&vote_average.gte=7.5&vote_count.gte=200&sort_by=vote_count.desc&language=pt-BR`, _score: 1.5 });

    // (O antigo BLOCO 9, franquias por keyword/colecao, virou as COLECOES —
    //  src/config/colecoes.js — cartoes proprios na Home, sem filtro de vistos.)

    // --- BLOCO 10: NICHO PERSONALIZADO (so aparece pra quem ja demonstrou interesse) ---
    // top_keywords vem da analise do que o usuario ja assistiu/curtiu. Sem esse
    // sinal, a prateleira simplesmente nao aparece — nao e universal.
    const topKeywordIds = new Set(Object.keys(top_keywords || {}));
    const pickName = (arr) => arr[Math.floor(Math.random() * arr.length)];

    if (topKeywordIds.has('15162')) {
      addF({
        title: pickName(["Cachorros no cinema", "Melhor amigo do homem", "Historias de cachorro"]),
        type: 'movie',
        url: `${b}/movie?api_key=${K}&with_keywords=15162&vote_average.gte=6.0&vote_count.gte=50&sort_by=popularity.desc&language=pt-BR`,
        _score: 2.0
      });
    }

    if (topKeywordIds.has('158718') || topKeywordIds.has('380747') || topKeywordIds.has('363345') || topKeywordIds.has('264386')) {
      addF({
        title: pickName(["Queer no cinema", "Historias LGBTQ+", "Amor e identidade"]),
        type: 'movie',
        url: `${b}/movie?api_key=${K}&with_keywords=158718|380747&vote_average.gte=6.0&vote_count.gte=30&sort_by=popularity.desc&language=pt-BR`,
        _score: 2.0
      });
    }

    // FALLBACK
    if (formulas.length <= 4) {
      addF({ title: "Acao Explosiva", type: 'movie', url: `${b}/movie?api_key=${K}&with_genres=28&sort_by=vote_count.desc&language=pt-BR`, _score: 0 });
      addF({ title: "Comedia para Relaxar", type: 'movie', url: `${b}/movie?api_key=${K}&with_genres=35&sort_by=vote_count.desc&language=pt-BR`, _score: 0 });
      addF({ title: "Series Mais Assistidas", type: 'tv', url: `${b}/tv?api_key=${K}&sort_by=vote_count.desc&language=pt-BR`, _score: 0 });
      addF({ title: "Romances Inesqueciveis", type: 'movie', url: `${b}/movie?api_key=${K}&with_genres=10749&sort_by=vote_count.desc&language=pt-BR`, _score: 0 });
      addF({ title: "Ficcao Cientifica", type: 'movie', url: `${b}/movie?api_key=${K}&with_genres=878&sort_by=vote_count.desc&language=pt-BR`, _score: 0 });
      addF({ title: "Terror e Suspense", type: 'movie', url: `${b}/movie?api_key=${K}&with_genres=27&sort_by=vote_count.desc&language=pt-BR`, _score: 0 });
    }

    return formulas;
};

export { TV_GENRE_MAP, toTvGenre, INFINITE_SHELF_POOL, generateDynamicShelves };
