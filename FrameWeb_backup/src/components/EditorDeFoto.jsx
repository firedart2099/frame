import { useEffect, useRef, useState } from 'react';
import { lerImagem, recortarQuadrado, tamanhoKb } from '../lib/foto';
import Icon from '../lib/icons';

/**
 * Escolher e enquadrar a foto do perfil.
 *
 * O app já recortava 1:1 no upload, mas o site só sabia mostrar o que viesse
 * de lá. E "recorte automático no centro" corta cabeça com frequência — por
 * isso aqui dá pra dar zoom e arrastar antes de salvar. O que sai é sempre um
 * quadrado de 400px, que é o que o círculo da interface espera.
 */
export default function EditorDeFoto({ atual, onSalvar, onCancelar }) {
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [erro, setErro] = useState(null);
  const [previa, setPrevia] = useState(atual || null);
  const arrastando = useRef(null);

  useEffect(() => {
    if (!img) return;
    setPrevia(recortarQuadrado(img, { zoom, dx: pos.x, dy: pos.y }));
  }, [img, zoom, pos]);

  const escolher = async (e) => {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setErro(null);
    try {
      const imagem = await lerImagem(arquivo);
      setImg(imagem);
      setZoom(1);
      setPos({ x: 0, y: 0 });
    } catch (erroLeitura) {
      setErro(erroLeitura.message);
    }
  };

  // arrastar move o recorte na imagem original, não na prévia
  const aoArrastar = (e) => {
    if (!arrastando.current || !img) return;
    const escala = Math.min(img.naturalWidth, img.naturalHeight) / 180;
    setPos({
      x: arrastando.current.px - (e.clientX - arrastando.current.x0) * escala,
      y: arrastando.current.py - (e.clientY - arrastando.current.y0) * escala,
    });
  };

  return (
    <div className="foto-editor">
      <div
        className="foto-previa"
        onPointerDown={(e) => {
          if (!img) return;
          arrastando.current = { x0: e.clientX, y0: e.clientY, px: pos.x, py: pos.y };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={aoArrastar}
        onPointerUp={() => {
          arrastando.current = null;
        }}
      >
        {previa ? <img src={previa} alt="" /> : <Icon name="plus" size={26} />}
      </div>

      {img && (
        <label className="foto-zoom">
          <span>Zoom</span>
          <input
            type="range"
            min="1"
            max="3"
            step="0.05"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
      )}

      {img && <div className="foto-dica">Arraste a foto para enquadrar</div>}
      {erro && <div className="notice notice-error">{erro}</div>}

      <div className="foto-acoes">
        <label className="btn btn-ghost">
          <Icon name="camera" size={14} />
          {previa ? 'Trocar foto' : 'Escolher foto'}
          <input type="file" accept="image/*" onChange={escolher} hidden />
        </label>

        <button
          className="btn btn-primary"
          disabled={!previa}
          onClick={() => onSalvar(previa, tamanhoKb(previa))}
        >
          Salvar foto
        </button>

        {onCancelar && (
          <button className="btn btn-ghost" onClick={onCancelar}>
            Cancelar
          </button>
        )}
      </div>
    </div>
  );
}
