import { useRef, useState } from 'react';
import { supabase } from '../supabase';
import Icon from '../lib/icons';

/**
 * Conta no Frame.
 *
 * A lista de convidados é checada em dois lugares: aqui, só pra dar uma
 * mensagem decente, e no banco, com um trigger em auth.users — esse é o que
 * vale. Checagem só no navegador não protege nada, porque a chave anon é
 * pública e qualquer um chamaria o signUp direto.
 */

const CODE_LEN = 6;

function CodeInput({ value, onChange, onComplete }) {
  const refs = useRef([]);

  const setAt = (i, ch) => {
    const next = (value.slice(0, i) + ch + value.slice(i + 1)).slice(0, CODE_LEN);
    onChange(next);
    if (ch && i < CODE_LEN - 1) refs.current[i + 1]?.focus();
    if (next.length === CODE_LEN && !next.includes(' ')) onComplete?.(next);
  };

  return (
    <div className="code-input">
      {Array.from({ length: CODE_LEN }).map((_, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          value={value[i] || ''}
          onChange={(e) => setAt(i, e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !value[i] && i > 0) refs.current[i - 1]?.focus();
          }}
          onPaste={(e) => {
            e.preventDefault();
            const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LEN);
            if (!digits) return;
            onChange(digits);
            if (digits.length === CODE_LEN) onComplete?.(digits);
          }}
        />
      ))}
    </div>
  );
}

export default function Auth({ initialMode = 'login', onBack }) {
  const [mode, setMode] = useState(initialMode); // login | signup | verify | forgot
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { kind, text }

  const say = (kind, text) => setMsg({ kind, text });

  const submitSignup = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      // pré-checagem só pra mensagem ser clara; quem barra de verdade é o banco
      const { data: allowed, error: rpcErr } = await supabase.rpc('email_allowed', {
        p_email: email.trim().toLowerCase(),
      });
      if (!rpcErr && allowed === false) {
        say('error', 'Esse e-mail não está na lista de convidados do Frame. Fala com quem te chamou.');
        setBusy(false);
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: window.location.origin },
      });

      // O Supabase esconde de propósito que o e-mail já existe (pra ninguém
      // descobrir quem tem conta): volta SEM erro, com `identities` vazio. Sem
      // checar isso, a tela mandava a pessoa esperar um e-mail que nunca vem.
      const jaTemConta =
        (!error && data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) ||
        (error && /already registered|already exists/i.test(error.message));

      if (jaTemConta) {
        setMode('login');
        say('info', 'Esse e-mail já tem conta. Entra com a tua senha — ou usa "Esqueci a senha".');
        setBusy(false);
        return;
      }

      if (error) {
        // o trigger da allowlist chega aqui como erro genérico do banco
        const blocked = /database error|saving new user/i.test(error.message);
        say(
          'error',
          blocked
            ? 'Esse e-mail não está na lista de convidados do Frame.'
            : error.message
        );
      } else {
        setMode('verify');
        say('info', `Mandamos um e-mail pra ${email.trim()}. Confirma por lá pra liberar sua conta.`);
      }
    } catch (err) {
      say('error', String(err.message || err));
    }
    setBusy(false);
  };

  const submitLogin = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      const unconfirmed = /confirm/i.test(error.message);
      if (unconfirmed) {
        setMode('verify');
        say('info', 'Sua conta ainda não foi confirmada. Usa o código que chegou no e-mail.');
      } else {
        say('error', /invalid login/i.test(error.message) ? 'E-mail ou senha incorretos.' : error.message);
      }
    }
    setBusy(false);
  };

  const submitCode = async (value) => {
    const token = (value || code).trim();
    if (token.length !== CODE_LEN) return;
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'email' });
    if (error) say('error', 'Código inválido ou expirado. Confere o e-mail ou pede outro.');
    setBusy(false);
  };

  const resend = async () => {
    setBusy(true);
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() });
    say(error ? 'error' : 'ok', error ? error.message : 'Mandamos de novo. Olha a caixa de entrada.');
    setBusy(false);
  };

  const submitForgot = async (e) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });
    say(error ? 'error' : 'ok', error ? error.message : 'Link de recuperação enviado.');
    setBusy(false);
  };

  return (
    <div className="center-screen">
      <div className="auth-card">
        <button
          onClick={onBack}
          style={{ color: 'var(--fg-dim)', fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 30, display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Icon name="chevronLeft" size={14} />
          Voltar
        </button>

        <div className="wordmark">FRAME</div>

        {mode === 'signup' && <p className="tag">Cria sua conta. Leva um minuto.</p>}
        {mode === 'login' && <p className="tag">Bem-vindo de volta.</p>}
        {mode === 'verify' && <p className="tag">Confirma que o e-mail é seu.</p>}
        {mode === 'forgot' && <p className="tag">A gente te manda um link pra criar outra senha.</p>}

        {msg && <div className={`notice notice-${msg.kind}`}>{msg.text}</div>}

        {mode === 'verify' ? (
          <>
            <label className="field">
              <span>Código de 6 dígitos</span>
            </label>
            <CodeInput value={code} onChange={setCode} onComplete={submitCode} />
            <button className="btn btn-primary btn-block" disabled={busy || code.length < CODE_LEN} onClick={() => submitCode()}>
              {busy ? <span className="spinner" /> : 'Confirmar'}
            </button>
            <p style={{ fontSize: 12, color: 'var(--fg-muted)', textAlign: 'center', marginTop: 18, lineHeight: 1.6 }}>
              Se o e-mail veio com um link em vez de código, é só clicar nele — dá no mesmo.
            </p>
            <div className="auth-switch">
              <button onClick={resend} disabled={busy}>
                Reenviar e-mail
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={mode === 'signup' ? submitSignup : mode === 'login' ? submitLogin : submitForgot}>
            <label className="field">
              <span>E-mail</span>
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="voce@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>

            {mode !== 'forgot' && (
              <label className="field">
                <span>Senha</span>
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            )}

            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? <span className="spinner" /> : mode === 'signup' ? 'Criar conta' : mode === 'login' ? 'Entrar' : 'Enviar link'}
            </button>
          </form>
        )}

        {mode === 'login' && (
          <>
            <div className="auth-switch">
              Não tem conta? <button onClick={() => { setMode('signup'); setMsg(null); }}>Criar</button>
            </div>
            <div className="auth-switch" style={{ marginTop: 10 }}>
              <button onClick={() => { setMode('forgot'); setMsg(null); }} style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>
                Esqueci a senha
              </button>
            </div>
          </>
        )}
        {mode === 'signup' && (
          <div className="auth-switch">
            Já tem conta? <button onClick={() => { setMode('login'); setMsg(null); }}>Entrar</button>
          </div>
        )}
        {mode === 'forgot' && (
          <div className="auth-switch">
            <button onClick={() => { setMode('login'); setMsg(null); }}>Voltar pro login</button>
          </div>
        )}
      </div>
    </div>
  );
}
