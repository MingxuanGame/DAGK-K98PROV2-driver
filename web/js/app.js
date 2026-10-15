/*
 * app.js — DAGK K98 PRO V2 Web 驱动 · 主控制器
 */
import { HidTransport, PID_WIRED, PID_DONGLE, sleep } from './transport.js';
import { Notifier } from './notify.js';
import {
  readConfigFromDevice, applyConfigToDevice, summarizeConfig, validateConfig,
  listLocalConfigs, saveLocalConfig, loadLocalConfig, deleteLocalConfig, downloadConfig,
} from './config.js';
import { K98Device, MODE, LIGHT_LIST, SIDE_LIGHT_LIST, hex } from './protocol.js';
import { initKeymap } from './keymap.js';
import { initLighting } from './lighting.js';
import { initMacro } from './macro.js';
import { KEYS } from './layout.js';

export const K98PRO_DEVICE_ID = 3780;   // yc3123_kk_k98_pro_3m_1k @ vid 0x3151 pid 0x5002

const $ = (id) => document.getElementById(id);

export const state = {
  device: null,
  mode: MODE.USB,
  info: null,
  status: null,
  config: null,        // 当前"待应用/已读取"的配置对象
  configName: '',      // 来源名称（文件名或槽位名）
};

export const notifier = new Notifier();

/* ---------------- logging / toast ---------------- */
const logEl = () => $('log');
export function log(kind, msg) {
  const el = logEl();
  if (!el) { console.log(kind, msg); return; }
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const line = `[${t}] ${kind} ${msg}`;
  el.textContent += line + '\n';
  el.scrollTop = el.scrollHeight;
  if (el.textContent.length > 200000) el.textContent = el.textContent.slice(-100000);
}
export function hexLog(dir, bytes) { log(dir, hex(bytes)); }

let toastTimer = null;
export function toast(msg, kind = 'ok') {
  const el = $('alert');
  el.className = 'alert ' + kind;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

/* ---------------- feature modules ---------------- */
export const ctx = {
  get device() { return state.device; },
  get mode() { return state.mode; },
  get info() { return state.info; },
  log, hexLog, toast,
  markDirty, hasDirty, confirmDiscard,
  setStatus(st) { state.status = st; renderStatus(); },
  refreshAll() { mods.forEach((m) => m.onDeviceChange && m.onDeviceChange()); },
};

const mods = [];
function register(mod) { mods.push(mod); }

/* ---------------- connection ---------------- */
/** 切换「欢迎/搜索设备页」与原厂风格主界面 */
function setConnected(on) {
  $('btnDisconnect').disabled = !on;
  $('welcome').classList.toggle('hidden', on);
  $('appMain').classList.toggle('hidden', !on);
  $('btnWired').disabled = on;
  $('btnDongle').disabled = on;
  renderStatus();
}

/** 更新欢迎页状态文字（原厂文案） */
function setWelcomeStatus(text, searching = false) {
  const el = $('welcomeStatus');
  el.textContent = text;
  el.classList.toggle('searching', searching);
}

async function connect(kind, opts = {}) {
  try {
    if (!HidTransport.supported) {
      toast('此浏览器不支持 WebHID，请使用 Chrome / Edge 89+ 桌面版', 'err');
      return;
    }
    let list;
    if (opts.silent) {
      // 打开页面时自动连：只用"已授权"的设备列表（getDevices 不需要用户手势）
      setWelcomeStatus('已授权设备，自动连接中…', true);
      list = await HidTransport.granted();
      if (!list.length) { setWelcomeStatus('设备搜索中...', true); return; }
    } else {
      setWelcomeStatus('正在打开设备选择窗口…', true);
      toast('请在弹窗中选择设备…');
      list = await HidTransport.request();
      if (!list.length) { setWelcomeStatus('设备搜索中...', true); toast('未选择设备', 'err'); return; }
    }
    setWelcomeStatus('已检测到设备, 自动连接中, 请稍候...', true);

    const wantPid = kind === 'wired' ? PID_WIRED : PID_DONGLE;
    let hid = list.find((h) => h.device.productId === wantPid && h.isVendorCollection())
           || list.find((h) => h.device.productId === wantPid)
           || list.find((h) => h.isVendorCollection())
           || list[0];

    if (hid.device.productId !== wantPid) {
      toast(`注意：选中的是 ${hid.device.productId.toString(16)}，与预期不符`, 'err');
    }

    await hid.open();
    hid.log = (dir, bytes) => {
      if ($('autoRead').checked || dir === 'OUT') hexLog(dir, bytes);
    };

    const mode = hid.device.productId === PID_DONGLE ? MODE.RF24G : MODE.USB;
    const dev = new K98Device(hid, mode);
    dev.log = hexLog;
    dev.onStatus = (st) => { state.status = st; renderStatus(); };

    state.device = dev;
    state.mode = mode;

    if (mode === MODE.RF24G) {
      // 2.4G 下只做「一次」状态读取。这个接收器的厂商通道很脆：
      // 反复轮询 / 连续重试会把它的控制端点 stall 掉，表现就是"连上一会儿就断"。
      // 所以连接阶段绝不重试、也绝不启动后台轮询（后台轮询改为显式开启）。
      log('..', '读取 2.4G 接收器状态 (0xF7, 仅一次)…');
      let st;
      try {
        st = await dev.relay.pollStatus();
      } catch (e) {
        log('!!', '0xF7 失败: ' + (e.message || e));
        toast('接收器没有响应 0xF7。请拔插一次接收器后重试。', 'err');
      }
      if (st) {
        state.status = st;
        renderStatus();
        log('..', `链路: 键盘电量=${st.keyboard.battery}% 在线=${st.keyboard.isOnline} 可发送=${st.keyboard.isCanSend} 目标=${st.keyboard.isOnline ? '键盘' : '?'}`);
        if (!st.keyboard.isOnline) {
          toast('接收器已连上，但键盘不在线。请把键盘开关拨到 2.4G 并按一下键唤醒，再点「读取设备配置」。', 'err');
        } else {
          toast('2.4G 接收器已连接 · 键盘在线 · 电量 ' + st.keyboard.battery + '%');
        }
      }
      setConnected(true);
      $('connSub').textContent = `${hid.device.productName || 'HID'} · vid 0x${hid.device.vendorId.toString(16)} pid 0x${hid.device.productId.toString(16)}`;
      $('footerInfo').textContent = `已连接 ${hid.device.productName || ''}`;
      ctx.refreshAll();
      // 无线也要和有线一样：读设备信息 + 自动读取配置（键盘在线时才做，别给脆弱接收器加压）
      if (!st || st.keyboard.isOnline) {
        try {
          const info2 = await dev.fetchDeviceInfo();
          if (info2) {
            state.info = info2;
            log('..', `(2.4G) 设备ID=${info2.deviceId} USB版本=${info2.usbVersion}`);
            $('footerInfo').textContent = `已连接 ${hid.device.productName || ''} · 设备ID ${info2.deviceId}`;
          }
        } catch (e) { log('..', '(2.4G) 读设备信息失败：' + (e.message || e)); }
        autoReadConfig();
      } else {
        log('..', '键盘不在线，先不自动读取；唤醒键盘后点右上角「读取设备配置」');
      }
      return;
    }

    const info = await dev.fetchDeviceInfo();
    if (!info) {
      toast('设备无响应（0x8F 超时）。请确认键盘已切到有线模式。', 'err');
    } else {
      state.info = info;
      log('..', `设备ID=${info.deviceId} USB版本=${info.usbVersion}` + (info.lightSync ? ' 支持灯光同步' : ''));
      if (info.deviceId !== K98PRO_DEVICE_ID) {
        toast(`设备ID ${info.deviceId} 不是 K98PRO(3780)！协议可能不兼容，请谨慎操作。`, 'err');
      } else {
        toast('已连接 K98PRO · ' + (mode === MODE.USB ? '有线' : '2.4G 无线'));
      }
      if (mode === MODE.RF24G) { try { await dev.getRfVersion(); } catch (e) {} }
    }

    setConnected(true);
    $('connSub').textContent = `${hid.device.productName || 'HID'} · vid 0x${hid.device.vendorId.toString(16)} pid 0x${hid.device.productId.toString(16)}`;
    $('footerInfo').textContent = `已连接 ${hid.device.productName || ''} · 设备ID ${state.info ? state.info.deviceId : '?'}`;
    ctx.refreshAll();
    // 连接成功：清掉掉线横幅，并刷新配置页按钮可用性
    notifier.deviceOk();
    $('btnCfgReadDev').disabled = false;
    $('btnCfgApplyDev').disabled = !state.config;
    // 连上就自动把键盘配置读回来（按键层 / 灯效 / 设置），省得再点一次
    autoReadConfig();
  } catch (e) {
    console.error(e);
    setWelcomeStatus('设备搜索中...', true);
    toast('连接失败: ' + (e.message || e), 'err');
    log('!!', String(e && e.stack || e));
    await handleDeviceFailure(e);
  }
}

/**
 * 统一的"设备出问题"处理：显示横幅 + 发系统通知（让用户不必盯着页面）。
 * 判定：超时 / EPIPE / 设备不存在 / USB 断开 都算需要拔插。
 */
export async function handleDeviceFailure(e) {
  const msg = (e && e.message) ? e.message : String(e || '');
  const needsReplug = /超时|timeout|EPIPE|Broken pipe|device|设备没有响应|not found|disconnected|断开/i.test(msg);
  if (!needsReplug) return;
  await notifier.deviceLost(msg || '设备没有响应');
}

/**
 * 掉线后重连（用户点横幅上的「我已重新插好，重试」时调用）
 *
 * 关键点：拔插之后原先那个 HIDDevice 对象已经失效，
 * 但**浏览器仍然记着本页面的授权**（授权是按 origin+设备 记的）。
 * 所以这里优先用 navigator.hid.getDevices() 拿"新的"设备对象直接打开，
 * 不需要再弹一次设备选择框 —— 用户只需拔插 + 点一下按钮。
 * 只有 getDevices() 找不到时才退回让用户重新点「连接」。
 */
async function retryAfterReplug() {
  const wantPid = state.mode === MODE.RF24G ? PID_DONGLE : PID_WIRED;
  try {
    toast('正在重新连接…');
    log('..', '尝试重连（查找已授权设备）');

    // 1) 先试着复用老对象
    const d = state.device;
    if (d) {
      try {
        await d.hid.close().catch(() => {});
        await sleep(400);
        await d.hid.open();
        await sleep(300);
        if (state.mode === MODE.RF24G) {
          const st = await d.relay.pollStatus();
          state.status = st; renderStatus();
        }
        notifier.deviceOk();
        toast('已重新连接');
        log('..', '重连成功（复用原连接）');
        return;
      } catch (e) {
        log('..', '复用原连接失败，改用 getDevices() 重新获取设备: ' + (e.message || e));
      }
    }

    // 2) 用已授权的设备列表重新拿设备对象（拔插后是新对象）
    const list = await HidTransport.granted();
    let hid = list.find((h) => h.device.productId === wantPid && h.isVendorCollection())
           || list.find((h) => h.device.productId === wantPid);
    if (!hid) {
      toast('浏览器里找不到已授权的接收器，请重新点「连接 2.4G 接收器」', 'err');
      log('!!', '重连失败：已授权设备列表为空');
      return;
    }
    if (state.device) { await state.device.close().catch(() => {}); }

    await hid.open();
    hid.log = (dir, bytes) => { if ($('autoRead').checked || dir === 'OUT') hexLog(dir, bytes); };
    const mode = hid.device.productId === PID_DONGLE ? MODE.RF24G : MODE.USB;
    const dev = new K98Device(hid, mode);
    dev.log = hexLog;
    dev.onStatus = (st) => { state.status = st; renderStatus(); };
    state.device = dev;
    state.mode = mode;

    if (mode === MODE.RF24G) {
      const st = await dev.relay.pollStatus();
      state.status = st;
    }
    await dev.fetchDeviceInfo();

    notifier.deviceOk();
    renderStatus();
    $('connSub').textContent = `${hid.device.productName || 'HID'} · vid 0x${hid.device.vendorId.toString(16)} pid 0x${hid.device.productId.toString(16)}`;
    ctx.refreshAll();
    $('btnCfgReadDev').disabled = false;
    $('btnCfgApplyDev').disabled = !state.config;
    toast('已重新连接');
    log('..', '重连成功（新设备对象）');
  } catch (e) {
    toast('重连失败：' + (e.message || e) + '（可再点一次「连接 2.4G 接收器」）', 'err');
    log('!!', '重连失败: ' + (e.message || e));
    await handleDeviceFailure(e);
  }
}

async function disconnect() {
  if (hasDirty() && !confirmDiscard('断开连接')) return;
  markDirty('*', 0);
  if (state.device) { await state.device.close(); }
  state.device = null; state.info = null; state.status = null;
  setConnected(false);
  $('connSub').textContent = '';
  $('footerInfo').textContent = '';
  setWelcomeStatus('设备搜索中...', true);
  renderStatus();
  toast('已断开');
}

function renderStatus() {
  const el = $('statusPill');
  const dot = $('connDot');
  const txt = $('connText');
  const setAll = (pillText, cls, footText) => {
    el.textContent = pillText;
    el.className = 'device-pill' + (cls ? ' ' + cls : '');
    dot.className = 'conn-dot' + (cls ? ' ' + cls : '');
    txt.textContent = footText;
  };
  const sd = $('sideDevName');
  if (sd) sd.textContent = state.device ? 'K98PRO' : '未连接';
  const fv = $('fwVersion');
  if (fv && state.info && state.info.deviceId) {
    const v = Number(state.info.usbVersion || 0).toString(16).toUpperCase();
    fv.textContent = '固件版本：ID' + state.info.deviceId + '_V' + v + '_KEYBOARDV64';
  }
  if (!state.device) { setAll('未连接', '', '未连接'); return; }
  if (state.mode === MODE.USB) { setAll('已连接 · 有线', 'on', '有线 USB 已连接'); return; }
  const k = state.status && state.status.keyboard;
  if (!k) { setAll('2.4G', 'warn', '2.4G 接收器'); return; }
  setAll(`2.4G · ${k.isOnline ? '在线' : '离线'} · 电量 ${k.battery}%`, k.isOnline ? 'on' : 'warn',
         k.isOnline ? '2.4G 已连接' : '未连接 2.4G 设备');
}

/* ---------------- 侧边导航 ---------------- */
function initTabs() {
  document.querySelectorAll('.navitem').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.navitem').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.panel').forEach((p) => p.classList.add('hidden'));
      $('tab-' + btn.dataset.tab).classList.remove('hidden');
      mods.forEach((m) => m.onShow && m.onShow());
      if (btn.dataset.tab === 'light') mods.forEach((m) => m.onShowPerKey && m.onShowPerKey());
    });
  });
}


/* ---------------- 配置管理页 ---------------- */
function cfgLog(msg) {
  const el = $('cfgLog');
  if (!el) return;
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  el.textContent += `[${t}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}

function setCfg(cfg, name) {
  state.config = cfg;
  state.configName = name || '';
  const has = !!cfg;
  $('btnCfgApplyDev').disabled = !has || !state.device;
  $('btnCfgExport').disabled = !has;
  $('btnCfgSaveLocal').disabled = !has;
  $('cfgState').textContent = has ? '已载入配置' : '尚未读取或导入';
  $('cfgState').className = 'device-pill' + (has ? ' on' : '');
  $('cfgName2').textContent = name ? `来源：${name}` : '';
  const ul = $('cfgSummary');
  ul.innerHTML = '';
  if (!has) { ul.innerHTML = '<li class="hint">点「从设备读取配置」或导入一个 .json 文件</li>'; return; }
  for (const line of summarizeConfig(cfg)) {
    const li = document.createElement('li');
    li.textContent = line;
    ul.appendChild(li);
  }
}

function refreshLocalList() {
  const names = listLocalConfigs();
  const sel = $('cfgLocalList');
  sel.innerHTML = names.length
    ? names.map((n) => `<option value="${n}">${n}</option>`).join('')
    : '<option value="">（无）</option>';
  const has = names.length > 0;
  $('btnCfgLoadLocal').disabled = !has;
  $('btnCfgDeleteLocal').disabled = !has;
}

function initConfig() {
  refreshLocalList();
  setCfg(null, '');

  $('btnCfgReadDev').onclick = async () => {
    const d = state.device;
    if (!d) return toast('请先连接设备', 'err');
    $('btnCfgReadDev').disabled = true;
    cfgLog('开始从设备读取配置…');
    try {
      const cfg = await readConfigFromDevice(d, (step, done, total) => {
        cfgLog(`  ${done}/${total} 已读 ${step}`);
        toast(`读取配置 ${done}/${total}（${step}）`);
      });
      setCfg(cfg, '设备 ' + (state.mode === MODE.USB ? '有线' : '2.4G'));
      cfgLog('读取完成');
      toast('配置已从设备读取');
    } catch (e) {
      cfgLog('读取失败: ' + (e.message || e));
      toast('读取配置失败：' + (e.message || e), 'err');
      await handleDeviceFailure(e);
    } finally {
      $('btnCfgReadDev').disabled = false;
    }
  };

  $('btnCfgApplyDev').onclick = async () => {
    const d = state.device;
    if (!d) return toast('请先连接设备', 'err');
    if (!state.config) return toast('请先读取或导入配置', 'err');
    if (!confirm('将把当前配置写入设备（会覆盖设备上的按键/灯效/宏），继续？')) return;
    $('btnCfgApplyDev').disabled = true;
    cfgLog('开始写入设备…');
    try {
      await applyConfigToDevice(d, state.config, (step, done, total) => {
        cfgLog(`  ${done}/${total} 已写 ${step}`);
        toast(`写入 ${done}/${total}（${step}）`);
      });
      cfgLog('写入完成');
      toast('配置已写入设备');
    } catch (e) {
      cfgLog('写入失败: ' + (e.message || e));
      toast('写入失败：' + (e.message || e), 'err');
      await handleDeviceFailure(e);
    } finally {
      $('btnCfgApplyDev').disabled = false;
    }
  };

  $('btnCfgExport').onclick = () => {
    if (!state.config) return;
    const name = downloadConfig(state.config);
    cfgLog('已导出文件 ' + name);
    toast('已导出 ' + name);
  };

  $('cfgFile').onchange = async () => {
    const f = $('cfgFile').files[0];
    if (!f) return;
    try {
      const text = await f.text();
      const cfg = JSON.parse(text);
      validateConfig(cfg);
      setCfg(cfg, f.name);
      cfgLog('已导入 ' + f.name);
      toast('已导入 ' + f.name);
    } catch (e) {
      cfgLog('导入失败: ' + (e.message || e));
      toast('导入失败：' + (e.message || e), 'err');
    } finally {
      $('cfgFile').value = '';
    }
  };

  $('btnCfgSaveLocal').onclick = () => {
    if (!state.config) return;
    const name = ($('cfgName').value || '').trim() || ('配置 ' + new Date().toLocaleString('zh-CN'));
    saveLocalConfig(name, state.config);
    refreshLocalList();
    $('cfgLocalList').value = name;
    cfgLog('已保存到浏览器：' + name);
    toast('已保存到浏览器：' + name);
  };

  $('btnCfgLoadLocal').onclick = () => {
    const name = $('cfgLocalList').value;
    if (!name) return;
    const cfg = loadLocalConfig(name);
    if (!cfg) return toast('读取失败：找不到 ' + name, 'err');
    try { validateConfig(cfg); } catch (e) { return toast('读取失败：' + e.message, 'err'); }
    setCfg(cfg, '浏览器：' + name);
    cfgLog('已从浏览器读取：' + name);
    toast('已读取 ' + name);
  };

  $('btnCfgDeleteLocal').onclick = () => {
    const name = $('cfgLocalList').value;
    if (!name) return;
    if (!confirm(`删除浏览器里保存的「${name}」？`)) return;
    deleteLocalConfig(name);
    refreshLocalList();
    cfgLog('已删除：' + name);
  };
}

/* ---------------- settings tab ---------------- */
const RATES = [8000, 4000, 2000, 1000, 500, 250, 125];

function initSettings() {
  const sel = $('setRate');
  sel.innerHTML = RATES.map((r) => `<option value="${r}">${r} Hz</option>`).join('');
  $('btnSettingsRead').onclick = async () => {
    const d = state.device; if (!d) return toast('请先连接设备', 'err');
    try {
      const [profile, rate, debounce, opt, sleepT] = await Promise.all([
        d.getCurrentProfile(), d.getReportRate(), d.getDeBounce(), d.getKbOption(), d.getSleepTime(),
      ]);
      if (profile !== undefined) $('setProfile').value = String(profile);
      if (rate !== undefined) $('setRate').value = String(rate);
      if (debounce !== undefined) $('setDebounce').value = String(debounce);
      if (opt) { $('setSystem').value = opt.system; $('setWasd').checked = opt.WASDSwap; }
      if (sleepT) {
        $('setSleep24').value = sleepT.time_24; $('setSleepBt').value = sleepT.time_bt;
        $('setDeep24').value = sleepT.deepTime_24; $('setDeepBt').value = sleepT.deepTime_bt;
      }
      log('..', `设置读取完成 profile=${profile} rate=${rate} debounce=${debounce} ` + JSON.stringify(opt || {}));
      toast('设置已读取');
    } catch (e) { toast('读取失败: ' + e.message, 'err'); log('!!', String(e)); }
  };
  $('btnSettingsWrite').onclick = async () => {
    const d = state.device; if (!d) return toast('请先连接设备', 'err');
    try {
      await d.setCurrentProfile(Number($('setProfile').value));
      await d.setReportRate(Number($('setRate').value));
      await d.setDeBounce(Number($('setDebounce').value));
      await d.setKbOption({ system: $('setSystem').value, WASDSwap: $('setWasd').checked, fnIndex: 0, RTStab: 0, 防误触开关: false });
      await d.setSleepTime({
        time_24: Number($('setSleep24').value), time_bt: Number($('setSleepBt').value),
        deepTime_24: Number($('setDeep24').value), deepTime_bt: Number($('setDeepBt').value),
      });
      toast('设置已写入');
    } catch (e) { toast('写入失败: ' + e.message, 'err'); log('!!', String(e)); }
  };
  $('btnReset').onclick = async () => {
    const d = state.device; if (!d) return toast('请先连接设备', 'err');
    if (!confirm('确定要重启/恢复设备吗？')) return;
    try { await d.reset(); toast('已发送重启命令'); }
    catch (e) { toast('失败: ' + e.message, 'err'); }
  };
}

/* ---------------- diagnostics ---------------- */
function initDiag() {
  $('btnDevInfo').onclick = async () => {
    const d = state.device; if (!d) return toast('请先连接设备', 'err');
    const info = await d.fetchDeviceInfo();
    log('..', '设备信息: ' + JSON.stringify(info));
    if (state.mode === MODE.RF24G) log('..', '接收器ID: ' + (await d.getDongleId()));
    toast('设备信息已输出到控制台');
  };
  /* ---- 2.4G 手动控制（默认不轮询，避免把脆弱的接收器拖死） ---- */
  $('btnPollNow').onclick = async () => {
    const d = state.device;
    if (!d) return toast('请先连接设备', 'err');
    if (state.mode !== MODE.RF24G) return toast('当前是有线连接，不需要刷新 2.4G 状态', 'err');
    try {
      const st = await d.relay.pollStatus();
      state.status = st;
      renderStatus();
      log('..', `F7 状态: 键盘电量=${st.keyboard.battery}% 在线=${st.keyboard.isOnline} 可发送=${st.keyboard.isCanSend} 可读取=${st.keyboard.isCanRead}`);
      toast(`键盘 ${st.keyboard.isOnline ? '在线' : '离线'} · 电量 ${st.keyboard.battery}%`);
    } catch (e) {
      renderStatus();
      toast('接收器没有响应。请拔插一次接收器，或点「软复位 HID 连接」重试。', 'err');
      log('!!', 'F7 失败: ' + (e.message || e));
    }
  };
  $('autoPoll').onchange = () => {
    const d = state.device;
    if (!d || state.mode !== MODE.RF24G) { $('autoPoll').checked = false; return toast('请先连接 2.4G 接收器', 'err'); }
    if ($('autoPoll').checked) {
      d.relay.startPolling((s, err) => {
        if (err) {
          $('autoPoll').checked = false;
          toast('自动刷新已停止：接收器不再响应，请拔插接收器。', 'err');
          return;
        }
        state.status = s; renderStatus();
      });
      toast('已开启自动刷新（每 5 秒）。若接收器变卡请关掉它。');
    } else {
      d.relay.stopPolling();
      toast('已关闭自动刷新');
    }
  };
  $('btnSoftReset').onclick = async () => {
    const d = state.device;
    if (!d) return toast('请先连接设备', 'err');
    try {
      if (state.mode === MODE.RF24G && d.relay) {
        await d.relay.softReset();
      } else {
        await d.hid.close();
        await sleep(300);
        await d.hid.open();
      }
      toast('已软复位 HID 连接，请再试一次读取');
      log('..', '软复位完成');
    } catch (e) {
      toast('软复位失败：' + (e.message || e), 'err');
    }
  };
  $('btnProbePage').onclick = async () => {
    const d = state.device;
    if (!d) return toast('请先连接设备', 'err');
    const page = Number($('probePage').value);
    $('btnProbePage').disabled = true;
    try {
      const raw = await d.readKeyMatrixRaw(0, 0, { only: page });
      const p = raw.slice(page * 64, page * 64 + 16);
      log('..', `单页读第 ${page} 页成功: ` + Array.from(p).join(','));
      toast(`第 ${page} 页读取成功`);
    } catch (e) {
      log('!!', `单页读第 ${page} 页失败: ` + (e.message || e));
      toast(`第 ${page} 页读取失败：${e.message || e}`, 'err');
    } finally {
      $('btnProbePage').disabled = false;
    }
  };
  $('btnListDevices').onclick = async () => {
    const box = $('devListBox');
    box.style.display = '';
    const el = $('devList');
    try {
      const devs = await navigator.hid.getDevices();
      if (!devs.length) { el.textContent = '(空) — 本页面还没有获得任何 HID 设备授权'; return; }
      el.textContent = devs.map((d) => {
        const cols = (d.collections || []).map((c) =>
          `    usagePage=0x${(c.usagePage ?? 0).toString(16).toUpperCase().padStart(4, '0')} usage=0x${(c.usage ?? 0).toString(16).toUpperCase().padStart(4, '0')}` +
          ` input=[${(c.inputReports || []).map((r) => r.reportId).join(',')}]` +
          ` output=[${(c.outputReports || []).map((r) => r.reportId).join(',')}]` +
          ` feature=[${(c.featureReports || []).map((r) => r.reportId).join(',')}]`).join('\n');
        return `${d.productName || '(无名)'}  vid=0x${d.vendorId.toString(16)} pid=0x${d.productId.toString(16)}  opened=${d.opened}\n${cols}`;
      }).join('\n\n');
      log('..', `已授权设备 ${devs.length} 个`);
    } catch (e) {
      el.textContent = '读取失败: ' + (e.message || e);
    }
  };
  $('btnRawRead').onclick = async () => {
    const d = state.device; if (!d) return toast('请先连接设备', 'err');
    try { const r = await d.readMsg(0); hexLog('IN ', r); } catch (e) { toast('读取失败: ' + e.message, 'err'); }
  };
  $('btnRawSend').onclick = async () => {
    const d = state.device; if (!d) return toast('请先连接设备', 'err');
    const txt = $('rawHex').value.trim();
    if (!txt) return;
    const bytes = txt.split(/[\s,]+/).map((x) => parseInt(x, 16)).filter((x) => !isNaN(x));
    try {
      await d._queue(async () => {
        await d.sendMsg(new Uint8Array(bytes));
        if ($('autoRead').checked) { const r = await d.readMsg(); hexLog('IN ', r); }
      });
    } catch (e) { toast('发送失败: ' + e.message, 'err'); }
  };
  $('btnClearLog').onclick = () => { logEl().textContent = ''; };
}

/* ---------------- firmware ---------------- */
function initFirmware() {
  const fileInput = $('fwFile');
  fileInput.onchange = () => {
    const ok = state.device && state.mode === MODE.USB && !!fileInput.files[0];
    $('btnFwStart').disabled = !ok;
  };
  $('btnFwStart').onclick = async () => {
    toast('固件刷写需要进入 Bootloader 并重新枚举设备；请在有线模式下按原厂工具流程操作。', 'err');
  };
  // keep the button state in sync with the connection
  setInterval(() => {
    const ok = !!(state.device && state.mode === MODE.USB && fileInput.files[0]);
    $('btnFwStart').disabled = !ok;
  }, 1000);
}

/* ---------------- 未写入改动提醒 ---------------- */
const dirtySources = new Map();     // 来源 -> 未写入条数

function dirtyTotal() {
  let n = 0;
  for (const v of dirtySources.values()) n += v;
  return n;
}
/** 各页面把"还没写进键盘"的改动数报上来（0 = 清空） */
export function markDirty(src, n) {
  if (n > 0) dirtySources.set(src, n); else dirtySources.delete(src);
  const total = dirtyTotal();
  // 刷新 / 关闭 / 跳转前，浏览器会弹原生确认框（文案由浏览器决定，这里给个理由）
  if (total > 0) {
    window.onbeforeunload = (e) => {
      const msg = '还有 ' + total + ' 处改动没有写入键盘，离开会丢失。';
      e.preventDefault();
      e.returnValue = msg;
      return msg;
    };
  } else {
    window.onbeforeunload = null;
  }
  const badge = document.getElementById('dirtyBadge');
  if (badge) {
    badge.textContent = total > 0 ? '有 ' + total + ' 处改动未写入' : '';
    badge.classList.toggle('hidden', total === 0);
  }
  return total;
}
export function hasDirty() { return dirtyTotal() > 0; }   // 用函数声明，避免 ctx 初始化时踩 TDZ
/** 会丢掉改动的操作（读取/扫描/换板载/断开）先问一句 */
export function confirmDiscard(what) {
  const total = dirtyTotal();
  if (!total) return true;
  return window.confirm('还有 ' + total + ' 处改动没有写入键盘：' + what + '会丢掉它们。\n\n继续吗？（想保留请先点「写入设备」）');
}

/* ---------------- 打开页面自动连上已授权设备 ---------------- */
async function tryAutoConnect() {
  if (!HidTransport.supported) return;
  try {
    const list = await HidTransport.granted();      // getDevices()：不需要用户手势
    if (!list.length) return;
    log('..', '发现已授权设备 ' + list.length + ' 个，自动连接…');
    if (list.some((h) => h.device.productId === PID_WIRED)) await connect('wired', { silent: true });
    else if (list.some((h) => h.device.productId === PID_DONGLE)) await connect('dongle', { silent: true });
  } catch (e) {
    log('..', '自动连接未成功（可手动点连接按钮）：' + (e.message || e));
  }
}

/* ---------------- 自动读取键盘配置 ---------------- */
// 记录"已经为哪个设备对象自动读取过"。
// 早期版本用的是布尔量，结果是：先连有线再换 2.4G（或掉线重连）时，
// 第二次连接就不会再自动读取了 —— 用户看到的就是"无线和有线行为不一样"。
// 每次连接都会创建一个新的设备对象，所以按对象比较即可做到"每连一次读一次"。
let autoReadFor = null;
async function autoReadConfig(force = false) {
  if (!state.device) return;
  if (autoReadFor === state.device && !force) return;
  autoReadFor = state.device;
  try {
    toast('正在自动读取键盘配置…');
    log('..', '连接成功 -> 自动读取键盘配置（按键层 + 灯效 + 设置）');
    // 按键层：模块内部会先问设备"当前板载"(0x84) 再读那一层
    for (const m of mods) { if (m.autoRead) await m.autoRead(); }
    // 设置类（回报率 / 去抖 / 键盘选项 / 休眠）
    const sr = $('btnSettingsRead');
    if (sr) sr.click();
    toast('键盘配置已读取');
  } catch (e) {
    log('!!', '自动读取配置失败: ' + (e.message || e));
    toast('自动读取配置失败：' + (e.message || e) + '（可手动点「读取设备配置」）', 'err');
  }
  void force;
}

/* ---------------- 原厂外壳：顶部设备下拉 / 页内页签 / 底栏 ---------------- */
function activePanel() {
  return [...document.querySelectorAll('.panel')].find((p) => !p.classList.contains('hidden'));
}

function initShell() {
  // 顶部设备下拉
  const sel = $('devSelect'), menu = $('devMenu');
  if (sel && menu) {
    sel.onclick = (ev) => { ev.stopPropagation(); menu.classList.toggle('hidden'); };
    document.addEventListener('click', () => menu.classList.add('hidden'));
    menu.querySelectorAll('[data-dev]').forEach((it) => {
      it.onclick = () => { menu.classList.add('hidden'); connect(it.dataset.dev); };
    });
  }
  // 顶部「读取设备配置」：转发到当前页面的读取按钮
  const rc = $('btnReadCfg');
  if (rc) rc.onclick = () => {
    const p = activePanel();
    if (!p) return;
    // 有 autoRead/readConfig 的页面（键盘设置 / Fn层设置 / 灯光设置）直接调模块：
    //   键盘设置 = 先问设备当前板载(0x84) 再读那一档
    for (const m of mods) {
      if (m.readConfig && m.root === p) { m.readConfig(); return; }
    }
    const btn = p.querySelector('[data-role="btnScan"]') || p.querySelector('[data-role="btnRead"]')
      || p.querySelector('#btnLightRead') || p.querySelector('#btnMacroRead') || p.querySelector('#btnSettingsRead');
    if (btn) btn.click(); else toast('当前页面没有可读取的配置', 'err');
  };
  // 页内页签（灯光设置 / 键盘设置 / Fn层设置 共用）
  document.querySelectorAll('.panel').forEach((p) => {
    const tabs = p.querySelectorAll('.ptab');
    if (!tabs.length) return;
    tabs.forEach((t) => {
      t.onclick = () => {
        tabs.forEach((x) => x.classList.remove('on'));
        t.classList.add('on');
        p.querySelectorAll('.pbody').forEach((b) => b.classList.toggle('hidden', b.dataset.pbody !== t.dataset.ptab));
        mods.forEach((m) => m.onShow && m.onShow());
      };
    });
  });
  // 底栏
  const kt = $('btnKeyTest'), ko = $('keyTestOverlay');
  if (kt && ko) {
    kt.onclick = () => { ko.classList.remove('hidden'); renderKeyTest(); };
    $('btnKeyTestClose').onclick = () => ko.classList.add('hidden');
  }
  const fr = $('btnFactoryReset');
  if (fr) fr.onclick = () => $('btnReset').click();
  const fo = $('btnFwOpen');
  if (fo) fo.onclick = () => {
    const box = $('fwBox');
    if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const hd = $('helpDot');
  if (hd) hd.onclick = () => toast('点顶部「读取设备配置」读取当前页面；改键后点「写入设备」保存到键盘。');
}

/** 底栏「键盘测试」：按下的键高亮（用页面自身的键盘图，跟原厂一样） */
function renderKeyTest() {
  const g = $('keyTestGrid');
  if (!g) return;
  if (!g.dataset.built) {
    g.dataset.built = '1';
    // 按这把键盘自己的 98 键布局排（和「键盘设置」页同一套坐标，按键位置一眼对上）
    g.innerHTML = '<div class="kbwrap kt-wrap"><div class="kbstage kt-stage">'
      + KEYS.filter((k) => k.idx !== null).map((k) =>
        '<span class="kbk kt-key" data-idx="' + k.idx + '" style="left:' + k.x + 'px;top:' + k.y + 'px;width:' + k.w + 'px;height:' + k.h + 'px">'
        + '<span class="kbk-txt"><span class="kbk-l1">' + k.label + '</span>'
        + (k.label2 ? '<span class="kbk-l2">' + k.label2 + '</span>' : '') + '</span></span>').join('')
      + '</div></div>';
    const stage = g.querySelector('.kt-stage');
    const wrap = g.querySelector('.kt-wrap');
    const fit = () => {
      if (!wrap || !stage) return;
      const sc = Math.min(1, (wrap.clientWidth - 28) / 881);
      stage.style.transform = 'scale(' + sc + ')';
      wrap.style.height = Math.round(281 * sc + 24) + 'px';
    };
    fit();
    window.addEventListener('resize', fit);
    const flash = (code) => {
      const k = KEYS.find((x) => x.id === code);
      if (!k || k.idx === null) return;
      const el = g.querySelector('.kt-key[data-idx="' + k.idx + '"]');
      if (el) { el.classList.add('pressed'); setTimeout(() => el.classList.remove('pressed'), 250); }
    };
    window.addEventListener('keydown', (e) => { flash(e.code); });
    window.addEventListener('keyup', (e) => { flash(e.code); });
  }
}

/* ---------------- boot ---------------- */
window.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  initSettings();
  initConfig();
  initDiag();
  initFirmware();

  // 通知器：探测系统通知桥 + 请求浏览器通知权限，并挂上"用户已重新插好"的回调
  const n = await notifier.init();
  notifier.onRetry = retryAfterReplug;
  log('..', `通知通道：页面横幅 ✓` + (n.bridge ? ' · 系统通知 ✓' : ' · 系统通知 ✗(未通过本地服务器打开)') + (n.browser ? ' · 浏览器通知 ✓' : ''));
  if (n.bridge) log('..', '掉线时会通过 notify-send 给你发系统通知');

  // USB 断开事件 —— 立即提醒（不用等超时）
  if (navigator.hid && navigator.hid.addEventListener) {
    navigator.hid.addEventListener('disconnect', (ev) => {
      if (!state.device) return;
      log('!!', `HID 设备已断开: ${ev.device && ev.device.productName}`);
      notifier.deviceLost('接收器/键盘已从 USB 断开');
    });
  }
  register(initKeymap(ctx, { panel: 'tab-keymap', fn: false }));
  register(initKeymap(ctx, { panel: 'tab-fn', fn: true }));
  register(initLighting(ctx));
  register(initMacro(ctx));
  initShell();
  // 打开配置器后：如果浏览器里已有"授权过的"键盘/接收器，直接自动连上并读取配置
  tryAutoConnect();
  // 配置页打开时，如果还没配置就提示一下
  $('btnWired').onclick = () => connect('wired');
  $('btnDongle').onclick = () => connect('dongle');
  $('btnWired2').onclick = () => connect('wired');
  $('btnDongle2').onclick = () => connect('dongle');
  $('btnDisconnect').onclick = disconnect;
  setConnected(false);
  setWelcomeStatus('设备搜索中...', true);
  renderStatus();
  // 断开按钮也要复位配置页状态
  const _origDisconnect = disconnect;
  $('btnDisconnect').onclick = async () => {
    await _origDisconnect();
    $('btnCfgReadDev').disabled = true;
    $('btnCfgApplyDev').disabled = true;
  };
  log('..', '就绪。请点击「连接有线」或「连接 2.4G 接收器」。');
  const devs = await HidTransport.granted();
  if (devs.length) log('..', `浏览器已授权 ${devs.length} 个 DAGK 设备，可直接连接。`);
});

window.__k98 = { state, ctx, log, notifier, handleDeviceFailure, retryAfterReplug };
