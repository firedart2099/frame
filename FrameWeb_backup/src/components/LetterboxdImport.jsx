import { useRef, useState } from 'react';
import { importLetterboxdZip } from '../services/letterboxd';
import { useFrame } from '../lib/FrameContext';
import { setSetting, SETTING_LBXD_RATINGS } from '../services/sync';
import Icon from '../lib/icons';

const EXPORT_URL = 'https://letterboxd.com/data/export/';

/**
 * Import do Letterboxd.
 *
 * O link de export baixa o .zip direto se a pessoa já estiver logada no
 * Letterboxd — não abre página nenhuma. Só funciona no site de computador,
 * daí o aviso pra quem estiver no celular.
 */
export default function LetterboxdImport({ onDone, compact = false, jaImportou = false }) {
  const { activeProfile, folders, folderItems, persistFoldersState, saveTasteProfile } = useFrame();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState(null);
  const inputRef = useRef(null);

  const handle = async (file) => {
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) {
      setMsg({ kind: 'error', text: 'Precisa ser o .zip que o Letterboxd te dá — não o CSV solto.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const result = await importLetterboxdZip(file, (s, p) => {
        setStep(s);
        setPct(p);
      });

      // funde com o que já existe, sem duplicar pasta
      const keep = folders.filter((f) => !result.folders.some((n) => n.id === f.id));
      const nextFolders = [...keep, ...result.folders];
      const nextItems = { ...folderItems, ...result.items };
      await persistFoldersState(nextFolders, nextItems);

      if (result.ratings.length && activeProfile?.id) {
        await setSetting(activeProfile.id, SETTING_LBXD_RATINGS, result.ratings);
      }
      await saveTasteProfile(result.taste_profile);

      const { watched, watchlist, lists } = result.stats;
      setMsg({
        kind: 'ok',
        text: `Pronto: ${watched} do diário, ${watchlist} na watchlist e ${lists} lista(s). Seu gosto já foi calibrado.`,
      });
      onDone?.(result);
    } catch (e) {
      setMsg({ kind: 'error', text: `Não consegui ler esse arquivo: ${e.message || e}` });
    }
    setBusy(false);
  };

  return (
    <div>
      {/* Quem ja importou nao precisa da explicacao de novo: pra essa pessoa a
          tela e so "atualizar". Quem nunca importou precisa saber o que ganha
          antes de ser mandado pra um site de terceiro baixar um arquivo. */}
      {!compact && !jaImportou && (
        <>
          <div className="lbxd-premio">
            <Icon name="award" size={22} style={{ color: '#4ade80' }} />
            <div>
              <b>Selo de cinéfilo</b> no seu perfil, e as recomendações passam a sair do que você realmente
              assistiu e curtiu — não de listas genéricas. Suas notas e favoritos viram prateleiras.
            </div>
          </div>

          <ol className="steps">
            <li className="step">
              <b>1.</b> Clique no botão abaixo para baixar seus dados. Se já estiver logado no Letterboxd, o
              arquivo baixa na hora, sem abrir página nenhuma.
            </li>
            <li className="step">
              <b>2.</b> Arraste o <b>.zip</b> na área aqui embaixo. Não precisa descompactar.
            </li>
          </ol>
        </>
      )}

      {!compact && (
        <a
          className="btn btn-light"
          href={EXPORT_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginBottom: 16 }}
        >
          <Icon name="letterboxd" size={15} />
          {jaImportou ? 'Baixar dados atualizados do Letterboxd' : 'Clique aqui para baixar seus dados'}
        </a>
      )}

      {msg && <div className={`notice notice-${msg.kind}`}>{msg.text}</div>}

      <div
        className={`dropzone${over ? ' over' : ''}`}
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          handle(e.dataTransfer.files?.[0]);
        }}
      >
        {busy ? (
          <>
            <div className="big">{step}…</div>
            <div className="small">{Math.round(pct * 100)}%</div>
            <div className="progress-bar" style={{ marginTop: 16 }}>
              <i style={{ width: `${pct * 100}%`, transition: 'width .3s ease' }} />
            </div>
          </>
        ) : (
          <>
            <div style={{ color: 'var(--fg-dim)', marginBottom: 12, display: 'grid', placeItems: 'center' }}>
              <Icon name="upload" size={26} />
            </div>
            <div className="big">Solta o letterboxd-export.zip aqui</div>
            <div className="small">ou clica pra escolher no computador</div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => handle(e.target.files?.[0])}
        />
      </div>

      <p style={{ fontSize: 12, color: 'var(--fg-dim)', marginTop: 14, lineHeight: 1.6 }}>
        O export do Letterboxd só existe no site de computador. No celular, baixa pelo PC e manda o arquivo
        pra você mesmo — ou faz o import direto pelo app do Frame.
      </p>
    </div>
  );
}
