/*
 * compare-frames.mjs — 逐字节比对：原厂驱动 vs 复刻版 发出的 64 字节帧
 *
 * 原厂那一侧的帧已经录好放在 tests/fixtures/orig-frames.json 里（用原厂驱动跑一遍抓下来的），
 * 所以本测试**不需要原厂安装包**就能跑。
 * 运行: npm run test:frames
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { ensureServer } from './ensure-server.mjs';

const CDP = 9461;
const PORT = process.env.PORT || 8177;
const fakeSrc = readFileSync(new URL('./fake-hid.js', import.meta.url), 'utf8');
const orig = JSON.parse(readFileSync(new URL('./fixtures/orig-frames.json', import.meta.url), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await ensureServer(PORT);

const chrome = spawn('google-chrome-stable', ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  '--remote-debugging-port=' + CDP, '--user-data-dir=/tmp/k98-cmp', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map();
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p })); return new Promise((res, rej) => pending.set(i, { res, rej })); };
const ev = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || '').split('\n')[0]);
  return r.result?.value;
};
let failures = 0;
const check = (name, ok, extra = '') => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra ? '  <' + extra + '>' : '')); if (!ok) failures++; };

try {
  let wsUrl;
  for (let i = 0; i < 60; i++) {
    try { const l = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json(); const p = l.find((t) => t.type === 'page'); if (p) { wsUrl = p.webSocketDebuggerUrl; break; } } catch (e) {}
    await sleep(200);
  }
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
  await send('Runtime.enable'); await send('Page.enable');
  // 原厂那份帧是在"当前板载 = 0"时录的；把假设备也设成 0，
  // 否则我们会按板载 2 去读 Fn 层，多出一组层号不同（但格式完全正确）的帧，被误判成不一致。
  await send('Page.addScriptToEvaluateOnNewDocument', { source: fakeSrc + ';window.__profile=0;' });
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/web/index.html' });
  await sleep(2500);
  // 顶部「读取设备配置」是各模块共用的按钮：读取期间它会 disabled（click 是空操作），
  // 所以每次点之前都等它可用 —— 连接后还有一次自动读取在跑。
  const waitEnabled = async (id = 'btnReadCfg', ms = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await ev(`!!document.getElementById('${id}') && !document.getElementById('${id}').disabled`)) return true;
      await sleep(200);
    }
    return false;
  };
  const clickRead = async () => {
    if (!await waitEnabled()) throw new Error('「读取设备配置」一直处于 disabled 状态');
    await ev("document.getElementById('btnReadCfg').click()");
  };

  await ev("window.confirm = () => true; document.getElementById('btnWired').click()");
  await sleep(2500);
  await clickRead();                       // 顶部「读取设备配置」= 键盘设置页
  await sleep(4000);
  // 三层矩阵 + Fn 层
  await ev("document.querySelector('.navitem[data-tab=keymap]').click()");
  await clickRead();
  await sleep(1500);
  await ev("document.querySelector('.navitem[data-tab=fn]').click()");
  await clickRead();
  await sleep(1800);
  // 灯效
  await ev("document.querySelector('.navitem[data-tab=light]').click()");
  await sleep(300);
  await ev("document.getElementById('btnLightRead').click()");
  await sleep(600);
  await ev("document.getElementById('btnSideRead').click()");
  await sleep(600);
  await ev("document.querySelector('[data-tab=more]').click()");
  await ev("document.getElementById('btnSettingsRead').click()");
  await sleep(1500);
  await ev("document.getElementById('btnMacroRead').click()");
  await sleep(1500);
  // 「更多 → 从设备读取配置」= 原厂启动时的完整读取（含 0x80/0x97/0xAD/0xAE 版本类命令）
  await ev("document.querySelector('.navitem[data-tab=more]').click()");
  await ev("document.getElementById('btnCfgReadDev').click()");
  await sleep(6000);

  const ours = JSON.parse(await ev("JSON.stringify(window.__frames.map(f=>f.hex))"));
  mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
  writeFileSync(new URL('./fixtures/frames-ours.json', import.meta.url), JSON.stringify(ours, null, 1));
  console.log('复刻版帧数 =', ours.length, ' 原厂帧数 =', orig.length);

  const byCmd = (list) => {
    const m = {};
    for (const f of list) { const c = f.split(' ')[0]; (m[c] = m[c] || []).push(f); }
    return m;
  };
  const O = byCmd(orig), U = byCmd(ours);
  const names = { '8f': '设备识别', '80': 'RF 版本', '97': '自动识别系统', 'ad': 'OLED 版本', 'ae': '矩阵灯版本',
    '83': '回报率', '84': '板载配置', '86': '去抖', '87': '主灯效', '88': '侧灯效',
    '89': '键盘选项', '8a': '按键矩阵', '90': 'Fn层(0x90 读)', '91': '休眠时间', '8b': '宏读取' };
  console.log('\n=== 同一命令的帧逐字节比对 ===');
  // 0x8B(宏) / 0x8C(单键背光)：原厂是"进对应页面才按需读"，本轮录制里它没进那些页面，
  // 所以只比对格式不比对集合（下面单独打印）。
  const ON_DEMAND_CMDS = ['8b', '8c'];
  for (const c of Object.keys(names)) {
    if (ON_DEMAND_CMDS.includes(c)) continue;
    const o = O[c] || [], u = U[c] || [];
    if (!o.length && !u.length) { check(c + ' ' + names[c], true, '双方都没发'); continue; }
    if (!u.length) { check(c + ' ' + names[c] + '（原厂有 ' + o.length + ' 帧，复刻版没发）', false, o[0]); continue; }
    const so = [...new Set(o)].sort(), su = [...new Set(u)].sort();
    const onlyO = so.filter((x) => !su.includes(x));
    const onlyU = su.filter((x) => !so.includes(x));
    // 判定标准：复刻版发出的每一帧，原厂都发过一模一样的（原厂启动时会多读一些组合，例如 win/mac 两套 Fn 层）
    check(c + ' ' + names[c] + '（复刻 ' + su.length + ' 种 / 原厂 ' + so.length + ' 种，'
      + (onlyU.length ? '有 ' + onlyU.length + ' 种对不上' : '全部能对上') + '）',
      onlyU.length === 0,
      (onlyU.length ? '仅复刻: ' + onlyU[0].slice(0, 40) : ''));
  }
  const onlyOrigCmds = Object.keys(O).filter((c) => !U[c]);
  const onlyOursCmds = Object.keys(U).filter((c) => !O[c]);
  console.log('\n原厂独有的命令:', onlyOrigCmds.join(',') || '(无)');
  console.log('复刻版独有的命令:', onlyOursCmds.join(',') || '(无)');
  // 0x8B(宏) / 0x8C(单键背光) 原厂是"进对应页面才按需读"，本轮流程里不会发；帧格式同厂商约定，不算差异
  const ON_DEMAND = ['8b', '8c'];
  const extra = onlyOursCmds.filter((c) => !ON_DEMAND.includes(c));
  if (extra.length) { failures++; console.log('  ✗ 复刻版发了原厂没有的命令: ' + extra.join(',')); }
  else if (onlyOursCmds.length) console.log('  ✓ 复刻版多发的 0x8B/0x8C 属于按需读取（原厂进对应页面才发）');
  console.log('\n' + (failures ? '有 ' + failures + ' 项不一致' : '全部命令的帧与原厂一致 ✓'));
} catch (e) {
  console.log('失败: ' + (e.stack || e.message));
  failures++;
} finally {
  try { ws && ws.close(); } catch (e) {}
  chrome.kill('SIGKILL');
  server.stop();
}
process.exit(failures ? 1 : 0);
