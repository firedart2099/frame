import { useState } from 'react';

/**
 * O site tem duas caras:
 *   celular  -> landing + downloads, pra pessoa baixar o app (é lá que a
 *               experiência de assistir no telefone é boa de verdade);
 *   PC       -> o Frame inteiro, com miniplayer.
 *
 * O corte é largura + ausência de mouse: tablet grande com teclado cai no
 * lado do PC, que é onde ele se comporta melhor.
 *
 * **A decisão é tomada UMA VEZ, na abertura, e não muda mais.**
 *
 * Isso não é preguiça, é o conserto de um bug que dava medo: dar zoom, arrastar
 * a janela pro outro monitor ou só redimensionar muda a largura em CSS — e com
 * a decisão sendo refeita a cada mudança, o app trocava a árvore inteira no meio
 * da sessão. O AppShell (que é quem tem o FrameProvider dentro) desmontava, e ia
 * junto o perfil, a lista de fontes e o filme que estava tocando: você estava
 * vendo JoJo e caía na landing.
 *
 * E a decisão refeita estava errada de qualquer jeito: um monitor menor não
 * transforma um PC em celular. O que define a cara do site é o aparelho, e o
 * aparelho não muda enquanto a aba está aberta.
 */
const QUERY = '(max-width: 899px), (pointer: coarse) and (max-width: 1180px)';

export default function useIsMobile() {
  const [isMobile] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(QUERY).matches
  );
  return isMobile;
}
