import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

const port = Number(process.env.PORT || 4175);
const webDist = process.env.WEB_DIST;
const shellDist = process.env.SHELL_DIST;

if (!webDist || !shellDist) {
  console.error('WEB_DIST and SHELL_DIST are required');
  process.exit(1);
}

const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function safeJoin(root, requestPath) {
  const cleaned = requestPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!cleaned || cleaned.split('/').some((part) => part === '..' || part === '')) return null;
  return join(root, cleaned);
}

function tryFile(path) {
  try {
    const info = statSync(path);
    if (info.isFile()) return path;
    if (info.isDirectory()) {
      const index = join(path, 'index.html');
      if (statSync(index).isFile()) return index;
    }
  } catch {
    return null;
  }
  return null;
}

function resolveRequest(urlPath) {
  const pathname = decodeURIComponent(urlPath.split('?')[0] || '/');
  if (pathname === '/shell' || pathname.startsWith('/shell/')) {
    const file = safeJoin(shellDist, pathname.replace(/^\//, ''));
    return file ? tryFile(file) : null;
  }
  if (pathname === '/easypic' || pathname.startsWith('/easypic/')) {
    const relative = pathname.slice('/easypic'.length) || '/';
    const file = relative === '/' ? webDist : safeJoin(webDist, relative);
    return file ? tryFile(file) : null;
  }
  return null;
}

const server = createServer((request, response) => {
  const file = resolveRequest(request.url || '/');
  if (!file) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
    return;
  }
  response.writeHead(200, {
    'content-type': types[extname(file)] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`locale preview http://127.0.0.1:${port}/easypic/`);
});
