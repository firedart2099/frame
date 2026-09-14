import { useState } from 'react';
import Icon from '../lib/icons';
import { conferirExtensao, marcarNaoMostrarConvite } from '../services/extensao';

/**
 * O convite pra instalar a extensão. Aparece sobre o player na primeira vez
 * que um arquivo .mkv vai tocar sem ela — o filme continua tocando embaixo
 * (no primeiro áudio do arquivo), então isto não é uma trava, é um aviso do
 * que a pessoa está perdendo: dublado e Dolby.
 *
 * Enquanto a extensão não está na Web Store, o caminho é o "modo do
 * desenvolvedor". São quatro passos, e cada um tem o que a pessoa vai VER na
 * tela, não só o que fazer.
 */
export default function PainelExtensao({ aoFechar, aoInstalada }) {
  const [conferindo, setConferindo] = useState(false);
  const [aindaNao, setAindaNao] = useState(false);

  const jaInstalei = async () => {
    setConferindo(true);
    setAindaNao(false);
    const ok = await conferirExtensao(800);
    setConferindo(false);
    if (ok) aoInstalada();
    else setAindaNao(true);
  };

  return (
    <div className="painel-extensao" role="dialog" aria-label="Instalar a extensão do Frame">
      <button className="fechar" onClick={aoFechar} title="Agora não">
        <Icon name="x" size={18} />
      </button>

      <div className="cabeca">
        <span className="selo">DUAL</span>
        <h3>Ouça dublado — sem trocar de arquivo</h3>
        <p>
          Este arquivo traz mais de um áudio (dublado e original), mas o Chrome sozinho só toca
          o primeiro, e não toca Dolby. A extensão do Frame libera isso: escolha o idioma no
          menu de áudio, com a mesma imagem, sem baixar dois filmes.
        </p>
      </div>

      <ol className="passos">
        <li>
          <a className="botao" href="/frame-extensao.zip" download>
            <Icon name="download" size={16} /> Baixar a extensão (.zip)
          </a>
          <span>e extrair a pasta em qualquer lugar (ela fica lá; não apague depois).</span>
        </li>
        <li>
          Abrir <code>chrome://extensions</code> — cole isso na barra de endereço.
        </li>
        <li>
          Ligar <strong>Modo do desenvolvedor</strong>, no canto superior direito.
        </li>
        <li>
          Clicar em <strong>Carregar sem compactação</strong> e escolher a pasta extraída.
          Vai aparecer o card <em>Frame — áudio dublado</em>.
        </li>
      </ol>

      <div className="acoes">
        <button className="primario" onClick={jaInstalei} disabled={conferindo}>
          {conferindo ? 'Conferindo…' : 'Já instalei'}
        </button>
        <button onClick={aoFechar}>Agora não</button>
        <button
          className="discreto"
          onClick={() => {
            marcarNaoMostrarConvite();
            aoFechar();
          }}
        >
          Não mostrar de novo
        </button>
      </div>
      {aindaNao && (
        <p className="ainda-nao">
          Ainda não encontrei a extensão. Depois de carregar, recarregue esta página (F5) — a
          extensão só enxerga páginas abertas depois dela.
        </p>
      )}
    </div>
  );
}
