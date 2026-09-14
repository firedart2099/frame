import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Os arquivos de src/services/sync/ sao copia fiel dos do app (React Native).
 * Em vez de reescrever, apontamos os imports nativos deles para shims web:
 * AsyncStorage -> localStorage, AppState -> visibilitychange.
 * Assim a mesma logica de sincronizacao roda no celular e no navegador.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@react-native-async-storage/async-storage': path.resolve('./src/shims/async-storage.js'),
      'react-native': path.resolve('./src/shims/react-native.js'),
    },
  },
  server: { port: 5173 },
  build: { outDir: 'dist', sourcemap: false },
});
