import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { preserveShellTopbarHtml } from './src/lib/shell-topbar-html.ts';

function deploymentBase(value: string | undefined): string {
  const prefix = value?.trim().replace(/^\/+|\/+$/g, '');
  return prefix ? `/${prefix}/` : '/';
}

function preserveShellTopbar() {
  return {
    name: 'preserve-shell-topbar',
    transformIndexHtml: {
      order: 'post' as const,
      handler(html: string) {
        return preserveShellTopbarHtml(html);
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: deploymentBase(env.EASYPIC_DEPLOY_PREFIX),
    plugins: [react(), preserveShellTopbar()],
    server: {
      proxy: {
        '/api': 'http://127.0.0.1:3000',
        '/easypic/api': {
          target: 'http://127.0.0.1:3000',
          rewrite: (path) => path.replace(/^\/easypic/, ''),
        },
        '/shell': { target: 'https://rende.fun', changeOrigin: true },
      },
    },
  };
});
