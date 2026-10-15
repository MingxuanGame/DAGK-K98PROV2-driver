# DAGK K98 PRO V2 — 2.4G dongle & Bluetooth wire protocol (reverse-engineered)

Target device: **vid 0x3151 (12625 dec)**, wired pid **0x5002 (20482)**, 2.4G dongle pid **0x5006 (20486)**.
App under analysis: unpacked Electron app in `app/resources/app/`.

## 0. Source map / citation keys

| key | file |
|---|---|
| `[idx:N]` | `app/resources/app/dist/js/index.630fe4af.js` — byte offset N in the minified bundle |
| `[pretty:N]` | `work/index.pretty.js` — beautified index, line N |
| `[map:N]` | `work/8eaa0b27.pretty.js` — chunk map (device name → chunk) |
| `[k98:N]` | `work/530511ba.pretty.js` — K98 PRO chunk |
| `[dad:N]` | `work/1dadcb6b.pretty.js` — parent class of the K98 chunk |
| `[fac:N]` | `work/8e9f164a.pretty.js` — `findYC3121Device` factory |
| `[kbd:N]` | `work/b469c422.fmt.txt` — keyboard/FEA base protocol (one statement per line) |

Class inventory (all in `[pretty]`):

| minified | pretty line | role |
|---|---|---|
| `mB` | 31050 | native (hidapi/proto) transport |
| `pB` | 31089 | **WebHID transport** (sendFeature/getFeature/write/listenToReports) |
| `kg` | 31154 | device wrapper: holds `deviceInfo` (the filter row incl. `reports`), dispatches recv callbacks |
| `_B` | 31208 | **vendor notify listener** (filter type `"vendor"`, input reports only) |
| `ki` | 31239 | checksum enum: `Bit7=0, Bit8=1, None=2` |
| `bg` | 31242 | device base (copies `filter`→`vid,pid,usage,usagePage,interfaceNumber,reports`, `devAddr=filter.devicePath`) |
| `yB`/`pK`/`hB` | 31271/31275/31289 | device-type wrappers `dongle`/`keyboard`/`mouse` |
| `wB` | 31342 | **2.4G dongle transport** |
| `_K` | 31570 | **keyboard transport for usb / 24g / bt** (exported as `ae` `[idx:2523949]`, imported by the protocol chunks as `j`) |
| `wg` | 31788 | HID device manager (filters, requestDevice, connect) |

`it = e => new Promise(t => setTimeout(t,e))` — the delay helper `[idx:999176]`.
`Wi = e => e.reduce((t,i)=>t+i,0)` — sum `[pretty:31203]`.
`oa` = "running inside Electron" `[idx:999055]`.

---

## 1. Device filter tables

### 1.1 Raw tables (minified offsets)

| table | start offset | meaning |
|---|---|---|
| `ig` | `[idx:999311]` | keyboard filters (usage 2 / page 0xFFFF, iface 2) |
| `rg` | `[idx:1002xxx]` | mouse filters |
| `ng` | `[idx:1013247]` | **dongle filters** |
| `yM` | `[idx:1020404]` | **BLE filters** (usage 514 / page 65365 or 65382, iface −1) |
| `Xx` | `[idx:1025188]` | `yM` + default `reports` |
| `hM/fM/gM` | 1025xxx | boot keyboard / boot mouse / boot dongle |
| `qx` | `[idx:1029021]` | **derived vendor filter list** |
| `Bd` | `[idx:1029281]` | `[...hM,...fM,...gM]` |
| `zs` | `[idx:1029304]` | `[...ig,...rg,...ng,...Xx,...qx]` ← the list handed to `navigator.hid.requestDevice` |

`ld` (the full device *definition* list) starts `[idx:874531]`; the K98 PRO entry itself:
```js
{id:3780, vid:12625, pid:20482, keyLayout:c.Common98_Y98, name:"yc3123_kk_k98_pro_3m_1k",
 displayName:"K98PRO", company:"DAGK", type:"keyboard", layer:3, fnSysLayer:{win:1,mac:1},
 lightLayout:T, sideLightLayout:he,
 other:{noMagneticSwitch:!0, isYC3123:!0, sleep24:{...}, sleepBT:{...}}}
```
`[idx:790901]` (`dR` sub-list). **The device's firmware ID is 3780 = 0x0EC4.**

### 1.2 Entries that match our two PIDs

* wired keyboard **0x5002** — `[idx:1001393]`, member of `ig`:
  ```js
  {type:"keyboard", vendorId:12625, productId:20482, usage:2, usagePage:65535, interfaceNumber:2}
  ```
* dongle **0x5006** — `[idx:1013959]`, member of `ng`:
  ```js
  {type:"dongle", vendorId:12625, productId:20486, usage:2, usagePage:65535, interfaceNumber:2}
  ```

Neither entry carries a `reports` field, so both get the **default** applied in `kg` `[pretty:31163]`:

```js
const n = t.reports ?? [{ reportId: 0, reportCount: 64, type: "feature" }];
```

⇒ **both the wired keyboard and the 2.4G dongle are driven exclusively with 64-byte HID FEATURE reports, report ID 0.**
(`pB.sendFeature` pads the payload to `reportCount`=64 `[pretty:31106]`; `pB.getFeature` = `device.receiveFeatureReport(0)` `[pretty:31118]`.)

### 1.3 Derived vendor filter list `qx` (exact code)

```js
qx = [...ig, ...rg, ...ng].map(e => {
  let t = { type:"vendor", vendorId:e.vendorId, productId:e.productId,
            usage:1, usagePage:65535, interfaceNumber:1,
            reports:[{ reportId:0, type:"input" }] };
  return (e.vendorId===12625 && e.productId===16407)
    ? { ...t, usage:1, usagePage:65534 }   // only pid 0x4017 is remapped
    : t;
});
```
`[idx:1029021]`. Therefore for our PIDs:

| pid | qx entry |
|---|---|
| 20486 (dongle) | `{type:"vendor",vendorId:12625,productId:20486,usage:1,usagePage:65535,interfaceNumber:1,reports:[{reportId:0,type:"input"}]}` |
| 20482 (wired) | same with productId 20482 |

This is an **input-only** channel used by class `_B` (see §7) — no feature/output reports, so `_B.sendFeature/write` are hard-coded to `()=>!1` `[pretty:31231,31235]`.

### 1.4 BLE entries `Xx`

```js
Xx = [...yM].map(e => ({ ...e, reports: e.reports ?? [{ reportId:6, reportCount:65, type:"out-input" }] }));
```
`[idx:1025188]`. The 0x3151 BLE pids present in `yM` `[idx:1020404]`:
20519, 20484, 16439, 16403, 16402*, 16428, 16412, 16413*, 16415, 16416*, 16419, 16420*, 16424, 20540, 20561
(* = `usagePage:65382` (0xFF66); all others `usagePage:65365` (0xFF55); all `usage:514` (0x0202), `interfaceNumber:-1`.)
**Which of these is the K98 PRO V2's Bluetooth PID is UNKNOWN** (the device table only stores the wired/24G pid 20482; identification is done at runtime by the 0x8F ID, §5).

### 1.5 How a filter row is chosen on connect

`___connectWebHids` `[pretty:31824]`:
```js
const r = this.filters.find(o => o.vendorId===i.vendorId && o.productId===i.productId &&
                                 i.collections.some(l => l.usage===o.usage && l.usagePage===o.usagePage));
```
`this.filters = [...zs]` (or `[...zs,...Bd]` when the IOT switch is on) `[pretty:31810,31814]`.
Because `zs` order is `ig, rg, ng, Xx, qx` and the device is connected once per HID device object (`___connectWebHids` skips devices already in `allDevices` `[pretty:31823]`), a 0x5006 dongle is claimed by the **first** row that matches: the `ng` row (usage 2, feature/64) wins over `qx`. The `qx`/`_B` vendor channel is therefore only used when usage 1 / page 0xFFFF lives on a **separate hidraw node** (a different HID interface); if both top-level collections are on the same node, only the `ng` (feature) channel is connected.
Then `___connectDev` `[pretty:31892]`: `type:"vendor"` → `new _B`; `type:"dongle"` → `new wB(filter, thid)` (stored in map `Ws`); `type:"keyboard"|"mouse"|"ble"` → temporary `new _K(pK({connect: r==="ble" ? "bt" : "usb", ...}))` used only to read the ID, then destroyed.

---

## 2. 2.4G dongle protocol (class `wB`, `[pretty:31342-31569]`)

All frames below are **SET_FEATURE / GET_FEATURE on report ID 0, always 64 bytes**, padded with zeros.
Helper `___sendFeature(t)` `[pretty:31361]` → `sendFeature(firstReportOfTypeFeature.reportId, t)`; `___getFeature()` `[pretty:31367]` → `getFeature(reportId)`.
Helper `___commonFeature(t)` `[pretty:31381]` = `delay(10); SET_FEATURE(t); delay(10); GET_FEATURE()`.

Constants: `INTERVAL_24G_TIME = 10` ms `[pretty:31346]`; status loop period 2000 ms `[pretty:31463]`.

### 2.1 Command bytes

| cmd | who sends it | meaning |
|---|---|---|
| `0xF7` | host | **status poll** (keyboard+mouse) |
| `0xF6` | host | **select 24G target**: `0x0A`=keyboard, `0x05`=mouse, `0x0D`=both |
| `0xFC` | host | **read notice** (sent before a GET_FEATURE read) |
| `0xFE` | host | **send length notice** (`[0xFE, len]`) — *defined but never called* (`[pretty:31459]`, no call site in the whole bundle) |
| `0xF1` | host | **dongleWhoAmI** (dongle's own 2-byte ID) |
| `0x8F` | host | **getNormalID** (device behind dongle, 4-byte LE ID) |
| `0x01,0x04,0x07…` | host | normal FEA command frames relayed to the keyboard (§4) |

### 2.2 `0xF7` status poll — exact frames

Send `[0xF7]` → `___sendFeature` pads to 64:
```
SET_FEATURE (64B): F7 00 00 ... 00          (0xF7 then 63 zero bytes — NO checksum, NO 9-byte padding)
delay 10 ms
GET_FEATURE (64B): <- 64-byte status frame
```
(Contrast: `Donglehelp.getDeviceIsBoot` sends the same 0xF7 through the *encoded* path `commonMsg([0xF7], Bit7)` → `F7 00 00 00 00 00 00 08 00` + 55 zeros, i.e. the dongle tolerates both.)

**Decoding** — `___dongleCheck24GStatusByF7` `[pretty:31384-31424]`, with `r` = the 64 bytes returned by GET_FEATURE (no report-ID byte):

| byte | meaning |
|---|---|
| `r[0]` | `isCanRead`: the app requires `r[0] === 1` |
| `r[1]` | keyboard battery (0…100) |
| `r[2]` | mouse battery |
| `r[3]` | keyboard online **when `r[3] === 0`** |
| `r[4]` | mouse online **when `r[4] === 0`** |
| `r[5]` | `isCanSend` when `r[5] === 1` |
| `r[6]` | target mask: `1` = keyboard present, `2` = mouse present, `3` = both (0/other → both reported offline) |
| `r[8]` | `isRFBoot` when `r[8] === 1` (independently confirmed: `getDeviceIsBoot` in `4dac447a.js` → `t[8]===1`, and in `6289e0ab.js` → `t[7]===1 && t[8]===1`) |

The JS is literally (keyboard branch shown):
```js
const a = dv.getUint8(6), o = dv.getUint8(1), l = dv.getUint8(2);
a===1 && (keyboard = { isCanRead: r[0]===1, battery: o, isOnline: r[3]===0,
                       isCanSend: r[5]===1, isRFBoot: r[8]===1 });
a===2 && (mouse    = { isCanRead: r[0]===1, battery: l, isOnline: r[4]===0,
                       isCanSend: r[5]===1, isRFBoot: r[8]===1 });
a===3 && (keyboard = {…r[3]…}, mouse = {…r[4]…});
```
If the SET/GET returns `undefined` the whole poll returns "everything offline" with the previously seen batteries `[pretty:31391]`.
Battery/online transitions are published as `{type: isOnline ? "wake" : "sleep", deviceType, battery}` `[pretty:31407-31420]`.

Status polling is restarted every 2 s by `___loopGet24GStatus` `[pretty:31462]` (suppressed while a command is in flight, `gg` flag) and is stopped/started around every send/read:
`___stopLoopGet24GStatus` / `___startLoopGet24GStatus` `[pretty:31465-31470]`.

### 2.3 `0xF6` target select

`___dongleSend24GDeviceByF6(t)` `[pretty:31373]` (t ∈ keyboard|mouse|all|none):
```js
if (this.current24GUsedDevice === t) return;      // already selected -> NO frame at all
if (t === "none") { this.current24GUsedDevice = "none"; return; }   // no frame either
const i = t==="keyboard" ? 10 : t==="mouse" ? 5 : 13;
await it(10);
await this.___sendFeature(new Uint8Array([246, i]));   // SET_FEATURE only, no GET
this.current24GUsedDevice = t;
```
Frames (64 B):
```
keyboard : F6 0A 00 00 ...   mouse : F6 05 00 00 ...   both/all : F6 0D 00 00 ...
```

### 2.4 `0xFC` read notice

`___dongleNoticeReadByFc` `[pretty:31456]`: `delay(10); SET_FEATURE([0xFC])` → `FC 00 00 …` (64 B). No GET.

### 2.5 `0xFE` send-length notice (dead code)

`___dongleNoticeSendLenByFe(t,i)` `[pretty:31459]`: `SET_FEATURE([0xFE, t]); delay(i ?? 10)` → `FE <len> 00 …`. No call site exists anywhere in the bundle → **never used by this app build**.

### 2.6 Retry loops

```js
___check24GIsCanSend = async t => {                    // [pretty:31471]
  for (let i=0; i<5; i++) {
    await it(100);
    if ((await this.___dongleCheck24GStatusByF7())[t].isCanSend) {
      await this.___dongleSend24GDeviceByF6(t);        // selects target, then...
      return true;
    }
  }
  return false;                                        // frame is NOT sent on failure
};
___check24GIsCanRead = async t => {                    // [pretty:31477]
  for (let i=0; i<5; i++) {
    await it(100);
    if ((await this.___dongleCheck24GStatusByF7())[t].isCanRead) {
      await this.___dongleNoticeReadByFc();            // 0xFC notice, then...
      return true;
    }
  }
  return false;
};
```
Worst case per loop = 5 × (100 ms + 20 ms poll) ≈ 600 ms.

### 2.7 `sendMsg` / `readMsg` / `commonMsg` in `wB`

```js
sendMsg = async (t, i, r=10, n="none") => {            // t=frame, i=checksum variant, r=extra delay, n=target
  while (this.isUsing.size > 0) await it(100);         // serialise
  const a = this.___encodeCmd(t, i);                   // pad to 9 + checksum  (§3)
  const o = Date.now() + hex(a);
  this.isUsing.add(o); this.___stopLoopGet24GStatus();
  try {
    this.isUsing.delete(o);
    if (n !== "none" && n !== "all") {
      if (!await this.___check24GIsCanSend(n)) return false;   // F7 poll + F6 select
      await it(10);
    }
    return (r > 0 && await it(r)), await this.___sendFeature(a);  // SET_FEATURE (64B)
  } finally { this.___startLoopGet24GStatus(); this.isUsing.delete(o); }
};                                                     // [pretty:31494]
readMsg = async (t=10, i="none") => {                  // [pretty:31509]
  while (this.isUsing.size > 0) await it(100);
  const r = Date.now().toString();
  this.isUsing.add(r); this.___stopLoopGet24GStatus();
  if (t > 0) await it(t);
  try {
    if (i !== "none" && i !== "all") {
      if (!await this.___check24GIsCanRead(i)) return;  // F7 poll + 0xFC
      await it(10);
    }
    return await this.___getFeature();                  // GET_FEATURE (64B)
  } finally { this.isUsing.delete(r); this.___startLoopGet24GStatus(); }
};
commonMsg = async (t, i, r=10, n=10, a="none") => {     // [pretty:31524]
  if (await this.sendMsg(t, i, r, a)) return await this.readMsg(n, a);
};
```

**Timing of a normal command** (no retries): `F7`(20 ms) → `F6`(+10 ms) → 10 ms → `r`=10 ms → SET_FEATURE(frame) → readMsg: 10 ms → `F7`(20 ms) → `FC`(+10 ms) → 10 ms → GET_FEATURE.

---

## 3. `___encodeCmd` — checksum variants (identical in `wB` and `_K`)

```js
___encodeCmd = (t, i) => {                              // [pretty:31483] (wB) / [pretty:31691] (_K)
  const r = t.length > 9 ? t : new Uint8Array([...t, ...new Uint8Array(9 - t.length)]);
  if (i === ki.Bit7) { const n = Wi([...r].slice(0,7)); r[7] = 255 - (n & 255); }
  if (i === ki.Bit8) { const n = Wi([...r].slice(0,8)); r[8] = 255 - (n & 255); }
  return r;                                             // _K additionally prepends 0x55 when bt
};
```
* `ki` = `{Bit7:0, Bit8:1, None:2}` `[pretty:31239]`.
* Frames **longer than 9 bytes are passed through untouched** (still checksummed at byte 7 or 8).
* Only frames that go through `sendMsg` are encoded; the dongle control frames F6/F7/FC/FE are **raw** (no padding beyond 64, no checksum).

Worked examples (verified by re-implementing the formula):

| command | Bit7 frame (9 bytes) | as sent (64 B, tail omitted) |
|---|---|---|
| `0x8F` getNormalID | `8F 00 00 00 00 00 00 70 00` | `8F 00 00 00 00 00 00 70 00` + 55×00 |
| `0xF1` dongleWhoAmI | `F1 00 00 00 00 00 00 0E 00` | `F1 00 00 00 00 00 00 0E 00` + 55×00 |
| `0x04 00` setProfile(0) | `04 00 00 00 00 00 00 FB 00` | … |
| `0x84` getCurrentProfile (64-byte frame) | `84 00 00 00 00 00 00 7B 00` … | checksum only covers bytes 0..6 |
| `0x8F` **Bit8** (hypothetical) | `8F 00 00 00 00 00 00 00 70` | `byte8 = 255-(sum b0..b7)` |
| Bit8 example `01 02 03 04 05 06 07 08` | → `01 02 03 04 05 06 07 08 DB` (255−36 = 219) | |
| None | no checksum byte written (padding still applied) | |
| 64-byte payload cmd, e.g. `sendSyncColor` `[kbd:921]` `[0F 01 00 38 01 00 00 …+56B RGB]` | `byte7 = 255-(15+1+0+56+1) = 0xB6`; payload bytes 8..63 are NOT covered | |

---

## 4. How a normal keyboard command is wrapped and sent

The K98 PRO class chain is `Yc3123_kk_k98_pro_3m_1k` → `C` `[dad:38]` → `C` `[kbd:8]` (`class at extends j`, `j` = `_K`) → `kg`. The chunk map entry is `yc3123_kk_k98_pro_3m_1k: () => import("./530511ba.js") … default: Yc3123_kk_k98_pro_3m_1k` `[map:155]`; the factory `findYC3121Device` does `new mod.default(deviceType)` `[fac:216]`.

`_K.___encodeCmd` adds the BT prefix (see §6); `_K.sendMsg` `[pretty:31701]`:

```js
sendMsg = async (t, i, r = this.SEND_TIME) => {
  try {
    this.___stopLoopCheckStatus();
    while (this.blockCommonData) await it(100);
    const n = this.___encodeCmd(t, i);
    if (this.CONNECT === "24g") {                       // <-- relay through the dongle
      if (!this.dongle) return false;
      const a = this.deviceType.type === "keyboard" ? "keyboard" : "mouse";
      return await this.dongle.sendMsg(n, i, r, a);     // wB.sendMsg (§2.7)
    }
    if (r > 0) await it(r);
    return this.CONNECT === "bt" ? (this.btReadDatas = [], await this.___write(n))
                                 : await this.___sendFeature(n);   // usb: SET_FEATURE(64B)
  } finally { this.___startLoopCheckStatus(); }
};
readMsg = async (t = this.READ_TIME) => {               // [pretty:31716]
  this.___stopLoopCheckStatus();
  while (this.blockCommonData) await it(100);
  if (this.CONNECT === "24g") return await this.dongle.readMsg(t, kind);
  if (t > 0) await it(t);
  if (this.CONNECT === "bt") { const d = btReadDatas.at(-1); btReadDatas = []; return d; }
  return await this.___getFeature();                    // usb: GET_FEATURE(64B)
};
___commonMsg = async (t,i,r=this.SEND_TIME,n=this.READ_TIME) => { if (await this.sendMsg(t,i,r)) return await this.readMsg(n); };
commonMsg   = CONNECT !== "bt" ? ___commonMsg
            : async (t,i,r,n) => { let a=0,o=await ___commonMsg(t,i,r,n);
                                   while (o===undefined && a<3) { a++; o=await ___commonMsg(t,i,r,n); }
                                   return o; };         // BT: up to 4 attempts total [pretty:31736]
```

Notes:
* The `24g` keyboard object **owns no HID device**: its `filter` is the *dongle's* filter row, hence `devAddr = filter.devicePath` = the dongle path, and the constructor reuses the live `wB` via `Ws.get(t.devAddr)` `[pretty:31597-31599]`.
* `_K.___encodeCmd` is applied first, then `wB.___encodeCmd` is applied again; the operation is idempotent (same byte 7/8 value), so the wire frame is the §3 frame.
* On USB (`connect==="usb"`) the very same frame goes out directly as SET_FEATURE and the reply comes from GET_FEATURE.
* `vendorSleep()` `[pretty:31746]` = on win32/win64 a vendor "开始/停止" bookkeeping event, otherwise just `await it(100)` (used by e.g. `setCurrentProfile` `[kbd:101]`).

---

## 5. Identifying the keyboard behind the dongle

`instantlyCheckStatus` `[pretty:31425]` (called right after connect **and** every 2 s):

1. `t = await ___dongleCheck24GStatusByF7()` (§2.2).
2. If `t.mouse.isRFBoot || t.keyboard.isRFBoot` → `dongleWhoAmI()` (§5.3) and return.
3. If `t.keyboard.isOnline && keyboardId === undefined && !isRFBoot`:
   `id = await ___whoAmI("keyboard")` → repeat `___getNormalID("keyboard")` up to 3× with 500 ms pause `[pretty:31531]`.
4. `deviceType = fd(id, "24g", this.DEVICE_FILTER, this.THID)`; if defined → `ci.set(${id}-${donglePath}, deviceType)` and emit `{type:"add"}`; otherwise unlock/destroy and emit `DEVICE_NOT_SUPPORTED` `[pretty:31430-31440]`.
5. Same for the mouse with `___whoAmI("mouse")`.

### 5.1 `0x8F` getNormalID

```js
___getNormalID = async t => {                                 // [pretty:31527]
  const i = await this.commonMsg(new Uint8Array([143]), ki.Bit7, 10, 10, t);  // t = "keyboard"|"mouse"
  if (i === undefined || i[0] !== 143) return;                // response MUST echo 0x8F at byte 0
  return new DataView(i.buffer, i.byteOffset, i.byteLength).getUint32(1, true);   // bytes 1..4 LE
};
```
Wire sequence for the K98 PRO (target keyboard):

```
SET_FEATURE F7 00×63                    -> GET_FEATURE   (poll until b5==1)
SET_FEATURE F6 0A 00×62                 (select "keyboard behind dongle")
wait 10 ms
SET_FEATURE 8F 00 00 00 00 00 00 70 00 + 55×00
SET_FEATURE F7 00×63                    -> GET_FEATURE   (poll until b0==1)
SET_FEATURE FC 00×63
wait 10 ms
GET_FEATURE -> 8F C4 0E 00 00 …         (= id 0x00000EC4 = 3780 → "K98PRO")
```
**3780 is the K98 PRO V2's firmware ID**, taken from `id:3780` in the device entry `[idx:790901]`.

### 5.2 ID → device entry mapping: `fd` `[idx:1564459]` (pretty 31301-31326)

Original (one line, `[pretty:31301]`):
`kB = gB ? ld : (!ts && (!oa || Nm.currentCompany === "")) ? ld.filter(e => e.other?.electronOnly !== !0) : ld.filter(e => e.company === Nm.currentCompany || e.isBoot)`.
The listing below is de-minified and abbreviated (only the pieces a re-implementation needs are kept verbatim):

```js
kB = ld.filter(e => e.other?.electronOnly !== true)          // generic build (Electron, currentCompany === "")
   : ld.filter(e => e.company === Nm.currentCompany || e.isBoot);   // branded build ("DAGK")
fd = (e, t, i, r) => {                        // e=id, t=connect, i=filter, r=thid
  const n = ts ? new Set([]) : new Set([...nx]);              // excluded companies
  let a = kB.find(u => u.id === e && !n.has(u.company) && !aR.has(u.displayName));
  if (e === -1) { /* helpers picked by pid */ }
  if (Bd.some(u => u.vendorId===i.vendorId && u.productId===i.productId &&
                   u.usage===i.usage && u.usagePage===i.usagePage)) { /* boot-device pid remap */ }
  if (a === undefined) return;
  const o = { id:e, isExclusive:false, connect:t, deviceType:a.type, filter:i, thid:r,
              name:a.name, displayName:a.displayName, company:a.company };
  const l = Object.assign(o, a);
  switch (a.type) { case "keyboard": return new pK(l); case "mouse": return new hB(l); case "dongle": return new yB(l); }
};
```
(`nx` = `["akko","MonsGeek","Veekos","TITANHUB","MEETION","EWEADNV","NyfterUG","cherry","SecretGearZX","PLUXKB"]`, `aR = new Set(["Storm68"])` `[idx:747433]`; the K98 PRO's company "DAGK"/displayName "K98PRO" is in neither.)
Over 24G `i` is the **dongle's** filter row, so the resulting keyboard object has `connect:"24g"`, `vid/pid = 0x3151:0x5006` and `devAddr = <dongle hidraw path>`; `zB` then instantiates the real class through `nL` → `findYC3121Device` `[idx:154105]` / `[idx:1813505]`.

### 5.3 `0xF1` dongleWhoAmI — **not used by pid 0x5006**

```js
bB = [{vid:12625,pid:20487},{12625,20512},{12625,20543},{12625,20544},{12625,20555},
      {13434,41730},{14154,41762}];                       // [pretty:31327]
dongleWhoAmI = async () => {                              // [pretty:31544]
  if (!bB.some(t => t.vid===vendorId && t.pid===productId)) { startStatusLoop(); return; }
  for (let t=0; t<3; t++) {
    const i = await this.___getDongleID();                // commonMsg([0xF1], Bit7, 10, 10, "none")
    if (i !== undefined) { const r = fd(i, "usb", this.DEVICE_FILTER, this.THID); … return; }
    await it(500);
  }
};
___getDongleID = async () => {                            // [pretty:31540]
  const t = await this.commonMsg(new Uint8Array([241]), ki.Bit7, 10, 10, "none");
  if (t === undefined || t[0] !== 241) return;            // echoes 0xF1 at byte 0
  return new DataView(t.buffer, t.byteOffset, t.byteLength).getUint16(1, true);   // 2 bytes LE
};
```
**pid 20486 is not in `bB`** ⇒ for the K98 PRO V2 dongle the app never sends 0xF1; it only starts the 2 s F7 status loop and relies on the 0x8F path above. (`0xF1` is still documented because it is the generic dongle-ID mechanism: `F1 00 00 00 00 00 00 0E 00` + 55×00 → `F1 <idLo> <idHi> …`, then `fd(id,"usb",…)`.)

### 5.4 `0x8F` is overloaded

The same command returns several fields (`[kbd:70-73,931-933]`):
```js
getUSBVersion = async () => { const e = await commonMsg([0x8F], Bit7); return e[8]<<8 | e[7]; };
supportsLightSync = async () => { const t = await commonMsg([0x8F], Bit7); return t[11] === 1; };
getDeviceIsBoot (K98 parent) = e !== undefined && e[9] === 1;    // [dad:28]
```
So one 0x8F response = `[0]=0x8F, [1..4]=deviceId(LE), [7..8]=usbVersion(LE), [9]=isBoot, [11]=supportsLightSync`.

---

## 6. Bluetooth path (class `_K` with `CONNECT === "bt"`)

### 6.1 Constructor / configuration `[pretty:31589-31600]`

```js
if (this.CONNECT === "bt") {
  this.SEND_TIME = 100; this.READ_TIME = 200;
  this.UNIQUE_KEY = t.devAddr;                       // hidraw path, not vid/pid
  this.addOnRecvCallback(this.___decodeBtInputData);
  this.listenToReports();
}
```
A BLE device is created by `___connectDev` with `connect:"bt"` and the `Xx` filter row `[pretty:31909-31921]`, so:
* **output report ID 6, 65 bytes** (`Xx` default) — writes use `device.sendReport(6, data)`;
* **input (notification) reports of any report ID** are delivered to `___decodeBtInputData`;
* there is **no feature-report usage at all** on this path (`___write` picks `type==="output"||"out-input"||"all"`, `[pretty:31653]`).

### 6.2 Write format

`_K.___encodeCmd` `[pretty:31691]` = §3 frame **prefixed with 0x55** when `CONNECT === "bt"`:
```js
return this.CONNECT === "bt" ? new Uint8Array([85, ...r]) : r;
```
then `pB.write(6, data)` pads the payload to `reportCount` = 65 `[pretty:31125-31143]`.

Example — `0x8F` getNormalID over BT (65-byte output report, report ID 6):
```
data: 55 8F 00 00 00 00 00 00 70 00 00 … 00      (65 bytes: 0x55 + 9-byte frame + 55 zeros)
HID:  sendReport(6, <above>)
```
Timing: `sendMsg` → `it(100)` → `btReadDatas = []` → send. `readMsg` → `it(200)` → take the last buffered frame.
The status poll is the exception — it bypasses `___encodeCmd`:
```js
checkStatus = async () => { if (this.CONNECT === "bt") await this.___write(new Uint8Array([119])); … };  // [pretty:31671]
```
⇒ `sendReport(6, 77 00 00 … 00)` (65 B), **no 0x55 prefix, no checksum**.

### 6.3 Notification format / decode (`___decodeBtInputData`, `[pretty:31631-31652]`)

`t` = `[reportId, ...data]` (the transport prepends the report id, `[pretty:31146-31149]`). `i = t.slice(1)`, `r = DataView(i)`, `n = r.getUint8(0)` = **first data byte**:

| first byte | action |
|---|---|
| `0x55` (85) | command response: `btReadDatas.push(t.slice(2))` → the stored frame **is the 9/64-byte frame without the 0x55 and without the report id** (i.e. it starts with the command echo, exactly like the GET_FEATURE payload of the wired path). Only the **last** such frame is returned by `readMsg`. |
| `0x77` (119) | status: `___setStatus({isOnline:true, battery: r.getUint8(1)})` → `[reportId][77][battery]…` |
| `0x88` (136) | status: `___setStatus({isOnline:false, battery:this.battery})` |
| `0x66` (102) | vendor notification: `a = t.slice(2)`, `o = mK(a)` (see §7), event value `l = t.slice(1)` (starts at 0x66). Same 300 ms "开始 → real type" debounce as the vendor channel. |

Unknown first bytes are ignored.

### 6.4 Timings / loops

| item | value | source |
|---|---|---|
| `SEND_TIME` (pre-write delay) | 100 ms | `[pretty:31574,31597]` |
| `READ_TIME` (wait before reading the buffered reply) | 200 ms | `[pretty:31575,31597]` |
| `commonMsg` retries | up to 4 attempts ×(`___commonMsg`) | `[pretty:31736]` |
| status poll | `0x77` every 5 s (first 2 s after start) | `[pretty:31679-31683]` |
| `instantlyCheckStatus` | write 0x77, wait 200 ms, return `isOnline` | `[pretty:31674]` |
| `vendorSleep()` default | 100 ms (`defaultVendorSleepTime`) | `[pretty:31585,31746]` |

Identification over BT is the same `whoAmI` → `___getNormalID` path `[pretty:31751-31756]` (0x8F, 4-byte LE at bytes 1..4, `0xFFFFFFFF` → `-1` meaning "no ID"), then `fd(id,"bt",filter,thid)` → same `id 3780` → "K98PRO".

---

## 7. Vendor notification channel (usage 1 / usagePage 0xFFFF / interface 1)

Class `_B` `[pretty:31208]` (constructed for `type:"vendor"`, mapped by device path in `mc` `[pretty:31896-31899]`). It is **listen-only** (`sendFeature/write → false`, `getFeature → undefined`).
`___vendorRecv(t)`: `i = t.slice(1)` (drop report id) → `mK(i)`:

```js
mK = e => {                                             // [pretty:31203]
  const t = e.slice(0,3);
  Fr([...t],[15,1,0])  && (i="开始");        Fr([...t],[15,0,0]) && (i="停止");   t[0]===27 && (i="磁轴行程");
  Fr([...t],[128,0,0]) && (i="麦克风");      Fr([...t],[13,0,0]) && (i="重置");   Fr([...t],[19,0,0]) && (i="切睡眠");
  Fr([...t],[44,0,0])  && (i="清屏完成");    Fr([...t],[47,1,0]) && (i="音频调整");
  t[0]>=4 && t[0]<=7   && (i="切灯效");      t[0]>=8 && t[0]<=11 && (i="切侧灯效");
  t[0]===12 && t[2]===0 && (i="切换DPI");    t[0]===2 && t[2]===0 && (i="切换回报率");   t[0]===1 && (i="切配置");
  t[0]===3 && (t[2]===8 && (i="切fn配置"), t[2]===9 && (i= t[2] ? "省电模式":"常规模式"),
               t[2]===4 && (i= t[1] ? "省电模式":"常规模式"),
               (t[2]===0||t[2]===2) && (i = t[1]&2 ? "切MAC":"切WIN"));
  t[0]===29 && (i="切换磁轴模式");
};
```
⇒ vendor notifications are 3-byte-prefixed: `[reportId(0)] [cmd] [p1] [p2] …`.
Over BT the same payload is wrapped as `[reportId] [0x66] [cmd] [p1] [p2] …` (§6.3).
`开始/停止/磁轴行程` are emitted immediately; any other known type is emitted as `开始` first and then as its own type after `vendorOnRecvTime = 300` ms `[pretty:31216-31229]`. While a vendor event is active, `_K.blockCommonData` makes every `sendMsg/readMsg` wait in 100 ms steps `[pretty:31621-31629]`.

---

## 8. Browser (WebHID) implementation notes

### 8.1 What Chromium actually allows (verified against Chromium sources)

Chromium filters reports per *report*, not per device (`content/browser/hid/hid_service.cc`, `HidService::RemoveProtectedReports` → `device::HasReportInAlwaysProtectedCollection` → `services/device/public/cpp/hid/hid_report_utils.cc`, `IsAlwaysProtected`):

* a collection on **usage page 0x0001 (Generic Desktop)** with usage Pointer(0x01)/Mouse(0x02)/**Keyboard(0x06)**/Keypad(0x07): its **input and output** reports are stripped; **feature reports are kept**. System-control usages 0x80… and usage page 0x0008 are always stripped.
* If a device (Linux: one **hidraw node = one USB interface / one Bluetooth HID node**) has **no** report left in any collection, it is not returned by `getDevices()`/`requestDevice()` at all.
* `HidDeviceFilter::Matches` compares vendorId/productId and requires some collection to match usagePage (and usage).

### 8.2 Verdict per transport

| path | feasible in Chrome/Linux? | why |
|---|---|---|
| **2.4G dongle 0x5006** (usage 2 / page 0xFFFF, report 0 feature 64 B) | **Yes.** | The dongle's vendor collection is untouched by the protection filter; feature reports are available. Use `filters:[{vendorId:0x3151,productId:0x5006,usagePage:0xFFFF,usage:2}]`. `sendFeatureReport(0, 64B)` / `receiveFeatureReport(0)` map 1:1 onto the app's SET_FEATURE/GET_FEATURE. |
| **Wired 0x5002** (same vendor interface, iface 2) | **Yes** (same as above). | The boot-keyboard interface of the same product is a different hidraw node and is protected, but we never need it. |
| **Vendor notify channel** (usage 1 / page 0xFFFF, report 0 input) | **Yes**, if the device exposes it as its own node (that is what `qx`+interfaceNumber 1 implies). | input reports in a vendor-page collection are not filtered. Use `inputreport` events. |
| **Bluetooth keyboard** (usage 0x0202 / page 0xFF55, report 6 out-input 65 B) | **Probably, with two caveats.** | On Linux a paired BT HID keyboard appears as a hidraw node (Chromium `hid_service_linux.cc` enumerates udev `hidraw` and maps `BUS_BLUETOOTH`), and the vendor-page collection survives filtering. Caveats: (1) the BLE **pid is UNKNOWN** (§1.4) — enumerate with `navigator.hid.getDevices()` after pairing, or request by usage only; (2) if the 64-byte vendor output report is declared *inside* the keyboard top-level collection it will be stripped (output reports of a Generic-Desktop/Keyboard collection are always protected) — dump `device.collections` and check that report id 6 exists before relying on it. |

Additional practical notes:
* Report-count ambiguity for BT: the app pads to **65** bytes for report id 6. Chromium's `reportCount` for report id 6 excludes the report id, so if `collections[…].outputReports` says `reportCount: 64`, send 64 bytes (0x55 + 63 zeros) — sending 65 will throw.
* For report ID 0 feature transfers, `receiveFeatureReport(0)` returns the 64 raw data bytes (no report-id byte) — exactly the buffer the app's decoders index into (`r[0]`, `r[1]`, …, `r[8]`).
* Linux permissions: `/dev/hidraw*` must be readable/writable by the user running Chrome (a udev rule or `uaccess` ACL is usually needed for vendor interfaces of keyboards/dongles).
* Filters that name a keyboard usage (page 0x01 usage 0x06/0x02) never match: those collections' input/output reports are stripped before matching, so a pure boot-keyboard node simply resolves to an empty device list (Chromium does **not** throw for such filters — `HIDDeviceFilter::Matches` in `services/device/public/cpp/hid/hid_device_filter.cc` only compares vid/pid/usagePage/usage, and Blink's `HID::requestDevice` only validates filter structure). A browser re-implementation should therefore use only the `ng` / `qx` / `Xx` rows for the K98 PRO, not the app's `ig`/`rg`/boot tables.
* Everything the app does through the native IOT sidecar (`St.controlDeviceLight`, `St.controlDeviceLoopCheckStatus`, `[pretty:31900]`) is a no-op for a web implementation.

### 8.3 Minimal working sequence (browser)

**2.4G dongle**
```js
const [dev] = await navigator.hid.requestDevice({ filters: [
  { vendorId: 0x3151, productId: 0x5006, usagePage: 0xFFFF, usage: 2 },
  // optionally also: { vendorId:0x3151, productId:0x5006, usagePage:0xFFFF, usage:1 }  (vendor notifications)
]});
await dev.open();
const set = d => dev.sendFeatureReport(0, Uint8Array.from([...d, ...new Uint8Array(64 - d.length)]));
const get = () => dev.receiveFeatureReport(0).then(v => new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
const f7 = async () => { await set([0xF7]); await sleep(10); return await get(); };
async function canSend(t){ for (let i=0;i<5;i++){ await sleep(100); const s = await f7();
    const m = s[6], ok = s[5]===1 && (t==='keyboard' ? (m===1||m===3) : (m===2||m===3));
    if (ok) { if (t==='keyboard'||t==='mouse'){ await sleep(10); await set([0xF6, t==='keyboard'?0x0A:0x05]); } return true; } }
  return false; }
async function canRead(t){ for (let i=0;i<5;i++){ await sleep(100); const s = await f7();
    const m = s[6], on = t==='keyboard' ? (m===1||m===3) : (m===2||m===3);
    if (on && s[0]===1) { await sleep(10); await set([0xFC]); return true; } } return false; }
function encode(frame, variant=0){ const r = frame.length>9 ? [...frame] : [...frame, ...new Array(9-frame.length).fill(0)];
  const sum = (a)=>a.reduce((x,y)=>x+y,0);
  if (variant===0) r[7] = 255 - (sum(r.slice(0,7)) & 255);
  if (variant===1) r[8] = 255 - (sum(r.slice(0,8)) & 255);
  return r; }
async function cmd(frame, variant=0){ const f = encode(frame, variant);
  if (!await canSend('keyboard')) throw new Error('not sendable');
  await sleep(10); await sleep(10); await set(f);
  if (!await canRead('keyboard')) throw new Error('not readable');
  await sleep(10); return await get(); }
const r = await cmd([0x8F]);                       // -> [0]=0x8F, id = LE32 at bytes 1..4 = 0x00000EC4
```

**Bluetooth**
```js
// 1) pair the keyboard in the OS (BlueZ); 2) find it:
const devs = await navigator.hid.getDevices();
const dev = devs.find(d => d.vendorId === 0x3151 && d.collections.some(c => c.usagePage === 0xFF55 && c.usage === 0x0202));
await dev.open(); dev.addEventListener('inputreport', onReport);
const send = d => dev.sendReport(6, Uint8Array.from([...d, ...new Uint8Array(65 - d.length)]));
let buf = [];
function onReport(e){ const t = [e.reportId, ...new Uint8Array(e.data.buffer)];
  if (t[1] === 0x55) buf.push(t.slice(2));                 // command response (no 0x55, no report id)
  else if (t[1] === 0x77) status = { online:true,  battery:t[2] };
  else if (t[1] === 0x88) status = { online:false, battery:(status && status.battery) || 0 };
  else if (t[1] === 0x66) vendorNotify(t.slice(2), t.slice(1)); }
async function btCmd(frame, variant=0){ const f = [0x55, ...encode(frame, variant)];
  buf = []; await sleep(100); await send(f); await sleep(200);
  const out = buf.length ? buf[buf.length-1] : undefined; buf = []; return out; }
await send([0x77]); await sleep(200);                       // status poll (no 0x55/checksum)
const id = await btCmd([0x8F]);                             // -> 8F C4 0E 00 00 …
```

---

## 9. UNKNOWN / must be verified on hardware

1. **Meaning of byte 0 of the 0xF7 status response.** The app requires `r[0]===1` for `isCanRead` and otherwise ignores byte 0 (no 0xF7 echo check, unlike 0x8F/0xF1). Whether the real dongle answers `01 …` (status flag) or `F7 …` (echo) could not be determined from static code — dump the raw 64-byte response first and adapt.
2. **Exact semantics of bytes 7, 9, 10, 11 of the 0xF7 response** — only bytes 0,1,2,3,4,5,6,8 are read anywhere in this bundle. Byte 7 is used only by a *mouse* class (`6289e0ab.js`: `t[7]===1 && t[8]===1`).
3. **0xFE (send length) semantics and payload** — implementation exists (`[pretty:31459]`) but has no call site; never exercised by this build.
4. **K98 PRO V2 Bluetooth PID** — not derivable from the app (device table only has 20482). Candidates: the 15 `0x3151` rows in `yM` (§1.4).
5. **Whether the BT vendor/frame reports live in a separate top-level collection** from the keyboard collection, and the real report count of report id 6 (64 vs 65) — must be read from `device.collections` at runtime; this decides whether the BT control path is usable from WebHID at all.
6. **Hidden per-command semantics of the 64-byte FEA payloads** (macro/light/screen…): only the transport framing is documented here. The `FEA_CMD_*` map is `[kbd:10-51]` and `[kbd:84-91]`.
7. **Why `wB.sendMsg` calls `this.isUsing.delete(o)` immediately after `add(o)`** `[pretty:31501]` (looks like an app bug; it makes the `isUsing` lock non-functional for the *send* half). Re-implementations should keep a real lock.
8. `dR` (the device-definition sub-list holding the K98 PRO entry) is not exported by name in the bundle; the offset `[idx:790901]` is where the literal starts.
