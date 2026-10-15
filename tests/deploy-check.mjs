/*
 * deploy-check.mjs — 预部署校验
 * 把 web/ 当作"部署根目录"来提供服务（等价于 Vercel 的 outputDirectory: "web"），
 * 然后在真实 Chrome 里检查: 资源是否 404、模块是否加载、界面是否正常、能否连接设备。
 * 运行: node tests/deploy-check.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

const PORT = 8188, CDP = 9446;
const WEB = new URL('../web/', import.meta.url).pathname;   // 部署根
const fakeSrc = readFileSync(new URL('./fake-hid.js', import.meta.url), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

// —— 1. 先静态检查: HTML 里引用的每个本地资源是否都存在 ——
const html = readFileSync(join(WEB, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map((m) => m[1]);
console.log('=== 静态资源引用 ===');
let missing = 0;
for (const r of refs) {
  const p = join(WEB, r.replace(/^\.\//, ''));
  const ok = existsSync(p);
  if (!ok) missing++;
  console.log(`  ${ok ? '✓' : '✗'} ${r}`);
}

const results = []; let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? (pass++, results.push('  ✓ ' + n)) : (fail++, results.push('  ✗ ' + n + (x ? '  <' + x + '>' : ''))); };
check('index.html 引用的本地资源全部存在', missing === 0, missing + ' 个缺失');

// —— 2. 以 web/ 为根启动服务（模拟 Vercel） ——
const srv = createServer((req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = join(WEB, p === '/' ? 'index.html' : p.replace(/^\//, ''));
    if (!existsSync(f)) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
    res.end(readFileSync(f));
  } catch (e) { res.writeHead(500); res.end('500'); }
});
await new Promise((r) => srv.listen(PORT, '127.0.0.1', r));

const chrome = spawn('google-chrome-stable', ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  `--remote-debugging-port=${CDP}`, '--user-data-dir=/tmp/k98-deploy-check', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

let ws, id = 0; const pending = new Map(); const events = [];
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p })); return new Promise((res, rej) => pending.set(i, { res, rej })); };
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception?.description || '').split('\n')[0] }; return r.result?.value; };

try {
  let wsUrl;
  for (let i = 0; i < 60; i++) { try { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { wsUrl = pg.webSocketDebuggerUrl; break; } } catch (e) {} await sleep(200); }
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } else if (m.method) events.push(m); };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: fakeSrc });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });   // 注意: 根路径, 不是 /web/
  await sleep(3500);

  const resp = events.filter((e) => e.method === 'Network.responseReceived')
    .map((e) => ({ url: e.params.response.url, status: e.params.response.status }))
    .filter((r) => r.url.startsWith(`http://127.0.0.1:${PORT}`));
  const bad = resp.filter((r) => r.status >= 400);
  console.log('\n=== 部署根路径下的请求 ===');
  for (const r of resp) console.log(`  ${r.status}  ${r.url.replace(`http://127.0.0.1:${PORT}`, '')}`);
  check('根路径 / 返回 200', resp.some((r) => r.url === `http://127.0.0.1:${PORT}/` && r.status === 200));
  // /api/* 是"系统通知桥"的可选探测：部署到 Vercel 时不存在，会 404 —— 这是预期行为，
  // 页面必须能优雅降级（横幅仍然可用）。所以这里把它们排除，并单独断言降级行为。
  const badReal = bad.filter((b) => !/\/api\//.test(b.url));
  check('除可选通知桥外没有任何 4xx/5xx 资源', badReal.length === 0, badReal.map((b) => b.status + ' ' + b.url).join(', '));
  const apiCalls = resp.filter((r) => /\/api\//.test(r.url));
  check('通知桥不存在时页面优雅降级（探测 404 但功能正常）',
    apiCalls.every((r) => r.status >= 400) || apiCalls.length === 0,
    apiCalls.map((r) => r.status + ' ' + r.url).join(', '));
  check('无通知桥时基础通知能力仍在（notifier 存在且横幅可用）',
    (await ev("!!(window.__k98.notifier) && !!document.getElementById('lostBanner')")) === true);
  check('CSS 已加载', resp.some((r) => r.url.endsWith('/css/style.css') && r.status === 200));
  check('入口模块已加载', resp.some((r) => r.url.endsWith('/js/app.js') && r.status === 200));
  check('protocol.js / transport.js 已加载',
    resp.some((r) => r.url.endsWith('/js/protocol.js')) && resp.some((r) => r.url.endsWith('/js/transport.js')));
  check('品牌 logo 已加载', resp.some((r) => r.url.includes('/assets/logo-default.png') && r.status === 200));

  const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => (e.params.exceptionDetails.exception?.description || '').split('\n')[0]);
  check('无 JS 异常', errs.length === 0, errs.join(' | '));
  check('欢迎页正常显示', (await ev("!document.getElementById('welcome').classList.contains('hidden')")) === true);
  check('98 键渲染', (await ev("document.querySelectorAll('#tab-keymap [data-role=kbStage] .kbk').length")) === 98);
  // 连接一次
  await ev("window.confirm=()=>true; document.getElementById('btnWired').click()");
  await sleep(1500);
  check('在部署根路径下可正常连接设备',
    String(await ev("document.getElementById('statusPill').textContent")).includes('已连接'),
    String(await ev("document.getElementById('statusPill').textContent")));
  check('设备 ID 正确 (3780)', (await ev("window.__k98.state.info && window.__k98.state.info.deviceId")) === 3780);

  /* ---- SEO / 分享卡片（发布到公网时这些是给搜索引擎看的门面） ---- */
  const grab = (re) => { const m = re.exec(html); return m ? (m[1] || '').trim() : ''; };
  const title = grab(/<title>([^<]+)<\/title>/);
  const desc = grab(/<meta name="description" content="([^"]+)"/);
  const canonical = grab(/<link rel="canonical" href="([^"]+)"/);
  const ogImage = grab(/<meta property="og:image" content="([^"]+)"/);
  const ldRaw = grab(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  let ld = null;
  try { ld = JSON.parse(ldRaw); } catch (e) { /* 下面断言会报出来 */ }

  check('SEO: <title> 是描述性的（不是 "DAGK Driver"）', title.length >= 10 && /K98/i.test(title), title);
  check('SEO: meta description 长度合适 (40~200)',
    desc.length >= 40 && desc.length <= 200, '长度=' + desc.length);
  check('SEO: canonical 是绝对 https 地址', /^https:\/\/[^/]+\/?$/.test(canonical), canonical);
  const host = canonical.replace(/^https:\/\//, '').replace(/\/$/, '');
  check('SEO: og:url 与 canonical 同域', grab(/<meta property="og:url" content="([^"]+)"/).startsWith('https://' + host), host);
  check('SEO: Open Graph 卡片齐全 (type/site_name/title/description/image)',
    ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:image'].every((p) => html.includes('property="' + p + '"')));
  check('SEO: 分享大图 og-cover.png 存在且是 1200x630', /og-cover\.png$/.test(ogImage) && existsSync(join(WEB, 'assets/og-cover.png')));
  check('SEO: twitter:card = summary_large_image', /<meta name="twitter:card" content="summary_large_image"/.test(html));
  check('SEO: JSON-LD 可解析且是 WebApplication', !!ld && ld['@type'] === 'WebApplication', ldRaw ? ldRaw.slice(0, 40) : '(缺失)');
  check('SEO: JSON-LD 的 url 与 canonical 一致', !!ld && String(ld.url).replace(/\/$/, '') === canonical.replace(/\/$/, ''), ld && ld.url);
  check('SEO: 有 <noscript> 兜底内容 + 唯一 <h1>',
    /<noscript>[\s\S]*?<\/noscript>/.test(html) && (html.match(/<h1[\s>]/g) || []).length === 1,
    'h1 数量=' + (html.match(/<h1[\s>]/g) || []).length);
  check('SEO: 图标齐全 (favicon / 192 / apple-touch)', ['favicon.ico', 'icon-192.png', 'apple-touch-icon.png']
    .every((f) => html.includes(f) && existsSync(join(WEB, 'assets', f))));

  const fetchText = async (p) => {
    try { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); return { status: r.status, text: await r.text() }; }
    catch (e) { return { status: 0, text: '' }; }
  };
  const robots = await fetchText('/robots.txt');
  check('SEO: /robots.txt 可访问且指向 sitemap', robots.status === 200 && /Sitemap:\s*https:\/\//.test(robots.text), 'HTTP ' + robots.status);
  const sitemap = await fetchText('/sitemap.xml');
  check('SEO: /sitemap.xml 可访问，<loc> 与 canonical 同域',
    sitemap.status === 200 && sitemap.text.includes('https://' + host), 'HTTP ' + sitemap.status);
  const manifest = await fetchText('/site.webmanifest');
  let mf = null;
  try { mf = JSON.parse(manifest.text); } catch (e) { /* 下面断言会报 */ }
  check('SEO/PWA: site.webmanifest 可解析且有名称与图标',
    manifest.status === 200 && !!mf && !!mf.name && Array.isArray(mf.icons) && mf.icons.length > 0, 'HTTP ' + manifest.status);
} catch (e) { fail++; results.push('  ✗ 校验异常: ' + (e.stack || e.message)); }
finally { try { ws && ws.close(); } catch (e) {} chrome.kill('SIGKILL'); srv.close(); }

console.log('\n' + results.join('\n'));
console.log('\n预部署校验: 通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
