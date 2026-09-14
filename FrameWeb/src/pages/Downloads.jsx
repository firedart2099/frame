import { RELEASES, COMING_SOON, latest } from '../data/releases';
import Icon, { Logo } from '../lib/icons';
import '../styles/downloads.css';

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
};

const platformIcon = (p) => (p === 'tv' ? 'tv' : p === 'ios' ? 'film' : 'download');

export default function Downloads({ onBack }) {
  const current = latest();

  return (
    <div className="dl-page">
      <nav className="landing-nav" style={{ padding: 0 }}>
        <button className="brand" onClick={onBack} aria-label="Voltar pro início">
          <Logo size={24} strokeWidth={5} />
          <span className="wordmark">FRAME</span>
        </button>
        <button className="enter" onClick={onBack}>
          Voltar
        </button>
      </nav>

      <header className="dl-head">
        <div className="eyebrow">Aplicativo</div>
        <h1>Baixar o Frame</h1>
        <p>
          Sem assinatura e sem anúncio. A conta é a mesma do site: listas, pastas e o ponto onde você parou
          aparecem nos dois lados. E o app baixa episódio pra ver sem internet e manda o filme pra TV.
        </p>
      </header>

      {current && (
        <section className="dl-current">
          <div className="dl-current-top">
            <div>
              <div className="dl-version">{current.version}</div>
              <div className="dl-meta">
                {fmtDate(current.date)}
                {current.size ? ` · ${current.size}` : ''}
              </div>
            </div>
            <span className={`dl-badge${current.channel === 'beta' ? ' beta' : ''}`} style={{ marginLeft: 'auto' }}>
              {current.channel === 'beta' ? 'Beta' : 'Versão atual'}
            </span>
          </div>

          <div className="dl-files">
            {current.files.map((f) => (
              <div className={`dl-file${f.url ? '' : ' soon'}`} key={f.label}>
                <span className="ico">
                  <Icon name={platformIcon(f.platform)} size={20} />
                </span>
                <div>
                  <div className="lbl">{f.label}</div>
                  {f.note && <div className="note">{f.note}</div>}
                </div>
                {f.url ? (
                  <a className="btn btn-primary act" href={f.url} target="_blank" rel="noopener noreferrer">
                    <Icon name="download" size={15} />
                    Baixar
                  </a>
                ) : (
                  <span className="soon-tag">Em breve</span>
                )}
              </div>
            ))}

            {COMING_SOON.map((c) => (
              <div className="dl-file soon" key={c.label}>
                <span className="ico">
                  <Icon name="film" size={20} />
                </span>
                <div>
                  <div className="lbl">{c.label}</div>
                </div>
                <span className="soon-tag">{c.note}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="dl-tip">
        <span className="ico">
          <Icon name="shield" size={17} />
        </span>
        <div>
          O Android avisa que o arquivo veio de fora da Play Store, porque o Frame não está lá. Toca em
          "Instalar mesmo assim" quando ele perguntar.
        </div>
      </div>

      <div className="dl-log-head">
        <h2 className="section-title" style={{ margin: 0 }}>
          O que mudou
        </h2>
      </div>

      {RELEASES.map((r, i) => (
        <article className="dl-release" key={r.version}>
          <div className="dl-release-head">
            <span className="v">{r.version}</span>
            <span className="d">{fmtDate(r.date)}</span>
            {i === 0 && <span className="now">atual</span>}
          </div>
          <ul className="dl-changes">
            {r.changes.map((c, j) => (
              <li key={j}>
                <span className={`dl-kind ${c.kind}`}>{c.kind}</span>
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        </article>
      ))}

      <footer className="landing-footer" style={{ padding: '46px 0 0' }}>
        <span>Frame</span>
        <span>Feito para umas poucas pessoas</span>
      </footer>
    </div>
  );
}
