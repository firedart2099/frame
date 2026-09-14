/**
 * Pedacinho do react-native que src/services/sync/index.js usa.
 *
 * No app, `AppState` avisa quando o usuario volta pro app e o sync aproveita
 * pra drenar a fila. No navegador o equivalente e a aba voltar a ficar visivel
 * (ou a janela recuperar o foco).
 */

const listeners = new Set();

function emit(state) {
  listeners.forEach((cb) => {
    try {
      cb(state);
    } catch (e) {}
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    emit(document.visibilityState === 'visible' ? 'active' : 'background');
  });
  window.addEventListener('online', () => emit('active'));
}

export const AppState = {
  get currentState() {
    if (typeof document === 'undefined') return 'active';
    return document.visibilityState === 'visible' ? 'active' : 'background';
  },
  addEventListener(type, handler) {
    if (type !== 'change') return { remove() {} };
    listeners.add(handler);
    return {
      remove() {
        listeners.delete(handler);
      },
    };
  },
};

export const Platform = { OS: 'web', select: (obj) => obj.web ?? obj.default };

export default { AppState, Platform };
