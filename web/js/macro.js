/*
 * macro.js — 宏编辑 (0x0B 写 / 0x8B 读)
 *
 * 数据格式 (256 字节, 厂商 setMacro/_setMacro + buffToMacroEvents):
 *   [0..1]  repeatCount (u16 LE)
 *   [2..]   4 字节记录序列, 以 [0,0,0,0] 结束
 *     键盘: [hid, 动作字节]          动作字节 = 按下 ? 延时+128 : 延时   (延时<=127)
 *            [hid, 128/0, 延时低, 延时高]                              (延时>127)
 *     鼠标键: 同键盘, 首字节 = 鼠标按钮字节 (Na 表的第 3 个字节)
 *     鼠标移动: [249, 延时<=127?延时:0, dx(int8), dy(int8)] (+延时高字节)
 *   每个"按键/鼠标/移动"事件后面跟一个延时事件, 二者合并成一条记录。
 */
import { HID_NAMES, keyLabel } from './keycodes.js';
import { htmlCodeMapHIDCode } from './kcfg.js';

const $ = (id) => document.getElementById(id);

/** steps -> 256 字节宏数据 */
export function encodeMacro(steps, repeatCount = 1) {
  const buf = new Uint8Array(256);
  buf[0] = repeatCount & 255;
  buf[1] = (repeatCount >> 8) & 255;
  let p = 2;
  const put = (bytes) => { for (const b of bytes) { if (p < 256) buf[p++] = b & 255; } };
  for (const s of steps) {
    const d = Math.max(0, Math.min(65535, s.delay | 0));
    if (s.type === 'move') {
      const rec = [249];
      if (d <= 127) rec.push(d); else rec.push(0);
      rec.push(s.dx & 255, s.dy & 255);
      if (d > 127) rec.push(d & 255, (d >> 8) & 255);
      put(rec);
    } else {
      const first = s.type === 'mouse' ? (s.button & 255) : (s.hid & 255);
      const rec = [first];
      if (d <= 127) rec.push(s.action === 'down' ? d + 128 : d);
      else { rec.push(s.action === 'down' ? 128 : 0); rec.push(d & 255, (d >> 8) & 255); }
      put(rec);
    }
    if (p >= 254) break;
  }
  for (let i = 0; i < 4; i++) put([0]);
  return buf;
}

/** 256 字节宏数据 -> steps */
export function decodeMacro(u8) {
  const repeatCount = u8[0] | (u8[1] << 8);
  const steps = [];
  let i = 2;
  const rec = () => Array.from(u8.slice(i, i + 4));
  let r = rec(); i += 4;
  const allZero = (a) => a[0] === 0 && a[1] === 0 && a[2] === 0 && a[3] === 0;
  let guard = 0;
  while (!allZero(r) && guard++ < 200) {
    if (r[0] === 249) {
      const dx = (r[2] << 24) >> 24, dy = (r[3] << 24) >> 24;
      let d;
      // 注意: 厂商读取端在这里写的是 r[1] >> 1, 与它自己的写入端 (直接写 r[1]) 不一致,
      // 会导致"鼠标移动"的延时读回来只有一半。这里按写入端还原, 保证读写往返稳定;
      // 写进设备的字节与官方驱动完全一致。
      if (r[1] !== 0) d = r[1];
      else { d = u8[i] | (u8[i + 1] << 8); i += 2; }
      steps.push({ type: 'move', dx, dy, delay: d });
      r = rec(); i += 4;
      continue;
    }
    let d;
    if (r[0] >= 4 && r[0] <= 239) {
      steps.push({ type: 'key', hid: r[0], action: r[1] <= 127 ? 'up' : 'down', delay: 0 });
      if (r[1] & 127) { d = r[1] & 127; i -= 2; } else { d = u8[i - 2] | (u8[i - 1] << 8); }
    } else {
      const mouseMap = { 240: 0, 241: 1, 242: 2, 243: 3, 244: 4 };
      steps.push({ type: 'mouse', button: mouseMap[r[0]] ?? 0, action: r[1] <= 127 ? 'up' : 'down', delay: 0 });
      if (r[1] & 127) { d = r[1] & 127; i -= 2; } else { d = u8[i - 2] | (u8[i - 1] << 8); }
    }
    steps[steps.length - 1].delay = d;
    r = rec(); i += 4;
  }
  return { repeatCount, steps };
}

export function initMacro(ctx) {
  let steps = [];
  let recording = false;
  const KEY_LIST = Object.entries(HID_NAMES).filter(([v]) => Number(v) >= 4 && Number(v) <= 0x67);

  $('macroSlot').innerHTML = Array.from({ length: 50 }, (_, i) => `<option value="${i + 1}">宏 ${i + 1}</option>`).join('');
  const slotNo = () => Number($('macroSlot').value) - 1;      // 界面 1..50 -> 设备 0..49
  const fixedDelay = () => Math.max(1, Number($('macroFixed').value) || 30);

  function render() {
    const box = $('macroSteps');
    box.innerHTML = '';
    if (!steps.length) { box.innerHTML = '<div class="hint">还没有步骤。用下面的按钮添加。</div>'; return; }
    steps.forEach((s, i) => {
      const el = document.createElement('div');
      el.className = 'step';
      const idx = document.createElement('span'); idx.className = 'idx'; idx.textContent = i + 1;
      el.appendChild(idx);

      if (s.type === 'key') {
        const sel = document.createElement('select');
        sel.innerHTML = KEY_LIST.map(([v, n]) => `<option value="${v}">${n}</option>`).join('');
        sel.value = String(s.hid);
        sel.onchange = () => { s.hid = Number(sel.value); };
        el.appendChild(sel);
        const act = document.createElement('select');
        act.innerHTML = '<option value="down">按下</option><option value="up">抬起</option>';
        act.value = s.action;
        act.onchange = () => { s.action = act.value; };
        el.appendChild(act);
      } else if (s.type === 'mouse') {
        const t = document.createElement('span'); t.textContent = '鼠标按键'; el.appendChild(t);
        const act = document.createElement('select');
        act.innerHTML = '<option value="down">按下</option><option value="up">抬起</option>';
        act.value = s.action; act.onchange = () => { s.action = act.value; };
        el.appendChild(act);
      } else {
        const t = document.createElement('span'); t.textContent = '鼠标移动'; el.appendChild(t);
        for (const axis of ['dx', 'dy']) {
          const inp = document.createElement('input');
          inp.type = 'number'; inp.value = s[axis]; inp.style.width = '70px';
          inp.onchange = () => { s[axis] = Number(inp.value) | 0; };
          const lab = document.createElement('label'); lab.textContent = axis; lab.appendChild(inp);
          el.appendChild(lab);
        }
      }

      const dlab = document.createElement('label');
      dlab.textContent = '延时(ms)';
      const dinp = document.createElement('input');
      dinp.type = 'number'; dinp.min = '0'; dinp.max = '65535'; dinp.value = s.delay; dinp.style.width = '80px';
      dinp.onchange = () => { s.delay = Number(dinp.value) | 0; };
      dlab.appendChild(dinp);
      el.appendChild(dlab);

      const del = document.createElement('button');
      del.className = 'btn'; del.textContent = '删除';
      del.onclick = () => { steps.splice(i, 1); render(); };
      el.appendChild(del);

      box.appendChild(el);
    });
  }

  $('btnMacroAddKeyDown').onclick = () => { steps.push({ type: 'key', hid: 0x04, action: 'down', delay: 30 }); render(); };
  $('btnMacroAddKeyUp').onclick = () => { steps.push({ type: 'key', hid: 0x04, action: 'up', delay: 30 }); render(); };
  $('btnMacroAddDelay').onclick = () => { steps.push({ type: 'move', dx: 0, dy: 0, delay: 100 }); render(); };
  $('btnMacroAddMouse').onclick = () => { steps.push({ type: 'mouse', button: 0, action: 'down', delay: 30 }); render(); };

  /* ---- 原厂宏编辑页的按钮 ---- */
  const setPlay = (mode, btnOn) => {
    ctx.macroPlayMode = mode;
    [$('btnMacroToggle'), $('btnMacroPress')].forEach((b) => b && b.classList.remove('on'));
    if (btnOn) btnOn.classList.add('on');
    ctx.toast('播放方式：' + (mode === 'on_off' ? '开关（按一下开始/再按停止）' : mode === 'touch_repeat' ? '按下播放' : '循环'));
  };
  $('btnMacroToggle').onclick = () => setPlay('on_off', $('btnMacroToggle'));
  $('btnMacroPress').onclick = () => setPlay('touch_repeat', $('btnMacroPress'));
  $('btnMacroNew').onclick = () => {
    steps = [];
    $('macroRepeat').value = '1';
    if (recording) $('btnMacroRecord').click();
    render();
    ctx.toast('已新建空宏（选中「宏 ' + $('macroSlot').value + '」，编辑完点保存）');
  };
  $('btnMacroClear').onclick = () => { steps = []; render(); ctx.toast('已清空步骤'); };
  $('btnMacroSave').onclick = () => $('btnMacroWrite').click();
  $('btnMacroRecord').onclick = () => {
    recording = !recording;
    $('btnMacroRecord').classList.toggle('on', recording);
    $('btnMacroRecord').textContent = recording ? '停止录制' : '开始录制';
    ctx.toast(recording ? '开始录制：直接在键盘上敲，按顺序记录（点「停止录制」结束）' : '已停止录制');
  };
  // 录制：页面监听，htmlCode -> HID（与原厂一样按 htmlCode 映射）
  window.addEventListener('keydown', (e) => {
    if (!recording || e.repeat) return;
    const hid = htmlCodeMapHIDCode(e.code);
    if (hid === undefined) return;
    e.preventDefault();
    steps.push({ type: 'key', hid, action: 'down', delay: fixedDelay() });
    render();
  });
  window.addEventListener('keyup', (e) => {
    if (!recording) return;
    const hid = htmlCodeMapHIDCode(e.code);
    if (hid === undefined) return;
    e.preventDefault();
    steps.push({ type: 'key', hid, action: 'up', delay: fixedDelay() });
    render();
  });

  $('btnMacroRead').onclick = async () => {
    const d = ctx.device; if (!d) return ctx.toast('请先连接设备', 'err');
    const slot = slotNo();
    const raw = await d.getMacroRaw(slot);
    if (!raw) return ctx.toast('读取失败', 'err');
    const dec = decodeMacro(raw);
    steps = dec.steps;
    $('macroRepeat').value = dec.repeatCount;
    render();
    ctx.log('..', `宏 ${slot} 原始数据: ` + Array.from(raw.slice(0, 32)).join(','));
    ctx.toast(`已读取宏 ${slot + 1}（${steps.length} 步）`);
  };

  $('btnMacroWrite').onclick = async () => {
    const d = ctx.device; if (!d) return ctx.toast('请先连接设备', 'err');
    const slot = slotNo();
    const data = encodeMacro(steps, Number($('macroRepeat').value) | 0);
    ctx.log('..', `写入宏 ${slot}: ` + Array.from(data.slice(0, 32)).join(','));
    await d.setMacroRaw(slot, data);
    ctx.toast(`宏 ${slot + 1} 已写入设备`);
  };

  render();
  return {};
}
