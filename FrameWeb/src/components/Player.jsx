import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '../lib/FrameContext';
import { idOf, titleOf } from '../lib/tmdb';
import { SERVERS, TMDB_API_KEY, tmdb } from '../services/constants';
import { NOMES_IDIOMA, buscarReleases, normalizarIdioma, bitrateMbps } from '../services/torrentio';
import { buscarLegendas, carregarFalas, falaEm, hashDoArquivo, legendaPadrao } from '../services/subtitles';
import { acharTocavel, suportaDolby } from '../services/probe';
import { semGravacoes } from '../services/gravacao';
import { estimarDeslocamento } from '../services/sincronia';
import { criarAudioSeparado, testarSomente } from '../services/audioSeparado';
import { abrirMotor } from '../services/remux/motor';
import { temExtensao, extensaoBusca, navegadorServe, naoMostrarConvite, escolherFaixa } from '../services/extensao';
import { buscarMovieBox } from '../services/movieboxNavegador';
import PainelExtensao from './PainelExtensao';
import { temDublagem } from '../services/superflix';
import * as WatchProgress from '../services/watchProgress';
import Icon from '../lib/icons';

/**
 * Um player só pro app inteiro.
 *
 * Montado uma vez no topo da árvore, alterna entre três tamanhos trocando de
 * classe CSS — nunca remontando o <video>. Se fosse desmontado e remontado, o
 * filme voltava do zero a cada troca de tamanho.
 *
 * Três coisas aqui não são escolha de estilo, são limite do navegador:
 *
 *  - **Trocar idioma troca de RELEASE**, não de faixa. O Chrome não implementa
 *    `HTMLMediaElement.audioTracks`, então um mkv com 5 áudios só toca o
 *    primeiro. É o mesmo caminho do app (`switchAudioLanguage`).
 *  - **Nada de crossOrigin**: o link do AllDebrid não manda
 *    `Access-Control-Allow-Origin` e o atributo faria o vídeo nem carregar.
 *  - **Nada de /api/proxy** pros links do AllDebrid: ele responde 503 pra IP
 *    de datacenter. Do navegador, 206 com Range normal.
 */

// Nomes das FAIXAS de um arquivo. Difere de NOMES_IDIOMA (dos releases), onde
// "en" quer dizer "dublado em inglês": aqui "en" é só inglês, e "original"
// é decidido comparando com o idioma original do título.
const NOMES_FAIXA = {
  pt: 'Português', en: 'Inglês', es: 'Espanhol', fr: 'Francês', de: 'Alemão', it: 'Italiano',
  ja: 'Japonês', ko: 'Coreano', zh: 'Chinês', ru: 'Russo', hi: 'Hindi', tr: 'Turco', und: 'Idioma desconhecido',
};

const MINI_MARGIN = 20;
const CONTROLES_TIMEOUT = 3000;
const TAMANHO_LEGENDA = { small: 15, medium: 20, large: 28 };
const SEM_FONTES = [];

// velocidade: barra contínua, não uma lista de opções
const VEL_MIN = 0.25;
const VEL_MAX = 3;

/**
 * Que episódio está tocando, como uma string.
 *
 * Existe porque quase tudo aqui é POR EPISÓDIO — as fontes, o release
 * destravado no AllDebrid, a sondagem — e comparar o objeto `playing` não
 * serve: ele é novo a cada render do contexto. Errar esse endereço é o player
 * tocando o episódio anterior de novo.
 */
const chaveDe = (p) =>
  p ? `${idOf(p.item)}:${p.type}:${p.type === 'tv' ? p.season : 0}:${p.type === 'tv' ? p.episode : 0}` : null;

const relogio = (s) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const seg = Math.floor(s % 60);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(seg).padStart(2, '0')}`;
};

/** 1x, 1,5x, 2,25x — sem casa decimal à toa. */
const fmtVel = (v) => String(Math.round(v * 100) / 100).replace('.', ',');

/** Qualidade que a conexão aguenta, quando o navegador sabe dizer. */
function qualidadeDaRede() {
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const mbps = c && Number.isFinite(c.downlink) ? c.downlink : null;
  if (mbps === null) return 1080; // sem informação: assume banda boa
  if (mbps >= 12) return 1080;
  if (mbps >= 5) return 720;
  return 480;
}

function useResolvedSources(playing, prefs) {
  const [sources, setSources] = useState([]);
  const [imdbId, setImdbId] = useState(null);
  const [state, setState] = useState('idle');
  // de qual episodio e esta lista. Sem isto, quem le as fontes nao tem como
  // saber que elas ainda sao do episodio anterior: `setSources([])` so vale no
  // render seguinte, e no meio disso o player ja escolheu um release.
  const [chave, setChave] = useState(null);

  useEffect(() => {
    if (!playing) {
      setSources([]);
      setImdbId(null);
      setState('idle');
      setChave(null);
      return undefined;
    }
    let alive = true;
    setState('loading');
    setSources([]);
    setImdbId(null);
    setChave(chaveDe(playing));

    const { item, type, season, episode } = playing;
    const tmdbId = idOf(item);
    const ano = String((item.release_date || item.first_air_date || '').slice(0, 4) || '');

    const push = (novos) => {
      if (!alive || !novos.length) return;
      setSources((prev) => [...prev, ...novos]);
    };

    const viaTorrentio = (async () => {
      // Titulo original em kanji/hangul nao serve pra buscar release: o
      // Knaben jogava o japones fora e casava so o "S04E01" — JoJo tocava
      // Dr. Stone (13/09/2026). Vai o nome em letra latina e, pra anime, os
      // titulos alternativos da TMDB (romaji "JoJo no Kimyou na Bouken").
      const original = item.original_name || item.original_title || '';
      const temLatino = /[a-z]/i.test(original);
      const [ext, detalhe, alts, serie] = await Promise.all([
        tmdb(`/${type === 'tv' ? 'tv' : 'movie'}/${tmdbId}/external_ids`).catch(() => null),
        // runtime: o item das listas nao traz; a pagina de detalhes traz
        type === 'tv' ? Promise.resolve(null) : tmdb(`/movie/${tmdbId}`).catch(() => null),
        // nomes das temporadas (JoJo: Stone Ocean e a 5ª): pack nomeado pela
        // parte errada cai fora no /api/busca
        type === 'tv' ? tmdb(`/tv/${tmdbId}`).catch(() => null) : Promise.resolve(null),
        temLatino ? Promise.resolve(null) : tmdb(`/${type === 'tv' ? 'tv' : 'movie'}/${tmdbId}/alternative_titles`).catch(() => null),
      ]);
      if (!alive || !ext?.imdb_id) return;
      const titulosAlt = [...new Set(
        ((alts && (alts.results || alts.titles)) || [])
          .filter((t) => ['JP', 'US', 'GB', 'KR', 'CN'].includes(t.iso_3166_1) && /^[\x20-\x7E\u00C0-\u024F]+$/.test(t.title || ''))
          .map((t) => t.title.trim())
      )].slice(0, 6);
      const temporadasTmdb = (serie && serie.seasons) || [];
      const maxTemporada = Math.max(0, ...temporadasTmdb.map((s) => s.season_number || 0));
      const nomesTemporadas = Array.from({ length: maxTemporada }, (_, i) => (temporadasTmdb.find((s) => s.season_number === i + 1) || {}).name || '');
      setImdbId(ext.imdb_id);
      const releases = await buscarReleases({
        imdbId: ext.imdb_id,
        type,
        season,
        episode,
        prefs,
        // titulo ORIGINAL: release de scene usa o nome em ingles — se for
        // em letra latina; kanji vai como o nome em ingles/pt
        titulo: temLatino ? original : titleOf(item),
        titulosAlt,
        nomesTemporadas,
        // o titulo em portugues e o que acha DUBLADO: release brasileiro se
        // chama "Interestelar", nao "Interstellar"
        tituloPt: titleOf(item),
        ano,
        // "ingles" e "original" sao a mesma coisa num titulo americano
        idiomaOriginal: item.original_language || null,
        // o Chrome nao toca AC3/E-AC3; isso muda a ordem da fila inteira —
        // a não ser que a extensão esteja aí: o motor decodifica em WASM
        semDolby: !suportaDolby() && !(temExtensao() && navegadorServe()),
        // runtime do TMDB: deixa a nota pesar o bitrate (1080p de 1,8 Mbps
        // não é 1080p)
        duracaoS: ((detalhe && detalhe.runtime) || item.runtime || 0) * 60 || null,
      });
      // Gravação de cinema fora: CAM/TS/TELECINE não é filme. O Torrentio
      // geral já filtra por qualityfilter, mas a lista brazuca e as outras
      // fontes não — e era por lá que entrava.
      push(
        semGravacoes(releases, item.title || item.name || '', 'release').map((r) => ({
          kind: 'torrent',
          hash: r.infoHash,
          fileIdx: r.fileIdx,
          release: r.release,
          quality: r.quality || 0,
          codec: r.codec,
          audio: r.audio,
          idioma: r.idioma,
          pt: r.pt,
          size: r.sizeBytes,
          proxied: false,
        }))
      );
    })().catch(() => {});

    const qs = new URLSearchParams({ tmdb: String(tmdbId), type, title: titleOf(item), year: ano });
    if (type === 'tv') {
      qs.set('season', String(season));
      qs.set('episode', String(episode));
    }
    const viaServidor = fetch(`/api/resolve?${qs}`)
      .then((r) => (r.ok ? r.json() : { sources: [] }))
      .then((json) => push((json.sources || []).map((x) => ({ ...x, kind: 'video', quality: x.quality || 0 }))))
      .catch(() => {});

    // MovieBox do computador da pessoa, pela extensão. É a fonte que o app
    // tem e o site não tinha: do Cloudflare a API responde 440.
    const viaExtensao = extensaoBusca()
      ? buscarMovieBox({
          title: titleOf(item),
          original: item.original_title || item.original_name || null,
          year: ano,
          type,
          season,
          episode,
        })
          .then((fontes) => push(fontes))
          .catch(() => {})
      : Promise.resolve();

    Promise.allSettled([viaTorrentio, viaServidor, viaExtensao]).then(() => alive && setState('done'));

    return () => {
      alive = false;
    };
  }, [playing, prefs]);

  return { sources, state, imdbId, chave, setSources };
}

/** Backdrop escurecido + logo PNG do título, igual à tela de carregamento do app. */
function TelaCarregando({ item, type, mensagem, aoVoltar }) {
  const [logo, setLogo] = useState(null);

  useEffect(() => {
    let vivo = true;
    const id = idOf(item);
    if (!id) return undefined;
    fetch(`https://api.themoviedb.org/3/${type === 'tv' ? 'tv' : 'movie'}/${id}/images?api_key=${TMDB_API_KEY}`)
      .then((r) => r.json())
      .then((j) => {
        const logos = j.logos || [];
        const escolhido =
          logos.find((l) => l.iso_639_1 === 'pt') || logos.find((l) => l.iso_639_1 === 'en') || logos[0];
        if (vivo && escolhido) setLogo(`https://image.tmdb.org/t/p/w500${escolhido.file_path}`);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [item, type]);

  return (
    <div className="player-carregando">
      {/* Sem isto não havia saída: a tela de carregamento cobre a barra de
          cima inteira (inset:0), então quem clicasse em assistir e mudasse de
          ideia ficava preso olhando o spinner até a busca terminar. */}
      {aoVoltar && (
        <button className="voltar" onClick={aoVoltar} title="Voltar (Esc)">
          <Icon name="chevronLeft" size={20} />
          <span>Voltar</span>
        </button>
      )}
      {item.backdrop_path && (
        <img className="fundo" src={`https://image.tmdb.org/t/p/w1280${item.backdrop_path}`} alt="" />
      )}
      <div className="veu" />
      <div className="centro">
        {logo ? <img className="logo" src={logo} alt={titleOf(item)} /> : <h2>{titleOf(item)}</h2>}
        <div className="msg">
          <span className="spinner" />
          {mensagem}
        </div>
      </div>
    </div>
  );
}

export default function Player() {
  const { playing, play, mini, setMini, stop, activeProfile, prefs } = useFrame();
  const chaveEp = chaveDe(playing);
  const resolvido = useResolvedSources(playing, prefs);

  /**
   * Fonte do episodio ANTERIOR nao vale pro atual.
   *
   * Trocar de episodio marca o `playing` novo na hora, mas `setSources([])` so
   * aparece no render seguinte — e nesse intervalo os efeitos daqui rodavam
   * com a lista velha, escolhiam um release dela e travavam a escolha. Dava o
   * bug de trocar de episodio, o titulo mudar e o video continuar sendo o
   * mesmo, do comeco, pra sempre.
   */
  const fontesDoEpisodio = resolvido.chave === chaveEp;
  const sources = fontesDoEpisodio ? resolvido.sources : SEM_FONTES;
  const state = fontesDoEpisodio ? resolvido.state : 'loading';
  const imdbId = fontesDoEpisodio ? resolvido.imdbId : null;

  const [pick, setPick] = useState(0);
  const [unlocked, setUnlocked] = useState({});
  const [falhou, setFalhou] = useState({});
  const [unlocking, setUnlocking] = useState(false);
  const [sondagem, setSondagem] = useState(null); // {feitos, total}
  // o SuperFlix tem este titulo? so entao vale oferecer dublado por la
  const [dubExterna, setDubExterna] = useState(false);
  const [proximoEp, setProximoEp] = useState(null); // {season, episode, nome}
  // Quanto este filme/episódio deveria durar (TMDB). É o que separa o arquivo
  // de verdade do "sample" de um minuto.
  const [duracaoEsperada, setDuracaoEsperada] = useState(null);
  // Duração MEDIDA do arquivo que está tocando: é a régua pra não trocar de
  // filme sem perceber (ver duracaoSuspeita em probe.js).
  const duracaoDoAtualRef = useRef(0);
  const [trocouDeFilme, setTrocouDeFilme] = useState(null);
  const [contagem, setContagem] = useState(null); // segundos pro proximo
  const [fallbackIdx, setFallbackIdx] = useState(null); // indice em SERVERS, ou null
  const [pronto, setPronto] = useState(false);
  const [esperando, setEsperando] = useState(false);
  // "pedi outro arquivo e não existe outro": sem dizer isso, o botão parecia
  // não fazer nada
  const [semOutro, setSemOutro] = useState(false);
  // altura REAL do video. O nome do release mente: o pack dublado se anuncia
  // 2160p e entrega 1080p, e o selo mostrava a mentira.
  const [alturaReal, setAlturaReal] = useState(0); // { largura, altura } medidos do <video>

  // Velocidade de reprodução. Barra contínua, não uma lista de opções: 1,4x é
  // uma velocidade tão legítima quanto 1,5x, e quem acha a sua não quer
  // escolher entre cinco números.
  const [velocidade, setVelocidade] = useState(1);

  // Som de OUTRO arquivo tocando junto com esta imagem (services/audioSeparado.js).
  // O navegador nao implementa `audioTracks`: num mkv com cinco audios ele toca
  // o primeiro — e se esse primeiro for AC3, nao toca nada. Aqui a imagem
  // continua vindo do release bom e o som vem de um que este navegador
  // decodifica.
  const [audioDeFora, setAudioDeFora] = useState(null); // { hash, url, idioma, quality }
  const [offsetAudio, setOffsetAudio] = useState(0);    // + adianta o som
  const [buscandoAudio, setBuscandoAudio] = useState(false);
  const audioSepRef = useRef(null);
  const audioDeForaRef = useRef(null);
  audioDeForaRef.current = audioDeFora;

  // O motor DUAL (services/remux/motor.js): quando o arquivo é .mkv e a
  // extensão está instalada, o site abre o arquivo por conta própria e
  // escolhe a faixa de áudio — dublado ou original — sem trocar de release e
  // sem segundo download. `faixasMotor` é a lista de áudios DO ARQUIVO, que
  // aparece no menu antes das opções de trocar de release.
  const motorRef = useRef(null);
  const [faixasMotor, setFaixasMotor] = useState(null); // [{ numero, idioma, codecCurto, canais, nome, toca }]
  const [audioMotor, setAudioMotor] = useState(null); // número da faixa tocando
  const [convidarExtensao, setConvidarExtensao] = useState(false);
  const [extensaoOk, setExtensaoOk] = useState(() => temExtensao());
  const convidouRef = useRef(false); // uma vez por sessão
  const fonteSalvaRef = useRef(null); // { hash, faixa, ... } do "continuar assistindo"
  const falhouRef = useRef({});
  const idiomaEscolhaRef = useRef({ codigo: 'original', original: null });
  falhouRef.current = falhou;

  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const shellRef = useRef(null);
  const retomar = useRef(null); // segundos a restaurar ao trocar de release
  const [pos, setPos] = useState({ x: null, y: null });
  const drag = useRef(null);

  const [tocando, setTocando] = useState(false);
  const [tempo, setTempo] = useState(0);
  const [duracao, setDuracao] = useState(0);
  const [bufferado, setBufferado] = useState(0);
  const [volume, setVolume] = useState(1);
  const [mudo, setMudo] = useState(false);
  const [visiveis, setVisiveis] = useState(true);
  const [menu, setMenu] = useState(null); // 'legendas' | 'idioma' | 'qualidade'
  const [telaCheia, setTelaCheia] = useState(false);
  const escondeTimer = useRef(null);

  const [legendas, setLegendas] = useState([]);
  const [legendaAtiva, setLegendaAtiva] = useState(null);
  // O que a pessoa escolheu é o IDIOMA; qual arquivo .srt entrega aquele idioma
  // é problema nosso, e muda junto com o vídeo.
  const idiomaLegendaRef = useRef(null);
  /**
   * Ajuste de tempo da legenda, em segundos (+ atrasa a legenda).
   *
   * Existe porque nem sempre HÁ legenda em sincronia: no Thor Ragnarok, as
   * dez legendas em português do OpenSubtitles são de CAM/HDTS, e nenhuma
   * casa com um WEB-DL. O ajuste fica salvo por título e idioma — quem
   * acertou uma vez não deve ter que acertar de novo no dia seguinte.
   */
  const [ajusteLegenda, setAjusteLegenda] = useState(0);
  const [sugestaoLegenda, setSugestaoLegenda] = useState(null);
  // As falas ficam em memoria e sao desenhadas por nos. O <track> nativo
  // acumulava faixa a cada troca de release (varias legendas na tela ao mesmo
  // tempo) e desenhava dentro da CAIXA do video — que com tarja preta fazia a
  // legenda aparecer embaixo do filme.
  const [falas, setFalas] = useState([]);
  const [falaAtual, setFalaAtual] = useState(null);

  const [qualidadeAlvo, setQualidadeAlvo] = useState(null); // null = automática
  const [idiomaAlvo, setIdiomaAlvo] = useState(null); // null = preferência do perfil

  useEffect(() => {
    setPick(0);
    setFallbackIdx(null);
    setPronto(false);
    setFalhou({});
    // O link destravado e de UM ARQUIVO, nao do torrent: num pack de temporada
    // o mesmo hash vira um link diferente por episodio. Guardar isso so por
    // hash fazia o episodio seguinte herdar o link do anterior — ou seja,
    // tocar o episodio errado com o nome certo na tela.
    setUnlocked({});
    // a sondagem do episodio anterior perde a vez aqui: sem isto, voltar pro
    // episodio que ela estava preparando cairia no "ja preparei este" e o
    // player ficaria sem release nenhum
    preparo.current = { chave: null, pronto: false };
    setLegendas([]);
    setLegendaAtiva(null);
    setFalas([]);
    setFalaAtual(null);
    setQualidadeAlvo(null);
    // O IDIOMA NÃO é zerado aqui de propósito: quem está vendo a série dublada
    // quer o próximo episódio dublado também. Zerar isso fazia cada episódio
    // recomeçar pela preferência das configurações, e a série trocava de
    // idioma sozinha no meio da maratona.
    duracaoDoAtualRef.current = 0; // título novo, régua nova
    setTrocouDeFilme(null);
    setAudioDeFora(null); // som emprestado e do episodio que saiu de cena
    setOffsetAudio(0);
    retomar.current = null;

    // O <video> nao e remontado (de proposito), entao sem isto o episodio
    // anterior continua TOCANDO por baixo da tela de carregamento do proximo
    // — imagem escondida, audio no ar.
    const v = videoRef.current;
    if (v) {
      try {
        v.pause();
        v.removeAttribute('src');
        v.load();
      } catch (e) {
        /* elemento ja trocado */
      }
    }
    setTempo(0);
    setDuracao(0);
    setTocando(false);
  }, [chaveEp]);

  const options = useMemo(
    () =>
      sources.map((s, i) => ({
        key: `src-${i}`,
        kind: s.kind === 'torrent' ? 'torrent' : 'video',
        hash: s.hash,
        fileIdx: s.fileIdx,
        release: s.release,
        quality: s.quality,
        codec: s.codec,
        audio: s.audio,
        idioma: s.idioma || 'original',
        pt: s.pt,
        size: s.size,
        url: s.kind === 'torrent' ? unlocked[s.hash] || null : s.url,
        indisponivel: !!falhou[s.hash || `src-${i}`],
        proxied: s.proxied === true,
      })),
    [sources, unlocked, falhou]
  );

  // A lista de AGORA. Quem comeca uma tarefa longa (a sondagem) e so termina
  // segundos depois nao pode procurar posicao no array que viu no comeco.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // O episodio de AGORA, pelo mesmo motivo.
  const chaveRef = useRef(chaveEp);
  chaveRef.current = chaveEp;

  // O motor que casa o <audio> escondido com o <video>. Vive enquanto houver
  // player montado — o <video> nao e remontado de proposito, e o motor
  // acompanha essa vida.
  const temPlayer = !!playing;
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const ctrl = criarAudioSeparado(video, {
      aoFalhar: (motivo) => {
        console.warn('[frame][som de fora]', motivo);
        setAudioDeFora(null);
      },
      aoBuferizar: (esperandoSom) => setEsperando(esperandoSom),
    });
    audioSepRef.current = ctrl;
    return () => {
      ctrl.destruir();
      audioSepRef.current = null;
    };
  }, [temPlayer]);

  useEffect(() => {
    const ctrl = audioSepRef.current;
    if (!ctrl) return;
    if (audioDeFora?.url) ctrl.ligar(audioDeFora.url);
    else ctrl.desligar();
  }, [audioDeFora?.url]);

  useEffect(() => {
    audioSepRef.current?.definirOffset(offsetAudio);
  }, [offsetAudio]);

  // um por servidor de embed, na ordem de confianca definida em SERVERS
  const embeds = useMemo(
    () =>
      playing
        ? SERVERS.map((srv, i) => ({
            i,
            nome: srv.name,
            dica: srv.dica || null,
            url: srv.getUrl(idOf(playing.item), playing.type, playing.season, playing.episode),
          }))
        : [],
    [playing]
  );

  const embedAtual = fallbackIdx === null ? null : embeds[fallbackIdx] || null;
  const current = embedAtual
    ? { kind: 'iframe', url: embedAtual.url, key: `embed-${fallbackIdx}` }
    : options[pick] || null;
  const usandoFallback = fallbackIdx !== null;

  /**
   * Uma linha por idioma e uma por qualidade — não uma por release.
   * A lista crua tem 15 entradas e dez delas são "1080p H.264": isso é ruído,
   * não escolha.
   */
  /**
   * "Original do título" não diz nada: original de quê?
   *
   * A TMDB sabe o idioma original do título, então o menu mostra qual é —
   * "Inglês · original". Os outros idiomas vão sem adjetivo nenhum: quem
   * escolhe "Francês" quer o filme em francês, e se é dublagem ou não é
   * problema do arquivo, não da escolha.
   */
  const nomeDeIdioma = useCallback(
    (codigo) => {
      const orig = playing?.item?.original_language || null;
      const limpo = (c) => (NOMES_IDIOMA[c] || String(c).toUpperCase()).replace(' (dublado)', '');
      if (codigo !== 'original') return limpo(codigo);
      return orig ? `${limpo(orig)} · original` : 'Original do título';
    },
    [playing?.item?.original_language]
  );

  /**
   * Idioma que EXISTE mas ainda não está pronto não pode sumir do menu.
   *
   * O Thor Ragnarok tem quatro releases dublados — e os quatro voltam
   * "nao_cacheado": o AllDebrid não tem aquele arquivo em cache. A sondagem
   * reprovava, o idioma saía da lista, e a tela dizia "só há um idioma
   * disponível para este título". Não é verdade: a dublagem existe, ela só não
   * está pronta AINDA (pedir o unlock já coloca o torrent pra baixar lá, então
   * em alguns minutos ela costuma estar).
   *
   * Dizer "preparando" é diferente de esconder: um manda esperar, o outro
   * mente.
   */
  const idiomas = useMemo(() => {
    const vivos = options.filter((o) => !o.indisponivel);
    const preparandoPorIdioma = new Set();
    for (const o of options) {
      if (!o.indisponivel) continue;
      const motivo = String(falhou[o.hash] || '');
      if (!/nao_cacheado|nao destravou|cache/i.test(motivo)) continue;
      const cod = o.idioma || 'original';
      if (!vivos.some((v) => (v.idioma || 'original') === cod)) preparandoPorIdioma.add(cod);
    }
    const orig = playing?.item?.original_language || null;
    const preferido = normalizarIdioma(prefs?.audioLanguage || 'original', orig);
    const secundario = normalizarIdioma(prefs?.secondaryAudioLanguage || null, orig);
    // a ordem do menu e a ordem das configuracoes: preferido, secundario,
    // original, resto
    const peso = (c) => (c === preferido ? 0 : c === secundario ? 1 : c === 'original' ? 2 : 3);
    const vistos = new Set();
    const lista = vivos
      .map((o) => o.idioma || 'original')
      .filter((c) => (vistos.has(c) ? false : vistos.add(c)))
      .sort((a, b) => peso(a) - peso(b))
      .map((codigo) => ({ codigo, label: nomeDeIdioma(codigo) }));

    // os que existem mas ainda não destravaram entram no fim, marcados
    for (const cod of preparandoPorIdioma) {
      if (lista.some((l) => l.codigo === cod)) continue;
      lista.push({ codigo: cod, label: nomeDeIdioma(cod), preparando: true });
    }

    // nao ha release dublado, mas o SuperFlix tem o titulo: a opcao existe,
    // so nao e no nosso player
    const iSuper = SERVERS.findIndex((srv) => srv.name === 'SuperFlix');
    if (dubExterna && iSuper >= 0 && !lista.some((l) => l.codigo === 'pt')) {
      lista.push({ codigo: 'pt-embed', label: 'Português (dublado) — via SuperFlix', embed: iSuper });
    }
    return lista;
  }, [options, prefs, dubExterna, nomeDeIdioma, falhou]);

  const qualidades = useMemo(() => {
    const vistas = new Set();
    // Só entra qualidade que existe NO IDIOMA que está tocando: oferecer 1080p
    // que só existe em francês é prometer o que a troca não entrega.
    const idiomaDoMomento = current?.idioma || 'original';
    return options
      .filter((o) => !o.indisponivel && o.quality)
      .filter((o) => {
        const dele = o.idioma || 'original';
        return dele === idiomaDoMomento || (idiomaDoMomento === 'original' && dele === 'multi');
      })
      .filter((o) => (vistas.has(o.quality) ? false : vistas.add(o.quality)))
      .map((o) => o.quality)
      .sort((a, b) => b - a);
  }, [options, current?.idioma]);

  /** Melhor release de um idioma/qualidade, na ordem que o ranking já deu. */


  /** Destrava um release no AllDebrid. Devolve a url direta, ou null. */
  const chaveAjuste = useCallback(
    (lang) => `frame_legenda_ajuste_${imdbId || idOf(playing?.item) || '?'}_${lang || '?'}`,
    [imdbId, playing]
  );

  const mexerAjuste = useCallback(
    (delta) => {
      setAjusteLegenda((a) => {
        const novo = Math.round((a + delta) * 100) / 100;
        try {
          const k = chaveAjuste(idiomaLegendaRef.current);
          if (novo) window.localStorage.setItem(k, String(novo));
          else window.localStorage.removeItem(k);
        } catch (e) {}
        return novo;
      });
    },
    [chaveAjuste]
  );

  const destravar = useCallback(
    async (o) => {
      const qs = new URLSearchParams({ hash: o.hash });
      if (o.fileIdx !== null && o.fileIdx !== undefined) qs.set('idx', String(o.fileIdx));
      // num pack de vários filmes o servidor precisa saber QUAL filme é
      if (playing?.type !== 'tv' && playing?.item) {
        qs.set('titulo', titleOf(playing.item) || '');
        if (playing.item.original_title) qs.set('original', playing.item.original_title);
        const ano = String(playing.item.release_date || '').slice(0, 4);
        if (ano) qs.set('ano', ano);
      }
      if (playing?.type === 'tv') {
        qs.set('season', String(playing.season));
        qs.set('episode', String(playing.episode));
      }
      try {
        const r = await fetch(`/api/unlock?${qs}`);
        const body = await r.json().catch(() => ({}));
        return r.ok && body.url ? { url: body.url, nome: body.nome } : { erro: body.error || 'falhou' };
      } catch (e) {
        return { erro: 'rede' };
      }
    },
    [playing?.type, playing?.season, playing?.episode, playing?.item]
  );

  /**
   * Empresta o som de um release, se ele tiver som que toque aqui.
   *
   * Testa antes de ligar: oferecer um AC3 como "som de outro arquivo" seria
   * trocar mudo por mudo. Devolve true quando o som entrou no ar.
   */
  const tentarAudioDe = useCallback(
    async (o) => {
      let url = o.url || null;
      if (!url) {
        const r = await destravar(o);
        if (!r?.url) return false;
        url = r.url;
        setUnlocked((u) => ({ ...u, [o.hash]: r.url, [`${o.hash}:nome`]: r.nome }));
      }
      const teste = await testarSomente(url);
      if (!teste.toca) {
        setFalhou((f) => (f[o.hash] ? f : { ...f, [o.hash]: teste.motivo || 'sem som' }));
        return false;
      }
      setOffsetAudio(0);
      setAudioDeFora({ hash: o.hash, url, idioma: o.idioma, quality: o.quality, release: o.release });
      return true;
    },
    [destravar]
  );

  const usarAudioDe = useCallback(
    async (o) => {
      setMenu(null);
      setBuscandoAudio(true);
      try {
        await tentarAudioDe(o);
      } finally {
        setBuscandoAudio(false);
      }
    },
    [tentarAudioDe]
  );

  /**
   * O release toca a imagem mas nao tem som que este navegador decodifique.
   *
   * Queimar o release inteiro por causa disso joga fora um 1080p que funciona.
   * Primeiro tenta emprestar o som de outro arquivo (no idioma pedido, o menor
   * primeiro — do emprestado so interessa a faixa de audio); so se nenhum
   * servir e que o release morre, como era antes.
   */
  const resgatarSom = useCallback(
    async (hashAtual, marcaFalha) => {
      if (audioDeForaRef.current) return marcaFalha('audio que o navegador nao decodifica');
      const preferido = normalizarIdioma(
        prefs?.audioLanguage || 'original',
        playing?.item?.original_language || null
      );
      const ordem = (o) => ((o.idioma || 'original') === preferido ? 0 : 1);
      const candidatos = optionsRef.current
        .filter((o) => o.kind === 'torrent' && o.hash !== hashAtual && !o.indisponivel)
        .sort((a, b) => ordem(a) - ordem(b) || (a.size || 0) - (b.size || 0))
        .slice(0, 2);
      for (const o of candidatos) {
        if (chaveRef.current !== chaveEp) return undefined; // trocou de episodio no meio
        if (await tentarAudioDe(o)) return undefined;
      }
      return marcaFalha('audio que o navegador nao decodifica');
    },
    [tentarAudioDe, prefs?.audioLanguage, playing?.item?.original_language, chaveEp]
  );

  const resgatarSomRef = useRef(resgatarSom);
  resgatarSomRef.current = resgatarSom;

  /**
   * Troca de idioma ou qualidade — pela sondagem, igual a escolha automatica.
   *
   * Antes isto pegava o primeiro release do filtro e mandava direto pro
   * <video>. Como ninguem tinha testado se ele toca, voltava o ciclo de dois
   * segundos: tocava, o audio nao vinha, trocava, repetia. Escolher na mao nao
   * pode ser um caminho pior do que deixar o player escolher.
   */
  /**
   * Um arquivo "multi" (dual) serve pra quem pediu o ORIGINAL.
   *
   * Ele tem a faixa original dentro, e no navegador é ela que toca (a primeira
   * do arquivo, quase sempre). Depois que DUAL deixou de contar como português,
   * esses arquivos ficaram fora do filtro de idioma — e como a maioria dos
   * 1080p de filme é dual, pedir 1080p em "original" não achava nada e o player
   * continuava no 720p. Era essa a regressão.
   */
  const serveParaIdioma = (o, idioma) => {
    const dele = o.idioma || 'original';
    if (dele === idioma) return true;
    return idioma === 'original' && dele === 'multi';
  };

  const trocarPara = useCallback(
    async (idioma, qualidade, excluirHash = null) => {
      // `excluirHash` existe por causa do "me dá outro arquivo": marcar o atual
      // como descartado é um setState, e setState não vale no mesmo tique — a
      // lista que chega aqui ainda contém o arquivo recusado, e a sondagem
      // escolhia ELE de novo. Passar o hash na chamada resolve sem esperar o
      // render seguinte.
      const vivos = options.filter(
        (o) => o.kind === 'torrent' && !o.indisponivel && o.hash !== excluirHash
      );
      const doIdioma = idioma ? vivos.filter((o) => serveParaIdioma(o, idioma)) : vivos;
      const pool = doIdioma.length ? doIdioma : vivos;
      const daQualidade = qualidade ? pool.filter((o) => o.quality === qualidade) : pool;
      const candidatos = (daQualidade.length ? daQualidade : pool).slice(0, 8);
      if (!candidatos.length) return;

      setMenu(null);
      retomar.current = videoRef.current?.currentTime || 0;
      setFallbackIdx(null);
      setPronto(false);
      setUnlocking(true);

      // A sondagem é feita por <video> escondidos que precisam BAIXAR pra
      // provar que tocam. Com o filme atual rodando junto, a banda se divide e
      // eles estouram o prazo — resultado: "nenhum outro arquivo", quando na
      // verdade ninguém teve chance. Por isso o atual pausa aqui; ele está
      // atrás da tela de carregamento de qualquer jeito.
      try {
        videoRef.current?.pause();
      } catch (e) {
        /* elemento já trocado */
      }

      const reprovados = {};
      const bom = await acharTocavel(
        candidatos.map((o) => ({ o, obterUrl: () => destravar(o) })),
        {
          aoReprovar: (t) => {
            console.info('[frame][sondagem] reprovado:', t.o.release || t.o.hash, '->', t.motivo);
            reprovados[t.o.hash] = t.motivo || 'nao toca neste navegador';
          },
          aoProgredir: (feitos, total) => setSondagem({ feitos, total }),
          duracaoEsperada,
          duracaoReferencia: duracaoDoAtualRef.current || null,
        }
      );
      setSondagem(null);
      setUnlocking(false);
      setFalhou((f) => ({ ...f, ...reprovados }));
      if (!bom) {
        // Nenhum candidato passou. O arquivo de antes continua carregado no
        // <video>, então o certo é voltar pra ele — sem isto a tela ficava no
        // "carregando" para sempre, porque `pronto` tinha virado false e
        // ninguém mais o levantava.
        setPronto(true);
        setSemOutro(true);
        setTimeout(() => setSemOutro(false), 4000);
        // pausamos pra sondar: devolve como estava
        try {
          videoRef.current?.play();
        } catch (e) {
          /* o navegador devolve promessa rejeitada se o gesto expirou */
        }
        return;
      }
      setUnlocked((u) => ({ ...u, [bom.o.hash]: bom.url, [`${bom.o.hash}:nome`]: bom.nome }));
      const i = options.indexOf(bom.o);
      if (i >= 0) setPick(i);
    },
    [options, destravar]
  );

  /**
   * Trocar de idioma troca o SOM, não a imagem.
   *
   * Antes isso trocava o arquivo inteiro — e vinha o que o arquivo trouxesse:
   * outra qualidade, outro codec e, no caso do Perfect Days, legenda croata
   * QUEIMADA na imagem, que não tem como desligar. A regra que vale nos dois
   * lados agora é a mesma: melhor vídeo que o aparelho aguenta, e o áudio no
   * idioma pedido vem de onde estiver.
   *
   * Trocar o arquivo continua existindo como último recurso: se nenhum release
   * daquele idioma entregar som que o navegador toque, aí sim vale trocar tudo
   * — melhor a imagem do release dublado do que assistir no idioma errado.
   */
  const trocarAudioParaIdioma = useCallback(
    async (codigo, { soSom = false } = {}) => {
      setMenu(null);
      setIdiomaAlvo(codigo);

      // o arquivo que já está tocando é desse idioma: só desliga o som de fora
      if ((current?.idioma || 'original') === codigo) {
        setAudioDeFora(null);
        return;
      }

      const doIdioma = optionsRef.current.filter(
        (o) => o.kind === 'torrent' && !o.indisponivel && (o.idioma || 'original') === codigo
      );
      if (!doIdioma.length) return;

      /**
       * Dois downloads ao mesmo tempo é o último recurso, não o primeiro.
       *
       * Som de outro arquivo custa uma segunda conexão do AllDebrid rodando em
       * paralelo. Com um 1080p dublado de fonte, a banda se divide e o
       * resultado é o que você viu: o filme em câmera lenta, a roda de
       * carregamento que não fecha e o som fora de sincronia.
       *
       * Então: se existe um release NAQUELE IDIOMA com qualidade parecida com a
       * que você está vendo, troca o arquivo inteiro — um download só, sincronia
       * perfeita, sem malabarismo. O som separado fica pra quando a única
       * dublagem é muito pior que a imagem atual (720p dublado contra um 4K),
       * que é quando ele realmente paga a pena.
       */
      const qualidadeAtualDoVideo = Number(current?.quality) || 0;
      const melhor = [...doIdioma].sort((a, b) => (b.quality || 0) - (a.quality || 0))[0];
      // "só o som" é escolha explícita de quem está assistindo: mantém ESTA
      // imagem e aceita o custo do segundo download.
      if (!soSom && (!qualidadeAtualDoVideo || (melhor?.quality || 0) >= qualidadeAtualDoVideo * 0.9)) {
        trocarPara(codigo, melhor?.quality || qualidadeAlvo);
        return;
      }

      // Som separado: aqui o arquivo MENOR é o certo. Dele só interessa a faixa
      // de áudio, e cada megabyte a mais é banda tirada da imagem.
      const paraSom = [...doIdioma].sort(
        (a, b) =>
          (/dual/i.test(a.release || '') ? 1 : 0) - (/dual/i.test(b.release || '') ? 1 : 0) ||
          (a.size || Infinity) - (b.size || Infinity) ||
          (a.quality || 0) - (b.quality || 0)
      );

      setBuscandoAudio(true);
      for (const o of paraSom.slice(0, 3)) {
        if (chaveRef.current !== chaveEp) break;
        if (await tentarAudioDe(o)) {
          setBuscandoAudio(false);
          return;
        }
      }
      setBuscandoAudio(false);
      trocarPara(codigo, qualidadeAlvo);
    },
    [current?.idioma, current?.quality, tentarAudioDe, trocarPara, qualidadeAlvo, chaveEp]
  );

  /**
   * "Este arquivo não presta, me dá outro igual."
   *
   * Qualidade não é a única coisa que difere entre dois 1080p: um pode estar
   * com áudio dessincronizado, legenda queimada, corte errado ou simplesmente
   * travando. Trocar a qualidade pra voltar não serve — a pessoa não quer
   * abrir mão do 1080p, quer OUTRO 1080p.
   *
   * O arquivo atual é marcado como descartado (é o mesmo mecanismo de quando
   * ele falha sozinho), e a escolha automática segue pro próximo da fila, no
   * mesmo idioma e na mesma qualidade — passando pela sondagem, como todo o
   * resto.
   */
  const outroArquivoIgualRef = useRef(null);
  const outroArquivoIgual = useCallback(() => {
    const atual = current;
    if (!atual) return;
    setMenu(null);
    if (atual.hash) {
      setFalhou((f) => ({ ...f, [atual.hash]: 'descartado por você' }));
    }
    setAudioDeFora(null);
    trocarPara(
      idiomaAlvo || atual.idioma || 'original',
      qualidadeAlvo || atual.quality || null,
      atual.hash || null
    );
  }, [current, idiomaAlvo, qualidadeAlvo, trocarPara]);
  outroArquivoIgualRef.current = outroArquivoIgual;

  useEffect(() => {
    if (usandoFallback || state !== 'done' || !options.length) return;
    const resta = options.some((o, i) => i >= pick && !o.indisponivel);
    if (!resta) setFallbackIdx(0);
  }, [options, pick, state, usandoFallback]);

  useEffect(() => {
    if (state === 'done' && !options.length && playing) setFallbackIdx(0);
  }, [state, options.length, playing]);

  useEffect(() => {
    if (!current?.indisponivel) return;
    const proximo = options.findIndex((o, i) => i > pick && !o.indisponivel);
    if (proximo !== -1) setPick(proximo);
  }, [current?.indisponivel, options, pick]);

  const saveProgress = useCallback(
    (seconds, dur) => {
      if (!playing || !activeProfile?.id) return;
      WatchProgress.savePosition({
        profileId: activeProfile.id,
        tmdbId: idOf(playing.item),
        type: playing.type,
        season: playing.type === 'tv' ? playing.season : 0,
        episode: playing.type === 'tv' ? playing.episode : 0,
        positionSeconds: Math.floor(seconds),
        durationSeconds: dur ? Math.floor(dur) : null,
        audioCode: prefs?.audioLanguage || null,
        // o arquivo que está tocando: na volta, o player vai direto nele
        fonte:
          current?.kind === 'torrent' && current.hash
            ? {
                hash: current.hash,
                fileIdx: current.fileIdx ?? null,
                idioma: current.idioma || 'original',
                quality: current.quality || null,
                faixa: audioMotor || null, // faixa de áudio DO ARQUIVO (motor)
                release: current.release || null,
              }
            : null,
      });
    },
    [playing, activeProfile, prefs, current?.kind, current?.hash, current?.fileIdx, current?.idioma, current?.quality, current?.release, audioMotor]
  );

  useEffect(() => {
    if (!playing || current?.kind !== 'iframe') return undefined;
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      WatchProgress.savePulse({
        profileId: activeProfile?.id,
        tmdbId: idOf(playing.item),
        type: playing.type,
        season: playing.type === 'tv' ? playing.season : 0,
        episode: playing.type === 'tv' ? playing.episode : 0,
        elapsedSeconds: 30,
      });
    }, 30000);
    return () => clearInterval(t);
  }, [playing, current?.kind, activeProfile]);


  /**
   * Escolhe o release ANTES de tocar qualquer coisa.
   *
   * Em serie de BluRay quase todo release e AC3/DTS, que o navegador nao
   * decodifica: o video aparece e o som nao existe. Descobrir isso tocando
   * significava o episodio comecar e reiniciar dez vezes na cara de quem so
   * queria assistir. Aqui os candidatos sao destravados e sondados em
   * paralelo — um Range de 512 KB le o codec no cabecalho do container — e so
   * o primeiro que o navegador realmente toca chega no <video>.
   */
  const preparo = useRef({ chave: null, pronto: false });
  useEffect(() => {
    if (!playing || !fontesDoEpisodio) return undefined;
    const chave = chaveEp;
    // Intercala dublado e original em vez de sondar na ordem crua do ranking.
    // Sem isso uma onda inteira cai num idioma so — no Breaking Bad os oito
    // primeiros eram todos dublados, e o menu de audio acabava com uma opcao
    // so, mentindo que o titulo nao tem original.
    const vivos = options.filter((o) => o.kind === 'torrent' && !o.indisponivel);
    // O que a pessoa escolheu no episódio anterior manda; só na falta dele
    // vale a preferência das configurações.
    const preferidoCod =
      idiomaAlvo ||
      normalizarIdioma(prefs?.audioLanguage || 'original', playing?.item?.original_language || null);
    const primeiro = vivos.filter((o) => (o.idioma || 'original') === preferidoCod);
    const segundo = vivos.filter((o) => (o.idioma || 'original') !== preferidoCod);
    const candidatos = [];
    for (let i = 0; i < Math.max(primeiro.length, segundo.length); i += 1) {
      if (primeiro[i]) candidatos.push(primeiro[i]);
      if (segundo[i]) candidatos.push(segundo[i]);
    }
    if (!candidatos.length || preparo.current.chave === chave) return undefined;
    preparo.current = { chave, pronto: false };

    // Quem cancela esta sondagem e a TROCA DE EPISODIO, nao o efeito rodar de
    // novo. Com `let vivo` num cleanup, cada fonte que chegava atrasada
    // (o /api/resolve responde depois do Torrentio) matava a sondagem no meio
    // — e como a chave ja estava marcada, ela nunca recomecava: ficava a
    // "LIBERANDO NO ALLDEBRID" eterna, ou o release velho tocando.
    const atual = () => chaveRef.current === chave;
    setUnlocking(true);
    (async () => {
      // "Continuar assistindo": o arquivo de antes testa PRIMEIRO e sozinho
      // — desde que a busca de hoje tambem o traga (ver abaixo).
      try {
        const prev = activeProfile?.id
          ? await WatchProgress.getProgress(activeProfile.id, idOf(playing.item), playing.type, playing.type === 'tv' ? playing.season : 0, playing.type === 'tv' ? playing.episode : 0)
          : null;
        if (!atual()) return;
        const fonte = prev && !prev.completed && prev.fonte && prev.fonte.hash ? prev.fonte : null;
        if (fonte) {
          fonteSalvaRef.current = fonte;
          const i = candidatos.findIndex((o) => o.hash === fonte.hash);
          if (i > 0) candidatos.unshift(candidatos.splice(i, 1)[0]);
          // Se a busca de HOJE nao o trouxe, ele NAO entra na fila. Entrar "assim
          // mesmo" (como era) repetia pra sempre um arquivo errado gravado por
          // um bug de busca antigo: JoJo S01E18 abria "Stone Ocean 18" e ficava
          // em CARREGANDO (13/09/2026). Fonte que a busca nao confirma nao vale.
        }
      } catch (e) {
        /* sem progresso salvo: segue a fila normal */
      }
      // Em ondas de 8: uma onda leva ~3s, e no Breaking Bad os oito primeiros
      // sao todos AC3/DTS. Sondar os 25 de uma vez seria 25 chamadas ao
      // AllDebrid pra usar uma — em ondas, quase sempre para na primeira.
      // Uma corrida so, com prazo: o primeiro release que tocar ganha, e o
      // resto e abortado na hora. Sondar em ondas e esperar a onda fechar
      // deixava a tela dois minutos em "liberando no AllDebrid".
      const reprovados = {};
      const bom = await acharTocavel(
        candidatos.map((o) => ({ o, obterUrl: () => destravar(o) })),
        {
          aoReprovar: (t) => {
            console.info('[frame][sondagem] reprovado:', t.o.release || t.o.hash, '->', t.motivo);
            reprovados[t.o.hash] = t.motivo || 'nao toca neste navegador';
          },
          aoProgredir: (feitos, total) => atual() && setSondagem({ feitos, total }),
          duracaoEsperada,
        }
      );
      if (!atual()) return;

      if (bom) {
        // so a fonte aprovada ganha url: sem isso o <video> pegava a primeira
        // da lista e tocava dois segundos de mudo antes da troca.
        // O indice sai da lista de AGORA (por hash), nao da que o efeito viu:
        // fonte que chegou no meio da sondagem muda as posicoes.
        const agora = optionsRef.current;
        const indice = agora.findIndex((o) => o.hash === bom.o.hash && o.release === bom.o.release);
        if (indice >= 0) setPick(indice);
        setUnlocked((u) => ({ ...u, [bom.o.hash]: bom.url, [`${bom.o.hash}:nome`]: bom.nome }));
      }
      if (!bom) {
        // Nenhum release passou. Marcar TODOS como reprovados leva direto ao
        // aviso e ao ultimo recurso. Deixar o player tentar um por um aqui era
        // o ciclo de 3 segundos reaparecendo pelo caminho antigo.
        for (const o of candidatos) reprovados[o.hash] = reprovados[o.hash] || 'nao toca neste navegador';
      }
      setFalhou((f) => ({ ...f, ...reprovados }));
      setSondagem(null);
      preparo.current.pronto = true;
      setUnlocking(false);
    })();

    return undefined;
  }, [playing, chaveEp, fontesDoEpisodio, options, destravar, prefs?.audioLanguage, idiomaAlvo]);

  // NAO existe mais um caminho que mande release nao testado pro <video>.
  // Tanto a escolha automatica quanto a troca manual passam pela sondagem;
  // qualquer atalho aqui era o ciclo de dois segundos voltando.


  useEffect(() => {
    const video = videoRef.current;
    const tocavel = current?.kind === 'video' || current?.kind === 'torrent';
    if (!video || !tocavel || !current.url || current.indisponivel) return undefined;

    const src = current.proxied ? `/api/proxy?url=${encodeURIComponent(current.url)}` : current.url;
    let cancelled = false;

    const cleanup = () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
    cleanup();

    const isHls = /\.m3u8(\?|$)/i.test(current.url);
    // .mkv do AllDebrid com a extensão instalada: o motor abre o arquivo e
    // escolhe a faixa. Sem a extensão, o <video> toca o primeiro áudio (como
    // sempre foi) e o convite pra instalar aparece uma vez.
    const ehMkv = current.kind === 'torrent' && !current.proxied && /\.mkv(\?|$)/i.test(current.url);
    if (ehMkv && extensaoOk && navegadorServe()) {
      const { codigo, original } = idiomaEscolhaRef.current;
      const salva = fonteSalvaRef.current;
      const faixaSalva = salva && salva.hash === current.hash && salva.faixa ? salva.faixa : null;
      abrirMotor(video, src, {
        escolherAudio: (faixas) =>
          (faixaSalva && faixas.some((f) => f.numero === faixaSalva && f.toca) ? faixaSalva : null) ||
          escolherFaixa(faixas, codigo, original),
        aoErro: (e) => console.warn('[frame][motor]', e && (e.message || e)),
      })
        .then((m) => {
          if (cancelled) {
            m.destruir();
            return;
          }
          motorRef.current = m;
          setFaixasMotor(m.faixasAudio);
          setAudioMotor(m.audioAtivo);
          video.play().catch(() => {});
        })
        .catch((e) => {
          // arquivo que o motor não abre (codec, .mkv estranho): player de sempre
          console.warn('[frame][motor] caiu pro <video>:', e && (e.message || e));
          if (cancelled) return;
          video.src = src;
          video.play().catch(() => {});
        });
    } else if (!isHls || video.canPlayType('application/vnd.apple.mpegurl')) {
      if (ehMkv && !extensaoOk && !convidouRef.current && !naoMostrarConvite()) {
        convidouRef.current = true;
        setConvidarExtensao(true);
      }
      video.src = src;
      video.play().catch(() => {});
    } else {
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled || !Hls.isSupported()) return;
        const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
        hlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      });
    }

    // trocar de release não pode voltar o filme pro começo
    const posicaoPendente = retomar.current;
    const aoCarregar = async () => {
      if (posicaoPendente) {
        video.currentTime = posicaoPendente;
        retomar.current = null;
        return;
      }
      if (!activeProfile?.id || !playing) return;
      const prev = await WatchProgress.getProgress(
        activeProfile.id,
        idOf(playing.item),
        playing.type,
        playing.type === 'tv' ? playing.season : 0,
        playing.type === 'tv' ? playing.episode : 0
      );
      if (WatchProgress.resumeDecision(prev) === 'resume') video.currentTime = prev.progressSeconds;
    };
    video.addEventListener('loadedmetadata', aoCarregar, { once: true });

    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', aoCarregar);
      cleanup();
      if (motorRef.current) {
        motorRef.current.destruir();
        motorRef.current = null;
        setFaixasMotor(null);
        setAudioMotor(null);
      }
    };
  }, [current?.url, current?.kind, current?.proxied, activeProfile, playing, extensaoOk]);

  /**
   * Release que não presta é queimado e o player anda pro próximo. Três jeitos
   * de não prestar, e o terceiro é o que deixou o Breaking Bad mudo:
   *
   *  1. `error` no elemento — arquivo inválido;
   *  2. nada decodificado em 25s — codec de vídeo que o navegador não tem;
   *  3. vídeo decodifica e áudio fica em ZERO byte — é AC3/E-AC3/DTS, que o
   *     Chrome não decodifica. Não dispara erro nenhum: simplesmente toca mudo.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !current || current.kind === 'iframe' || !current.url) return undefined;

    const chave = current.hash || current.key;
    const meuSrc = current.proxied ? `/api/proxy?url=${encodeURIComponent(current.url)}` : current.url;
    const meuAbsoluto = new URL(meuSrc, window.location.href).href;
    const marcaFalha = (motivo) => setFalhou((f) => (f[chave] ? f : { ...f, [chave]: motivo }));

    const onErro = () => {
      // trocar o src dispara `error` referente ao src ANTIGO (ABORTED, ou
      // "Empty src"). Sem conferir de quem é, cada troca queimava o release
      // seguinte e a lista inteira sumia em dois segundos.
      if (video.currentSrc !== meuAbsoluto) return;
      if (video.error && video.error.code === 1) return;
      marcaFalha('nao tocou');
    };

    const semVideo = setTimeout(() => {
      if (video.currentSrc === meuAbsoluto && video.readyState === 0) marcaFalha('sem decodificador de video');
    }, 25000);

    const semAudio = setInterval(() => {
      if (video.currentSrc !== meuAbsoluto || video.paused || video.currentTime < 2.5) return;
      const v = video.webkitVideoDecodedByteCount;
      const a = video.webkitAudioDecodedByteCount;
      if (v === undefined) return clearInterval(semAudio); // navegador não expõe
      if (v > 0 && a === 0) {
        clearInterval(semAudio);
        // A imagem esta boa: antes de queimar o release, tenta o som de outro
        // arquivo. `marcaFalha` continua sendo o fim da linha se nao houver.
        resgatarSomRef.current?.(chave, marcaFalha);
      }
    }, 1000);

    const onDados = () => clearTimeout(semVideo);
    video.addEventListener('error', onErro);
    video.addEventListener('loadeddata', onDados);
    return () => {
      video.removeEventListener('error', onErro);
      video.removeEventListener('loadeddata', onDados);
      clearTimeout(semVideo);
      clearInterval(semAudio);
    };
  }, [current?.url, current?.key, current?.hash, current?.kind, current?.proxied]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    let last = 0;
    const onTime = () => {
      setTempo(video.currentTime);
      if (video.buffered.length) setBufferado(video.buffered.end(video.buffered.length - 1));
      if (video.currentTime - last >= 10) {
        last = video.currentTime;
        saveProgress(video.currentTime, video.duration);
      }
    };
    const onMeta = () => {
      // O arquivo já está no ar: se a duração não bate, ele não é o filme.
      // (é o mesmo teste da sondagem, pra quando o arquivo entrou por outro
      // caminho — troca manual, retomada, fonte direta)
      const d = video.duration;
      if (Number.isFinite(d) && d > 0 && (d < 300 || (duracaoEsperada && d < duracaoEsperada * 0.6))) {
        const chave = current?.hash || current?.key;
        if (chave) setFalhou((f) => (f[chave] ? f : { ...f, [chave]: 'arquivo curto demais (amostra)' }));
      }
      setDuracao(video.duration || 0);
      setAlturaReal(video.videoHeight ? { largura: video.videoWidth, altura: video.videoHeight } : 0);

      // Régua de identidade: se o arquivo novo difere mais de 3% do que estava
      // tocando, não é outra versão — é outro filme.
      const ref = duracaoDoAtualRef.current;
      if (Number.isFinite(d) && d > 300) {
        if (ref > 300 && Math.abs(d - ref) / ref > 0.03) {
          const chave = current?.hash || current?.key;
          // Não é aviso pra pessoa, é arquivo errado: reprova e vai pro
          // próximo, como faz com qualquer release que não toca. O banner com
          // "tentar outro / é esse mesmo" perguntava o que o player já sabe.
          if (chave) setFalhou((f) => (f[chave] ? f : { ...f, [chave]: 'outro filme (duração não bate)' }));
          console.info('[frame][player] outro filme:', Math.round(d / 60), 'min contra', Math.round(ref / 60), '— trocando');
          setTrocouDeFilme({ novo: Math.round(d / 60), antigo: Math.round(ref / 60) });
          setTimeout(() => setTrocouDeFilme(null), 6000);
          outroArquivoIgualRef.current && outroArquivoIgualRef.current();
        } else {
          duracaoDoAtualRef.current = d;
        }
      }
    };
    const onPlay = () => setTocando(true);
    const onPause = () => setTocando(false);
    const onTocou = () => {
      setPronto(true);
      setEsperando(false);
    };
    const onEsperando = () => setEsperando(true);
    const onVol = () => {
      setVolume(video.volume);
      setMudo(video.muted);
    };
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('durationchange', onMeta);
    video.addEventListener('play', onPlay);
    video.addEventListener('playing', onTocou);
    video.addEventListener('waiting', onEsperando);
    video.addEventListener('seeking', onEsperando);
    video.addEventListener('pause', onPause);
    video.addEventListener('volumechange', onVol);
    return () => {
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('durationchange', onMeta);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('playing', onTocou);
      video.removeEventListener('waiting', onEsperando);
      video.removeEventListener('seeking', onEsperando);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('volumechange', onVol);
    };
  }, [saveProgress]);

  // Serie recente costuma nao ter NENHUM torrent dublado (Sterling Point, por
  // exemplo). Quando o SuperFlix tem o titulo, o menu de audio passa a
  // oferecer portugues por la, em vez de fingir que a opcao nao existe.
  // qual e o proximo episodio desta temporada
  useEffect(() => {
    setProximoEp(null);
    setContagem(null);
    if (!playing || playing.type !== 'tv') return undefined;
    let vivo = true;
    const jaSaiu = (e) => !e?.air_date || Date.parse(e.air_date) <= Date.now();
    (async () => {
      const temporada = await tmdb(`/tv/${idOf(playing.item)}/season/${playing.season}`).catch(() => null);
      if (!vivo) return;
      const seguinte = (temporada?.episodes || []).find((e) => e.episode_number === playing.episode + 1);
      if (seguinte) {
        setProximoEp({ season: playing.season, episode: seguinte.episode_number, nome: seguinte.name });
        return;
      }
      // Fim da temporada nao e fim da serie: sem isto, o ultimo episodio de
      // cada temporada era um beco sem saida.
      const proxima = await tmdb(`/tv/${idOf(playing.item)}/season/${playing.season + 1}`).catch(() => null);
      if (!vivo) return;
      const primeiro = (proxima?.episodes || []).find((e) => e.episode_number === 1);
      if (primeiro && jaSaiu(primeiro)) {
        setProximoEp({ season: playing.season + 1, episode: 1, nome: primeiro.name });
      }
    })();
    return () => {
      vivo = false;
    };
  }, [playing]);

  useEffect(() => {
    setDuracaoEsperada(null);
    if (!playing) return undefined;
    let vivo = true;
    (async () => {
      try {
        if (playing.type === 'tv') {
          const temporada = await tmdb(`/tv/${idOf(playing.item)}/season/${playing.season}`);
          const ep = (temporada?.episodes || []).find((e) => e.episode_number === playing.episode);
          if (vivo && ep?.runtime) setDuracaoEsperada(ep.runtime * 60);
        } else {
          const filme = await tmdb(`/movie/${idOf(playing.item)}`);
          if (vivo && filme?.runtime) setDuracaoEsperada(filme.runtime * 60);
        }
      } catch (e) {
        /* sem runtime: o piso de 5 minutos ainda vale */
      }
    })();
    temDublagem(idOf(playing.item), playing.type)
      .then((tem) => vivo && setDubExterna(tem))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [playing]);

  useEffect(() => {
    if (!playing || !imdbId || mini) return undefined;
    let vivo = true;
    const nomeArquivo = current?.hash ? unlocked[`${current.hash}:nome`] || '' : current?.release || '';
    // O hash sai do arquivo que ESTÁ tocando (dois Range de 64 KB) e faz o
    // provedor devolver a legenda feita pra ele — é a diferença entre legenda
    // em sincronia e legenda "do mesmo episódio, de outro release".
    hashDoArquivo(current?.url, current?.size)
      .then((movieHash) =>
        buscarLegendas({
          imdbId,
          type: playing.type,
          season: playing.season,
          episode: playing.episode,
          prefs,
          releaseName: nomeArquivo,
          movieHash,
        })
      )
      .then((lista) => {
        if (!vivo) return;
        // uma por idioma. A lista crua trazia oito "Português" seguidos, e
        // escolher entre eles não é decisão de quem está vendo o filme.
        const porIdioma = [];
        const vistos = new Set();
        for (const l of lista) {
          // "Português (BR) · ORPHEUS", "Português · 0tv" e "Português (BR)"
          // sao a MESMA escolha pra quem assiste. Fica so a mais bem ranqueada
          // de cada idioma, e codigo cru (ZHT, RON) nao vira linha de menu.
          const grupo = l.label.replace(/ · .*$/, '').replace(/ \(BR\)$/, '');
          if (grupo === grupo.toUpperCase() && grupo.length <= 4) continue;
          if (vistos.has(grupo)) continue;
          vistos.add(grupo);
          porIdioma.push({ ...l, label: grupo });
          if (porIdioma.length >= 12) break;
        }
        setLegendas(porIdioma);

        // Trocar de arquivo troca a legenda certa: a que estava em sincronia
        // com o release anterior não está com este. O que se preserva é a
        // ESCOLHA (o idioma) — o .srt é reescolhido pro arquivo novo, de
        // preferência o casado por hash, que agora vem no topo da lista.
        const escolhido = idiomaLegendaRef.current;
        if (escolhido === 'off') {
          setLegendaAtiva(null);
          return;
        }
        const mesmoIdioma = escolhido ? porIdioma.find((l) => l.lang === escolhido) : null;
        const padrao = mesmoIdioma || legendaPadrao(porIdioma, prefs);
        if (padrao) {
          idiomaLegendaRef.current = padrao.lang;
          setLegendaAtiva(padrao.id);
        }
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
    // DEPENDE do arquivo (current?.url), e isso é novo.
    //
    // Antes não dependia, com uma razão boa pela metade: recarregar a lista
    // fazia a legenda escolhida se perder no meio do filme. Só que a legenda
    // está em sincronia com UM release — trocar de qualidade (ou de arquivo
    // pelo "tentar outro") mantinha a legenda do release antigo, e ela
    // dessincronizava na cara de quem estava assistindo. Agora a lista é
    // refeita pro arquivo novo (casada pelo hash dele) e o idioma escolhido é
    // preservado por `idiomaLegendaRef`.
  }, [playing, imdbId, mini, current?.url]);

  useEffect(() => {
    setFalaAtual(null);
    if (!legendaAtiva) {
      setFalas([]);
      return undefined;
    }
    const escolhida = legendas.find((l) => l.id === legendaAtiva);
    if (!escolhida) return undefined;
    let vivo = true;
    setSugestaoLegenda(null);
    // o ajuste que você já fez neste título/idioma vale mais que qualquer palpite
    let salvo = 0;
    try {
      salvo = Number(window.localStorage.getItem(chaveAjuste(escolhida.lang))) || 0;
    } catch (e) {}
    setAjusteLegenda(salvo);

    carregarFalas(escolhida.url)
      .then(async (lista) => {
        if (!vivo) return;
        setFalas(lista);
        if (salvo) return;

        /**
         * A régua: uma legenda casada pelo HASH do arquivo. As falas
         * acontecem nos MESMOS instantes em qualquer idioma, então uma
         * legenda em sincronia diz onde as outras deveriam estar.
         *
         * Medido nas legendas reais do Thor: as três de CAM concordam em
         * +10,9s, mas com força de pico 4,1 contra 2,8 do ruído puro — margem
         * fina demais pra mexer sozinho. Por isso: sinal forte (>=6) aplica,
         * sinal fraco vira SUGESTÃO num botão. Legenda boa não pode ser
         * estragada por um palpite meu.
         */
        const regua = legendas.find((l) => l.id !== escolhida.id && l.hashCasado);
        if (!regua) return;
        try {
          const falasRegua = await carregarFalas(regua.url);
          if (!vivo) return;
          const r = estimarDeslocamento(lista, falasRegua);
          if (!r || Math.abs(r.deslocamento) < 0.3) return;
          if (r.forca >= 6) setAjusteLegenda(-r.deslocamento);
          else if (r.forca >= 3.5) setSugestaoLegenda({ deslocamento: -r.deslocamento, forca: r.forca });
        } catch (e) {
          /* sem régua: fica o ajuste manual */
        }
      })
      .catch(() => vivo && setFalas([]));
    return () => {
      vivo = false;
    };
  }, [legendaAtiva, legendas]);

  // Trocar de release nao pode apagar a legenda: e o mesmo episodio, as falas
  // continuam validas. Por isso elas vivem fora do <video>, e so o tempo
  // corrente as sincroniza.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !falas.length) {
      setFalaAtual(null);
      return undefined;
    }
    const aoAndar = () => {
      const f = falaEm(falas, video.currentTime - ajusteLegenda);
      setFalaAtual((atual) => (atual === (f ? f.texto : null) ? atual : f ? f.texto : null));
    };
    video.addEventListener('timeupdate', aoAndar);
    video.addEventListener('seeked', aoAndar);
    return () => {
      video.removeEventListener('timeupdate', aoAndar);
      video.removeEventListener('seeked', aoAndar);
    };
  }, [falas, current?.url, ajusteLegenda]);

  /** Vai pro proximo episodio mantendo o player montado (sem recarregar). */
  const irProximoEpisodio = useCallback(() => {
    if (!playing || !proximoEp) return;
    setContagem(null);
    play(playing.item, { type: 'tv', season: proximoEp.season, episode: proximoEp.episode });
  }, [playing, proximoEp, play]);

  /**
   * "A seguir" tem que aparecer QUANDO OS CRÉDITOS COMEÇAM, não quando o
   * arquivo acaba.
   *
   * A regra antiga eram os últimos 25 segundos do arquivo — e crédito de série
   * dura de um a três minutos, então dava tempo de assistir metade dele antes
   * de o Frame se manifestar. Sem marcação de capítulo (que ninguém entrega em
   * torrent), a melhor aproximação é uma fração do episódio, presa entre 60 e
   * 150 segundos: pega o crédito de um episódio de 22 min sem estourar no meio
   * da cena final de um de 50.
   *
   * E a contagem vale por si: vai a zero e troca de episódio ali, sem esperar o
   * fim do arquivo. Esperar o evento `ended` era o mesmo erro pela porta dos
   * fundos — o arquivo só acaba depois do último crédito.
   */
  const LIMIAR_MIN = 60;
  const LIMIAR_MAX = 150;
  const ESPERA_TROCA = 12; // segundos de "quer pular?" antes de trocar sozinho
  const trocaAgendadaRef = useRef(false);

  useEffect(() => {
    trocaAgendadaRef.current = false;
  }, [chaveEp]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !proximoEp || !duracao) return undefined;
    // Onde começam os créditos: a ÚLTIMA FALA da legenda é o sinal bom —
    // depois que a última linha de diálogo termina, o que vem é crédito, e isso
    // não depende de idioma nem de duração. Sem legenda (ou com a última fala
    // colada no fim, sinal de que ela cobre a música), vale a janela de 60 a
    // 150 segundos, que é o melhor chute possível.
    const inicioDosCreditos = () => {
      const ultima = falas && falas.length ? falas[falas.length - 1].termino : null;
      if (!ultima || duracao - ultima <= 25) {
        return duracao - Math.min(LIMIAR_MAX, Math.max(LIMIAR_MIN, duracao * 0.06));
      }
      // A última fala é ESTIMATIVA, não verdade: muito episódio termina sem
      // ninguém falando — perseguição, música, um plano parado. Presa entre
      // "não antes de" e "não depois de", ela erra pra menos em vez de estragar
      // a cena final.
      const cedoDemais = duracao - Math.min(210, Math.max(60, duracao * 0.1));
      const tardeDemais = duracao - 45;
      return Math.min(Math.max(ultima + 4, cedoDemais), tardeDemais);
    };

    const onTempo = () => {
      const alvo = inicioDosCreditos();
      if (video.currentTime < alvo || video.currentTime >= duracao) {
        if (!trocaAgendadaRef.current) setContagem(null);
        return;
      }
      if (trocaAgendadaRef.current) return;
      trocaAgendadaRef.current = true;
      // automático desligado: o cartão aparece, mas sem contagem
      setContagem(prefs?.proximoEpisodio === false ? -1 : ESPERA_TROCA);
    };

    const onAcabou = () => {
      if (prefs?.proximoEpisodio !== false) irProximoEpisodio();
    };

    video.addEventListener('timeupdate', onTempo);
    video.addEventListener('ended', onAcabou);
    return () => {
      video.removeEventListener('timeupdate', onTempo);
      video.removeEventListener('ended', onAcabou);
    };
  }, [proximoEp, duracao, prefs, irProximoEpisodio, chaveEp, falas]);

  // A contagem corre no relógio, não no vídeo: pausar o filme pausa ela junto.
  useEffect(() => {
    if (contagem === null || contagem < 0) return undefined;
    if (contagem === 0) {
      irProximoEpisodio();
      return undefined;
    }
    if (!tocando) return undefined;
    const id = setTimeout(() => setContagem((c) => (c === null || c < 0 ? c : c - 1)), 1000);
    return () => clearTimeout(id);
  }, [contagem, tocando, irProximoEpisodio]);

  /**
   * Trocar o `src` zera o `playbackRate` — o navegador trata cada mídia como
   * nova. Sem reaplicar, mudar de release (ou de episódio) devolvia tudo pra
   * 1x sem ninguém ter pedido.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    video.playbackRate = velocidade;
    const aoTrocar = () => {
      video.playbackRate = velocidade;
    };
    video.addEventListener('loadedmetadata', aoTrocar);
    video.addEventListener('canplay', aoTrocar);
    return () => {
      video.removeEventListener('loadedmetadata', aoTrocar);
      video.removeEventListener('canplay', aoTrocar);
    };
  }, [velocidade, current?.url]);

  /** Perto de 1x, cola em 1x: voltar ao normal não pode exigir pontaria. */
  const mudarVelocidade = useCallback((valor) => {
    const v = Math.abs(valor - 1) < 0.06 ? 1 : Math.round(valor * 20) / 20;
    setVelocidade(v);
    if (videoRef.current) videoRef.current.playbackRate = v;
  }, []);

  const alternar = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }, []);

  const pular = useCallback((delta) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(Math.max(0, video.currentTime + delta), video.duration || Infinity);
  }, []);

  const mostrarControles = useCallback(() => {
    setVisiveis(true);
    clearTimeout(escondeTimer.current);
    escondeTimer.current = setTimeout(() => setVisiveis(false), CONTROLES_TIMEOUT);
  }, []);

  /**
   * Picture-in-picture do proprio navegador.
   *
   * O miniplayer que eu tinha feito e uma caixa dentro da pagina: some quando
   * voce troca de aba e nao tem controles do sistema. O nativo flutua sobre
   * tudo, sobrevive a troca de aba e ja vem com play/pause — e o navegador
   * cuida dele. Usar o pronto e melhor que imitar o pronto.
   */
  const pipDisponivel = typeof document !== 'undefined' && document.pictureInPictureEnabled;

  const alternarPip = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch (e) {
      // iframe de terceiro ou video sem faixa de video ainda: cai no antigo
      setMini(true);
    }
  }, [setMini]);

  const alternarTelaCheia = useCallback(() => {
    const alvo = shellRef.current;
    if (!alvo) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else alvo.requestFullscreen().catch(() => {});
  }, []);

  useEffect(() => {
    const onFs = () => setTelaCheia(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    if (!playing || mini) return undefined;
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const video = videoRef.current;
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          alternar();
          break;
        case 'ArrowLeft':
          pular(-10);
          break;
        case 'ArrowRight':
          pular(10);
          break;
        case 'ArrowUp':
          if (video) video.volume = Math.min(1, video.volume + 0.1);
          break;
        case 'ArrowDown':
          if (video) video.volume = Math.max(0, video.volume - 0.1);
          break;
        case 'm':
          if (video) video.muted = !video.muted;
          break;
        case 'f':
          alternarTelaCheia();
          break;
        case 'c':
          setLegendaAtiva((a) => (a ? null : legendaPadrao(legendas, prefs)?.id || legendas[0]?.id || null));
          break;
        case 'Escape':
          if (menu) setMenu(null);
          // Ainda carregando: virar miniplayer seria encolher um spinner.
          else if (!pronto) stop();
          else if (!document.fullscreenElement) setMini(true);
          break;
        default:
          return;
      }
      mostrarControles();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, mini, menu, pronto, stop, alternar, pular, alternarTelaCheia, mostrarControles, legendas, prefs, setMini]);

  useEffect(() => {
    if (!mini) return undefined;
    const onMove = (e) => {
      if (!drag.current) return;
      const { dx, dy, w, h } = drag.current;
      const x = Math.min(Math.max(MINI_MARGIN, e.clientX - dx), window.innerWidth - w - MINI_MARGIN);
      const y = Math.min(Math.max(MINI_MARGIN, e.clientY - dy), window.innerHeight - h - MINI_MARGIN);
      setPos({ x, y });
    };
    const onUp = () => {
      drag.current = null;
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [mini]);

  /**
   * O "voltar" do navegador tem que sair do player.
   *
   * O player e uma CAMADA por cima da rota, nao uma rota. Sem isto, voltar
   * trocava a pagina por baixo e o filme continuava tocando por cima dela —
   * som de um lugar, tela de outro.
   */
  useEffect(() => {
    if (!playing) return undefined;
    const aoTrocarRota = () => stop();
    window.addEventListener('hashchange', aoTrocarRota);
    return () => window.removeEventListener('hashchange', aoTrocarRota);
  }, [playing, stop]);

  const startDrag = (e) => {
    const box = e.currentTarget.closest('.miniplayer').getBoundingClientRect();
    drag.current = { dx: e.clientX - box.left, dy: e.clientY - box.top, w: box.width, h: box.height };
    document.body.style.userSelect = 'none';
  };

  if (!playing) return null;

  const legendaFonte = TAMANHO_LEGENDA[prefs?.subtitleSize] || TAMANHO_LEGENDA.medium;

  /**
   * A "qualidade" de um arquivo é a LARGURA, não a altura.
   *
   * Filme de cinema é 2.40:1: um 1080p vem 1920×800, com as tarjas pretas já
   * cortadas fora. Medir pela altura dizia "720p" pra um arquivo de 7 GB que é
   * 1080p de verdade — e a pessoa via 720p no selo tendo certeza de que era
   * 1080. Pela largura não tem erro: 1920 é 1080p, 3840 é 4K, 1280 é 720p.
   * A altura só decide quando o vídeo é mais ALTO que 16:9 (4:3 antigo).
   */
  const daMedida = (m) => {
    if (!m) return null;
    const { largura, altura } = m;
    const w = largura >= (altura * 16) / 9 ? largura : (altura * 16) / 9;
    return w >= 3400 ? 2160 : w >= 1800 ? 1080 : w >= 1200 ? 720 : 480;
  };
  /**
   * Duas coisas diferentes com a mesma cara: o que o arquivo MEDE e o que o
   * nome dele PROMETE.
   *
   * O nome mente nos dois sentidos — o "[ULTRA HD] 720p" dublado do Guerra
   * Infinita tem 7,47 GB, que é tamanho de 1080p. Enquanto a medição não chega
   * (ela só existe depois do `loadedmetadata`), o selo mostra o que o nome diz
   * seguido de um ~, pra ninguém tomar promessa por medida.
   */
  const qualidadeMedida = daMedida(alturaReal);
  const qualidadeAtual = qualidadeMedida || current?.quality || null;
  const qualidadeEhMedida = !!qualidadeMedida;
  // bitrate do arquivo atual: tamanho (do nome do release) ÷ duração medida
  const mbpsAtual = bitrateMbps(current?.size || null, duracao || duracaoEsperada || null);
  const idiomaAtual = current?.idioma || 'original';

  /**
   * O idioma que voce pediu existe, mas NENHUM release dele toca aqui.
   * Sem dizer isso, o player parece estar ignorando a sua preferencia — quando
   * na verdade ele nao tem escolha.
   */
  const idiomaPreferido = normalizarIdioma(
    prefs?.audioLanguage || 'original',
    playing?.item?.original_language || null
  );
  idiomaEscolhaRef.current = { codigo: idiomaAlvo || idiomaPreferido, original: playing?.item?.original_language || null };
  const idiomaSemAudio = (() => {
    if (!current || idiomaAtual === idiomaPreferido) return null;
    const doPreferido = options.filter((o) => (o.idioma || 'original') === idiomaPreferido);
    if (!doPreferido.length || doPreferido.some((o) => !o.indisponivel)) return null;
    const porCodec = doPreferido.filter((o) => /audio|video/.test(falhou[o.hash] || ''));
    return porCodec.length ? idiomaPreferido : null;
  })();

  /**
   * Arquivos que podem emprestar o som. Do emprestado so interessa a faixa de
   * audio, entao release pequeno no idioma pedido ganha do REMUX de 30 GB —
   * e a banda aqui e dobrada, os dois arquivos baixam ao mesmo tempo.
   */
  const fontesDeSom = options
    .filter((o) => o.kind === 'torrent' && o.hash !== current?.hash)
    .sort(
      (a, b) =>
        (((a.idioma || 'original') === idiomaPreferido ? 0 : 1) -
          ((b.idioma || 'original') === idiomaPreferido ? 0 : 1)) ||
        (a.size || 0) - (b.size || 0)
    )
    .slice(0, 8);

  const video = (
    <>
      <video ref={videoRef} playsInline autoPlay />

      {/* Camada propria da legenda: fica ACIMA dos controles e dentro da area
          visivel, nunca sobre a tarja preta. Cada linha e um bloco proprio —
          com o <track> nativo, fala de tres linhas ganhava um espacamento
          esquisito porque o navegador desenha tudo num paragrafo so. */}
      {falaAtual && !mini && (
        <div className="legenda-camada">
          {falaAtual.split('\n').map((linha, i) => (
            <span key={i}>{linha}</span>
          ))}
        </div>
      )}
      {esperando && pronto && (
        <div className="player-buffer">
          <span className="spinner" />
        </div>
      )}
    </>
  );

  const stage = (
    <div
      className={mini ? 'stage' : 'player-stage'}
      style={{ '--legenda-fonte': `${legendaFonte}px` }}
      onMouseMove={mini ? undefined : mostrarControles}
      onClick={() => {
        if (mini) return;
        if (menu) return setMenu(null); // clicar em qualquer lugar fecha o menu
        // Durante o carregamento, o toque na tela dava play no arquivo ANTIGO
        // e roubava a banda da sondagem — o clique parecia "cancelar" a troca.
        if (!pronto) return;
        if (current?.kind !== 'iframe') alternar();
      }}
      onDoubleClick={mini || current?.kind === 'iframe' ? undefined : alternarTelaCheia}
    >
      {current?.kind === 'iframe' ? (
        <iframe
          src={current.url}
          title={titleOf(playing.item)}
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          allowFullScreen
          referrerPolicy="origin"
        />
      ) : (
        video
      )}

      {!mini && contagem !== null && proximoEp && (
        <div className="player-proximo">
          <div className="txt">
            <span className="lbl">A seguir</span>
            <span className="nm">
              {proximoEp.season !== playing.season ? `T${proximoEp.season} ` : ''}E{proximoEp.episode} ·{' '}
              {proximoEp.nome}
            </span>
          </div>
          <button className="ok" onClick={irProximoEpisodio}>
            {contagem > 0 ? `Assistir agora (${contagem}s)` : 'Assistir agora'}
          </button>
          <button className="nao" onClick={() => setContagem(null)}>
            Ficar aqui
          </button>
        </div>
      )}

      {!mini && !pronto && current?.kind !== 'iframe' && (
        <TelaCarregando
          item={playing.item}
          type={playing.type}
          aoVoltar={stop}
          mensagem={
            sondagem
              ? `TESTANDO FONTES ${sondagem.feitos}/${sondagem.total}`
              : unlocking
                ? 'LIBERANDO NO ALLDEBRID'
                : state === 'loading'
                  ? 'PROCURANDO FONTES'
                  : 'CARREGANDO'
          }
        />
      )}
    </div>
  );

  if (mini) {
    const style =
      pos.x === null
        ? { right: MINI_MARGIN, bottom: MINI_MARGIN }
        : { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' };
    return (
      <div className={`miniplayer${drag.current ? ' dragging' : ''}`} style={style}>
        <div className="drag" onPointerDown={startDrag}>
          <Icon name="grip" size={14} style={{ color: 'var(--fg-ghost)' }} />
          <span className="t">{titleOf(playing.item)}</span>
          <div className="acts">
            <button title="Voltar pro player" onClick={() => setMini(false)}>
              <Icon name="maximize" size={13} />
            </button>
            <button title="Fechar" onClick={stop}>
              <Icon name="x" size={14} />
            </button>
          </div>
        </div>
        {stage}
      </div>
    );
  }

  const progresso = duracao ? (tempo / duracao) * 100 : 0;
  const buffer = duracao ? (bufferado / duracao) * 100 : 0;

  return (
    <div
      ref={shellRef}
      className={`player-shell${visiveis ? '' : ' oculto'}`}
      onMouseMove={mostrarControles}
    >
      {stage}

      {/* So o titulo em cima. Botao no topo do video e coisa que atrapalha:
          os comandos vivem todos na barra de baixo, junto do resto. */}
      <div className="player-top">
        <button className="icon-btn" onClick={stop} title="Voltar">
          <Icon name="chevronLeft" size={20} />
        </button>
        <div className="now">
          <div className="t">{titleOf(playing.item)}</div>
          {playing.type === 'tv' && (
            <div className="s">
              T{playing.season} · E{playing.episode}
            </div>
          )}
        </div>
      </div>

      {!usandoFallback && idiomaSemAudio && (
        <div className="player-aviso">
          <Icon name="alert" size={15} />
          <span>
            Nenhum release em <strong>{NOMES_IDIOMA[idiomaSemAudio] || idiomaSemAudio}</strong> toca neste
            navegador — todos usam áudio Dolby (AC3/E-AC3), que o Chrome não decodifica. Tocando em{' '}
            {NOMES_IDIOMA[idiomaAtual] || idiomaAtual}. No Microsoft Edge o áudio original funcionaria.
          </span>
        </div>
      )}

      {trocouDeFilme && (
        <div className="player-aviso grave">
          <Icon name="alert" size={15} />
          <span>
            <strong>Arquivo errado</strong> ({trocouDeFilme.novo} min, o filme tem {trocouDeFilme.antigo}).
            Procurando outro…
          </span>
        </div>
      )}

      {semOutro && (
        <div className="player-aviso">
          <Icon name="alert" size={15} />
          <span>Não há outro arquivo nesta qualidade e idioma. Continuando neste.</span>
        </div>
      )}

      {convidarExtensao && !mini && (
        <PainelExtensao
          aoFechar={() => setConvidarExtensao(false)}
          aoInstalada={() => {
            setConvidarExtensao(false);
            setExtensaoOk(true); // refaz o src pelo motor
          }}
        />
      )}

      {audioDeFora && (
        <div className="player-aviso">
          <Icon name="alert" size={15} />
          <span>
            Este arquivo não tem áudio que o navegador decodifique. O som está vindo de{' '}
            <strong>
              {NOMES_IDIOMA[audioDeFora.idioma] || audioDeFora.idioma || 'outro release'}
              {audioDeFora.quality ? ` ${audioDeFora.quality}p` : ''}
            </strong>
            , acompanhando a imagem.{' '}
            {offsetAudio !== 0
              ? `(${offsetAudio > 0 ? '+' : ''}${String(offsetAudio).replace('.', ',')}s) `
              : ''}
            <button
              className="link-inline"
              onClick={() => setOffsetAudio((o) => Math.round((o - 0.25) * 100) / 100)}
            >
              atrasar
            </button>
            <button
              className="link-inline"
              onClick={() => setOffsetAudio((o) => Math.round((o + 0.25) * 100) / 100)}
            >
              adiantar
            </button>
            <button className="link-inline" onClick={() => setAudioDeFora(null)}>
              desligar
            </button>
          </span>
        </div>
      )}

      {usandoFallback && (
        <div className="player-aviso">
          <Icon name="alert" size={15} />
          <span>
            Nenhum release tocou neste navegador. Usando <strong>{embedAtual?.nome}</strong>
            {embedAtual?.dica ? ` — ${embedAtual.dica}` : ''}. É player de terceiro: sem os nossos controles nem
            escolha de legenda.
            {embeds.length > 1 && (
              <button
                className="link-inline"
                onClick={() => setFallbackIdx((i) => ((i || 0) + 1) % embeds.length)}
              >
                Tentar {embeds[((fallbackIdx || 0) + 1) % embeds.length]?.nome}
              </button>
            )}
          </span>
        </div>
      )}

      {current?.kind !== 'iframe' && (
        <div className="player-controles" onClick={(e) => e.stopPropagation()}>
          <div
            className="barra"
            onClick={(e) => {
              const v = videoRef.current;
              if (!v || !duracao) return;
              const r = e.currentTarget.getBoundingClientRect();
              v.currentTime = ((e.clientX - r.left) / r.width) * duracao;
            }}
          >
            <div className="buffer" style={{ width: `${buffer}%` }} />
            <div className="feito" style={{ width: `${progresso}%` }} />
            <div className="bolinha" style={{ left: `${progresso}%` }} />
          </div>

          <div className="linha">
            <button className="ctrl" onClick={alternar} title={tocando ? 'Pausar (espaço)' : 'Tocar (espaço)'}>
              <Icon name={tocando ? 'pause' : 'play'} size={20} />
            </button>
            <button className="ctrl" onClick={() => pular(-10)} title="Voltar 10s">
              <Icon name="back10" size={18} />
            </button>
            <button className="ctrl" onClick={() => pular(10)} title="Avançar 10s">
              <Icon name="forward10" size={18} />
            </button>

            <div className="volume">
              <button
                className="ctrl"
                onClick={() => {
                  const v = videoRef.current;
                  if (v) v.muted = !v.muted;
                }}
                title="Mudo (m)"
              >
                <Icon name={mudo || volume === 0 ? 'volumeOff' : 'volume'} size={18} />
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={mudo ? 0 : volume}
                onChange={(e) => {
                  const v = videoRef.current;
                  if (!v) return;
                  v.volume = Number(e.target.value);
                  v.muted = Number(e.target.value) === 0;
                }}
              />
            </div>

            <div className="tempo">
              {relogio(tempo)} <span>/ {relogio(duracao)}</span>
            </div>

            <div className="dir">
              <div className="menu-wrap">
                <button
                  className="ctrl selo"
                  onClick={() => setMenu(menu === 'qualidade' ? null : 'qualidade')}
                  title={
                    mbpsAtual != null && mbpsAtual < 4 && qualidadeAtual >= 1080
                      ? `${qualidadeAtual}p de resolução, mas só ${mbpsAtual.toFixed(1)} Mbps — imagem de 720p. Escolha outro arquivo.`
                      : qualidadeEhMedida
                      ? `${qualidadeAtual}p medidos no arquivo${mbpsAtual != null ? ` · ${mbpsAtual.toFixed(1)} Mbps` : ''}`
                      : 'Qualidade que o nome do arquivo promete — ainda não medida'
                  }
                >
                  {qualidadeAtual ? `${qualidadeAtual}p${qualidadeEhMedida ? '' : '~'}` : 'auto'}
                  {mbpsAtual != null && mbpsAtual < 4 && qualidadeAtual >= 1080 ? ' ·' : ''}
                </button>
                {menu === 'qualidade' && (
                  <div className="menu">
                    <button
                      className={qualidadeAlvo === null ? 'sel' : ''}
                      onClick={() => {
                        setQualidadeAlvo(null);
                        // sempre com o idioma que esta tocando: mexer na
                        // qualidade nunca pode trocar o audio
                        trocarPara(idiomaAlvo || idiomaAtual, qualidadeDaRede());
                      }}
                    >
                      Automática {qualidadeAlvo === null && qualidadeAtual ? `(${qualidadeAtual}p)` : ''}
                    </button>
                    {qualidades.map((q) => (
                      <button
                        key={q}
                        className={qualidadeAlvo === q ? 'sel' : ''}
                        onClick={() => {
                          setQualidadeAlvo(q);
                          trocarPara(idiomaAlvo || idiomaAtual, q);
                        }}
                      >
                        {q}p
                      </button>
                    ))}

                  </div>
                )}
              </div>

              <button
                className="ctrl"
                onClick={outroArquivoIgual}
                title="Tentar outro arquivo nesta mesma qualidade"
              >
                <Icon name="refresh" size={17} />
              </button>

              <div className="menu-wrap">
                <button
                  className="ctrl"
                  onClick={() => setMenu(menu === 'idioma' ? null : 'idioma')}
                  title="Faixa de áudio"
                >
                  <Icon name="audioTrack" size={18} />
                </button>
                {menu === 'idioma' && (
                  <div className="menu">
                    {faixasMotor && (
                      <>
                        <span className="titulo">Áudio deste arquivo</span>
                        {faixasMotor.map((f) => (
                          <button
                            key={`faixa-${f.numero}`}
                            className={`faixa-arquivo${f.numero === audioMotor ? ' sel' : ''}`}
                            disabled={!f.toca}
                            title={f.toca ? undefined : 'Este navegador não decodifica esta faixa'}
                            onClick={async () => {
                              setMenu(null);
                              setIdiomaAlvo(f.idioma);
                              setAudioMotor(f.numero);
                              await motorRef.current?.trocarAudio(f.numero);
                            }}
                          >
                            <span>
                              {NOMES_FAIXA[f.idioma] || f.nome || f.idioma}
                              {f.idioma === (playing?.item?.original_language || 'en') ? ' · original' : ''}
                            </span>
                            <small>
                              {f.codecCurto}
                              {f.canais ? ` ${f.canais === 6 ? '5.1' : f.canais === 8 ? '7.1' : f.canais + 'ch'}` : ''}
                            </small>
                          </button>
                        ))}
                        <span className="titulo">Outros arquivos</span>
                      </>
                    )}
                    {!faixasMotor && <span className="titulo">Áudio</span>}
                    {idiomas.map((l) => (
                      <button
                        key={l.codigo}
                        className={idiomaAtual === l.codigo ? 'sel' : ''}
                        onClick={() => {
                          if (l.embed !== undefined) {
                            setFallbackIdx(l.embed); // dublagem so existe fora
                            setMenu(null);
                            return;
                          }
                          trocarAudioParaIdioma(l.codigo);
                        }}
                        title={
                          l.preparando
                            ? 'O arquivo existe, mas o AllDebrid ainda está preparando. Tente de novo em alguns minutos.'
                            : undefined
                        }
                      >
                        {l.label}
                        {l.preparando ? ' · preparando' : ''}
                      </button>
                    ))}

                    {/* A troca normal pega o arquivo inteiro naquele idioma: um
                        download, sincronia perfeita. Quem quer MANTER esta
                        imagem (porque é 4K, ou porque este arquivo é o bom)
                        escolhe aqui, e aí o som vem de outro arquivo tocando
                        junto — custa uma segunda conexão. */}
                    {idiomas.filter((l) => l.codigo !== idiomaAtual && !l.preparando && l.embed === undefined)
                      .map((l) => (
                        <button
                          key={`som-${l.codigo}`}
                          className="so-som"
                          onClick={() => trocarAudioParaIdioma(l.codigo, { soSom: true })}
                          title="Mantém a imagem que está tocando e traz só o som deste idioma (baixa dois arquivos ao mesmo tempo)"
                        >
                          {l.label} · só o som
                        </button>
                      ))}
                    {idiomas.length < 2 && (
                      <span className="vazio">Só há um idioma disponível para este título.</span>
                    )}
                    {audioDeFora && (
                      <>
                        <span className="titulo">Som</span>
                        <span className="vazio">
                          Vindo de outro arquivo (este não tem áudio que o navegador toque).
                        </span>
                        <button onClick={() => setAudioDeFora(null)}>Voltar ao som deste arquivo</button>
                      </>
                    )}

                  </div>
                )}
              </div>

              <div className="menu-wrap">
                <button
                  className={`ctrl${legendaAtiva ? ' on' : ''}`}
                  onClick={() => setMenu(menu === 'legendas' ? null : 'legendas')}
                  title="Legendas (c)"
                >
                  <Icon name="subtitles" size={18} />
                </button>
                {menu === 'legendas' && (
                  <div className="menu">
                    <button
                      className={legendaAtiva ? '' : 'sel'}
                      onClick={() => {
                        idiomaLegendaRef.current = 'off';
                        setLegendaAtiva(null);
                      }}
                    >
                      Desligada
                    </button>
                    {legendaAtiva && (
                      <>
                        <span className="titulo">Sincronia</span>
                        <div className="sincronia-legenda">
                          <button onClick={() => mexerAjuste(-0.25)} title="A legenda aparece mais cedo">
                            −0,25s
                          </button>
                          <span className="valor">
                            {ajusteLegenda > 0 ? '+' : ''}
                            {ajusteLegenda.toFixed(2).replace('.', ',')}s
                          </span>
                          <button onClick={() => mexerAjuste(0.25)} title="A legenda aparece mais tarde">
                            +0,25s
                          </button>
                        </div>
                        {sugestaoLegenda && (
                          <button
                            className="sugestao-sync"
                            onClick={() => {
                              mexerAjuste(sugestaoLegenda.deslocamento - ajusteLegenda);
                              setSugestaoLegenda(null);
                            }}
                            title="Estimado comparando com a legenda que casa com este arquivo"
                          >
                            Tentar {sugestaoLegenda.deslocamento > 0 ? '+' : ''}
                            {sugestaoLegenda.deslocamento.toFixed(1).replace('.', ',')}s automático
                          </button>
                        )}
                      </>
                    )}

                    {legendas.map((l) => (
                      <button
                        key={l.id}
                        className={legendaAtiva === l.id ? 'sel' : ''}
                        onClick={() => {
                          idiomaLegendaRef.current = l.lang;
                          setLegendaAtiva(l.id);
                        }}
                        title={l.arquivo}
                      >
                        {l.label}
                        {l.hashCasado ? ' ·' : ''}
                      </button>
                    ))}
                    {!legendas.length && <span className="vazio">Nenhuma legenda encontrada</span>}
                  </div>
                )}
              </div>

              <div className="menu-wrap">
                <button
                  className={`ctrl selo${velocidade !== 1 ? ' on' : ''}`}
                  onClick={() => setMenu(menu === 'velocidade' ? null : 'velocidade')}
                  title="Velocidade"
                >
                  {fmtVel(velocidade)}x
                </button>
                {menu === 'velocidade' && (
                  <div className="menu velocidade">
                    <span className="titulo">Velocidade</span>
                    <div className="valor">{fmtVel(velocidade)}x</div>
                    <input
                      type="range"
                      min={VEL_MIN}
                      max={VEL_MAX}
                      step="0.05"
                      value={velocidade}
                      onChange={(e) => mudarVelocidade(Number(e.target.value))}
                      aria-label="Velocidade de reprodução"
                    />
                    <div className="marcas">
                      <span>{fmtVel(VEL_MIN)}x</span>
                      <span>1x</span>
                      <span>{fmtVel(VEL_MAX)}x</span>
                    </div>
                    {velocidade !== 1 && (
                      <button onClick={() => mudarVelocidade(1)}>Voltar pra velocidade normal</button>
                    )}
                  </div>
                )}
              </div>

              {pipDisponivel && (
                <button className="ctrl" onClick={alternarPip} title="Miniplayer do navegador">
                  <Icon name="grip" size={17} />
                </button>
              )}

              {/* Um botão só: se está na tela cheia ele sai dela, se não está
                  ele entra. Dois botões pra isso era pergunta sem resposta. */}
              <button
                className="ctrl"
                onClick={alternarTelaCheia}
                title={telaCheia ? 'Sair da tela cheia (f)' : 'Tela cheia (f)'}
              >
                <Icon name={telaCheia ? 'minimize' : 'maximize'} size={18} />
              </button>

              <button className="ctrl" onClick={stop} title="Fechar">
                <Icon name="x" size={18} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
