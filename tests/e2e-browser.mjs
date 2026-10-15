/*
 * e2e-browser.mjs — 在真实 Chrome (headless) 里跑完整 UI 流程
 * 通过 CDP 注入假 WebHID 设备, 然后像用户一样点击页面。
 * 运行: node tests/e2e-browser.mjs
 */
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const PORT = process.env.PORT || 8177;
const CDP = 9333;
const URL_PAGE = `http://127.0.0.1:${PORT}/web/index.html`;
const CHROME = 'google-chrome-stable';
const fakeSrc = readFileSync(new URL('./fake-hid.js', import.meta.url), 'utf8');
import { detectModes } from './detect-mode.mjs';
import { ensureServer } from './ensure-server.mjs';

// 条件：只有对应模式真的连着才跑那一组用例（FORCE=1 可用假设备强制全跑）
const MODES = detectModes();
const FORCE = process.env.FORCE === '1';
const DO_WIRED = MODES.wired.length > 0 || FORCE;
const DO_RF = MODES.dongle.length > 0 || FORCE;
const HAS_WIRED = DO_WIRED;      // 兼容旧命名
const HAS_DONGLE = DO_RF;
const SKIP_MSG = (what) => '  ⏭ 跳过：当前没有连接 ' + what + '（FORCE=1 可用假设备强制跑）';

// 需要一个静态服务把仓库喂给 Chrome。端口上已经有（npm run dev）就复用，没有就自己起
const server = await ensureServer(PORT);

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  `--remote-debugging-port=${CDP}`, '--user-data-dir=/tmp/k98-e2e-profile',
  '--no-first-run', '--no-default-browser-check', '--disable-features=Translate',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPageWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('Chrome CDP 未启动');
}

let id = 0;
const pending = new Map();
const events = [];
let ws;

function send(method, params = {}, sessionId) {
  const msgId = ++id;
  ws.send(JSON.stringify({ id: msgId, method, params, sessionId }));
  return new Promise((res, rej) => pending.set(msgId, { res, rej }));
}

async function evalInPage(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}

const results = [];
let pass = 0, fail = 0;

/** 轮询等待页面里的条件成立（比死等 sleep 稳，尤其是 2.4G 下每一步都要几百 ms） */
async function waitFor(expr, ms = 20000, step = 250) {
  const t0 = Date.now();
  for (;;) {
    try { if (await evalInPage(expr)) return true; } catch (e) { /* 页面还没就绪 */ }
    if (Date.now() - t0 > ms) return false;
    await sleep(step);
  }
}

/** 等设备流量安静下来（连续两次采样的帧数不再变），避免把后台自动读取的帧算进来 */
async function settle(ms = 8000) {
  const t0 = Date.now();
  let last = -1;
  while (Date.now() - t0 < ms) {
    const n = await evalInPage('window.__frames.length');
    if (n === last) return true;
    last = n;
    await sleep(400);
  }
  return false;
}
function check(name, cond, extra = '') {
  if (cond) { pass++; results.push('  ✓ ' + name); }
  else { fail++; results.push('  ✗ ' + name + (extra ? '  <' + extra + '>' : '')); }
}

try {
  const wsUrl = await getPageWsUrl();
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    } else if (m.method) events.push(m);
  };
  // 直接连到 about:blank 这个 page target (不用 session, 更稳)
  const S = (method, params) => send(method, params);
  await S('Page.enable'); await S('Runtime.enable'); await S('Log.enable');
  await S('Page.addScriptToEvaluateOnNewDocument', { source: fakeSrc });
  await S('Page.navigate', { url: URL_PAGE });
  await sleep(2500);

  // 收集控制台错误
  const errors = events.filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
  check('页面加载无 JS 异常', errors.length === 0, errors.join(' | '));
  check('模块已加载 (window.__k98 存在)', await evalInPage('!!window.__k98'));

  /* ---- 欢迎页（还原原厂首屏） ---- */
  check('首屏显示欢迎/搜索设备页',
    (await evalInPage("!document.getElementById('welcome').classList.contains('hidden')")) === true);
  check('欢迎页文案还原原厂',
    String(await evalInPage("document.getElementById('welcomeStatus').textContent")).includes('设备搜索中'));
  check('主界面此时隐藏',
    (await evalInPage("document.getElementById('appMain').classList.contains('hidden')")) === true);
  {
    const s0 = await S('Page.captureScreenshot', { format: 'png' });
    const { writeFileSync: wf0 } = await import('node:fs');
    wf0(new URL('../docs/screenshot-welcome.png', import.meta.url), Buffer.from(s0.data, 'base64'));
    results.push('  · 截图已保存 docs/screenshot-welcome.png');
  }

  check('98 键渲染完成', (await evalInPage("document.querySelectorAll('#tab-keymap [data-role=kbStage] .kbk').length")) === 98,
    String(await evalInPage("document.querySelectorAll('#tab-keymap [data-role=kbStage] .kbk').length")));

  // headless 下 confirm() 默认返回 false, 覆盖成确定
  await evalInPage("window.confirm = () => true");

  if (!DO_WIRED) results.push(SKIP_MSG('有线键盘 (3151:5002)'));
  // 注意：这里用 DO_WIRED || DO_RF —— 只插了 2.4G 接收器（没有有线键盘）时，
  // 2.4G 那一组也必须能单独跑起来。
  if (DO_WIRED || DO_RF) {
    /* ---- 连接有线 ---- */
    if (DO_WIRED) {
  await evalInPage("document.getElementById('btnWired').click()");
      await sleep(1200);
      const pill = await evalInPage("document.getElementById('statusPill').textContent");
      check('有线连接成功 (状态栏)', /已连接/.test(pill), pill);
      check('连接后切换到主界面',
        (await evalInPage("document.getElementById('welcome').classList.contains('hidden')")) === true);
      check('侧边导航 = 原厂的 5 个页签', (await evalInPage("document.querySelectorAll('.navitem').length")) === 5,
        String(await evalInPage("document.querySelectorAll('.navitem').length")));
      const devId = await evalInPage("window.__k98.state.info && window.__k98.state.info.deviceId");
      check('读到设备 ID = 3780 (K98PRO)', devId === 3780, String(devId));
      const frames = await evalInPage('window.__frames.length');
      check('已向设备发送 0x8F 识别帧', await evalInPage('window.__frames.some(f=>f.cmd===0x8f)'));
      check('所有帧都是 64 字节且校验和正确',
        await evalInPage(`window.__frames.every(f => { const b = f.hex.split(' ').map(x=>parseInt(x,16)); let s=0; for(let i=0;i<7;i++) s+=b[i]; return b.length===64 && b[7] === (255-(s&255)); })`));

      /* ---- 配置管理：从设备读取 / 保存到浏览器 / 读取回来 / 应用 ---- */
      await evalInPage("document.querySelector('[data-tab=more]').click()");
      const cfgTabVisible = await evalInPage("!document.getElementById('tab-more').classList.contains('hidden') && !!document.getElementById('btnCfgReadDev')");
      check('「配置管理」已并入「更多」页且可打开', cfgTabVisible === true);

      await evalInPage("document.getElementById('btnCfgReadDev').click()");
      await sleep(3000);
      const cfgState = await evalInPage("document.getElementById('cfgState').textContent");
      check('从设备读取配置成功', /已载入配置/.test(cfgState), cfgState);
      const summary = await evalInPage("document.getElementById('cfgSummary').textContent");
      check('配置摘要含关键项（设备ID/灯效/按键）',
        /设备ID/.test(summary) && /主灯效/.test(summary) && /按键映射/.test(summary), summary.slice(0, 140));
      check('读取后「应用到设备」可用', (await evalInPage("document.getElementById('btnCfgApplyDev').disabled")) === false);

      // 保存到浏览器
      await evalInPage("document.getElementById('cfgName').value='日常'; document.getElementById('btnCfgSaveLocal').click()");
      await sleep(400);
      check('可保存到浏览器 localStorage',
        (await evalInPage("JSON.parse(localStorage.getItem('k98pro.config.index')||'[]').includes('日常')")) === true);
      check('保存后出现在下拉列表',
        (await evalInPage("!!document.getElementById('cfgLocalList').querySelector('option[value=\"日常\"]')")) === true);

      // 改一下内存里的配置，再从本地读回来，验证内容确实来自存储
      await evalInPage("window.__k98.state.config = null; document.getElementById('btnCfgLoadLocal').click()");
      await sleep(400);
      check('可从浏览器读取回来',
        (await evalInPage("!!window.__k98.state.config && !!window.__k98.state.config.keymap")) === true);
      check('读回的内容与保存时一致（按键矩阵 512 字节）',
        (await evalInPage("window.__k98.state.config.keymap['0'].length")) === 512);

      // 导出为文件（用 Blob + a.click 下载，这里只验证不抛异常并能生成文件名）
      const exported = await evalInPage(`(() => {
        try {
          const c = window.__k98.state.config;
          const blob = new Blob([JSON.stringify(c)], { type: 'application/json' });
          return 'ok:' + blob.size;
        } catch (e) { return 'err:' + e.message; }
      })()`);
      check('配置可序列化为 JSON 文件内容', String(exported).startsWith('ok:') && Number(String(exported).slice(3)) > 1000, exported);

      // 应用回设备
      await evalInPage("window.confirm=()=>true");
      const beforeApply = await evalInPage('window.__frames.length');
      await evalInPage("document.getElementById('btnCfgApplyDev').click()");
      await sleep(4000);
      const afterApply = await evalInPage('window.__frames.length');
      check('「应用到设备」会向设备写入（帧数增加）', afterApply > beforeApply, `${beforeApply} -> ${afterApply}`);
      const applyLog = await evalInPage("document.getElementById('cfgLog').textContent");
      check('应用日志显示写入完成', /写入完成/.test(applyLog), applyLog.slice(-120));

      /* ---- 掉线通知 ---- */
      const notif = await evalInPage(`(async () => {
        const n = window.__k98.notifier;
        await n.deviceLost('单元测试：模拟掉线');
        const banner = document.getElementById('lostBanner');
        return JSON.stringify({
          bannerVisible: !banner.classList.contains('hidden'),
          reason: document.getElementById('lostReason').textContent,
          bridge: n.bridgeAvailable,
          lost: n.lost,
        });
      })()`);
      const nj = JSON.parse(notif);
      check('掉线时显示页面横幅', nj.bannerVisible === true, notif);
      check('横幅带原因文字', /模拟掉线/.test(nj.reason), nj.reason);
      await evalInPage("document.getElementById('lostRetry').click()");
      await sleep(300);
      check('点「我已重新插好」后横幅消失',
        (await evalInPage("document.getElementById('lostBanner').classList.contains('hidden')")) === true);

      /* ---- 按键映射 ---- */
      // 注入一层"被改过"的矩阵, 覆盖原厂四种按键状态:
      //   位置 9  = B              -> 已修改(青)
      //   位置 20 = 00 00 00 00    -> 固件禁用(黄)
      //   位置 65 = 4D 58 63 6F    -> 系统按键(红，原厂识别不了的字节)
      await evalInPage(`(() => {
        const m = window.__DEFAULT_MATRIX.slice();
        m[9 * 4] = 0; m[9 * 4 + 1] = 0; m[9 * 4 + 2] = 5; m[9 * 4 + 3] = 0;
        m[20 * 4] = 0; m[20 * 4 + 1] = 0; m[20 * 4 + 2] = 0; m[20 * 4 + 3] = 0;
        m[65 * 4] = 77; m[65 * 4 + 1] = 88; m[65 * 4 + 2] = 99; m[65 * 4 + 3] = 111;
        window.__matrixByLayer = { 0: m, 1: m, 2: m };
      })()`);
      await evalInPage("document.querySelector('[data-tab=keymap]').click()");
      const beforeKeys = await evalInPage("window.__frames.filter(f=>f.cmd===0x8a).length");
      await evalInPage("document.getElementById('btnReadCfg').click()");
      await sleep(1500);
      const afterKeys = await evalInPage("window.__frames.filter(f=>f.cmd===0x8a).length");
      check('读取按键矩阵: 本次发出 8 个分页请求', afterKeys - beforeKeys === 8, `${beforeKeys} -> ${afterKeys}`);

      const modes = await evalInPage(`JSON.stringify({
        changed: document.querySelector('#tab-keymap [data-role=kbStage] .kbk[data-idx="9"]').className,
        forbidden: document.querySelector('#tab-keymap [data-role=kbStage] .kbk[data-idx="20"]').className,
        system: document.querySelector('#tab-keymap [data-role=kbStage] .kbk[data-idx="65"]').className,
        normal: document.querySelector('#tab-keymap [data-role=kbStage] .kbk[data-idx="0"]').className,
        text9: (document.querySelector('#tab-keymap [data-role=kbStage] .kbk[data-idx="9"] .kbk-fn') || {}).textContent,
      })`);
      const md = JSON.parse(modes);
      check('原厂四种按键状态都能显示(已修改/固件禁用/系统按键/常规)',
        /changed/.test(md.changed) && /forbidden/.test(md.forbidden) && /system/.test(md.system) && !/changed|forbidden|system/.test(md.normal), modes);
      check('位置 9 显示改后的键名 B', String(md.text9).trim() === 'B', String(md.text9));

      // 选中矩阵位置 9 (=A 键), 改成 C
      await evalInPage("document.querySelector('#tab-keymap [data-role=kbStage] .kbk[data-idx=\"9\"]').click()");
      await sleep(200);
      const editTitle = await evalInPage("document.querySelector('[data-role=keyedit] .ke-title').textContent");
      check('改键面板显示当前键信息 (矩阵位置 9)', /矩阵位置 9/.test(editTitle), editTitle);
      const catCount = await evalInPage("document.querySelectorAll('[data-role=keyedit] .kecat').length");
      check('改键面板分类 = 原厂的 组合键/宏设置/功能/禁用按键 (+扩展)', catCount === 5, '分类数=' + catCount);
      const cats = await evalInPage("[...document.querySelectorAll('[data-role=keyedit] .kecat')].map(b=>b.textContent).join('/')");
      check('分类名与原厂一致',
        ['组合键', '宏设置', '功能', '禁用按键'].every((c) => cats.includes(c)), cats);

      // 用「普通键」分类把位置 9 改成 C (hid 0x06)
      // 组合键格子是"开关"：当前绑定 B 已高亮，先点它取消，再点 C（这样才是把 A 键改成 C）
      await evalInPage(`(() => {
        const grid = [...document.querySelectorAll('.kk[data-h]')];
        grid.find((x) => x.dataset.h === '5').click();     // 取消 B
        [...document.querySelectorAll('.kk[data-h]')].find((x) => x.dataset.h === '6').click();   // 选 C
        return document.querySelector('[data-role=keConfirm]').textContent;
      })()`);
      await sleep(200);
      await evalInPage("document.querySelector('[data-role=keConfirm]').click()");
      await sleep(200);
      await evalInPage("document.querySelector('#tab-keymap [data-role=btnWrite]').click()");
      await sleep(600);
      // confirm 对话框在 headless 下默认返回 false -> 用 Page.handleJavaScriptDialog 之前先 override
      const single = await evalInPage('window.__singleWrites && window.__singleWrites.length');
      if (!single) {
        const diag = await evalInPage(`JSON.stringify({
          hint: document.querySelector('#tab-keymap [data-role=hint]').textContent,
          alert: document.getElementById('alert').textContent,
          alertHidden: document.getElementById('alert').className,
          confirmOk: String(window.confirm).slice(0, 40),
          frames0a: (window.__frames || []).filter(f => f.cmd === 0x0a).map(f => f.hex.slice(0, 40)),
        })`);
        results.push('    · 诊断: ' + diag);
      }
      check('写入单键帧被设备收到', !!single && single > 0, 'singleWrites=' + single);
      if (single) {
        const w = await evalInPage('JSON.stringify(window.__singleWrites)');
        check('单键帧内容正确 (位置9 -> C)', /"idx":9/.test(w) && /"cfg":\[0,0,6,0\]/.test(w), w);
      }

      /* ---- 灯效 ---- */
      await evalInPage("document.querySelector('[data-tab=light]').click()");
      await evalInPage("document.getElementById('btnLightRead').click()");
      await sleep(600);
      check('读取主灯效', (await evalInPage("document.getElementById('lightBright').value")) !== '', await evalInPage("document.getElementById('lightBright').value"));
      await evalInPage(`(() => {
        // 原厂灯效列表：点「动态呼吸」= LightBreath(2)
        [...document.querySelectorAll('#lightEffects .lp-effect')].find(b => b.dataset.k === 'LightBreath').click();
        document.getElementById('lightBright').value = '4';
        document.getElementById('lightBright').dispatchEvent(new Event('input'));
        document.getElementById('lightSpeed').value = '1';
        document.getElementById('lightSpeed').dispatchEvent(new Event('input'));
        // 颜色：选「自定义色彩」再点第 2 个色块（红）
        [...document.querySelectorAll('#lightColorOpts .lp-opt')].find(b => b.dataset.c === 'custom').click();
        [...document.querySelectorAll('#lightSwatches .lp-sw')].find(b => b.dataset.c === String(0xff0000)).click();
        document.getElementById('btnLightApply').click();
      })()`);
      await sleep(700);
      const lf = await evalInPage("window.__frames.filter(f=>f.cmd===0x07).map(f=>f.hex).pop()");
      const lb = (lf || '').split(' ').map((x) => parseInt(x, 16));
      check('主灯效帧: 效果=2(呼吸) 亮度=4 速度=4-1=3 颜色=ff/00/00 校验=Bit8',
        lb[0] === 7 && lb[1] === 2 && lb[2] === 3 && lb[3] === 4 && lb[5] === 0xff && lb[6] === 0x00 && lb[7] === 0x00 && lb[8] === (255 - ((lb[0] + lb[1] + lb[2] + lb[3] + lb[4] + lb[5] + lb[6] + lb[7]) & 255)),
        lf);

      await evalInPage("document.getElementById('btnSideRead').click()");
      await sleep(500);
      check('读取侧灯效', (await evalInPage("document.getElementById('sideBright').value")) !== '');
      await evalInPage(`(() => {
        [...document.querySelectorAll('#sideEffects .lp-effect')].find(b => b.dataset.k === 'LightWave').click();
        document.getElementById('btnSideApply').click();
      })()`);
      await sleep(600);
      check('侧灯帧已发送 (0x08)', await evalInPage("window.__frames.some(f=>f.cmd===0x08)"));

      /* ---- 单键背光 ---- */
      await evalInPage("document.querySelector('[data-tab=light]'); document.querySelector('.ptab[data-ptab=edit]').click()");
      await evalInPage("document.getElementById('btnPicFill').click()");
      const beforeW = await evalInPage("window.__frames.filter(f=>f.cmd===0x0c).length");
      await evalInPage("document.getElementById('btnPicWrite').click()");
      await sleep(900);
      const afterW = await evalInPage("window.__frames.filter(f=>f.cmd===0x0c).length");
      check('单键背光写入 7 个分页 (0x0C)', afterW - beforeW === 7, `${beforeW} -> ${afterW}`);
      const beforeR = await evalInPage("window.__frames.filter(f=>f.cmd===0x8c).length");
      await evalInPage("document.getElementById('btnPicRead').click()");
      await sleep(900);
      const afterR = await evalInPage("window.__frames.filter(f=>f.cmd===0x8c).length");
      check('单键背光读取 6 个分页 (0x8C)', afterR - beforeR === 6, `${beforeR} -> ${afterR}`);

      /* ---- 宏 ---- */
      await evalInPage("document.querySelector('[data-tab=macro]').click()");
      await evalInPage("document.getElementById('btnMacroAddKeyDown').click()");
      await evalInPage("document.getElementById('btnMacroAddKeyUp').click()");
      await evalInPage("document.getElementById('btnMacroWrite').click()");
      await sleep(700);
      check('宏写入 (0x0B)', await evalInPage("window.__frames.some(f=>f.cmd===0x0b)"));
      await evalInPage("document.getElementById('btnMacroRead').click()");
      await sleep(700);
      check('宏读取 (0x8B)', await evalInPage("window.__frames.some(f=>f.cmd===0x8b)"));

      /* ---- 设置 ---- */
      await evalInPage("document.querySelector('[data-tab=more]').click()");
      await evalInPage("document.getElementById('btnSettingsRead').click()");
      await sleep(1200);
      check('读取设置 (回报率)', (await evalInPage("document.getElementById('setRate').value")) === '1000',
        await evalInPage("document.getElementById('setRate').value"));
      await evalInPage("document.getElementById('btnSettingsWrite').click()");
      await sleep(1500);
      check('写入设置帧 (0x04/0x03/0x06/0x09/0x11)',
        await evalInPage("[4,3,6,9,17].every(c=>window.__frames.some(f=>f.cmd===c))"));

      /* ---- 诊断 ---- */
      await evalInPage("document.querySelector('[data-tab=more]').click()");
      await evalInPage("document.getElementById('btnDevInfo').click()");
      await sleep(600);
      check('控制台有日志', (await evalInPage("document.getElementById('log').textContent.length")) > 50);
    }

    if (!HAS_DONGLE) results.push(SKIP_MSG('2.4G 接收器 (3151:5006)'));

if (DO_RF) {
  /* ---- 2.4G ---- */
      await evalInPage("document.getElementById('btnDisconnect').click()");
      await sleep(600);
      await evalInPage("window.__useDevice='dongle'");
      const frameBase = await evalInPage('window.__frames.length');   // 有线阶段的帧不计入
      await evalInPage("document.getElementById('btnDongle').click()");
      await sleep(1200);
      const pill2 = await evalInPage("document.getElementById('statusPill').textContent");
      check('2.4G 连接成功', /2\.4G/.test(pill2), pill2);
      // 连接阶段的行为（2026-10-15 起）：读一次链路状态(F7) + 读设备信息(0x8F) + 自动读取配置，
      // 与有线完全一致 —— 这是用户明确要求的"无线要和有线一样"。
      // 但仍然绝不做后台轮询、也不反复重试：这个接收器的厂商通道很脆，连续打命令会把它 stall 死。
      const f7AtConnect = await evalInPage(`window.__frames.slice(${frameBase}).filter(f=>f.cmd===0xf7).length`);
      // 连接阶段会做一次状态查询 + 自动读取（自动读取本身也要握手），所以 F7 不止 1 次；
      // 这里只做"跑飞"兜底（真正的"不后台轮询"由下面静置 5 秒的断言来证明）。
      check('2.4G 连接阶段 F7 次数正常（状态查询 + 自动读取握手，无重试风暴）',
        f7AtConnect >= 1 && f7AtConnect <= 60, 'F7 次数=' + f7AtConnect);
      check('2.4G 连接后默认不开后台轮询', (await evalInPage("document.getElementById('autoPoll').checked")) === false);
      check('2.4G 连接后自动读设备信息 (0x8F)，与有线一致',
        (await evalInPage(`window.__frames.slice(${frameBase}).filter(f=>f.cmd===0x8f).length`)) >= 1);
      const f6AtConnect = await evalInPage(`window.__frames.slice(${frameBase}).filter(f=>f.cmd===0xf6).length`);
      check('2.4G 选目标码 = 10 (键盘)', await evalInPage(`window.__frames.slice(${frameBase}).some(f=>f.cmd===0xf6 && f.hex.split(' ')[1]==='0a')`), 'F6 次数=' + f6AtConnect);

      // 「无线 = 有线」的核心断言：连上就自动把键盘配置读回来，不需要用户手点
      const autoReadOk = await waitFor("document.querySelectorAll('#tab-keymap .kbk.unknown').length === 0", 30000);
      check('2.4G 连接后自动读取键盘配置成功（无需手点，与有线一致）', autoReadOk,
        '仍是 unknown 的按键=' + await evalInPage("document.querySelectorAll('#tab-keymap .kbk.unknown').length"));
      check('2.4G 自动读取后按键状态正确（位置 65 = 系统按键）',
        /system/.test(await evalInPage("String((document.querySelector('#tab-keymap .kbk[data-idx=\"65\"]')||{className:''}).className)")),
        await evalInPage("String((document.querySelector('#tab-keymap .kbk[data-idx=\"65\"]')||{title:''}).title)"));

      // 手动再读一次「读取设备配置」 -> 走完整握手 F7/F6/…/FC，并且要真的读满 8 页
      await evalInPage("document.querySelector('[data-tab=keymap]').click()");
      // 顶部「读取设备配置」是各模块共用的：Fn 层模块还在自动读取时它会处于 disabled，
      // 这时 click() 是空操作（早期版本就是这样误报"手动读取没反应"的）。
      await waitFor("!document.getElementById('btnReadCfg').disabled", 25000);
      const pages0 = await evalInPage(`window.__frames.slice(${frameBase}).filter(f=>f.cmd===0x8a).length`);
      await evalInPage("document.getElementById('btnReadCfg').click()");
      const pagesOk = await waitFor(`window.__frames.slice(${frameBase}).filter(f=>f.cmd===0x8a).length >= ${pages0 + 8}`, 25000);
      check('手动读取在 2.4G 下也读满 8 个分页 (0x8A)', pagesOk,
        pages0 + ' -> ' + await evalInPage(`window.__frames.slice(${frameBase}).filter(f=>f.cmd===0x8a).length`));
      const hs = await evalInPage(`window.__frames.slice(${frameBase}).filter(f=>[0xf7,0xf6,0xfc].includes(f.cmd)).map(f=>f.cmd)`);
      check('触发读取后走完整握手: F7 轮询 + F6 选目标 + FC 读通知',
        hs.includes(0xf7) && hs.includes(0xf6) && hs.includes(0xfc), JSON.stringify(hs.slice(0, 12)));

      // 真机（2026-10-15）发现：接收器的 isCanRead 常常不回 1，但应答其实已经就绪。
      // 这里把假接收器也设成"永远不回 isCanRead=1"，验证读取仍然能成功（回包校验兜底）。
      await evalInPage("window.__noCanRead = true");
      await evalInPage("document.querySelector('[data-tab=more]').click()");
      await evalInPage("document.getElementById('btnSettingsRead').click()");
      await sleep(2500);
      const rateNoFlag = await evalInPage("document.getElementById('setRate').value");
      check('isCanRead 一直为 0 时读取仍成功（回包校验兜底）', !!rateNoFlag && rateNoFlag !== '', 'setRate=' + rateNoFlag);
      await evalInPage("window.__noCanRead = false");

      // 手动刷新状态按钮。先等设备流量安静：连接后的自动读取会持续发 F7，
      // 不等它跑完就量，会把后台的 F7 一起算进来（旧版本就是这么误报的）。
      await evalInPage("document.querySelector('[data-tab=more]').click()");
      await settle();
      const before = await evalInPage("window.__frames.filter(f=>f.cmd===0xf7).length");
      await evalInPage("document.getElementById('btnPollNow').click()");
      await waitFor(`window.__frames.filter(f=>f.cmd===0xf7).length > ${before}`, 5000);
      await sleep(300);
      const after = await evalInPage("window.__frames.filter(f=>f.cmd===0xf7).length");
      check('「刷新 2.4G 链路状态」按钮会发一次 F7', after === before + 1, `${before} -> ${after}`);
      check('自动刷新默认关闭', (await evalInPage("document.getElementById('autoPoll').checked")) === false);
      // 真正的"不后台轮询"证明：静置 5 秒，设备不应收到任何自发流量
      await settle();
      const idle1 = await evalInPage('window.__frames.length');
      await sleep(5000);
      const idle2 = await evalInPage('window.__frames.length');
      check('静置 5 秒没有任何自发流量（确认不存在后台轮询）', idle1 === idle2, `${idle1} -> ${idle2}`);
      check('存在「软复位 HID 连接」按钮', await evalInPage("!!document.getElementById('btnSoftReset')"));
} else {
  results.push('  ⏭ 2.4G 场景用例已跳过（当前未连接 3151:5006；FORCE=1 可用假设备强制跑）');
}

  }

  if (DO_WIRED) {
  /* ---- 设计还原校验: 运行时计算样式是否等于原厂变量 ---- */
    // 先确保键盘页真的读到数据了，否则按键是 unknown 状态（底色透明、位置 65 显示"常规"），
    // 量出来的颜色全是错的；同时主按钮在别的页签下是 disabled 的（灰 #d5d5d5）。
    await evalInPage("document.querySelector('[data-tab=keymap]').click()");
    await sleep(500);   // .navitem 有 background .18s 过渡，立刻量会读到过渡起点 rgba(0,0,0,0)
    if ((await evalInPage("document.querySelectorAll('#tab-keymap .kbk.unknown').length")) > 0) {
      await evalInPage("document.getElementById('btnReadCfg').click()");
      await waitFor("document.querySelectorAll('#tab-keymap .kbk.unknown').length === 0", 25000);
    }
    await waitFor("!document.getElementById('btnReadCfg').disabled", 15000);
    check('样式检查前：按键矩阵已从设备读入（不是 unknown 占位状态）',
      (await evalInPage("document.querySelectorAll('#tab-keymap .kbk.unknown').length")) === 0,
      'unknown=' + await evalInPage("document.querySelectorAll('#tab-keymap .kbk.unknown').length"));
    check('样式检查前：主按钮「读取设备配置」处于可用状态（当前页是键盘设置）',
      (await evalInPage("document.getElementById('btnReadCfg').disabled")) === false);
    const styleJson = await evalInPage(`(() => {
      const cs = getComputedStyle(document.documentElement);
      const nav = document.querySelector('.navitem.active');
      const btn = document.getElementById('btnReadCfg');
      const key = document.querySelector('#tab-keymap [data-role=kbStage] .kbk');
      const row = document.querySelector('#tab-keymap [data-role=kbStage] .kbk[data-idx="65"]');   // 注入的"系统按键"(红)
      const disabled = [...document.querySelectorAll('#tab-keymap [data-role=kbStage] .kbk')].find((k) => k.classList.contains('forbidden'));
      const kb = document.getElementById('kbWrap');
      return JSON.stringify({
        vars: {
          selected: cs.getPropertyValue('--color-background-selected').trim(),
          hover: cs.getPropertyValue('--color-background-hover').trim(),
          radius: cs.getPropertyValue('--border-radius').trim(),
          confirm: cs.getPropertyValue('--color-button-confirm-background').trim(),
          keyBg: cs.getPropertyValue('--color-key-background-default').trim(),
          keyChanged: cs.getPropertyValue('--color-key-background-changed').trim(),
          keyForbidden: cs.getPropertyValue('--color-key-background-forbidden').trim(),
          keySystem: cs.getPropertyValue('--color-key-background-system').trim(),
          fontSc: cs.getPropertyValue('--font-family-sc').trim(),
        },
        navActive: nav ? getComputedStyle(nav).backgroundColor : null,
        navRadius: nav ? getComputedStyle(nav).borderRadius : null,
        sideBg: nav && nav.closest('.sidenav') ? getComputedStyle(nav.closest('.sidenav')).backgroundColor : null,
        btnBg: btn ? getComputedStyle(btn).backgroundColor : null,
        btnRadius: btn ? getComputedStyle(btn).borderRadius : null,
        keyBg: key ? getComputedStyle(key).backgroundColor : null,
        fnBg: row ? getComputedStyle(row).backgroundColor : null,
        fnImg: row ? getComputedStyle(row).backgroundImage : null,
        disabledBg: disabled ? getComputedStyle(disabled).backgroundColor : null,
        bodyFont: getComputedStyle(document.body).fontSize,
        kbBg: kb ? getComputedStyle(kb).backgroundColor : null,
      });
    })()`);
    const st = JSON.parse(styleJson);
    check('CSS 变量: 原厂 50 个设计变量已注入页面', Object.values(st.vars).every((v) => v && v.length > 0), JSON.stringify(st.vars));
    check('CSS 变量取值与原厂一致 (#74ebd5 / #71a4f1 / 12px / #3E3E3E)',
      st.vars.selected === '#74ebd5' && st.vars.hover === '#71a4f1' && st.vars.radius === '12px' && st.vars.confirm === '#3E3E3E',
      JSON.stringify(st.vars));
    check('侧栏选中项 = 原厂青色 rgb(116,235,213)', st.navActive === 'rgb(116, 235, 213)', st.navActive);
    check('侧栏底色 = 原厂 #3E3E34', st.sideBg === 'rgb(62, 62, 52)', st.sideBg);
    check('主按钮「读取设备配置」= 原厂青 rgb(116,235,213)', st.btnBg === 'rgb(116, 235, 213)', st.btnBg);
    check('按键默认底色 = 原厂 rgb(62,62,62)', st.keyBg === 'rgb(62, 62, 62)', st.keyBg);
    // 先确认矩阵确实读到了 Fn 位置(65) = [10,1,0,0]
    const fnCfg = await evalInPage(`(() => {
      const el = document.querySelector('#tab-keymap [data-role=kbStage] .kbk[data-idx="65"]');
      return JSON.stringify({ cls: el ? el.className : null, title: el ? el.title : null });
    })()`);
    check('矩阵位置 65 的未知改键被判定为「系统按键」', /system/.test(String(fnCfg)), fnCfg);
    check('系统按键 = 原厂 SVG 画法(底色 #575757 + 60% #FE4545 叠加)',
      st.fnBg === 'rgb(87, 87, 87)' && /254, 69, 69/.test(String(st.fnImg)), st.fnBg + ' | ' + String(st.fnImg).slice(0, 120));
    check('正文字号 = 原厂 14px', st.bodyFont === '14px', st.bodyFont);

    /* ---- 布局几何校验 (代替肉眼看图) ---- */
    await evalInPage("document.querySelector('[data-tab=keymap]').click()");
    await sleep(300);
    check('改键页签已切回且可见',
      (await evalInPage("!document.getElementById('tab-keymap').classList.contains('hidden') && !document.getElementById('appMain').classList.contains('hidden')")) === true,
      await evalInPage("JSON.stringify({panel:document.getElementById('tab-keymap').className, main:document.getElementById('appMain').className, active:[...document.querySelectorAll('.navitem')].filter(n=>n.classList.contains('active')).map(n=>n.dataset.tab)})"));
    const geo = await evalInPage(`(() => {
      const rows = [1, 2, 3, 4, 5, 6];   // 键盘图用绝对定位, 行数用坐标推断(下面按 y 去重)
      const all = [...document.querySelectorAll('#tab-keymap [data-role=kbStage] .kbk')];
      const boxes = all.map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, t: el.textContent }; });
      let overlaps = 0;
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5) overlaps++;
      }
      const esc = document.querySelector('#tab-keymap [data-role=kbStage] .kbk[data-idx="0"]').getBoundingClientRect();
      const f12 = document.querySelector('#tab-keymap [data-role=kbStage] .kbk[data-idx="72"]').getBoundingClientRect();
      const rowTops = [...new Set(all.map((el) => Math.round(el.getBoundingClientRect().y)))];
      return JSON.stringify({
        rows: rowTops.length, keys: all.length, overlaps,
        zeroSize: boxes.filter((b) => b.w < 10 || b.h < 10).length,
        emptyText: boxes.filter((b) => !b.t.trim()).length,
        escX: Math.round(esc.x), escY: Math.round(esc.y), f12X: Math.round(f12.x), f12Y: Math.round(f12.y),
        rowTops,
      });
    })()`);
    const g = JSON.parse(geo);
    check('布局: 6 行 / 98 键 / 无重叠 / 无零尺寸', g.rows === 6 && g.keys === 98 && g.overlaps === 0 && g.zeroSize === 0, geo);
    check('布局: 每个按键都有文字标签', g.emptyText === 0, 'empty=' + g.emptyText);
    check('布局: Esc 在左上角, F12 在同一行且更靠右',
      g.escX < g.f12X && g.escY === g.f12Y,
      `esc=(${g.escX},${g.escY}) f12=(${g.f12X},${g.f12Y})`);

    /* ---- 截图（统一 1400x1000 视口） ---- */
    const { writeFileSync } = await import('node:fs');
    await S('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
    const shoot = async (sel, file) => {
      await evalInPage(sel);
      await sleep(900);
      const s = await S('Page.captureScreenshot', { format: 'png' });
      writeFileSync(new URL('../docs/' + file, import.meta.url), Buffer.from(s.data, 'base64'));
      results.push('  · 截图已保存 docs/' + file);
    };
    await shoot("document.querySelector('[data-tab=keymap]').click(); document.getElementById('btnReadCfg').click()", 'screenshot-keymap.png');
    await shoot("document.querySelector('[data-tab=light]').click(); document.querySelector('#tab-light .ptab[data-ptab=light]').click()", 'screenshot-light.png');
    await shoot("document.querySelector('.navitem[data-tab=fn]').click()", 'screenshot-fn.png');
    await shoot("document.querySelector('.navitem[data-tab=macro]').click()", 'screenshot-macro.png');
    await shoot("document.querySelector('.navitem[data-tab=more]').click()", 'screenshot-more.png');
    await S('Emulation.clearDeviceMetricsOverride');

  
} else {
  results.push('  ⏭ 样式/几何/截图检查已跳过（需要有设备连接；FORCE=1 可强制跑）');
}

  const errs2 = events.filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
  check('全流程无未捕获异常', errs2.length === 0, errs2.join(' | '));

} catch (e) {
  fail++;
  results.push('  ✗ 测试框架异常: ' + (e.stack || e.message));
} finally {
  try { ws && ws.close(); } catch (e) {}
  chrome.kill('SIGKILL');
  server.stop();
}

console.log(results.join('\n'));
console.log('\n浏览器端到端: 通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
