/**
 * Foto de perfil: recorte quadrado no navegador, antes de subir.
 *
 * O avatar vai pro banco como data URL na coluna `avatar_url` (é assim que o
 * app já grava), então o tamanho do arquivo importa de verdade: uma foto de
 * celular tem 3-8 MB e não cabe numa linha de tabela — e viajaria inteira em
 * cada carregamento de perfil.
 *
 * Por isso aqui: recorta o centro num quadrado, reduz para 400px e comprime em
 * JPEG. O resultado fica em torno de 40 KB, e o quadrado garante que o círculo
 * da interface não distorça nada.
 */

const LADO = 400;
const QUALIDADE = 0.82;

export function lerImagem(arquivo) {
  return new Promise((resolve, reject) => {
    if (!arquivo.type.startsWith('image/')) {
      reject(new Error('Isso não é uma imagem.'));
      return;
    }
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error('Não consegui ler o arquivo.'));
    leitor.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Não consegui abrir a imagem.'));
      img.onload = () => resolve(img);
      img.src = leitor.result;
    };
    leitor.readAsDataURL(arquivo);
  });
}

/**
 * Recorta o centro em quadrado e devolve um data URL pronto pro banco.
 * `zoom` e `deslocamento` deixam a pessoa ajustar o enquadramento — sem isso o
 * corte central pode cortar a cabeça, que é o defeito clássico de avatar
 * automático.
 */
export function recortarQuadrado(img, { zoom = 1, dx = 0, dy = 0 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = LADO;
  canvas.height = LADO;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#101010';
  ctx.fillRect(0, 0, LADO, LADO);

  // o lado do quadrado de origem é o menor lado da foto, dividido pelo zoom
  const base = Math.min(img.naturalWidth, img.naturalHeight) / zoom;
  const maxX = img.naturalWidth - base;
  const maxY = img.naturalHeight - base;
  const sx = Math.min(Math.max(0, (img.naturalWidth - base) / 2 + dx), Math.max(0, maxX));
  const sy = Math.min(Math.max(0, (img.naturalHeight - base) / 2 + dy), Math.max(0, maxY));

  ctx.drawImage(img, sx, sy, base, base, 0, 0, LADO, LADO);
  return canvas.toDataURL('image/jpeg', QUALIDADE);
}

/** Tamanho aproximado, em KB, de um data URL — pra avisar antes de gravar. */
export const tamanhoKb = (dataUrl) => Math.round((dataUrl.length * 3) / 4 / 1024);
