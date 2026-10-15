/*
 * 本地开发服务器 (node tests/serve.mjs [port], 默认 8177)
 *
 * 除静态文件外还提供"系统通知"桥:
 *   POST /api/notify  { title, body, urgency }  -> notify-send 弹桌面通知
 *   GET  /api/ping                              -> { ok, notify:true|false }
 *
 * 网页检测到接收器掉线时调用它, 你没盯着页面也能收到系统通知。
 * 部署到 Vercel 时没有该端点, 网页自动退化为页面横幅 + 浏览器通知。
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = Number(process.argv[2] || 8177);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function hasNotifySend() {
  return new Promise((resolve) => {
    const p = spawn('which', ['notify-send']);
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
}

function sendNotify({ title, body, urgency = 'normal' }) {
  return new Promise((resolve) => {
    const args = ['-u', urgency, '-a', 'DAGK K98PRO', '-i', 'input-keyboard', String(title || 'DAGK K98PRO'), String(body || '')];
    const p = spawn('notify-send', args, { env: process.env });
    p.on('error', (e) => resolve({ ok: false, error: String(e) }));
    p.on('close', (code) => resolve({ ok: code === 0, code }));
  });
}

function readBody(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
};

createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);

  if (p === '/api/ping') return json(res, 200, { ok: true, notify: await hasNotifySend(), platform: process.platform });

  if (p === '/api/notify' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const { title, body, urgency } = JSON.parse(raw || '{}');
      const r = await sendNotify({ title, body, urgency });
      console.log('[notify]', r.ok ? 'ok' : 'failed', '-', title, '|', body);
      return json(res, r.ok ? 200 : 500, r);
    } catch (e) {
      return json(res, 400, { ok: false, error: String(e) });
    }
  }

  try {
    if (p === '/') { res.writeHead(302, { Location: '/web/index.html' }); res.end(); return; }
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 ' + e.message);
  }
}).listen(PORT, '127.0.0.1', async () => {
  const n = await hasNotifySend();
  console.log('serving ' + ROOT + ' on http://127.0.0.1:' + PORT + '/web/index.html');
  console.log('系统通知桥: ' + (n ? '可用 (notify-send)' : '不可用 (没找到 notify-send)'));
});
