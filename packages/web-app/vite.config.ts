import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function deploymentBase(value: string | undefined): string {
  const prefix = value?.trim().replace(/^\/+|\/+$/g, '');
  return prefix ? `/${prefix}/` : '/';
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: deploymentBase(env.EASYPIC_DEPLOY_PREFIX),
    plugins: [react()],
    server: {
      proxy: {
        '/api': 'http://127.0.0.1:3000',
      },
    },
  };
});
