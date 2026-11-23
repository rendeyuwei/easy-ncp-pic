import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { preserveShellTopbarHtml } from './src/lib/shell-topbar-html.ts';
import { applyLocaleHtml, localeBootSource, localeUrls } from './src/lib/locale.ts';

function deploymentBase(value: string | undefined): string {
  const prefix = value?.trim().replace(/^\/+|\/+$/g, '');
  return prefix ? `/${prefix}/` : '/';
}

function localeHtml(prefixEnv: string | undefined) {
  const urls = localeUrls(prefixEnv);
  let boot: string | null = null;
  const bootSource = (): string => {
    if (boot !== null) return boot;
    const source = localeBootSource();
    if (/<\/script|<!--/i.test(source)) {
      throw new Error('locale boot script cannot be inlined');
    }
    boot = source.replace(/</g, '\\u003c');
    return boot;
  };

  return {
    name: 'easypic-locale-html',
    transformIndexHtml: {
      order: 'pre' as const,
      handler(html: string) {
        const next = applyLocaleHtml(html, urls);
        if (!next.includes('<script data-easypic-boot></script>')) return next;
        return next.replace(
          '<script data-easypic-boot></script>',
          () => `<script data-easypic-boot>${bootSource()}</script>`,
        );
      },
    },
  };
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
    plugins: [react(), localeHtml(env.EASYPIC_DEPLOY_PREFIX), preserveShellTopbar()],
    build: {
      rollupOptions: {
        input: {
          main: fileURLToPath(new URL('./index.html', import.meta.url)),
          en: fileURLToPath(new URL('./en/index.html', import.meta.url)),
        },
      },
    },
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
