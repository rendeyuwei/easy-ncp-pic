import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { preserveShellTopbarHtml, SHELL_CSS_SRC, SHELL_LANG_SRC, SHELL_TOPBAR_SRC } from './src/lib/shell-topbar-html.ts';
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

const pinnedShell = new Map([
  [SHELL_TOPBAR_SRC, { file: 'src/test/fixtures/shell-topbar.js', type: 'text/javascript; charset=utf-8' }],
  [SHELL_LANG_SRC, { file: 'src/test/fixtures/shell-lang.js', type: 'text/javascript; charset=utf-8' }],
  [SHELL_CSS_SRC, { file: 'src/test/fixtures/shell-topbar.css', type: 'text/css; charset=utf-8' }],
]);

function servePinnedShell() {
  const root = fileURLToPath(new URL('.', import.meta.url));
  return {
    name: 'serve-pinned-shell',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => {
        const path = (req.url ?? '').split('?')[0] ?? '';
        const pinned = pinnedShell.get(path);
        if (!pinned) {
          next();
          return;
        }
        // Actual fdaa701 bytes. Do not proxy the unpublished hash to production.
        res.setHeader('content-type', pinned.type);
        res.setHeader('cache-control', 'no-store');
        res.end(readFileSync(join(root, pinned.file)));
      });
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
    plugins: [react(), localeHtml(env.EASYPIC_DEPLOY_PREFIX), preserveShellTopbar(), servePinnedShell()],
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
        '/shell': {
          target: 'https://rende.fun',
          changeOrigin: true,
          bypass(req) {
            const path = (req.url ?? '').split('?')[0] ?? '';
            if (pinnedShell.has(path)) return false;
          },
        },
      },
    },
  };
});
