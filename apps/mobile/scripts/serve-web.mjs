// Development and browser tests only: serves the exported web build (dist/) and forwards /api to
// the local API, so the app and the API share one origin. Unknown paths get index.html (app routes).
//   node scripts/serve-web.mjs [port] [apiOrigin]
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { extname, join, normalize } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../dist', import.meta.url));
const port = Number(process.argv[2] ?? 8081);
const api = new URL(process.argv[3] ?? 'http://127.0.0.1:4000');
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const upstream = request(
      {
        host: api.hostname,
        port: api.port,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: api.host },
      },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502).end();
    });
    req.pipe(upstream);
    return;
  }
  const path = normalize(join(root, decodeURIComponent(url.pathname)));
  const file =
    path.startsWith(root) && existsSync(path) && statSync(path).isFile()
      ? path
      : join(root, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(port, () => process.stdout.write(`mobile web build on http://localhost:${port}\n`));
