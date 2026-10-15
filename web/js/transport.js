/*
 * transport.js — DAGK K98 PRO V2 Web Driver
 * ------------------------------------------------------------------
 * HID transport layer, reverse-engineered 1:1 from the original
 * "DAGK Driver" (Electron) renderer bundle.
 *
 * Facts established from the vendor binary (see docs/):
 *   - The keyboard/receiver expose a vendor HID collection:
 *         usagePage = 0xFFFF, usage = 0x0002, interface #2
 *     and the configuration channel is a 64-byte HID FEATURE report
 *     with reportId = 0 (SET_FEATURE = write, GET_FEATURE = read).
 *   - The vendor app uses WebHID for this on every platform
 *     (class "pB" in dist/js/index.*.js); the native hidapi helper
 *     (iot_manager/common_hid_rs.exe) is only an exclusive-access
 *     fallback. There is NO serial/CDC code path anywhere in the app.
 *   - 2.4G receiver (0x3151:0x5006) relays the very same 64-byte
 *     feature reports to the paired keyboard after a small handshake
 *     (0xF7 status poll / 0xF6 target select / 0xFC read notice).
 */

export const VID = 0x3151;
export const PID_WIRED = 0x5002;   // K98PRO wired  (20482)
export const PID_DONGLE = 0x5006;  // 2.4G receiver (20486)

export const USAGE_PAGE_VENDOR = 0xffff;
export const USAGE_VENDOR = 0x0002;

export const REPORT_ID = 0;        // feature report id used by the vendor app
export const REPORT_SIZE = 64;     // bytes

/** Filters handed to navigator.hid.requestDevice(). */
export const HID_FILTERS = [
  { vendorId: VID, productId: PID_WIRED, usagePage: USAGE_PAGE_VENDOR, usage: USAGE_VENDOR },
  { vendorId: VID, productId: PID_DONGLE, usagePage: USAGE_PAGE_VENDOR, usage: USAGE_VENDOR },
  { vendorId: VID, productId: PID_WIRED },
  { vendorId: VID, productId: PID_DONGLE },
];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Vendor app timings (classes _K / wB). */
export const TIMING = {
  SEND_TIME: 10,        // delay before a feature write (usb)
  READ_TIME: 10,        // delay before a feature read (usb)
  BT_SEND_TIME: 100,
  BT_READ_TIME: 200,
  INTERVAL_24G: 10,     // delay around dongle traffic (原厂 INTERVAL_24G_TIME)
  POLL_READ_DELAY: 0,   // F7 轮询时 SET->GET 的额外等待(0 = 交给 WebHID 往返时延)
  POLL_INTERVAL: 5000,  // 手动开启后台轮询时的间隔(默认不开)
  STATUS_POLL: 2000,    // 兼容旧名
  WRITE_TIMEOUT: 1500,  // 单次 SET_FEATURE 超时 (原厂在 2.4G 下最多重试 5×100ms)
  READ_TIMEOUT: 1500,   // 单次 GET_FEATURE 超时
};

/* ------------------------------------------------------------------ */
/* Raw WebHID transport (one HID interface = one 64-byte feature pipe) */
/* ------------------------------------------------------------------ */
export class HidTransport {
  /** @param {HIDDevice} device */
  constructor(device) {
    this.device = device;
    this.log = () => {};
    this._inputHandler = null;
  }

  static get supported() {
    return typeof navigator !== 'undefined' && !!navigator.hid;
  }

  /** Ask the user to pick a device. Returns HidTransport[] (one per collection). */
  static async request() {
    if (!HidTransport.supported) throw new Error('此浏览器不支持 WebHID（请使用 Chrome/Edge 89+）');
    const devices = await navigator.hid.requestDevice({ filters: HID_FILTERS });
    return devices.map((d) => new HidTransport(d));
  }

  /** Devices the user already granted access to. */
  static async granted() {
    if (!HidTransport.supported) return [];
    const devices = await navigator.hid.getDevices();
    return devices
      .filter((d) => d.vendorId === VID && (d.productId === PID_WIRED || d.productId === PID_DONGLE))
      .map((d) => new HidTransport(d));
  }

  get info() {
    const d = this.device;
    return {
      vendorId: d.vendorId,
      productId: d.productId,
      productName: d.productName,
      collections: d.collections,
      opened: d.opened,
    };
  }

  isVendorCollection() {
    return (this.device.collections || []).some(
      (c) => c.usagePage === USAGE_PAGE_VENDOR && c.usage === USAGE_VENDOR
    );
  }

  async open() {
    if (!this.device.opened) await this.device.open();
    return this;
  }

  async close() {
    this.offInput();
    if (this.device.opened) await this.device.close();
  }

  /**
   * 给 WebHID 调用加超时。
   * 某些情况下（例如命令没走 0xFC 握手就直发）设备会把控制端点 stall 住，
   * 此时 receiveFeatureReport 会永远不 resolve —— 没有超时的话整个页面就卡死了。
   */
  async _withTimeout(promise, ms, what) {
    let timer;
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error(`${what} 超时 (${ms}ms)：设备没有响应，可能需要重新插拔`)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Write one 64-byte feature report (report id 0). */
  async sendFeature(data, timeout = TIMING.WRITE_TIMEOUT) {
    const buf = new Uint8Array(REPORT_SIZE);
    buf.set(data.slice(0, REPORT_SIZE));
    this.log('OUT', buf);
    await this._withTimeout(this.device.sendFeatureReport(REPORT_ID, buf), timeout, '发送');
  }

  /** Read one 64-byte feature report (report id 0). */
  async getFeature(timeout = TIMING.READ_TIMEOUT) {
    const view = await this._withTimeout(this.device.receiveFeatureReport(REPORT_ID), timeout, '读取');
    const out = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    const copy = new Uint8Array(REPORT_SIZE);
    copy.set(out.slice(0, REPORT_SIZE));
    this.log('IN ', copy);
    return copy;
  }

  onInput(cb) {
    this.offInput();
    this._inputHandler = (ev) => {
      const data = new Uint8Array(ev.data.buffer, ev.data.byteOffset, ev.data.byteLength);
      cb(ev.reportId, data);
    };
    this.device.addEventListener('inputreport', this._inputHandler);
  }

  offInput() {
    if (this._inputHandler) {
      this.device.removeEventListener('inputreport', this._inputHandler);
      this._inputHandler = null;
    }
  }
}

/* ------------------------------------------------------------------ */
/* 2.4G receiver (dongle) relay                                        */
/* ------------------------------------------------------------------ */
export const DONGLE_CMD = {
  STATUS: 0xf7,        // poll link status (battery / online / can read / can send)
  SELECT: 0xf6,        // select relay target
  NOTICE_READ: 0xfc,   // "the response is ready, read it"
  SEND_LEN: 0xfe,
  ID: 0xf1,            // receiver id
};

export const TARGET = { KEYBOARD: 10, MOUSE: 5, BOTH: 13 };

/**
 * Wraps a HidTransport opened on the receiver's vendor collection and
 * reproduces exactly what class "wB" does in the vendor app.
 */
export class DongleRelay {
  /** @param {HidTransport} hid */
  constructor(hid) {
    this.hid = hid;
    this.current = 'none';           // currently selected relay target
    this.status = {
      keyboard: { isCanRead: false, battery: 0, isOnline: false, isCanSend: false, isRFBoot: false },
      mouse: { isCanRead: false, battery: 0, isOnline: false, isCanSend: false, isRFBoot: false },
    };
    this.pollTimer = null;
    this.busy = false;
    this._tail = Promise.resolve();   // 串行锁尾指针（见 _serialize）
  }

  /**
   * 串行锁 —— 接收器的厂商通道同一时刻只能跑一个事务。
   *
   * 页面里"按键设置 / Fn层 / 灯光 / 设置"会各自自动读取，全是异步的；
   * 一旦并发，两次事务的控制传输(SET/GET)就会互相穿插：
   *   * 真机上表现为读回旧数据 / 超时，甚至把控制端点 stall 成 EPIPE（"连上一会儿就断"）；
   *   * 假设备上是回包串台，读出来的层数据是空的。
   * 所以所有对外方法都从这里排队，内部步骤改用 _ 前缀的无锁版本。
   */
  _serialize(fn) {
    const run = () => Promise.resolve().then(fn);
    const p = this._tail.then(run, run);
    this._tail = p.then(() => {}, () => {});
    return p;
  }

  /** 是否正在后台轮询（供协议层在事务期间暂停/恢复） */
  get isPolling() { return this.pollTimer !== null; }

  static targetName(t) {
    return t === TARGET.KEYBOARD ? 'keyboard' : t === TARGET.MOUSE ? 'mouse' : 'both';
  }

  /**
   * 0xF7 — one status round trip. Mirrors ___dongleCheck24GStatusByF7().
   *
   * 注意 readDelay：原厂在 SET 和 GET 之间等 INTERVAL_24G_TIME(10ms)。但我们实测这个
   * 接收器"读取窗口"很窄 —— 实测固定延迟 50ms 就会超时并把它拖死(EPIPE)。
   * 浏览器的 WebHID 调用本身就有往返开销，再叠加 10ms 很容易超窗，
   * 所以这里默认不再额外等待(0)，把间隔交给 Chrome 的往返时延。
   * 想恢复原厂时序可以在「高级」里调。
   */
  pollStatus(readDelay = TIMING.POLL_READ_DELAY) {
    return this._serialize(() => this._pollStatus(readDelay));
  }

  /** 无锁版本 —— 只允许在已持有串行锁的流程内部调用（否则会自锁死） */
  async _pollStatus(readDelay = TIMING.POLL_READ_DELAY) {
    const req = new Uint8Array([DONGLE_CMD.STATUS]);
    await this.hid.sendFeature(req);
    if (readDelay > 0) await sleep(readDelay);
    const r = await this.hid.getFeature();
    if (!r) return this.status;
    const k = { ...this.status.keyboard };
    const m = { ...this.status.mouse };
    const who = r[6];
    if (who === 1) {
      Object.assign(k, { isCanRead: r[0] === 1, battery: r[1], isOnline: r[3] === 0, isCanSend: r[5] === 1, isRFBoot: r[8] === 1 });
    } else if (who === 2) {
      Object.assign(m, { isCanRead: r[0] === 1, battery: r[2], isOnline: r[4] === 0, isCanSend: r[5] === 1, isRFBoot: r[8] === 1 });
    } else if (who === 3) {
      Object.assign(k, { isCanRead: r[0] === 1, battery: r[1], isOnline: r[3] === 0, isCanSend: r[5] === 1, isRFBoot: r[8] === 1 });
      Object.assign(m, { isCanRead: r[0] === 1, battery: r[2], isOnline: r[4] === 0, isCanSend: r[5] === 1, isRFBoot: r[8] === 1 });
    }
    this.status = { keyboard: k, mouse: m };
    return this.status;
  }

  /** 0xF6 — switch the receiver's relay target (only when it changes). */
  selectTarget(target) {
    return this._serialize(() => this._selectTarget(target));
  }

  async _selectTarget(target) {
    if (this.current === target) return;
    const code = target === 'keyboard' ? TARGET.KEYBOARD : target === 'mouse' ? TARGET.MOUSE : TARGET.BOTH;
    await sleep(TIMING.INTERVAL_24G);
    await this.hid.sendFeature(new Uint8Array([DONGLE_CMD.SELECT, code]));
    this.current = target;
  }

  async ensureCanSend(target, tries = 3) {
    for (let i = 0; i < tries; i++) {
      await sleep(100);
      const st = await this._pollStatus();
      if (st[target].isCanSend) {
        await this._selectTarget(target);
        return true;
      }
    }
    return false;
  }

  async ensureCanRead(target, tries = 3) {
    for (let i = 0; i < tries; i++) {
      await sleep(100);
      const st = await this._pollStatus();
      if (st[target].isCanRead) {
        await this.hid.sendFeature(new Uint8Array([DONGLE_CMD.NOTICE_READ]));
        return true;
      }
    }
    return false;
  }

  /** Write a 9-byte (already checksummed) keyboard frame through the relay. */
  send(frame, target = 'keyboard', delay = TIMING.INTERVAL_24G, skipCheck = false) {
    return this._serialize(() => this._send(frame, target, delay, skipCheck));
  }

  async _send(frame, target = 'keyboard', delay = TIMING.INTERVAL_24G, skipCheck = false) {
    if (!skipCheck && target !== 'none' && target !== 'all') {
      if (!(await this.ensureCanSend(target))) throw new Error('2.4G: 键盘端不可发送 (isCanSend=0)');
      await sleep(10);
    }
    if (delay > 0) await sleep(delay);
    await this.hid.sendFeature(frame);
  }

  /** Read a 64-byte keyboard response through the relay. */
  read(target = 'keyboard', delay = TIMING.INTERVAL_24G, tries = 3) {
    return this._serialize(() => this._read(target, delay, tries));
  }

  async _read(target = 'keyboard', delay = TIMING.INTERVAL_24G, tries = 3) {
    if (delay > 0) await sleep(delay);
    if (target !== 'none' && target !== 'all') {
      if (!(await this.ensureCanRead(target, tries))) throw new Error('2.4G: 键盘端不可读取 (isCanRead=0)');
      await sleep(TIMING.INTERVAL_24G);
    }
    return this.hid.getFeature();
  }

  /**
   * 一次"温和"的完整事务 —— 2.4G 下尽量少打扰接收器。
   *
   * 与 send()+read() 的区别：
   *   * 只做 **1 次** F7 预检（而不是发送前、读取前各轮询一次，最多 6 次）；
   *   * 命令发出去以后才轮询等待 isCanRead，间隔更宽(150ms)、次数更少(3)；
   *   * 任何一步失败立即抛出，绝不继续往下打命令。
   *
   * 这样一页配置只需要 1 + 1 + ≤3 次控制传输，而不是原来的 ~6 次。
   */
  transact(frame, target = 'keyboard') {
    return this._serialize(() => this._transact(frame, target));
  }

  async _transact(frame, target = 'keyboard') {
    const t0 = Date.now();
    // 1) 预检: 链路在不在、能不能发
    const st = await this._pollStatus();
    const slot = st[target] || st.keyboard;
    if (!slot.isOnline) throw new Error('2.4G: 键盘不在线（可能睡着了）');
    if (!slot.isCanSend) throw new Error('2.4G: 键盘端暂不可发送');
    await this._selectTarget(target);

    // 2) 发命令
    await sleep(TIMING.INTERVAL_24G);
    await this.hid.sendFeature(frame);

    // 3) 等键盘应答
    let ready = false;
    for (let i = 0; i < 3 && !ready; i++) {
      await sleep(150);
      const s = await this._pollStatus();
      ready = !!(s[target] || s.keyboard).isCanRead;
    }

    // 4) 通知读取并取回。
    //
    // 真机实测（2.4G，2026-10-15）：isCanRead **经常不回 1**，但应答其实已经躺在接收器
    // 的读取缓冲里了 —— 这时候照样发 FC + GET 就能拿到正确的回包。
    // 所以这里不再因为 isCanRead=0 直接抛错，而是"照读一次，再检查回包是否像本次命令的应答"：
    //   * 回包 cmd 字节 == 我们发的 cmd  → 认定成功（isCanRead 只是没及时置位）
    //   * 回包全 0 / cmd 对不上          → 才判定失败
    await sleep(TIMING.INTERVAL_24G);
    await this.hid.sendFeature(new Uint8Array([DONGLE_CMD.NOTICE_READ]));
    await sleep(TIMING.INTERVAL_24G);
    const resp = await this.hid.getFeature();
    const want = frame[0];
    const got = resp ? resp[0] : 0;
    // 0x8A/0x90 这类分页数据读：回包第一字节是数据而不是命令，所以这两种按"非全 0"判定
    const paged = want === 0x8a || want === 0x90;
    const plausible = paged ? !!resp && resp.some((b) => b !== 0) : got === want;
    if (plausible) return resp;
    if (!ready) throw new Error('2.4G: 键盘没有应答（第 ' + Math.round((Date.now() - t0)) + 'ms 仍未就绪）');
    return resp;
  }

  /**
   * 后台每 2 秒轮询一次链路状态。
   *
   * 注意：这个接收器的厂商通道很"脆" —— 一旦某次读取超时，继续硬轮询会把它彻底
   * 拖死(EPIPE / 设备掉线)。所以连续失败 2 次就自动停下，并把错误抛给上层提示用户。
   */
  /**
   * 后台轮询链路状态 —— **默认不开**，需要用户显式启用。
   *
   * 原因：这个接收器的厂商通道很脆。每次 F7 都是"SET + GET"两次控制传输，
   * 只要有一次 GET 落在响应窗口之外，接收器就会 stall，之后全部 EPIPE，
   * 表现就是"连上之后过一会儿就断"。所以宁可牺牲电量自动刷新，也不默认轮询。
   * 一旦某次失败，立即永久停止轮询（不再重试），避免越轮询越死。
   */
  startPolling(cb, interval = TIMING.POLL_INTERVAL) {
    this.stopPolling();
    this.pollTimer = setInterval(async () => {
      if (this.busy) return;
      this.busy = true;
      try {
        const st = await this.pollStatus();
        if (cb) cb(st);
      } catch (e) {
        this.stopPolling();        // 第一次失败就停, 不再重试
        if (cb) cb(null, e);
      } finally {
        this.busy = false;
      }
    }, interval);
  }

  /** 软复位: 关掉再打开 HID 设备, 有时能把 stall 的控制端点救回来(不行就提示拔插) */
  softReset() {
    return this._serialize(() => this._softReset());
  }

  async _softReset() {
    this.stopPolling();
    try { await this.hid.close(); } catch (e) { /* ignore */ }
    await sleep(300);
    await this.hid.open();
    await sleep(200);
  }

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }
}
