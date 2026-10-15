/* 注入到页面里的假 WebHID 设备 (普通脚本, 无 import) — 仅用于自动化测试 */
(() => {
  const DEFAULT_MATRIX = [0,0,41,0,0,0,53,0,0,0,43,0,0,0,57,0,0,0,225,0,0,0,224,0,0,0,58,0,0,0,30,0,0,0,20,0,0,0,4,0,0,0,0,0,0,0,227,0,0,0,59,0,0,0,31,0,0,0,26,0,0,0,22,0,0,0,29,0,0,0,226,0,0,0,60,0,0,0,32,0,0,0,8,0,0,0,7,0,0,0,27,0,0,0,0,0,0,0,61,0,0,0,33,0,0,0,21,0,0,0,9,0,0,0,6,0,0,0,0,0,0,0,62,0,0,0,34,0,0,0,23,0,0,0,10,0,0,0,25,0,0,0,0,0,0,0,63,0,0,0,35,0,0,0,28,0,0,0,11,0,0,0,5,0,0,0,44,0,0,0,64,0,0,0,36,0,0,0,24,0,0,0,13,0,0,0,17,0,0,0,0,0,0,0,65,0,0,0,37,0,0,0,12,0,0,0,14,0,0,0,16,0,0,0,0,0,0,0,66,0,0,0,38,0,0,0,18,0,0,0,15,0,0,0,54,0,0,0,230,0,0,0,67,0,0,0,39,0,0,0,19,0,0,0,51,0,0,0,55,0,10,1,0,0,0,0,68,0,0,0,45,0,0,0,47,0,0,0,52,0,0,0,56,0,0,0,0,0,0,0,69,0,0,0,46,0,0,0,48,0,0,0,50,0,0,0,229,0,0,0,80,0,0,0,76,0,0,0,42,0,0,0,49,0,0,0,40,0,0,0,82,0,0,0,81,0,0,0,74,0,0,0,83,0,0,0,95,0,0,0,92,0,0,0,89,0,0,0,79,0,0,0,75,0,0,0,84,0,0,0,96,0,0,0,93,0,0,0,90,0,0,0,98,0,0,0,78,0,0,0,85,0,0,0,97,0,0,0,94,0,0,0,91,0,0,0,99,0,0,0,72,0,0,0,86,0,0,0,87,0,0,0,0,0,0,0,0,0,0,0,88,0,3,0,233,0,3,0,234,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
  function Device(pid, name) {
    this.vendorId = 0x3151; this.productId = pid; this.productName = name;
    this.collections = [{ usagePage: 0xffff, usage: 2, inputReports: [], outputReports: [], featureReports: [{ reportId: 0, items: [] }] }];
    this.opened = false; this.resp = new Uint8Array(64); this.frames = []; this._l = {};
  }
  Device.prototype.addEventListener = function (t, cb) { (this._l[t] = this._l[t] || []).push(cb); };
  Device.prototype.removeEventListener = function (t, cb) { this._l[t] = (this._l[t] || []).filter((f) => f !== cb); };
  Device.prototype.open = async function () { this.opened = true; };
  Device.prototype.close = async function () { this.opened = false; };
  Device.prototype.sendFeatureReport = async function (id, view) {
    const d = new Uint8Array(view.buffer || view, view.byteOffset || 0, view.byteLength || view.length);
    if (id !== 0) throw new Error('bad reportId');
    if (d.length !== 64) throw new Error('bad report length ' + d.length);
    this.frames.push(Array.from(d));
    (window.__frames = window.__frames || []).push({ pid: this.productId, cmd: d[0], hex: Array.from(d).map((b) => b.toString(16).padStart(2, '0')).join(' ') });
    const r = new Uint8Array(64); const cmd = d[0]; r[0] = cmd;
    switch (cmd) {
      case 0x8f: r[1] = 0xc4; r[2] = 0x0e; r[7] = 0x00; r[8] = 0x04; r[11] = 1; break;
      // window.__profile 可覆盖"当前板载"（默认 1 = 板载2，与原厂录制时的 0 不同）
      case 0x84: r[1] = window.__profile === undefined ? 1 : window.__profile; break;
      case 0x83: r[2] = 3; break;
      case 0x86: r[1] = 5; break;
      case 0x89: r[1] = 0; r[2] = 0; break;
      case 0x91: r[8] = 120; r[10] = 90; r[12] = 0xa0; r[13] = 0x06; break;
      case 0x87: r[1] = window.__lightType === undefined ? 1 : window.__lightType; r[2] = 2; r[3] = 3; r[4] = 7; r[5] = 255; r[6] = 0; r[7] = 0; break;
      case 0x88: r[1] = 2; r[2] = 1; r[3] = 2; r[4] = 7; r[5] = 0; r[6] = 255; r[7] = 0; break;
      case 0x8a: {
        // 支持按层注入矩阵: window.__matrixByLayer = { 0:[512], 1:[...], 2:[...] }
        const byLayer = window.__matrixByLayer && window.__matrixByLayer[d[1]];
        const src = byLayer || window.__matrix || DEFAULT_MATRIX;
        const p = d[3];
        for (let i = 0; i < 64; i++) r[i] = src[(p * 64 + i) % src.length] || 0;
        break;
      }
      case 0x8c: { const p = d[3]; for (let i = 0; i < 64; i++) r[i] = (window.__pic || [])[p * 64 + i] || 0; break; }
      case 0x8b: { const buf = (window.__macros = window.__macros || {})[d[1]] || []; const p = d[2]; for (let i = 0; i < 64; i++) r[i] = buf[p * 64 + i] || 0; break; }
      case 0x07: window.__lightType = d[1]; break;
      case 0x0a: {
        if (d[2] !== 255 && d[5] === 1) { window.__singleWrites = (window.__singleWrites || []).concat([{ idx: d[2], cfg: [d[8], d[9], d[10], d[11]], layer: d[1] }]); }
        else if (d[2] === 255) { window.__layerWrites = (window.__layerWrites || []).concat([{ page: d[3], len: d[4], last: d[5] }]); }
        break;
      }
      case 0x0c: { const p = d[3]; const pic = window.__pic = window.__pic || new Array(384).fill(0); for (let i = 0; i < d[4]; i++) pic[p * 56 + i] = d[8 + i]; break; }
      case 0x0b: { const m = window.__macros = window.__macros || {}; const buf = m[d[1]] = m[d[1]] || new Array(256).fill(0); for (let i = 0; i < d[3]; i++) buf[d[2] * 56 + i] = d[8 + i]; break; }
      // window.__noCanRead = true 用来模拟真机上"应答已就绪但 isCanRead 一直是 0"的情况
      case 0xf7: r[0] = window.__noCanRead ? 0 : 1; r[1] = 88; r[2] = 60; r[3] = 0; r[4] = 0; r[5] = 1; r[6] = 1; break;
      // F6/FE 只是选目标/长度, 不改变接收器里缓存的键盘应答
      case 0xf6: case 0xfe: return;
      // FC = 通知读取: 把最近收到的键盘应答放到读取缓冲 (对应真实接收器的行为)
      case 0xfc:
        if (this.kbResp) this.resp = this.kbResp.slice();
        return;
      default: break;
    }
    this.resp = r;
    // 只有"要转发给键盘"的命令才更新键盘应答缓存。
    // F7/F6/FC/FE 都是接收器本地的控制帧, 不经过键盘 —— 早期版本把 F7 的状态应答也当成
    // 键盘应答缓存起来, 导致随后 FC 之后读到的是 F7 的状态帧而不是键盘数据。
    const DONGLE_LOCAL = [0xf7, 0xf6, 0xfc, 0xfe];
    if (this.productId === 0x5006 && DONGLE_LOCAL.indexOf(cmd) === -1) {
      this.kbResp = this.resp.slice();
    }
  };
  Device.prototype.receiveFeatureReport = async function (id) { return new DataView(this.resp.slice().buffer); };
  Device.prototype.__isVendor = function () { return this.productId === 0x5002; };

  window.__DEFAULT_MATRIX = DEFAULT_MATRIX.slice();   // 供测试构造自定义层数据
  const wired = new Device(0x5002, 'K98PRO');
  const dongle = new Device(0x5006, '2.4G Receiver');
  window.__devices = { wired, dongle };
  window.__useDevice = 'wired';

  const fakeHid = {
    getDevices: async () => [],
    requestDevice: async () => [window.__useDevice === 'dongle' ? dongle : wired],
    addEventListener: () => {}, removeEventListener: () => {},
  };
  // navigator.hid 在 Navigator.prototype 上是只读 getter, 必须用 defineProperty 覆盖
  Object.defineProperty(Navigator.prototype, 'hid', { get: () => fakeHid, configurable: true });
})();
