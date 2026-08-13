import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': process.env.EASYPIC_ADMIN_API_ORIGIN ?? 'http://127.0.0.1:3000',
    },
  },
});
