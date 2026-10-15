/*
 * smoke-keymap.mjs — 键盘设置页的端到端验证（用真机抓到的层2数据当假设备）
 *
 * 复现用户遇到过的场景：右上角四个键在"层2"被改过，读出来要能正确显示。
 * 运行: node tests/smoke-keymap.mjs   (需要先起 node tests/serve.mjs)
 */
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const PORT = process.env.PORT || 8177;
const CDP = 9444;
const PAGE = 'http://127.0.0.1:' + PORT + '/web/index.html';
const fakeSrc = readFileSync(new URL('./fake-hid.js', import.meta.url), 'utf8');
const wired = JSON.parse(readFileSync(new URL('../data/wired-matrix.json', import.meta.url), 'utf8'));
const layer2 = [];
for (const p of wired.layer2) layer2.push(...p);

const chrome = spawn('google-chrome-stable', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  '--remote-debugging-port=' + CDP, '--user-data-dir=/tmp/k98-smoke-profile',
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let id = 0; const pending = new Map(); const events = [];
let ws;
function send(method, params = {}) {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((res, rej) => pending.set(mid, { res, rej }));
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}
const results = []; let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; results.push('  ✓ ' + name); }
  else { fail++; results.push('  ✗ ' + name + (extra ? '  <' + extra + '>' : '')); }
}

try {
  let wsUrl;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + CDP + '/json/list')).json();
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) { wsUrl = p.webSocketDebuggerUrl; break; }
    } catch (e) { /* 还没起来 */ }
    await sleep(200);
  }
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    else if (m.method) events.push(m);
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: fakeSrc });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__matrixByLayer = { 2: ' + JSON.stringify(layer2) + ' };' });
  await send('Page.navigate', { url: PAGE });
  await sleep(2500);

  // 1) 进入主界面（有线）
  await ev("document.getElementById('btnWired').click()");
  await sleep(1200);
  check('连接后有主界面', await ev("!!document.querySelector('#tab-keymap [data-role=kbStage]')"));
  check('键盘图容器存在', await ev("!!document.querySelector('#tab-keymap [data-role=kbStage]')"));

  // 2) 切到键盘设置
  await ev("document.querySelector('.navitem[data-tab=\"keymap\"]').click()");
  await sleep(300);
  check('键盘图渲染出 98 个按键', (await ev("document.querySelectorAll('#tab-keymap [data-role=kbStage] .kbk').length")) === 98,
        'got ' + (await ev("document.querySelectorAll('#tab-keymap [data-role=kbStage] .kbk').length")));

  // 3) 扫描全部层 -> 应自动落到层 2
  await ev("document.querySelector('#tab-keymap [data-role=btnScan]').click()");
  await sleep(4000);
  const layerVal = await ev("document.querySelector('#tab-keymap [data-role=layerSel]').value");
  check('扫描后自动切到层 2（改动最多的层）', layerVal === '2', 'layer=' + layerVal);
  const changed = await ev("Array.from(document.querySelectorAll('[data-role=kbStage] .kbk.changed')).map(e=>e.dataset.idx)");
  check('层2 显示 4 个已修改按键', Array.isArray(changed) && changed.length === 4, JSON.stringify(changed));
  const delFn = await ev("(document.querySelector('#tab-keymap [data-role=kbStage] .kbk[data-idx=\"78\"] .kbk-fn')||{}).textContent");
  check('Delete 键显示改后的功能 Print Screen', String(delFn).replace(/\s+/g, '') === 'PrintScreen', String(delFn));
  const upFn = await ev("(document.querySelector('#tab-keymap [data-role=kbStage] .kbk[data-idx=\"90\"] .kbk-fn')||{}).textContent");
  check('PgUp 键显示改后的功能 End', String(upFn).trim() === 'End', String(upFn));

  // 3.5) 「读取本层」应先问设备当前板载（0x84）并自动切过去（假设备回报 r[1]=1 -> 板载 2）
  await ev("document.getElementById('btnReadCfg').click()");
  await sleep(2500);
  const layerAfterRead = await ev("document.querySelector('#tab-keymap [data-role=layerSel]').value");
  check('读取时自动切到设备当前板载（0x84=1 -> 板载 2）', layerAfterRead === '1', 'layer=' + layerAfterRead);
  check('读取时确实发了 0x84 查询', await ev("window.__frames.some(f=>f.cmd===0x84)"));
  const hintTxt = await ev("document.querySelector('#tab-keymap [data-role=hint]').textContent");
  check('提示里标出「设备当前使用」', /设备当前使用/.test(String(hintTxt)), String(hintTxt).slice(0, 80));
  // 切回层 2 继续后面的用例
  await ev("(()=>{const s=document.querySelector('#tab-keymap [data-role=layerSel]'); s.value='2'; s.dispatchEvent(new Event('change'));})()");
  await sleep(300);

  // 4) 点开 Delete 键的改键面板
  await ev("document.querySelector('#tab-keymap [data-role=kbStage] .kbk[data-idx=\"78\"]').click()");
  await sleep(300);
  const nowTxt = await ev("document.querySelector('.ke-now').textContent");
  check('面板显示当前功能 Print Screen', /Print\s*Screen/.test(nowTxt), nowTxt);
  const raw = await ev("document.querySelector('.ke-raw').textContent");
  check('面板显示原始字节 [0, 70, 0, 0]', raw.indexOf('0, 70, 0, 0') >= 0, raw);

  // 4.5) 104 板小键盘列必须上下对齐（7/8/9、4/5/6、1/2/3、0 的 x 相同）
  const cols = await ev(`(() => {
    // 用 HID 值精确取小键盘那些键（数字行的 7/4/1 文本相同，不能按文本找）
    const bx = (hid) => { const el = document.querySelector('.kb104-k[data-h="' + hid + '"]');
      return el ? Math.round(el.getBoundingClientRect().x) : null; };
    return JSON.stringify({ c7: bx(95), c4: bx(92), c1: bx(89), c0: bx(98), c8: bx(96), c5: bx(93), c2: bx(90) });
  })()`);
  const c = JSON.parse(cols);
  {
    const lab = JSON.parse(await ev(`(() => {
      const t = (hid) => { const el = document.querySelector('.kb104-k[data-h="' + hid + '"]'); return el ? el.textContent.trim() : null; };
      return JSON.stringify({ row7: t(36), num7: t(95), numLock: t(83) });
    })()`));
    check('数字行的 7 与小键盘 7 标签可区分（避免点错键）',
      lab.row7 === '7' && lab.num7 === 'Num7', JSON.stringify(lab));
  }
  check('104 小键盘列对齐（7/4/1/0 同一列，8/5/2 同一列）',
    c.c7 !== null && c.c7 === c.c4 && c.c4 === c.c1 && c.c1 === c.c0 && c.c8 === c.c5 && c.c5 === c.c2, cols);

  // 4.6) 「把这一档设为键盘当前板载」按钮 -> 发 0x04
  await ev("document.querySelector('#tab-keymap [data-role=btnSetProfile]').click()");
  await sleep(1200);
  check('切换板载按钮发出 0x04（SET_PROFILE）',
    await ev("window.__frames.some(f=>f.cmd===0x04)"), await ev("JSON.stringify(window.__frames.filter(f=>f.cmd===0x04))"));

  // 5) 组合键格子（原厂改普通键就在这里）: 先取消当前的 Print Screen, 再选 Home
  await ev("Array.from(document.querySelectorAll('.kecat')).find(b=>b.textContent==='组合键').click()");
  await sleep(250);
  check('组合键分类有基本字符/拓展字符两组格子',
    (await ev("document.querySelectorAll('.kk[data-h]').length")) > 100,
    String(await ev("document.querySelectorAll('.kk[data-h]').length")));
  await ev("(()=>{const g=[...document.querySelectorAll('.kk[data-h]')]; const cur=g.find(b=>b.classList.contains('on')); if(cur) cur.click();})()");
  await sleep(250);
  await ev("Array.from(document.querySelectorAll('.kk[data-h]')).find(b=>b.textContent==='Home').click()");
  await sleep(200);
  check('应用按钮可点', (await ev("document.querySelector('[data-role=keConfirm]').disabled")) === false);
  await ev("window.confirm = () => true");   // 读/扫描/换板载会弹确认，测试里一律确认
  await ev("document.querySelector('[data-role=keConfirm]').click()");
  await sleep(300);
  const afterFn = await ev("(document.querySelector('#tab-keymap [data-role=kbStage] .kbk[data-idx=\"78\"] .kbk-fn')||{}).textContent");
  check('应用后键盘图上 Delete 显示 Home', String(afterFn).trim() === 'Home', String(afterFn));
  check('写入按钮变为可用', (await ev("document.querySelector('#tab-keymap [data-role=btnWrite]').disabled")) === false);
  // 未写入提醒：刷新/退出前要有 beforeunload，顶栏要有徽标
  check('有未写入改动时注册了 beforeunload（刷新/退出会提醒）',
    (await ev("typeof window.onbeforeunload")) === 'function', String(await ev("typeof window.onbeforeunload")));
  check('顶栏显示「有 N 处改动未写入」',
    /未写入/.test(String(await ev("document.getElementById('dirtyBadge').textContent"))) &&
    (await ev("document.getElementById('dirtyBadge').classList.contains('hidden')")) === false,
    String(await ev("document.getElementById('dirtyBadge').textContent")));

  // 6) 写入设备 -> 假设备应收到 0A 帧
  await ev("document.querySelector('#tab-keymap [data-role=btnWrite]').click()");
  await sleep(2500);
  const writes = await ev("JSON.stringify(window.__singleWrites || [])");
  check('设备收到单键写入帧', /"idx":78/.test(String(writes)) && /"cfg":\[0,0,74,0\]/.test(String(writes)), String(writes).slice(0, 300));

  // 6.5) 写入之后提醒要撤掉
  check('写入完成后 beforeunload 已清除', (await ev("window.onbeforeunload === null")) === true,
    String(await ev("typeof window.onbeforeunload")));
  check('写入完成后顶栏徽标隐藏',
    (await ev("document.getElementById('dirtyBadge').classList.contains('hidden')")) === true);

  // 7) 恢复默认按钮
  await ev("document.querySelector('[data-role=keReset2]').click()");
  await sleep(300);
  const raw2 = await ev("document.querySelector('.ke-raw').textContent");
  check('恢复出厂默认后原始字节回到 [0, 0, 76, 0]', raw2.indexOf('0, 0, 76, 0') >= 0, raw2);

  // 8) Fn层设置页（同一模块的第二个实例）
  await ev("document.querySelector('.navitem[data-tab=\"fn\"]').click()");
  await sleep(400);
  check('Fn层设置页也有 98 键键盘图',
    (await ev("document.querySelectorAll('#tab-fn [data-role=kbStage] .kbk').length")) === 98,
    String(await ev("document.querySelectorAll('#tab-fn [data-role=kbStage] .kbk').length")));
  check('Fn层设置页有 Fn板载 下拉 + 系统选择',
    (await ev("!!document.querySelector('#tab-fn [data-role=layerSel]') && !!document.querySelector('#tab-fn [data-role=fnSysSel]')")) === true);
  await ev("document.querySelector('#tab-fn [data-role=kbStage] .kbk[data-idx=\"9\"]').click()");
  await sleep(300);
  const fnCats = await ev("[...document.querySelectorAll('#tab-fn .kecat')].map(b=>b.textContent).join('/')");
  check('Fn层改键分类 = 原厂的 组合键/宏设置/功能/清空功能', /组合键/.test(fnCats) && /宏设置/.test(fnCats) && /功能/.test(fnCats) && /清空功能/.test(fnCats), fnCats);

  // 9) 灯光设置页三个页签
  await ev("document.querySelector('.navitem[data-tab=\"light\"]').click()");
  await sleep(300);
  const lpTabs = await ev("[...document.querySelectorAll('#tab-light .ptab')].map(b=>b.textContent).join('/')");
  check('灯光设置页签 = 灯光/灯光编辑/灯带（原厂顺序）', lpTabs === '灯光/灯光编辑/灯带', lpTabs);

  // 截图（用于文档）: SHOT=1 时保存 docs/screenshot-keymap.png
  if (process.env.SHOT) {
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(new URL('../docs/screenshot-keymap.png', import.meta.url), Buffer.from(shot.data, 'base64'));
    console.log('（截图已存 docs/screenshot-keymap.png）');
  }

  const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text || '')).slice(0, 3);
  check('页面无未捕获异常', errs.length === 0, errs.join(' | ').slice(0, 300));
} catch (e) {
  fail++; results.push('  ✗ 异常终止: ' + (e.message || e));
} finally {
  console.log('=== 键盘设置页端到端 ===');
  console.log(results.join('\n'));
  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  try { ws && ws.close(); } catch (e) {}
  chrome.kill('SIGKILL');
  process.exit(fail ? 1 : 0);
}
