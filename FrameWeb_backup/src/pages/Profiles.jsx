import { useState } from 'react';
import { supabase } from '../supabase';
import { useFrame } from '../lib/FrameContext';
import Icon from '../lib/icons';
import EditorDeFoto from '../components/EditorDeFoto';

/** Seleção de perfil — os mesmos perfis do app, mesma tabela. */
export default function Profiles() {
  const { profiles, setActiveProfile, loadProfiles, session, signOut } = useFrame();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [foto, setFoto] = useState(null); // foto escolhida ao criar
  const [editando, setEditando] = useState(null); // perfil em edicao de foto

  /** Troca a foto de um perfil que ja existe. */
  const salvarFoto = async (perfil, dataUrl) => {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.from('profiles').update({ avatar_url: dataUrl }).eq('id', perfil.id);
    if (error) setErr(error.message);
    else await loadProfiles();
    setEditando(null);
    setBusy(false);
  };

  const isCinephile = (p) =>
    p?.taste_profile?.is_cinephile === true ||
    Object.keys(p?.taste_profile?.analytics?.top_directors || {}).length > 0;

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase
      .from('profiles')
      .insert([{ user_id: session.user.id, name: name.trim(), avatar_url: foto || null }])
      .select();
    if (error) setErr(error.message);
    else {
      await loadProfiles();
      setName('');
      setFoto(null);
      setCreating(false);
      if (data?.[0]) setActiveProfile(data[0]);
    }
    setBusy(false);
  };

  return (
    <div className="center-screen">
      <div style={{ width: '100%', maxWidth: 760, textAlign: 'center' }}>
        <div className="eyebrow" style={{ marginBottom: 28 }}>Quem está assistindo?</div>

        {err && <div className="notice notice-error">{err}</div>}

        {creating ? (
          <form onSubmit={create} style={{ maxWidth: 340, margin: '0 auto' }}>
            <label className="field">
              <span>Nome do perfil</span>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Luiz" maxLength={24} />
            </label>

            {/* foto ja na criacao: antes so dava pra por pelo app */}
            <EditorDeFoto atual={foto} onSalvar={(dataUrl) => setFoto(dataUrl)} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? <span className="spinner" /> : 'Criar'}
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => setCreating(false)}>
                Cancelar
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="profiles">
              {profiles.map((p) => (
                <div className="profile-pick" key={p.id}>
                  <button className="face" onClick={() => setActiveProfile(p)} title={`Entrar como ${p.name}`}>
                    {p.avatar_url ? <img src={p.avatar_url} alt="" /> : (p.name || '?').charAt(0).toUpperCase()}
                  </button>

                  <div className="nm">
                    {p.name}
                    {isCinephile(p) && <Icon name="selo" size={15} style={{ color: '#F5C518' }} />}
                  </div>

                  <div className="perfil-acoes">
                    <button onClick={() => setEditando(p)} title="Trocar foto">
                      <Icon name="camera" size={13} />
                    </button>
                  </div>
                </div>
              ))}

              <button className="profile-pick" onClick={() => setCreating(true)}>
                <div className="face" style={{ color: 'var(--fg-dim)' }}>
                  <Icon name="plus" size={26} />
                </div>
                <div className="nm">Novo perfil</div>
              </button>
            </div>

            {editando && (
              <div className="perfil-modal">
                <h3>Foto de {editando.name}</h3>
                <EditorDeFoto
                  atual={editando.avatar_url}
                  onSalvar={(dataUrl) => salvarFoto(editando, dataUrl)}
                  onCancelar={() => setEditando(null)}
                />
              </div>
            )}

            <button
              onClick={signOut}
              style={{ marginTop: 54, color: 'var(--fg-dim)', fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', display: 'inline-flex', gap: 8, alignItems: 'center' }}
            >
              <Icon name="logout" size={14} />
              Sair da conta
            </button>
          </>
        )}
      </div>
    </div>
  );
}
