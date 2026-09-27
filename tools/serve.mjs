import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.json': 'application/json', '.md': 'text/plain' };
const port = Number(process.env.PIXEL_HEAVEN_PORT ?? 8080);
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    const relative = path.slice(root.length).split(/[\\/]/);
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)
      || relative.some(part => part.startsWith('.')) || !types[extname(path)]) {
      response.writeHead(403).end('Forbidden'); return;
    }
    const data = await readFile(path);
    response.writeHead(200, { 'Content-Type': `${types[extname(path)]}; charset=utf-8`, 'Cache-Control': 'no-store' });
    response.end(data);
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Pixel Heaven: http://localhost:${port} (Ctrl+C to stop)`));
