/*
 * mock-device.mjs — 模拟一台 K98 PRO V2 (WebHID HIDDevice 接口)
 * 用于在没有硬件的情况下端到端测试协议层。
 * 只实现逆向出来的行为: 64 字节 feature report / reportId 0。
 */
import { DEFAULT_MATRIX, DEFAULT_FN_MATRIX, DEFAULT_FN_MAC_MATRIX } from '../web/js/protocol.js';

export class MockHidDevice {
  constructor(opts = {}) {
    this.vendorId = opts.vendorId ?? 0x3151;
    this.productId = opts.productId ?? 0x5002;
    this.productName = opts.productName ?? 'K98PRO';
    this.collections = opts.collections ?? [{ usagePage: 0xffff, usage: 0x0002, inputReports: [], outputReports: [], featureReports: [{ reportId: 0, items: [] }] }];
    this.opened = false;
    this.frames = [];          // 记录收到的所有帧
    this.resp = new Uint8Array(64);
    this.badChecksum = 0;
    // 设备状态
    this.state = {
      profile: 0, rate: 3, debounce: 5,
      kbOption: { system: 0, fnIndex: 0, fang: 0, rts: 0, wasd: 0 },
      sleep: { bt: 120, rf: 120, deepBt: 1680, deepRf: 1680 },
      light: { type: 1, speed: 2, bright: 3, option: 0, r: 255, g: 0, b: 0 },
      sideLight: { type: 2, speed: 1, bright: 2, option: 0, r: 0, g: 255, b: 0 },
      matrix: Uint8Array.from(DEFAULT_MATRIX),
      fnMatrix: Uint8Array.from(DEFAULT_FN_MATRIX),
      fnMacMatrix: Uint8Array.from(DEFAULT_FN_MAC_MATRIX),
      lightPic: new Uint8Array(384),
      macros: new Map(),
      deviceId: opts.deviceId ?? 3780,
      version: opts.version ?? 0x0400,
    };
    this._listeners = {};
  }

  addEventListener(t, cb) { (this._listeners[t] ||= []).push(cb); }
  removeEventListener(t, cb) { this._listeners[t] = (this._listeners[t] || []).filter((f) => f !== cb); }

  async open() { this.opened = true; }
  async close() { this.opened = false; }

  async sendFeatureReport(reportId, view) {
    if (!this.opened) throw new Error('device not open');
    const d = new Uint8Array(view.buffer ?? view, view.byteOffset ?? 0, view.byteLength ?? view.length);
    if (reportId !== 0) throw new Error('bad reportId ' + reportId);
    if (d.length !== 64) throw new Error('bad report length ' + d.length + ' (expect 64)');
    this.frames.push(Uint8Array.from(d));
    this._handle(d);
  }

  async receiveFeatureReport(reportId) {
    if (!this.opened) throw new Error('device not open');
    if (reportId !== 0) throw new Error('bad reportId ' + reportId);
    return new DataView(this.resp.slice().buffer);
  }

  /** 核心: 按逆向结果产生应答 */
  _handle(d) {
    const r = new Uint8Array(64);
    const dv = new DataView(r.buffer);
    const cmd = d[0];
    r[0] = cmd;
    const s = this.state;
    switch (cmd) {
      case 0x8f:
        dv.setUint32(1, s.deviceId, true);
        dv.setUint16(7, s.version, true);
        r[9] = 0; r[11] = 1;
        break;
      case 0x84: r[1] = s.profile; break;
      case 0x83: r[2] = s.rate; break;
      case 0x86: r[1] = s.debounce; break;
      case 0x89: r[1] = s.kbOption.system; r[2] = s.kbOption.fnIndex; r[3] = s.kbOption.fang; r[4] = s.kbOption.rts; r[5] = s.kbOption.wasd; break;
      case 0x91:
        dv.setUint16(8, s.sleep.bt, true); dv.setUint16(10, s.sleep.rf, true);
        dv.setUint16(12, s.sleep.deepBt, true); dv.setUint16(14, s.sleep.deepRf, true);
        break;
      case 0x87:
        r[1] = s.light.type; r[2] = s.light.speed; r[3] = s.light.bright; r[4] = s.light.option;
        r[5] = s.light.r; r[6] = s.light.g; r[7] = s.light.b;
        break;
      case 0x88:
        r[1] = s.sideLight.type; r[2] = s.sideLight.speed; r[3] = s.sideLight.bright; r[4] = s.sideLight.option;
        r[5] = s.sideLight.r; r[6] = s.sideLight.g; r[7] = s.sideLight.b;
        break;
      case 0x8a: { const p = d[3]; r.set(s.matrix.slice(p * 64, p * 64 + 64)); break; }
      case 0x90: { const p = d[4]; r.set(s.fnMatrix.slice(p * 64, p * 64 + 64)); break; }
      case 0x8c: { const p = d[3]; r.set(s.lightPic.slice(p * 64, p * 64 + 64)); break; }
      case 0x8b: {
        const slot = d[1], page = d[2];
        const buf = s.macros.get(slot) || new Uint8Array(256);
        r.set(buf.slice(page * 64, page * 64 + 64));
        break;
      }
      case 0x0a: // SET_KEYMATRIX
        if (d[2] !== 255 && d[5] === 1) { s.matrix.set(d.slice(8, 12), d[2] * 4); }
        else if (d[2] === 255) { s.matrix.set(d.slice(8, 8 + d[4]), d[3] * 56); }
        break;
      case 0x10: // SET_FN
        if (d[3] !== 255) { s.matrix.set(d.slice(8, 12), 0); }
        else { s.fnMatrix.set(d.slice(8, 8 + d[5]), d[4] * 56); }
        break;
      case 0x07:
        s.light = { type: d[1], speed: d[2], bright: d[3], option: d[4], r: d[5], g: d[6], b: d[7] };
        break;
      case 0x08:
        s.sideLight = { type: d[1], speed: d[2], bright: d[3], option: d[4], r: d[5], g: d[6], b: d[7] };
        break;
      case 0x0c: { const p = d[3]; s.lightPic.set(d.slice(8, 8 + d[4]), p * 56); break; }
      case 0x0b: {
        const slot = d[1], page = d[2];
        const buf = s.macros.get(slot) || new Uint8Array(256);
        buf.set(d.slice(8, 8 + d[3]), page * 56);
        s.macros.set(slot, buf);
        break;
      }
      case 0x04: s.profile = d[1]; break;
      case 0x03: s.rate = d[2]; break;
      case 0x06: s.debounce = d[1]; break;
      case 0x09: s.kbOption = { system: d[1], fnIndex: d[2], fang: d[3], rts: d[4], wasd: d[5] }; break;
      case 0x11:
        s.sleep = {
          bt: d[8] | (d[9] << 8), rf: d[10] | (d[11] << 8),
          deepBt: d[12] | (d[13] << 8), deepRf: d[14] | (d[15] << 8),
        };
        break;
      case 0x01: break;   // reset
      default: break;
    }
    this.resp = r;
  }
}

/**
 * 模拟 2.4G 接收器 (3151:5006): F7 状态轮询 / F6 选目标 / FC 读通知 / FE 长度,
 * 其余帧转发给被模拟的键盘。
 */
export class MockDongleDevice extends MockHidDevice {
  constructor(opts = {}) {
    super({ ...opts, productId: 0x5006, productName: '2.4G Receiver' });
    this.keyboard = opts.keyboard ?? new MockHidDevice();
    this.forwarded = [];
    this.dongleFrames = [];
    this.battery = 77;
  }
  _handle(d) {
    const r = new Uint8Array(64);
    this.dongleFrames.push(Uint8Array.from(d));
    switch (d[0]) {
      case 0xf7:
        // 厂商解码: b0=isCanRead b1=键盘电量 b2=鼠标电量 b3=键盘在线(0=在线) b4=鼠标在线
        //           b5=isCanSend b6=对象(1键盘/2鼠标/3两者) b8=isRFBoot
        // this.noCanRead = true 模拟真机上的情况：应答已就绪但 isCanRead 一直是 0
        r[0] = this.noCanRead ? 0 : 1;
        r[1] = this.battery; r[2] = 55; r[3] = 0; r[4] = 0; r[5] = 1; r[6] = 1; r[8] = 0;
        this.resp = r;
        return;
      // F6/FE 只是控制帧(选目标/长度), 不改变接收器里缓存的键盘应答。
      case 0xf6: return;
      case 0xfe: return;
      // FC = "通知读取": 接收器把最近收到的键盘应答放到读取缓冲里,
      // 随后主机的 GET_FEATURE 就会拿到它 (这正是厂商 readMsg 的顺序: F7轮询 -> FC -> GET)。
      case 0xfc:
        if (this.kbResp) this.resp = this.kbResp.slice();
        return;
      default:
        this.forwarded.push(Uint8Array.from(d));
        this.keyboard.frames.push(Uint8Array.from(d));
        this.keyboard.opened = true;
        this.keyboard._handle(d);
        this.kbResp = this.keyboard.resp.slice();
        this.resp = this.kbResp.slice();
        return;
    }
  }
}

/** 校验 Bit7 帧的校验和 */
export function checksumOk(frame, kind = 'bit7') {
  let sum = 0;
  const n = kind === 'bit7' ? 7 : 8;
  for (let i = 0; i < n; i++) sum += frame[i];
  return frame[n] === (0xff - (sum & 0xff));
}
