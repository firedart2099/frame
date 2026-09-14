import { useState } from 'react';
import { useFrame } from '../lib/FrameContext';
import { AUDIO_LANGUAGES, SUBTITLE_LANGUAGES, QUALITY_OPTIONS } from '../services/playbackPrefs';
import { syncNow } from '../services/sync';
import LetterboxdImport from '../components/LetterboxdImport';
import Icon from '../lib/icons';
import { supabase } from '../supabase';

const CODECS = [
  { nome: 'H.264', mime: 'video/mp4; codecs="avc1.42E01E"' },
  { nome: 'HEVC', mime: 'video/mp4; codecs="hvc1.1.6.L93.B0"' },
  { nome: 'AV1', mime: 'video/mp4; codecs="av01.0.05M.08"' },
  { nome: 'AAC', mime: 'audio/mp4; codecs="mp4a.40.2"' },
  { nome: 'AC3', mime: 'audio/mp4; codecs="ac-3"' },
  { nome: 'E-AC3', mime: 'audio/mp4; codecs="ec-3"' },
];

/**
 * Pergunta ao navegador, nao ao sistema operacional: o Chrome do Windows nao
 * toca Dolby nem quando a maquina tem; o Edge toca; e ChromeOS varia conforme
 * o fabricante licenciou. Sem ver isto, "nao tem 1080p em ingles" parece
 * falta de fonte quando na verdade e falta de codec.
 */
const suporta = (mime) => {
  try {
    if (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(mime)) return true;
  } catch (e) {
    /* sem MediaSource */
  }
  try {
    return document.createElement('video').canPlayType(mime) !== '';
  } catch (e) {
    return false;
  }
};

export default function Settings() {
  const { activeProfile, setActiveProfile, loadProfiles, prefs, updatePrefs, pendingWrites, markOnboarded, signOut, folderItems } =
    useFrame();

  // ja tem diario ou watchlist do Letterboxd importados? entao a tela vira
  // "atualizar", sem repetir a explicacao de quem nunca usou
  const jaImportouLbxd = ['lbxd_watched', 'lbxd_watchlist', 'lbxd_diary'].some(
    (k) => (folderItems?.[k] || []).length > 0
  );
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);

  const doSync = async () => {
    setSyncing(true);
    setSynced(false);
    try {
      await syncNow(activeProfile?.id);
      setSynced(true);
    } catch (e) {}
    setSyncing(false);
  };

  const set = (key) => (e) => updatePrefs({ ...prefs, [key]: e.target.value });
  const alternar = (key) => () => updatePrefs({ ...prefs, [key]: prefs[key] === false });

  // Excluir perfil vive aqui, e nao na tela de escolha: la o clique de apagar
  // fica a milimetros do clique de entrar, e o erro e irreversivel.
  const [confirmando, setConfirmando] = useState(false);
  const [apagando, setApagando] = useState(false);

  const excluirPerfil = async () => {
    if (!activeProfile?.id) return;
    setApagando(true);
    const { error } = await supabase.from('profiles').delete().eq('id', activeProfile.id);
    setApagando(false);
    if (error) return;
    setActiveProfile(null);
    await loadProfiles();
  };

  return (
    <div className="page">
      <div className="page-head" style={{ maxWidth: 780, margin: '0 auto 22px', padding: '0 var(--page-x)' }}>
        <h1>Ajustes</h1>
        <p>Valem para o perfil {activeProfile?.name} — e para o app também.</p>
      </div>

      <div className="settings">
        <h2 className="section-title" style={{ marginTop: 12 }}>
          Reprodução
        </h2>

        <div className="setting-row">
          <div>
            <div className="lbl">Idioma do áudio</div>
            <div className="hint">Quando a fonte tiver mais de uma faixa</div>
          </div>
          <div className="ctl">
            <select value={prefs.audioLanguage} onChange={set('audioLanguage')}>
              {AUDIO_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="lbl">Idioma secundário</div>
            <div className="hint">Quando o preferido não existir naquele título</div>
          </div>
          <div className="ctl">
            <select value={prefs.secondaryAudioLanguage} onChange={set('secondaryAudioLanguage')}>
              {AUDIO_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="lbl">Legenda</div>
            <div className="hint">Idioma preferido</div>
          </div>
          <div className="ctl">
            <select value={prefs.subtitleLanguage} onChange={set('subtitleLanguage')}>
              {SUBTITLE_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="lbl">O que este aparelho toca</div>
            <div className="hint">
              Codec é do navegador, não do Frame: o que estiver em vermelho aqui nenhum release consegue usar
            </div>
          </div>
          <div className="ctl">
            <div className="codecs">
              {CODECS.map((c) => (
                <span key={c.nome} className={suporta(c.mime) ? 'sim' : 'nao'}>
                  {c.nome}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="lbl">Próximo episódio</div>
            <div className="hint">Entra sozinho quando o episódio acaba</div>
          </div>
          <div className="ctl">
            <button
              className={`toggle${prefs.proximoEpisodio === false ? '' : ' on'}`}
              onClick={alternar('proximoEpisodio')}
              aria-pressed={prefs.proximoEpisodio !== false}
            >
              {prefs.proximoEpisodio === false ? 'Desligado' : 'Ligado'}
            </button>
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="lbl">Qualidade</div>
            <div className="hint">Automática se adapta à sua internet</div>
          </div>
          <div className="ctl">
            <select value={prefs.preferredQuality} onChange={set('preferredQuality')}>
              {QUALITY_OPTIONS.map((q) => (
                <option key={q.code} value={q.code}>
                  {q.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <h2 className="section-title" style={{ marginTop: 40 }}>
          Sincronização
        </h2>

        <div className="setting-row">
          <div>
            <div className="lbl">
              <span className={`sync-dot${pendingWrites > 0 ? ' pending' : ''}`} />
              {pendingWrites > 0 ? `${pendingWrites} alteração(ões) pra subir` : 'Tudo sincronizado'}
            </div>
            <div className="hint">Acontece sozinho. Isso aqui é só se você estiver com pressa.</div>
          </div>
          <div className="ctl">
            <button className="btn btn-ghost" onClick={doSync} disabled={syncing}>
              {syncing ? <span className="spinner" /> : <Icon name="refresh" size={15} />}
              {synced && !syncing ? 'Pronto' : 'Sincronizar'}
            </button>
          </div>
        </div>

        <h2 className="section-title" style={{ marginTop: 40 }}>
          Letterboxd
        </h2>
        <div style={{ padding: '8px 0 20px' }}>
          <LetterboxdImport jaImportou={jaImportouLbxd} />
        </div>

        <h2 className="section-title" style={{ marginTop: 40 }}>
          Perfil
        </h2>

        <div className="setting-row">
          <div>
            <div className="lbl">Refazer a calibração de gosto</div>
            <div className="hint">Escolhe os filmes e séries de novo, do zero</div>
          </div>
          <div className="ctl">
            <button className="btn btn-ghost" onClick={() => markOnboarded(false)}>
              Refazer
            </button>
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="lbl">Sair da conta</div>
            <div className="hint">O que estiver na fila sobe antes</div>
          </div>
          <div className="ctl">
            <button className="btn btn-ghost" onClick={signOut}>
              <Icon name="logout" size={15} />
              Sair
            </button>
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="lbl">Excluir este perfil</div>
            <div className="hint">
              Vão junto as pastas, o histórico, o progresso dos episódios e as recomendações. Isso não volta.
            </div>
          </div>
          <div className="ctl">
            {confirmando ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" disabled={apagando} onClick={excluirPerfil}>
                  {apagando ? <span className="spinner" /> : 'Excluir mesmo assim'}
                </button>
                <button className="btn btn-ghost" onClick={() => setConfirmando(false)}>
                  Cancelar
                </button>
              </div>
            ) : (
              <button className="btn btn-ghost" onClick={() => setConfirmando(true)}>
                <Icon name="trash" size={15} />
                Excluir
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
