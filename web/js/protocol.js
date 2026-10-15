/*
 * protocol.js — DAGK K98 PRO V2 feature protocol
 * ------------------------------------------------------------------
 * Reverse engineered from the vendor Electron app:
 *   dist/js/index.*.js            (device classes _K / wB, filters)
 *   dist/js/b469c422.js           (keyboard FEA command set)
 *   dist/js/1dadcb6b.js           (upgrade / boot commands)
 *   dist/js/530511ba.js           (K98PRO model data: default matrix ...)
 *
 * Every command is a 64-byte HID feature report (report id 0):
 *
 *   byte 0        command
 *   byte 1..n     parameters
 *   byte 7 or 8   checksum  (Bit7 / Bit8 variants)
 *   byte 9..63    payload (paged commands) or zero padding
 *
 * checksum Bit7: b[7] = 0xFF - (sum(b[0..6]) & 0xFF)
 * checksum Bit8: b[8] = 0xFF - (sum(b[0..7]) & 0xFF)
 * (identical to the vendor app's ___encodeCmd / Wi())
 */

import { HidTransport, DongleRelay, sleep, TIMING } from './transport.js';

/* ------------------------------------------------------------------ */
/* command ids (FEA_CMD_* in the vendor bundle)                        */
/* ------------------------------------------------------------------ */
export const CMD = {
  SET_RESERT: 0x01,            GET_USB_VERSION: 0x8f,   // 143: id + version + caps
  SET_REPORT: 0x03,            GET_REPORT: 0x83,        // report rate
  SET_PROFILE: 0x04,           GET_PROFILE: 0x84,
  SET_DEBOUNCE: 0x06,          GET_DEBOUNCE: 0x86,
  SET_LEDPARAM: 0x07,          GET_LEDPARAM: 0x87,      // main light
  SET_SLEDPARAM: 0x08,         GET_SLEDPARAM: 0x88,     // side light
  SET_KBOPTION: 0x09,          GET_KBOPTION: 0x89,
  SET_KEYMATRIX: 0x0a,         GET_KEYMATRIX: 0x8a,     // key remap
  SET_MACRO: 0x0b,             GET_MACRO: 0x8b,
  SET_USERPIC: 0x0c,           GET_USERPIC: 0x8c,       // per-key RGB
  SET_FN: 0x10,                GET_FN: 0x90,
  SET_SLEEPTIME: 0x11,         GET_SLEEPTIME: 0x91,
  SET_USERGIF: 0x12,
  SET_AUTOOSEN: 0x17,          GET_AUTOOSEN: 0x97,
  GET_LEDONOFF: 0x85,                                   // power save indicator
  GET_RF_VERSION: 0x80,
  SET_FLASH_ERASE: 0xac,
  GET_SKU: 0xd0,               SET_SKU: 0x50,
};

/** checksum selector — ki {Bit7:0, Bit8:1, None:2} */
export const CK = { Bit7: 0, Bit8: 1, None: 2 };

export const sum = (arr) => arr.reduce((a, b) => a + b, 0);

/** Build the 9-byte wire frame exactly like the vendor ___encodeCmd(). */
export function encodeCmd(cmd, checksum = CK.Bit7) {
  const src = cmd instanceof Uint8Array ? cmd : new Uint8Array(cmd);
  const r = new Uint8Array(src.length > 9 ? src.length : 9);
  r.set(src);
  if (checksum === CK.Bit7) r[7] = 0xff - (sum(r.slice(0, 7)) & 0xff);
  else if (checksum === CK.Bit8) r[8] = 0xff - (sum(r.slice(0, 8)) & 0xff);
  return r;
}

export function hex(bytes, sep = ' ') {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(sep);
}

/** K98PRO default key matrix (128 positions x 4 bytes), from 530511ba.js. */
export const DEFAULT_MATRIX = new Uint8Array([
  0,0,41,0, 0,0,53,0, 0,0,43,0, 0,0,57,0, 0,0,225,0, 0,0,224,0, 0,0,58,0, 0,0,30,0,
  0,0,20,0, 0,0,4,0, 0,0,0,0, 0,0,227,0, 0,0,59,0, 0,0,31,0, 0,0,26,0, 0,0,22,0,
  0,0,29,0, 0,0,226,0, 0,0,60,0, 0,0,32,0, 0,0,8,0, 0,0,7,0, 0,0,27,0, 0,0,0,0,
  0,0,61,0, 0,0,33,0, 0,0,21,0, 0,0,9,0, 0,0,6,0, 0,0,0,0, 0,0,62,0, 0,0,34,0,
  0,0,23,0, 0,0,10,0, 0,0,25,0, 0,0,0,0, 0,0,63,0, 0,0,35,0, 0,0,28,0, 0,0,11,0,
  0,0,5,0, 0,0,44,0, 0,0,64,0, 0,0,36,0, 0,0,24,0, 0,0,13,0, 0,0,17,0, 0,0,0,0,
  0,0,65,0, 0,0,37,0, 0,0,12,0, 0,0,14,0, 0,0,16,0, 0,0,0,0, 0,0,66,0, 0,0,38,0,
  0,0,18,0, 0,0,15,0, 0,0,54,0, 0,0,230,0, 0,0,67,0, 0,0,39,0, 0,0,19,0, 0,0,51,0,
  0,0,55,0, 10,1,0,0, 0,0,68,0, 0,0,45,0, 0,0,47,0, 0,0,52,0, 0,0,56,0, 0,0,0,0,
  0,0,69,0, 0,0,46,0, 0,0,48,0, 0,0,50,0, 0,0,229,0, 0,0,80,0, 0,0,76,0, 0,0,42,0,
  0,0,49,0, 0,0,40,0, 0,0,82,0, 0,0,81,0, 0,0,74,0, 0,0,83,0, 0,0,95,0, 0,0,92,0,
  0,0,89,0, 0,0,79,0, 0,0,75,0, 0,0,84,0, 0,0,96,0, 0,0,93,0, 0,0,90,0, 0,0,98,0,
  0,0,78,0, 0,0,85,0, 0,0,97,0, 0,0,94,0, 0,0,91,0, 0,0,99,0, 0,0,72,0, 0,0,86,0,
  0,0,87,0, 0,0,0,0, 0,0,0,0, 0,0,88,0, 3,0,233,0, 3,0,234,0, 0,0,0,0, 0,0,0,0,
  0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
  0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
]);

export const DEFAULT_FN_MATRIX = new Uint8Array([
  10,2,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 3,0,112,0, 14,0,0,0,
  0,0,0,0, 10,5,0,0, 0,0,0,0, 10,3,0,0, 3,0,111,0, 14,0,1,0, 0,0,0,0, 10,5,1,0,
  8,0,4,0, 0,0,0,0, 0,0,227,43, 14,0,2,0, 0,0,0,0, 0,0,0,0, 8,0,4,1, 0,0,0,0,
  0,0,227,8, 14,0,5,0, 0,0,0,0, 0,0,0,0, 8,0,4,2, 0,0,0,0, 3,0,138,1, 14,0,6,0,
  0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 3,0,35,2, 0,0,0,0, 0,0,0,0, 0,0,0,0,
  0,0,0,0, 10,8,0,0, 3,0,182,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
  3,0,205,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 3,0,181,0, 0,0,0,0,
  0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 3,0,226,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
  0,0,0,0, 0,0,0,0, 3,0,234,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
  3,0,233,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 13,3,1,0, 0,0,0,0, 10,9,0,0,
  0,0,0,0, 0,0,0,0, 13,2,1,0, 13,2,2,0, 13,5,1,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
  0,0,0,0, 13,3,2,0, 13,5,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
  0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 13,1,0,0, 0,0,0,0,
  0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
  0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
  0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
]);

export const DEFAULT_FN_MAC_MATRIX = new Uint8Array([
  10,2,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 3,0,112,0, 14,0,0,0,
  0,0,0,0, 10,5,0,0, 0,0,0,0, 0,0,0,0, 3,0,111,0, 14,0,1,0, 0,0,0,0, 10,5,1,0,
  8,0,4,0, 0,0,0,0, 0,231,225,33, 14,0,2,0, 0,0,0,0, 0,0,0,0, 8,0,4,1, 0,0,0,0,
  3,0,159,2, 14,0,5,0, 0,0,0,0, 0,0,0,0, 8,0,4,2, 0,0,0,0, 3,0,226,0, 14,0,6,0,
  0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 3,0,234,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
  0,0,0,0, 10,8,0,0, 3,0,233,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
  3,0,182,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 3,0,205,0, 0,0,0,0,
  0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 3,0,181,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
  0,0,0,0, 0,0,0,0, 3,0,33,2, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
  3,0,35,2, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 13,3,1,0, 0,0,0,0, 10,9,0,0,
  0,0,0,0, 0,0,0,0, 13,2,1,0, 13,2,2,0, 13,5,1,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
  0,0,0,0, 13,3,2,0, 13,5,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
  0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 13,1,0,0, 0,0,0,0,
  0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
  0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
  0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
]);


/** Main light effects (LightList in b469c422.js). */
export const LIGHT_LIST = {
  0: 'LightOff', 1: 'LightAlwaysOn', 2: 'LightBreath', 3: 'LightNeon', 4: 'LightWave',
  5: 'LightRipple', 6: 'LightRaindrop', 7: 'LightSnake', 8: 'LightPressAction',
  9: 'LightConverage', 10: 'LightSineWave', 11: 'LightKaleidoscope', 12: 'LightLineWave',
  13: 'LightUserPicture', 14: 'LightLaser', 15: 'LightCircleWave', 16: 'LightDazzing',
  17: 'LightRainDown', 18: 'LightMeteor', 19: 'LightPressActionOff', 20: 'LightMusicFollow3',
  21: 'LightScreenColor', 22: 'LightMusicFollow2', 23: 'LightTrain', 24: 'LightFireWorks',
  25: 'LightUserColor',
};

/** Side light effects (K98PRO overrides SIDELIGHTLIST). */
export const SIDE_LIGHT_LIST = {
  0: 'LightOff', 1: 'LightAlwaysOn', 2: 'LightBreath', 3: 'LightNeon', 4: 'LightWave',
  5: 'LightSnake', 6: 'LightMusicFollow2',
};

/** K98PRO side-light map (530511ba.js). */
export const SIDELIGHT_ENUM = { LightOff: 0, LightAlwaysOn: 1, LightBreath: 2, LightNeon: 3, LightWave: 4, LightSnake: 5, LightMusicFollow3: 20, LightScreenColor: 21, LightMusicFollow2: 22 };

export const MAXSPEED = 4;
export const DAZZLE = 8;
export const NORMAL = 7;
/** K98PRO COMMONCOLOR (530511ba.js). */
export const COMMONCOLOR = { 0: 0xffffff, 1: 0xff0000, 2: 0xff8000, 3: 0xffff00, 4: 0x00ff00, 5: 0x00ffff, 6: 0x0000ff, 7: 0x8b00ff };
export const RGB_WHITE_SPECIAL = 16449530; // stored instead of 0xFFFFFF

export const rgbToNum = (r, g, b) => (r << 16) | (g << 8) | b;
export const numToRgb = (n) => ({ r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff });
export const reverseEnum = (obj, value) => Object.keys(obj).find((k) => obj[k] === value);

/* ------------------------------------------------------------------ */
/* Device session                                                      */
/* ------------------------------------------------------------------ */
export const MODE = { USB: 'usb', RF24G: '24g' };

export class K98Device {
  /**
   * @param {HidTransport} hid  transport opened on the vendor collection
   * @param {'usb'|'24g'} mode
   */
  constructor(hid, mode = MODE.USB) {
    this.hid = hid;
    this.mode = mode;
    this.relay = mode === MODE.RF24G ? new DongleRelay(hid) : null;
    this.target = 'keyboard';
    this.deviceId = undefined;
    this.usbVersion = undefined;
    this.rfVersion = undefined;
    this.supportsLightSync = false;
    this.log = () => {};
    this.lock = Promise.resolve();
  }

  get SEND_TIME() { return TIMING.SEND_TIME; }
  get READ_TIME() { return TIMING.READ_TIME; }

  /** Serialize all traffic (the vendor app does the same with its isUsing set). */
  _queue(fn) {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => {});
    return run;
  }

  /** Send one frame (no read). */
  async sendMsg(cmd, checksum = CK.Bit7, delay = this.SEND_TIME) {
    const frame = encodeCmd(cmd, checksum);
    if (this.mode === MODE.RF24G) {
      const wasPolling = this.relay.isPolling;
      this.relay.stopPolling();
      // 只在"本来就开着轮询"时才恢复轮询。
      // 早期版本无条件 startPolling(), 等于每次读写都顺手启动一个 2 秒后台轮询 ——
      // 对真实接收器就是持续压力, 表现成"连上一会儿就断"。
      try {
        return await this.relay.send(frame, this.target, delay || TIMING.INTERVAL_24G);
      } finally {
        if (wasPolling) this.relay.startPolling(this.onStatus);
      }
    }
    if (delay > 0) await sleep(delay);
    await this.hid.sendFeature(frame);
    return true;
  }

  /** Read the 64-byte response. */
  async readMsg(delay = this.READ_TIME) {
    if (this.mode === MODE.RF24G) {
      const wasPolling = this.relay.isPolling;
      this.relay.stopPolling();
      try {
        return await this.relay.read(this.target, delay || TIMING.INTERVAL_24G);
      } finally {
        if (wasPolling) this.relay.startPolling(this.onStatus);
      }
    }
    if (delay > 0) await sleep(delay);
    return await this.hid.getFeature();
  }

  /** send + read (the vendor commonMsg). */
  async commonMsg(cmd, checksum = CK.Bit7, sendDelay = this.SEND_TIME, readDelay = this.READ_TIME) {
    return this._queue(async () => {
      // 2.4G 走"温和事务": 每次只 1 次预检 + 1 次等待, 失败立刻抛出, 不再补枪。
      if (this.mode === MODE.RF24G) {
        const frame = encodeCmd(cmd, checksum);
        const wasPolling = this.relay.isPolling;
        this.relay.stopPolling();
        try {
          return await this.relay.transact(frame, this.target);
        } finally {
          if (wasPolling) this.relay.startPolling(this.onStatus);
        }
      }
      await this.sendMsg(cmd, checksum, sendDelay);
      return await this.readMsg(readDelay);
    });
  }

  /** SET commands in the vendor app end with a 100 ms "vendor sleep". */
  async vendorSleep(ms = 100) { await sleep(ms); }

  async _set(cmd, checksum = CK.Bit7) {
    return this._queue(async () => {
      const ok = await this.sendMsg(cmd, checksum);
      await this.vendorSleep();
      return !!ok;
    });
  }

  /* ---------------- identification ---------------- */

  /**
   * 0x8F — device id (u32 LE @1), usb version (u16 LE @7), flags @9/@11.
   * 2.4G 下第一次常常读不到(键盘可能刚唤醒), 所以按原厂 ___whoAmI 的做法重试 3 次。
   */
  async fetchDeviceInfo(retries = 3, gap = 400) {
    let r;
    for (let i = 0; i < retries; i++) {
      r = await this.commonMsg(new Uint8Array([CMD.GET_USB_VERSION]), CK.Bit7);
      if (r && r[0] === CMD.GET_USB_VERSION) break;
      if (i < retries - 1) await sleep(gap);
    }
    if (!r || r[0] !== CMD.GET_USB_VERSION) return undefined;
    const dv = new DataView(r.buffer, r.byteOffset, r.byteLength);
    this.deviceId = dv.getUint32(1, true);
    this.usbVersion = dv.getUint16(7, true);
    this.isBoot = r[9] === 1;
    this.supportsLightSync = r[11] === 1;
    return { deviceId: this.deviceId, usbVersion: this.usbVersion, isBoot: this.isBoot, lightSync: this.supportsLightSync };
  }

  /** 0xAD / 0xAE — OLED / 矩阵灯 版本（原厂启动时也会读，本机没有 OLED 时返回 0） */
  async getOledVersion() {
    const r = await this.commonMsg(new Uint8Array([0xad]), CK.Bit7);
    return r ? (r[1] | (r[2] << 8)) : undefined;
  }

  async getMLedVersion() {
    const r = await this.commonMsg(new Uint8Array([0xae]), CK.Bit7);
    return r ? (r[1] | (r[2] << 8)) : undefined;
  }

  /** 0x97 — 自动识别系统开关（原厂启动时读一次） */
  async getAutoOs() {
    const r = await this.commonMsg(new Uint8Array([0x97]), CK.Bit7);
    return r ? r[1] : undefined;
  }

  /** 0x80 — RF (2.4G) firmware version. */
  async getRfVersion() {
    const r = await this.commonMsg(new Uint8Array([CMD.GET_RF_VERSION]), CK.Bit7);
    if (!r) return undefined;
    const v = (r[2] << 8) | r[1];
    this.rfVersion = v || undefined;
    return this.rfVersion;
  }

  /** receiver-id (0xF1) used to look the wireless device up in the app database */
  async getDongleId() {
    const r = await this.commonMsg(new Uint8Array([0xf1]), CK.Bit7);
    if (!r || r[0] !== 0xf1) return undefined;
    return new DataView(r.buffer, r.byteOffset, r.byteLength).getUint16(1, true);
  }

  /* ---------------- settings ---------------- */

  async reset() { return this._set(new Uint8Array([CMD.SET_RESERT])); }

  async getCurrentProfile() {
    const r = await this.commonMsg(new Uint8Array([CMD.GET_PROFILE]), CK.Bit7);
    return r ? r[1] : undefined;
  }
  async setCurrentProfile(n) { return this._set(new Uint8Array([CMD.SET_PROFILE, n])); }

  async getDeBounce() {
    const r = await this.commonMsg(new Uint8Array([CMD.GET_DEBOUNCE]), CK.Bit7);
    return r ? r[1] : undefined;
  }
  async setDeBounce(v) { return this._set(new Uint8Array([CMD.SET_DEBOUNCE, v])); }

  static RATE_TO_CODE = { 8000: 0, 4000: 1, 2000: 2, 1000: 3, 500: 4, 250: 5, 125: 6 };
  async getReportRate() {
    const r = await this.commonMsg(new Uint8Array([CMD.GET_REPORT]), CK.Bit7);
    if (!r) return undefined;
    return Object.keys(K98Device.RATE_TO_CODE).map(Number).find((hz) => K98Device.RATE_TO_CODE[hz] === r[2]);
  }
  async setReportRate(hz) {
    const e = K98Device.RATE_TO_CODE[hz];
    if (e === undefined) return false;
    const f = new Uint8Array(8); f[0] = CMD.SET_REPORT; f[2] = e;
    return this._set(f);
  }

  async getSleepTime() {
    const r = await this.commonMsg(new Uint8Array([CMD.GET_SLEEPTIME]), CK.Bit7);
    const def = { time_bt: 120, time_24: 120, deepTime_bt: 1680, deepTime_24: 1680 };
    if (!r) return def;
    return {
      time_bt: (r[9] << 8) | r[8],
      time_24: (r[11] << 8) | r[10],
      deepTime_bt: (r[13] << 8) | r[12],
      deepTime_24: (r[15] << 8) | r[14],
    };
  }
  async setSleepTime(t) {
    const f = new Uint8Array(64);
    f[0] = CMD.SET_SLEEPTIME;
    f[8] = t.time_bt & 0xff; f[9] = (t.time_bt >> 8) & 0xff;
    f[10] = t.time_24 & 0xff; f[11] = (t.time_24 >> 8) & 0xff;
    f[12] = t.deepTime_bt & 0xff; f[13] = (t.deepTime_bt >> 8) & 0xff;
    f[14] = t.deepTime_24 & 0xff; f[15] = (t.deepTime_24 >> 8) & 0xff;
    return this._set(f);
  }

  async getKbOption() {
    const r = await this.commonMsg(new Uint8Array([CMD.GET_KBOPTION]), CK.Bit7);
    if (!r) return undefined;
    const system = ['win', 'mac', 'ios', 'android'][r[1]] || 'win';
    return {
      防误触开关: !!r[3],
      RTStab: r[4] > 5 ? 0 : r[4] * 25,
      WASDSwap: r[5] === 1,
      system,
      fnIndex: r[2],
    };
  }
  async setKbOption(o) {
    const f = new Uint8Array(8);
    f[0] = CMD.SET_KBOPTION;
    f[1] = { win: 0, mac: 1, ios: 2, android: 3 }[o.system] ?? 0;
    f[2] = o.fnIndex ?? 0;
    f[3] = Number(!!o.防误触开关);
    f[4] = Math.round((o.RTStab ?? 0) / 25);
    f[5] = o.WASDSwap ? 1 : 0;
    return this._set(f);
  }

  /* ---------------- lighting ---------------- */

  async getLightSetting() {
    const r = await this.commonMsg(new Uint8Array([CMD.GET_LEDPARAM]), CK.Bit7);
    if (!r) return undefined;
    const type = LIGHT_LIST[r[1]];
    if (type === undefined) return undefined;
    const option = r[4] >> 4;
    const low = r[4] & 15;
    let rgb = rgbToNum(r[5], r[6], r[7]);
    if (low !== DAZZLE && low !== NORMAL && COMMONCOLOR[low] !== undefined) rgb = COMMONCOLOR[low];
    if (rgb === RGB_WHITE_SPECIAL) rgb = 0xffffff;
    return {
      type, option, bright: r[3], speed: MAXSPEED - r[2], rgb,
      dazzle: type === 'LightMusicFollow3' || type === 'LightMusicFollow2' ? low === 0 : low === DAZZLE,
    };
  }

  async setLightSetting(t) {
    const f = new Uint8Array(64);
    f[0] = CMD.SET_LEDPARAM;
    f[1] = reverseEnum(LIGHT_LIST, t.type) ?? 0;
    const s = t.dazzle ? DAZZLE : NORMAL;
    const r = t.dazzle ? 0 : 4;
    let a = (t.option << 4) | s;
    if (t.type === 'LightUserPicture') a = t.option << 4;
    if (t.type === 'LightMusicFollow3' || t.type === 'LightMusicFollow2') a = (t.option << 4) | r;
    if (t.type === 'LightScreenColor') a = 0;
    f[2] = MAXSPEED - t.speed;
    f[3] = t.bright;
    f[4] = a;
    if (t.rgb !== undefined) {
      const c = numToRgb(t.rgb === 0xffffff ? RGB_WHITE_SPECIAL : t.rgb);
      f[5] = c.r; f[6] = c.g; f[7] = c.b;
    }
    if (t.type === 'LightUserPicture') { f[5] = 0; f[6] = 200; f[7] = 200; }
    return this._set(f, CK.Bit8);
  }

  async getSideLightSetting() {
    const r = await this.commonMsg(new Uint8Array([CMD.GET_SLEDPARAM]), CK.Bit7);
    if (!r) return undefined;
    const map = { 0: 'LightOff', 1: 'LightAlwaysOn', 2: 'LightBreath', 3: 'LightNeon', 4: 'LightWave', 5: 'LightSnake', 6: 'LightMusicFollow2' };
    const type = map[r[1]];
    if (type === undefined) return undefined;
    const low = r[4] & 15;
    let rgb = rgbToNum(r[5], r[6], r[7]);
    if (low !== DAZZLE && low !== NORMAL && COMMONCOLOR[low] !== undefined) rgb = COMMONCOLOR[low];
    if (rgb === RGB_WHITE_SPECIAL) rgb = 0xffffff;
    return { type, option: r[4] >> 4, bright: r[3], speed: r[2], rgb, dazzle: low === DAZZLE };
  }

  async setSideLightSetting(t) {
    const f = new Uint8Array(64);
    f[0] = CMD.SET_SLEDPARAM;
    let n = 0;
    const s = t.dazzle ? DAZZLE : NORMAL;
    const r = t.dazzle ? 0 : 4;
    let a = (t.option << 4) | s;
    switch (t.type) {
      case 'LightOff': n = 0; break;
      case 'LightAlwaysOn': n = 1; break;
      case 'LightBreath': n = 2; break;
      case 'LightNeon': n = 3; a = 8; break;
      case 'LightWave': n = 4; break;
      case 'LightSnake': n = 5; break;
      case 'LightMusicFollow2': n = 6; a = (t.option << 4) | r; break;
      default: n = 0;
    }
    f[1] = n; f[2] = t.speed; f[3] = t.bright; f[4] = a;
    if (t.rgb !== undefined) {
      const c = numToRgb(t.rgb === 0xffffff ? RGB_WHITE_SPECIAL : t.rgb);
      f[5] = c.r; f[6] = c.g; f[7] = c.b;
    }
    return this._set(f, CK.Bit8);
  }

  /* ---------------- key matrix ---------------- */

  /**
   * 0x8A — read one layer. 8 pages x 64 bytes = 512 bytes = 128 positions x 4.
   * Vendor: _getKeyMatrix(layer, fnType) -> n[1]=layer n[2]=255 n[4]=fnType? n[3]=page
   */
  async readKeyMatrixRaw(layer = 0, fnType = 0, opts = {}) {
    const f = new Uint8Array(64);
    f[0] = CMD.GET_KEYMATRIX;
    f[1] = layer;
    f[2] = 255;
    f[4] = fnType ?? 0;
    return this._readPaged(f, 3, (page) => { f[3] = page; }, opts);
  }

  /** 0x10 — read one Fn layer (win/mac/ios/android). */
  async readFnKeyMatrixRaw(fnSystem = 'win', layer = 0, opts = {}) {
    const f = new Uint8Array(64);
    f[0] = CMD.GET_FN;
    f[1] = { win: 0, mac: 1, android: 2, ios: 3 }[fnSystem] ?? 0;
    f[2] = layer;
    f[3] = 255;
    return this._readPaged(f, 4, (page) => { f[4] = page; }, opts);
  }

  /**
   * 通用分页读取。
   *
   * 关键点（真机踩坑）：
   *   * **一页一页来**，页与页之间插一段间隔，绝不连续猛打 —— 8 页连发会把接收器拖死，
   *     表现就是"点读取设备配置，键盘断联"。
   *   * **任何一页失败立刻中止**，把已读到的页和失败页号报给上层，
   *     绝不"继续把剩下 7 页打完"（那正是把设备彻底拖死的元凶）。
   *   * 支持只读单页（调试用）。
   *
   * @param {Uint8Array} frame 64 字节命令帧（页号由 setPage 写入）
   * @param {number} pageIndex 帧里放页号的字节下标
   * @param {(page:number)=>void} setPage
   * @param {{pages?:number, only?:number, gapMs?:number, onProgress?:(done:number,total:number)=>void}} opts
   */
  async _readPaged(frame, pageIndex, setPage, opts = {}) {
    const total = opts.pageCount ?? 8;
    const gapMs = opts.gapMs ?? (this.mode === MODE.RF24G ? 120 : 0);
    const pages = opts.only !== undefined ? [opts.only] : Array.from({ length: total }, (_, i) => i);
    const out = new Uint8Array(total * 64);
    const got = [];
    for (const page of pages) {
      setPage(page);
      const r = await this.commonMsg(frame, CK.Bit7);   // 失败会抛出 -> 整个读取中止
      if (r) {
        out.set(r.subarray(0, 64), page * 64);
        got.push(page);
      }
      if (opts.onProgress) opts.onProgress(got.length, pages.length);
      if (gapMs > 0 && page !== pages[pages.length - 1]) await sleep(gapMs);
    }
    out.pagesRead = got;
    return out;
  }

  /** Single key write (vendor setKeyConfigSimple). cfg = 4 bytes. */
  async setKeyConfigSimple(matrixIndex, cfg4, layer = 0, fnType = 0) {
    const f = new Uint8Array(64);
    f[0] = CMD.SET_KEYMATRIX;
    f[1] = layer;
    f[2] = matrixIndex;
    f[5] = 1;
    f[6] = fnType ?? 0;
    f[8] = cfg4[0]; f[9] = cfg4[1]; f[10] = cfg4[2]; f[11] = cfg4[3];
    return this._set(f);
  }

  /** Single Fn key write (vendor setFnKeyConfigSimple). */
  async setFnKeyConfigSimple(matrixIndex, cfg4, layer = 0, fnSystem = 'win') {
    const f = new Uint8Array(64);
    f[0] = CMD.SET_FN;
    f[1] = { win: 0, mac: 1, android: 2, ios: 3 }[fnSystem] ?? 0;
    f[2] = layer;
    f[3] = matrixIndex;
    f[8] = cfg4[0]; f[9] = cfg4[1]; f[10] = cfg4[2]; f[11] = cfg4[3];
    return this._set(f);
  }

  /** Whole-layer write (vendor _setKeyConfig): 8-byte header + 56 byte payload. */
  async writeKeyMatrixRaw(data512, layer = 0, fnType = 0) {
    const f = new Uint8Array(8);   // 厂商 _setKeyConfig 用的是 8 字节帧头, 负载 56 字节 */

    f[0] = CMD.SET_KEYMATRIX;
    f[1] = layer;
    f[2] = 255;
    f[6] = fnType ?? 0;
    const chunks = Math.ceil(data512.length / 56);
    for (let i = 0; i < chunks; i++) {
      let part = Array.from(data512.slice(i * 56, i * 56 + 56));
      f[3] = i;
      f[4] = part.length;
      f[5] = i === chunks - 1 ? 1 : 0;
      while (part.length < 56) part.push(0);
      await this._queue(async () => { await this.sendMsg(new Uint8Array([...f, ...part]), CK.Bit7); });
    }
    await this.vendorSleep();
    return true;
  }

  /** Whole Fn layer write (vendor _setFnKeyConfig): 10 chunks of 56. */
  async writeFnKeyMatrixRaw(data512, layer = 0, fnSystem = 'win') {
    const f = new Uint8Array(8);
    f[0] = CMD.SET_FN;
    f[1] = { win: 0, mac: 1, android: 2, ios: 3 }[fnSystem] ?? 0;
    f[2] = layer;
    f[3] = 255;
    for (let i = 0; i < 10; i++) {
      f[4] = i;
      f[5] = i === 9 ? 0 : 56;
      f[6] = i === 9 ? 1 : 0;
      let part = Array.from(data512.slice(i * 56, i * 56 + 56));
      while (part.length < 56) part.push(0);
      await this._queue(async () => { await this.sendMsg(new Uint8Array([...f, ...part]), CK.Bit7); });
    }
    await this.vendorSleep();
    return true;
  }

  /* ---------------- per-key RGB ---------------- */

  /** 0x8C — 6 pages x 64 = 384 bytes = 128 positions x RGB. */
  async getLightPicRaw(index = 0, opts = {}) {
    const f = new Uint8Array(64);
    f[0] = CMD.GET_USERPIC;
    f[1] = index ?? 0;
    f[2] = 255;
    const data = await this._readPaged(f, 3, (page) => { f[3] = page; },
      { ...opts, pageCount: 6, pages: undefined });
    return new Uint8Array(data.buffer, data.byteOffset, 6 * 64);
  }

  /** 0x0C — 7 chunks of 56 payload bytes (8-byte header). */
  async setLightPicRaw(rgb384, index = 0) {
    const f = new Uint8Array(8);
    f[0] = CMD.SET_USERPIC;
    f[1] = index ?? 0;
    f[2] = 255;
    for (let i = 0; i < 7; i++) {
      f[3] = i;
      f[4] = i === 6 ? 378 - 56 * 6 : 56;
      f[5] = i === 6 ? 1 : 0;
      let part = Array.from(rgb384.slice(i * 56, i * 56 + 56));
      while (part.length < 56) part.push(0);
      await this._queue(async () => { await this.sendMsg(new Uint8Array([...f, ...part]), CK.Bit7); });
    }
    await this.vendorSleep();
    return true;
  }

  /* ---------------- macros ---------------- */

  /** 0x8B — 4 pages x 64 bytes. */
  /**
   * 0x8B — 宏读取。一页一页来，页间插间隔；遇到结尾标记就提前收工，
   * 不把剩下几页白打一遍（对 2.4G 尤其重要）。
   */
  async getMacroRaw(index, opts = {}) {
    const f = new Uint8Array(64);
    f[0] = CMD.GET_MACRO;
    f[1] = index;
    const gapMs = opts.gapMs ?? (this.mode === MODE.RF24G ? 120 : 0);
    const out = [];
    for (let i = 0; i < 4; i++) {
      f[2] = i;
      const r = await this.commonMsg(f, CK.Bit7);
      if (!r) return undefined;
      out.push(...r);
      if (r.some((b, idx) => idx <= r.length - 4 && b === 0 && r[idx + 1] === 0 && r[idx + 2] === 0 && r[idx + 3] === 0)) break;
      if (gapMs > 0 && i < 3) await sleep(gapMs);
    }
    return new Uint8Array(out);
  }

  /** 0x0B — macro payload in 5 chunks of 56 (vendor _setMacro). */
  async setMacroRaw(index, data256) {
    const f = new Uint8Array(8);
    f[0] = CMD.SET_MACRO;
    f[1] = index;
    const arr = Array.from(data256);
    let used = 0;
    for (let s = 0; s < 5; s++) {
      if (arr.slice(s * 56, 56 + s * 56).some((b) => b !== 0)) used++;
    }
    for (let s = 0; s < used; s++) {
      f[2] = s;
      f[3] = 56;
      f[4] = s === used - 1 ? 1 : 0;
      let part = arr.slice(s * 56, 56 + s * 56);
      while (part.length < 56) part.push(0);
      await this._queue(async () => { await this.sendMsg(new Uint8Array([...f, ...part]), CK.Bit7); });
    }
    await this.vendorSleep();
    return true;
  }

  onStatus = undefined;

  async close() {
    if (this.relay) this.relay.stopPolling();
    try { await this.hid.close(); } catch (e) { /* ignore */ }
  }
}
