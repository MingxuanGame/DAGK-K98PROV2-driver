# DAGK K98 PRO V2 — firmware / config flashing path (刷写)

Scope: read-only reverse engineering of the unpacked Electron app in `app/resources/app/`.
All citations are `<file> @<byte-offset>` inside `app/resources/app/dist/js/`.
Line references to `work/*.pretty.js` / `work/*.fmt.txt` are given where a beautified copy exists.
**Byte-exact, no guessing: anything not proven by code is marked UNKNOWN.**

---

## 0. TL;DR — the answer

**Firmware flashing for the K98 PRO V2 can NOT be done over the 2.4G dongle and can NOT be done over Bluetooth.**

* Every upgrade entry point in the UI is hard-gated with `deviceType.connect !== "usb"` and shows the string
  `升级模式只能在有线模式下进行` / EN `"Upgrade mode can only be performed in wired mode"`
  (`86db41a2.js @3041`, `a3768b21.js @2026`, `index.630fe4af.js @1668251`).
* A device reached through the dongle is registered with `connect === "24g"` (`index @1569505`, `@1570031`),
  a BLE device with `connect === "bt"` (`index @1585290`). Both are rejected by the gate.
* The upgrade protocol object is **constructed with `connect:"usb"` forced** (`index @1755080`), i.e. the whole
  flasher is written for direct HID **feature** reports on the *wired* interface. For a BT filter the
  transport advertises report `{reportId:6, reportCount:65, type:"out-input"}` (`index @1025188`) and
  `___sendFeature` only accepts `feature`/`all` (`index @1566995`) → the very first data packet would fail.
* The wired K98 PRO re-enumerates into a dedicated bootloader HID device (0x3151:0x5001, `helpYc3123`) and
  is then flashed over USB.

There *is* an RF ("rf") upgrade code path in the framework (`boot_rf`, `upgrade_rf`, cmd 0xF8/0xF7, method "rf"),
but it is only selected (a) while the keyboard is **plugged in by USB cable** and the server manifest carries an
`rfv` version part + `firmwareRFFile.bin`, or (b) in the recovery page for a boot device that is **not** in the
boot-device table. It is never selected for a `connect:"24g"` / `"bt"` device. Details + quotes in §12.

---

## 1. Object graph for the K98 PRO (who implements what)

| Layer | File @offset | Class / member |
|---|---|---|
| device entry | `index.630fe4af.js @790919` | `{id:3780, vid:12625 (0x3151), pid:20482 (0x5002), name:"yc3123_kk_k98_pro_3m_1k", displayName:"K98PRO", company:"DAGK", type:"keyboard"}` |
| lazy chunk map | `8eaa0b27.js @19939` | `yc3123_kk_k98_pro_3m_1k: () => import("./530511ba.js").then(_=>({default:_.Yc3123_kk_k98_pro_3m_1k}))` |
| device class | `530511ba.js @128` | `class e extends t` (t = `C` from 1dadcb6b) — only matrices/keymaps, no protocol |
| K98 protocol | `1dadcb6b.js @795` | `class U extends u` (u = `C` from b469c422) → `getDeviceIsBoot` @813, `upgrade` @927 |
| upgrade protocol | `1dadcb6b.js @98` | `class r extends w` (w = `am` = `tp` in index) → `checkIsCanStartUpgrade`, `checkUpgradeIsSuccess`, `upgrade_usb` |
| generic boot/flash | `index.630fe4af.js @1755075` | `class tp extends _K` → `upgradeFirmware`, `boot_usb`, `boot_rf`, `upgrade_usb`, `upgrade_rf`, `checkRFIsEnterBoot/ExitBoot` |
| keyboard base | `b469c422.js @1719` | `class at extends j` (j = `ae` = `_K`) → `upgrade`, `rfUpgrade`, `oledUpgrade`, `flashUpgrade`, `getUSBVersion`, `getRFVersion` |
| FEA base | `index.630fe4af.js @1573762` | `class _K extends kg` → `sendMsg`, `readMsg`, `commonMsg`, `___encodeCmd`, `___sendFeature`, `___write`, `destory` |

Effective K98 PRO members: `upgrade()` is **overridden** by `U` (1dadcb6b @795);
`rfUpgrade / oledUpgrade / flashUpgrade` are **inherited unchanged from `at`**
(b469c422 @36017 / @36233 / @36439).

Export aliases used below (`index.630fe4af.js @2523319`):
`tp as am`, `_K as ae`, `ki as aj`, `rr as an`, `B0 as ao`, `Wi as ap`, `it as ar`, `di as o`.

---

## 2. Transport & framing (prerequisite for a WebHID re-implementation)

### 2.1 HID filters / report shape
* Wired K98 PRO HID interface: `{type:"keyboard", vendorId:12625, productId:20482, usage:2, usagePage:65535, interfaceNumber:2}`
  (`index @1001383`, inside the `ig` array which starts @999311).
* Bootloader HID interface: `{type:"bootKeyboard", vendorId:12625, productId:20481, usage:1, usagePage:65281 (0xFF01), interfaceNumber:0}`
  (`index @1026352`, inside `hM` which starts @1025282).
* Filters without an explicit `reports` array default to **feature report id 0, 64 bytes**:
  `reports:(r.reports??[{reportId:0,reportCount:64,type:"feature"}])` (`index @1041317`, `@1559894`).
  → every `sendMsg` on a wired K98 PRO goes out as **SET_FEATURE, report id 0, 64-byte payload**.

### 2.2 Checksum modes
~~~js
var ki=(e=>(e[e.Bit7=0]="Bit7",e[e.Bit8=1]="Bit8",e[e.None=2]="None",e))(ki||{});   // index @1562953
Wi=e=>e.reduce((t,i)=>t+i,0);                                                       // index @1561453 (plain 32-bit byte sum)
~~~

~~~js
// index @1571354  (_K)
___encodeCmd=(t,i)=>{
  const r = t.length>9 ? t : new Uint8Array([...t,...new Uint8Array(9-t.length)]);   // pad short frames to 9 bytes
  if(i===ki.Bit7){const n=Wi([...r].slice(0,7)); r[7]=255-(n&255)}                   // Bit7: byte7 = 255-(sum(bytes0..6)&255)
  if(i===ki.Bit8){const n=Wi([...r].slice(0,8)); r[8]=255-(n&255)}                   // Bit8: byte8 = 255-(sum(bytes0..7)&255)
  return this.CONNECT==="bt" ? new Uint8Array([85,...r]) : r                         // BT frames get a 0x55 prefix
};
~~~
**A 64-byte payload is never padded and never checksummed** (`t.length>9` → returned as-is), which is why firmware
data chunks are sent with `ki.None`. The final short chunk of a file is sent short (the HID layer zero-pads it to 64).

### 2.3 send / read
~~~js
// index @1578694
sendMsg=async(t,i,r=this.SEND_TIME)=>{ ... const n=this.___encodeCmd(t,i);
  if(this.CONNECT==="24g"){ if(!this.dongle)return!1;
     const a=this.deviceType.type==="keyboard"?"keyboard":"mouse";
     return await this.dongle.sendMsg(n,i,r,a) }               // <- 2.4G goes through the dongle object
  return r>0&&await it(r),
         this.CONNECT==="bt" ? (this.btReadDatas=[], await this.___write(n))
                             : await this.___sendFeature(n) };  // <- USB / BT split
// index @1579639
commonMsg=async(t,i,r=this.SEND_TIME,n=this.READ_TIME)=>{
  if(this.CONNECT!=="bt") return this.___commonMsg(t,i,r,n);
  {let a=0,o=await this.___commonMsg(t,i,r,n); for(;o===void 0&&a<3;)a++,o=await this.___commonMsg(t,i,r,n); return o}};
~~~
* USB: `___sendFeature` (`index @1577273`) picks `reports.find(type==="feature"||"all")` → `sendFeature(0,data)`;
  `___getFeature` picks the same report → `getFeature(0)`.
* BT: `___write` requires `output|out-input|all` (report 6 for BLE filters) and reads come from an
  `inputreport` listener (`___decodeBtInputData`, `index @1576182`). SEND_TIME/READ_TIME become 100/200 ms
  (`index @1574422`). **None of the upgrade code ever runs in this mode.**
* Native bridge sends `[reportId, ...data, pad to reportCount]` (`index @1554009`); reads strip the echoed
  report id (`@1554573`). The WebHID transport (`index @1557432`) pads to 64 and calls
  `device.sendFeatureReport(0,data64)`, reads with `device.receiveFeatureReport(0)` and only strips a leading
  byte when `reportId!==0` (`@1558700`).

---

## 3. UI entry points and the "wired only" gate

The upgrade request is staged in a store slice:

~~~js
class l{升级事件="none_调用结束";升级查找设备中=!1;升级成功次数=0;state={progress:0,errMsg:""};需要升级的列表=[]}  // index @158507 (设备升级)
~~~

Firmware-upgrade lists are built in exactly four places. **Three of them bail out unless the device is on USB:**

~~~js
// index.630fe4af.js @1668251  (store helper; no caller found in the bundle)
async getFirmwareUpgradeListFromServer(){
  if(this.getCurrentDevice().deviceType.connect!=="usb")return;      // <<< HARD GATE
  ...
  a(r[s],o.usb)&&l.push({method:"usb",file:n.fw});
  u.includes("rfv")&&n.fwRF!==void 0&&a(u,o.rf)&&l.push({method:"rf",file:n.fwRF});
  u.includes("oledv")&&...push({method:"oled",file:n.fwOled});
  u.includes("flashv")&&...push({method:"flash",file:n.fwFlash});
~~~

~~~js
// 86db41a2.js @3041  (exported as Page_更多页_web)   and   a3768b21.js @2026 (Page_更多页, Electron)
if(s.getCurrentDevice().deviceType.connect!=="usb"){
   w.error(t.升级模式只能在有线模式下进行,f), l(!1); return }          // <<< HARD GATE
...
E.push({method:"usb",file:d.fw}) ... {method:"rf",file:d.fwRF} ... {method:"oled",file:d.fwOled} ... {method:"flash",file:d.fwFlash}
s.getCurrentDevice().设备升级.需要升级的列表=E; s.isShowFirmwareUpgradePage=!0
~~~

~~~js
// f5daf7c6.js @1361..1500  (exported as Page_RecoveryMode — shown when deviceType.isBoot)
const c=[];
if(i.isBoot&&(j.some(p=>p.vendorId===i.vid&&p.productId===i.pid&&p.usage===i.usage&&p.usagePage===i.usagePage)
      ? c.push({method:"usb",file:n.fw})
      : n.fwRF!==void 0&&c.push({method:"rf",file:n.fwRF})), c.length===0){ ... }
a.getCurrentDevice().设备升级.需要升级的列表=c, t.isShowFirmwareUpgradePage=!0
~~~
(`j` here is import `C` from index = `Bd`, the boot-device filter list — see §6.)

i18n proof of the gate's meaning (`index @1328750`):
`升级模式只能在有线模式下进行: {cn:"升级模式只能在有线模式下进行", en:"Upgrade mode can only be performed in wired mode", ...}`

Progress dialog: `7bcf6f4b.js @627` (exported `F`) sets `设备升级.升级事件="start_开始调用"` only after the list is
non-empty; for `deviceType.isBoot` it uses the alternate confirm handler.

---

## 4. The upgrade task (`Qp`) — how `upgrade()` is invoked

~~~js
// index @1757535
class Qp{dev;dj;constructor(t,i){this.dev=t,this.dj=i}
 upDeviceByMethod=async(t,i,r)=>{switch(i){
   case"usb":   return await this.dev.upgrade(t,r);
   case"rf":    return await this.dev.rfUpgrade(t,r);
   case"nordic":return!1;
   case"mled":  return!1;
   case"oled":  return await this.dev.oledUpgrade(t,r);
   case"flash": return await this.dev.flashUpgrade(t,r)}};
~~~
`Qp` is a member of every device task list — `AB=[Jp,CB,Qp,RB]` (keyboard, index @1781388),
`MB=[Jp,IB,Qp]` (mouse, @1795204), `FB=[Jp,PB,Qp]` (mousePan1080, @1809213), `VB=[OB,Qp]` (dongle, @1812760).

~~~js
// index @1758279  (Qp.writeToDevice — abridged, exact text preserved)
async writeToDevice(){
 if(this.dj.设备升级.升级事件!=="start_开始调用")return;
 ... Xk(!0), this.dev.deviceType.isBoot||await qi.stopLight(this.dj.deviceType.devAddr);
 let i=!1;
 if(!this.dev.deviceType.isBoot) i=await this.upDevice(t);
 else if(t[0].method==="usb") try{
       const r=await this.upDeviceByMethod(t[0].file,t[0].method, s=>{this.dj.设备升级.state.progress=s}),
             o=zt.find(s=>s.pid===this.dev.deviceType.pid&&s.vid===this.dev.deviceType.vid);
       if(o&&(o.name==="helpMouse8K"||o.name==="helpKeyboard8k")){ ...checkRFIsExitBoot loop... }
       else r!==rr.SUCCESS?i=!1:i=!0 } catch{...}
 else t.length===1&&(i=await this.upDevice(t));     // <- boot device + non-usb method (i.e. "rf")
~~~
Progress mapping (`upDevice`, index @1757842): `this.dj.设备升级.state.progress=(n/i+r*l)*.99`, and the whole list is
capped at 0.99 until the final `progress=1`.

Return codes (`var rr=...`, index @1754001): `SUCCESS=0, FAILED=1, NOT_DEVICE=2, NOT_BOOT=3, ENTER_BOOT_FAILED=4,
FILE_ERROR=5, LOCK_DEVICE_ERROR=6, SEND_DATA_FAILED=7`.

---

## 5. `connect` — where usb / 24g / bt come from

~~~js
// index @1584767  ___connectDev
if(r==="vendor"&&!mc.has(i)){ new _B(...); return }
if(r==="dongle"&&!Ws.has(i)){ const n=new wB(t.deviceFilter,t.thid); ... await n.dongleWhoAmI(); return }
if(r==="keyboard"||r==="mouse"||r==="ble"){
   let n=new pK({id:0,isExclusive:!1,connect:r==="ble"?"bt":"usb", ...});      // <<< BT vs USB
   const a=new _K(n); ... await a.whoAmI(); ... return }
if(r==="bootKeyboard"||r==="bootMouse"||r==="bootDongle"){
   const n=fd(0,"usb",t.deviceFilter,t.thid); ... ci.set(a,n), mn.next({type:"add",deviceType:n,battery:0}); return }
~~~
* Devices reached *through a dongle* are registered with `connect:"24g"`:
  `const r=fd(i,"24g",this.DEVICE_FILTER,this.THID)` (`index @1569505` keyboard, `@1570031` mouse); the keyboard id
  is read over RF with cmd `0x8F` (`___getNormalID`, `index @1572550`).
* Boot devices are always registered with `connect:"usb"` and resolved through `fd` → `zt` → `isBoot:true` (§6).
* `getDeviceIsBoot()` runs right after the device object is built (`index @1813994`):
  `const l=await r.getDeviceIsBoot(); n.deviceType.isBoot=l;` and only `if(!n.deviceType.isBoot)` are versions read:
  `version.usb=await r.getUSBVersion(), version.rf=await r.getRFVersion(), version.mled=..., version.oled/flash=...`
  (`index @1814202..1814590`). The RF entry in the upgrade list therefore needs `version.rf`, which is read even on
  a USB connection; the list builder itself is still USB-gated.

---

## 6. Boot device table (`Bd` / `zt`) and re-enumeration

~~~js
Bd=[...hM,...fM,...gM];          // index @1029281  "boot keyboard" + "boot mouse" + "boot dongle" HID filters
~~~
YC3123 (vid 12625) entries:
* `hM` (bootKeyboard, usage 1 / usagePage 0xFF01 / iface 0): 16385, 16397, 16406, 16409, 16410, 16438, 16443, **20481**, 20516, 20522, 20557, 20567
* `fM` (bootMouse): 16394, 16421, 16427, 20534, 20539, 20548, 20569
* `gM` (bootDongle): 16425, 16430, 16441, 20520, 20537, 20542, 20550, 20571   ← **20486 (the K98 PRO dongle) is NOT listed**

Boot device types (`zt`, index @498311) — the K98 PRO's counterpart:
~~~js
{isBoot:!0,id:-112,vid:12625,pid:20481,name:"helpYc3123",displayName:"help",type:"keyboard",company:""}   // index @499178
~~~
`fd` maps a matching HID filter to that entry (`index @1565598`):
`u===12625&&m===20481?a=zt.find(y=>y.vid===12625&&y.pid===20481)`.

**Evidence that the wired K98 PRO (0x5002) becomes 0x5001 in boot mode** (no per-device mapping is hard-coded,
so this is an inference from three facts, flagged as such):
1. `20482` (0x5002) appears only as a *normal* keyboard filter/device id (`index @1001383`, `@790919`); it is not in `Bd`.
2. `20481` (0x5001) appears in exactly three places: the `zt` boot entry `helpYc3123`, the `hM` boot filter,
   and the `fd` mapping — all three YC3123-specific, and 0x5001 = 0x5002 − 1.
3. The same −1 pattern holds for other YC3123 keyboards (16386→16385, 16411→16410, 16444→16443, 20517→20516).

`findBootDevice` (index @1754465) does **not** filter by the current device — it matches *any* live HID device
against *any* `Bd` entry:
~~~js
e.findBootDevice=async(i={findDelay:1e3,maxFindCount:10})=>{ ...
  a=Array.from(ci.values()).find(s=>Bd.some(u=>u.vendorId===s.filter.vendorId&&u.productId===s.filter.productId
        &&u.usage===s.filter.usage&&u.usagePage===s.filter.usagePage)), o++, await di(r); return a};
~~~

---

## 7. `boot_usb()` — definition, exact bytes, re-enumeration

Defined in **`index.630fe4af.js @1756411`** (class `tp`, exported as `am`; inherited by `1dadcb6b.js` class `r`):

~~~js
boot_usb=async()=>Bd.some(i=>i.vendorId===this.deviceType.vid&&i.productId===this.deviceType.pid
      &&i.usage===this.deviceType.usage&&i.usagePage===this.deviceType.usagePage)
   ? this.deviceType
   : (await this.sendMsg(new Uint8Array([127,85,170,85,170,0,0,ki.Bit7]),ki.Bit7),
      await di(1e3),
      await B0.findBootDevice());
~~~
Behaviour, byte-exact:
1. If the *current* deviceType already matches a `Bd` entry (vid/pid/usage/usagePage) → we are already in the bootloader;
   return the current deviceType (no command sent).
2. Otherwise send the 8-element frame `[0x7F,0x55,0xAA,0x55,0xAA,0x00,0x00,ki.Bit7=0]` with `ki.Bit7`:
   `___encodeCmd` pads it to 9 bytes and writes `byte[7]=255-((0x7F+0x55+0xAA+0x55+0xAA+0+0)&0xFF)=0x82`.
   → transmitted payload (64 B, feature report id 0): `7F 55 AA 55 AA 00 00 82 00` + 55 × `00`.
   (Derived from the algorithm above; not observed on the wire.)
3. `await di(1000)`.
4. `B0.findBootDevice()` polls the live device map every 1000 ms, up to 10 times.
5. `upgrade_usb` then waits another 1000 ms and builds the upgrade protocol object on the **new** device.

Re-enumeration: the app does **not** assert a VID/PID. It relies on the OS re-enumerating the keyboard into one of the
`Bd` HID interfaces. For the K98 PRO that is expected to be **0x3151:0x5001, usage 1, usagePage 0xFF01, interface 0** (§6).
The boot device is registered by `___connectDev` as `fd(0,"usb",...)` → deviceType `helpYc3123`, `isBoot=true`,
`connect="usb"`; the `Page_RecoveryMode` page is then shown (`f5daf7c6.js`; trigger `deviceType.isBoot` in
`9262221c.js @19717`). After a successful flash `Qp.writeToDevice` emits `{type:"remove"}` and does **not** re-add
the boot device, i.e. it expects the normal pid to come back.

`boot_rf()` (index @1756717) is the 2.4G twin — see §12.

---

## 8. `upgrade_usb` / `upgradeFirmware` (the K98 PRO path)

~~~js
// 1dadcb6b.js @98   class r extends w (=tp)
checkIsCanStartUpgrade=async(e,n)=>{const s=new Uint8Array(64),t=new DataView(s.buffer,s.byteOffset,s.byteLength);
    return t.setUint8(0,186),t.setUint8(1,192),t.setUint32(8,e,!0),await this.commonMsg(s,i.Bit7)!==void 0};   // 0xBA 0xC0
checkUpgradeIsSuccess=async(e,n,s)=>{const t=new Uint8Array(64),a=new DataView(t.buffer,t.byteOffset,t.byteLength);
    a.setUint8(0,186),a.setUint8(1,194),a.setUint32(8,e,!0),a.setUint32(12,n,!0);
    const o=await this.commonMsg(t,i.None,100,100); return o!==void 0&&o[2]===85};                          // 0xBA 0xC2
upgrade_usb=async(e,n,s,t)=>{t(0);const a=await this.boot_usb(); if(a===void 0)return m.NOT_BOOT;
    await d(1e3); const o=new r(a); let c=await o.upgradeFirmware(e,n,s,t); return t(1),o.destory(),c}}        // (d,m)=(di,rr)

// 1dadcb6b.js @795   class U extends u (=at)
getDeviceIsBoot=async()=>{const e=await this.commonMsg(new Uint8Array([143]),i.Bit7);
    return e!==void 0&&e[9]===1};                                                                           // 0x8F, resp byte 9 == 1
upgrade=async(e,n)=>{n(0); const s=new r(this.deviceType), t=await s.upgrade_usb(e,65536,10,n);
    return s.destory(),n(1),t}
~~~

`upgradeFirmware` (inherited from `tp`, **index @1755666**):
~~~js
upgradeFirmware=async(t,i,r,n)=>{                       // t=file, i=skipBytes, r=per-packet delay, n=progress cb
  if(n(0), t.length<=i) return rr.FILE_ERROR;           // K98 PRO: i=65536
  let a=t.slice(i);                                     // <<< FIRST 64 KiB OF THE FILE ARE DROPPED
  const o=64, l=Math.ceil(a.length/o);                  // 64-byte chunks
  let s=!1,u=0;
  for(;!s&&u<10;) s=await this.checkIsCanStartUpgrade(l,a.length), u++, await di(1e3);   // up to 10 tries, 1 s apart
  if(!s) return rr.FAILED;
  for(let h=0;h<l;h++){
     const f=h*o>a.length?o-(h*o-a.length):o;           // always 64 in practice; slice() clamps the last chunk
     const g=a.slice(h*o,h*o+f);
     if(!await this.sendMsg(g,ki.None,r)) return rr.SEND_DATA_FAILED;   // raw 64-byte block, no checksum byte
     n(h/l) }                                                            // progress 0..1
  const m=Wi([...a]);                                                   // checksum = 32-bit sum of ALL payload bytes
  return await this.checkUpgradeIsSuccess(l,m,a.length) ? rr.SUCCESS : rr.FAILED };
~~~

Concrete parameters for the K98 PRO (from `class U.upgrade`): **skip = 65536 B, delay = 10 ms/packet, chunk = 64 B,
progress = blocksDone/blocksTotal, checksum = byte sum of `file.slice(65536)`, retries = 10 × 1 s.**

### 8.1 Frames actually produced (K98 layout, class `r`)

| Step | Bytes 0..1 | 2..7 | 8..11 | 12..15 | 16..63 | checksum |
|---|---|---|---|---|---|---|
| can-start (`0xBA 0xC0`) | `BA C0` | 00 | `blockCount` u32 LE | 00 | 00 | Bit7 → byte7 = `0x85` constant (0xBA+0xC0=378, 378&0xFF=122, 255−122=133) |
| is-success (`0xBA 0xC2`) | `BA C2` | 00 | `blockCount` u32 LE | `byteSum` u32 LE | 00 | `ki.None` → byte7 stays 0 |
| data block *n* | file payload bytes | — | — | — | — | `ki.None`, 64 B (last one short) |

Answer to can-start = "any response"; answer to is-success must have **payload byte[2] === 0x55**.
(`commonMsg(t,ki.None,100,100)` = 100 ms before sending, 100 ms before reading.)

**Caution — the generic `tp` layout is different** (index @1755200 / @1755420):
`0xBA 0xC0` + `u16 blockCount@2` + `u32 length@4`, Bit7 checksum → **the checksum in byte 7 overwrites the top
byte of the 32-bit length**; and `0xBA 0xC2` + `u16 blockCount@2` + `u32 checksum@4` + `u32 length@8`, answer byte[4]===0x55.
The K98 PRO uses the `r` layout, not this one.

---

## 9. What file is uploaded, and where it comes from

~~~js
// index @1195634  (yd = update API module)
const vy=(e,t)=>Fv(x7+e,t,{timeout:8e3});
yd.getFwVersion = async y => await vy("/get_fw_version",{dev_id:y});
const i="firmwareFile.bin", r="firmwareOledFile.bin", n="firmwareMledFile.bin",
      a="firmwareRFFile.bin", o="firmwareNordicFile.bin", l="firmwareFlashFile.bin";
yd.downloadAllDevUpgradeFile = async y=>{
   const h=await tm(Ky+"/"+y.file_path); if(h.errCode!==0)return;
   let f,g,k,v,b,K; const S=y.version_str.match(/[^_]+/ig);
   if(S!==null&&S.length>1){ const C=new Mk; await C.loadAsync(Buffer.from(h.data));   // Mk = JSZip
        f=await t(C,i); g=await t(C,a); k=await t(C,r); v=await t(C,n); b=await t(C,o); K=await t(C,l) }
   else f=pi.inflateRaw(h.data);                                                      // pi = pako
   return {fw:f, fwRF:g, fwOled:k, fwMled:v, fwNordic:b, fwFlash:K}};
~~~
* API base `x7 = "https://api2.rongyuan.tech:3816/api/v2"`, download base `Ky = "https://api2.rongyuan.tech:3816/download"`
  (`index @1200244 / @1200288`).
* The upgrade list is keyed on `version_str` split by `_`; the **first part is the USB firmware** (`method:"usb", file:fw`),
  later parts matching `rfv / nordicv / mledv / oledv / flashv` select `fwRF / fwNordic / fwMled / fwOled / fwFlash`.
  A part is accepted only when its parsed number exceeds the device's `version.<kind>` — hex for normal devices,
  decimal for `type:"dongle"` with `version.usb>200` (`86db41a2.js @3600`).
* So a raw-deflated `.bin` (single-part manifest) or a ZIP containing `firmwareFile.bin` etc. is downloaded and
  **passed to `upgrade()` unparsed**; the only structural knowledge the client has is the fixed 64 KiB prefix that
  `upgradeFirmware` slices off.

---

## 10. OLED / TFT variants — `85888098.js`

Exported `S as B`; imported by `b469c422.js` as `H` and by `530511ba.js`. `class S extends _K`
(`85888098.js @94`) — ordinary FEA commands sent over the *existing* HID interface, **no re-enumeration at all**:

| Const | Value | Meaning (as used) |
|---|---|---|
| `FEA_CMD_SET_OLEDBOOTLOADER` @112 | 48 = **0x30** | enter OLED bootloader, payload `30 55 AA 55 AA` (`enterBoot @235`) |
| `FEA_CMD_GET_OLEDBOOTLOADER` | 176 = **0xB0** | poll until `resp[0]===0xB0 && resp[1]===1`; 5 tries × 3000 ms |
| `FEA_CMD_SET_OLEDBOOTSTART` | 49 = **0x31** | start: `u16 chunkCount` LE @1, Bit7 |
| `FEA_CMD_GET_OLEDBOOTCHECKSUM` | 177 = **0xB1** | `u32 checksum` LE @1, Bit7, read delay 1000 ms, success = `resp[1]===0x55` |
| `FEA_CMD_SETTFTFLASHDATA` | 50 = **0x32** | TFT/"flash" data: 56-byte payload, index u32 LE split across bytes 1..4 |
| `FEA_CMD_GETTFTFLASHDATA` | 178 = **0xB2** | `u32 chunkCount` @1, expect `resp[0]===0xB2 && resp[1]===1` |

~~~js
// 85888098.js @1050
upgrade=async(a,t)=>{ if(t(0), a.length<=65536) return o.FILE_ERROR; const e=a.slice(65536);   // same 64 KiB skip
   if(!await this.enterBoot()) return o.ENTER_BOOT_FAILED;
   const n=64, D=Math.ceil(e.length/n); await this.checkIsCanStartUpgrade(D);
   for(let i=0;i<D;i++){ ... if(!await this.sendMsg(T,E.None)) return o.SEND_DATA_FAILED; t(i/D) }
   const r=O([...e]);                                                                          // O = Wi
   const A=await this.checkUpgradeIsSuccess(r); return t(1), A?o.SUCCESS:o.FAILED }
// 85888098.js @1830
flashUpgrade=async(a,t)=>{ t(0); const e=a, s=56, n=Math.ceil(e.length/s);
   if(!await this.getTTFTFlashData(n)) return o.FAILED;
   for(...){ const h=new Uint8Array([0x32,c[0],c[1],i.length,c[2],c[3],0,0,...i]); if(!await this.sendMsg(h,E.Bit7,5)) return o.SEND_DATA_FAILED }
   return t(1), o.SUCCESS }
~~~
Note the OLED `upgrade` sends blocks with `E.None` *without* the `0xBA 0xC0/0xC2` handshake used by `tp`
(it re-implements `checkIsCanStartUpgrade / checkUpgradeIsSuccess` with its own byte layout, @~350 / @~500).

**When are they used?** Only through the `"oled"` / `"flash"` methods of `Qp.upDeviceByMethod`, i.e. when the server
manifest contains an `oledv` / `flashv` part and the device reported a non-zero `version.oled / version.flash`
(`index @1814590`). Both are inherited by the K98 PRO from `b469c422.js`:
~~~js
oledUpgrade =async(t,e)=>{e(0);const n=await K.findSameDevice(this.deviceType.devAddr,this.deviceType.id);
   if(n===void 0)return X.NOT_DEVICE; const i=new H(n), s=await i.upgrade(t,e); return i.destory(),e(1),s};      // b469c422 @36233
flashUpgrade=async(t,e)=>{... const i=new H(n), s=await i.flashUpgrade(t,e); ...};                                // b469c422 @36439
~~~
They reuse the *same* HID interface (`findSameDevice`, index @1754801) — unlike the main MCU flash there is no
re-enumeration and no `isBoot` state. **They are still inside the "wired only" gate**, because the list that carries
their method strings is built in the USB-gated functions of §3.

---

## 11. `FEA_CMD_SET_FLASHCHIPERASSE` (172 = 0xAC) — NOT an upgrade step

~~~js
// 90cac215.js @13995/@14027   (identical in b469c422.js @2335 and 4dac447a.js @3070)
FEA_CMD_SET_FLASHCHIPERASSE=172;
setFlashChipErase=async()=>{const t=new Uint8Array(64); t[0]=this.FEA_CMD_SET_FLASHCHIPERASSE;
   const e=await this.commonMsg(t,_.Bit7);
   return e===void 0?!1:e[0]===this.FEA_CMD_SET_FLASHCHIPERASSE&&e[1]===170&&e[2]===170&&e[3]===85&&e[4]===85};
~~~
Only caller: the **screen-settings task**, when the user asks to clear the screen
(`index @1775275` / `@1811305`): `if(this.dj.屏幕设置.清除屏幕事件==="start_开始调用"){ ... await this.dev.setFlashChipErase() ... }`,
with a ~55 s progress animation. It erases the flash chip holding user pictures/GIFs. **It is not part of
`upgradeFirmware` and does not touch the MCU firmware.**
Caveat: the same constant name is 44 in a different protocol family (`6289e0ab.js @1709`: `FEA_CMD_SET_FLASHCHIPERASSE=44; FEA_CMD_GET_FLASHCHIPERASSE=172`), so 172 is
class-local, not global.

---

## 12. The RF ("rf") / Bluetooth paths — what exists and what is reachable

### 12.1 RF upgrade primitives (present in `tp`, hence in every keyboard)
~~~js
// index @1756156 / @1756284 / @1756717
checkRFIsEnterBoot=async()=>{const t=await this.commonMsg(new Uint8Array([247]),ki.Bit7); return t!==void 0&&t[7]===1&&t[8]===1};  // 0xF7
checkRFIsExitBoot =async()=>{const t=await this.commonMsg(new Uint8Array([247]),ki.Bit7); return t!==void 0&&t[7]===0&&t[8]===0};
boot_rf=async()=>{ if(await this.checkRFIsEnterBoot())return this.deviceType;
   await di(100), await this.sendMsg(new Uint8Array([248,85,170,85,170,0,0,ki.Bit7]),ki.Bit7), await di(2000);  // 0xF8 + magic
   let i=0,r=!1; for(;!r&&i<10;) i++, r=await this.checkRFIsEnterBoot(), await di(100); if(r)return this.deviceType};
upgrade_rf=async(t,i,r,n)=>{ n(0); const a=await this.boot_rf(); if(a===void 0)return rr.NOT_BOOT;
   await di(1e3); const o=new tp(a); let l=await o.upgradeFirmware(t,i,r,n);           // same flasher, 64 KiB skip, 10 ms
   if(l===rr.SUCCESS){ await di(2e3); ...10× checkRFIsExitBoot... } return n(1),o.destory(),l};
~~~
`boot_rf` sends `[0xF8,0x55,0xAA,0x55,0xAA,0x00,0x00,0x09,0x00]` (Bit7 checksum = 255−((0xF8+0x55+0xAA+0x55+0xAA)&0xFF) = 0x09)
padded to 64 B. `boot_rf` **returns the current deviceType** — no re-enumeration; the boot state is reported by the
`0xF7` status command (dongle path decodes `isRFBoot = resp[8]===1`, `index @1568220`).

### 12.2 Who can select method `"rf"`
Only the builders in §3:
* `86db41a2.js @~4067` / `a3768b21.js @~3033` / `index @1668951` — all after `connect!=="usb" → return`.
* `f5daf7c6.js @1372` — `isBoot && NOT in Bd` → `{method:"rf",file:fwRF}`. This is the *recovery* path for a
  bootloader that is not a known USB boot keyboard; the corresponding `zt` entry is e.g.
  `{isBoot:!0,id:-115,vid:1130,pid:302,...}` (not present in `Bd`). For the K98 PRO bootloader (20481) the recovery
  page picks **usb**, because 20481 *is* in `hM`.

### 12.3 Exact quotes for the two forbidden cases
Dongle registration (`index @1569505`):
~~~js
if(t.keyboard.isOnline&&this.keyboardId===void 0&&!t.keyboard.isRFBoot){const i=await this.___whoAmI("keyboard");
   if(this.keyboardId=i,i!==void 0){const r=fd(i,"24g",this.DEVICE_FILTER,this.THID); ...}}
~~~
BLE registration (`index @1585290`):
~~~js
if(r==="keyboard"||r==="mouse"||r==="ble"){let n=new pK({id:0,isExclusive:!1,connect:r==="ble"?"bt":"usb", ...});
~~~
Gate that both of them hit (`86db41a2.js @3041`, `a3768b21.js @2026`, `index @1668251`):
~~~js
if(this.getCurrentDevice().deviceType.connect!=="usb"){ w.error(t.升级模式只能在有线模式下进行,f),l(!1);return }
if(this.getCurrentDevice().deviceType.connect!=="usb")return;
~~~
Forced-USB construction of the flasher (`index @1755080`):
~~~js
class tp extends _K{constructor(t){super({...t,connect:"usb"})}
~~~
⇒ even the `"rf"` variant writes **USB feature reports** to `deviceType.filter.devicePath`.

**Conclusion:** the code never initiates a firmware upgrade while `connect` is `"24g"` or `"bt"`. The only
2.4G-flavoured upgrade is `"rf"` = "update the RF module from the wired connection", or a bootloader with no USB boot
device entry. A plain keyboard (K98 PRO) sitting on its dongle is never flashed.

---

## 13. Notes for a WebHID re-implementation

1. `navigator.hid.requestDevice` filters:
   `{vendorId:0x3151, productId:0x5002, usagePage:0xFFFF, usage:2}` (normal) and
   `{vendorId:0x3151, productId:0x5001, usagePage:0xFF01, usage:1}` (bootloader, after re-enumeration).
2. All traffic is `device.sendFeatureReport(0, <64 B>)` / `device.receiveFeatureReport(0)`
   (report id 0; WebHID does not prefix the payload with the report id — the app accounts for this at `index @1558700`).
3. Flashing sequence (byte-exact):
   1. `sendFeatureReport(0, [7F 55 AA 55 AA 00 00 82 00 …00])` → keyboard reboots to bootloader; wait ~1 s.
   2. Re-open the HID device (new VID/PID), wait another ~1 s.
   3. `payload = file.slice(65536)`; `blocks = ceil(payload.length/64)`.
   4. Up to 10 × [ `BA C0 00×6 85 <blocks u32 LE> 00×52`, wait 1 s, read feature report ] until a reply arrives.
   5. For each 64-byte block: `sendFeatureReport(0, block padded to 64)`, sleep 10 ms, progress = i/blocks.
   6. `sum = Σ payload bytes (32-bit)`; send `BA C2 00×6 00 <blocks u32 LE> <sum u32 LE> 00×48`,
      wait 100 ms, read → success iff `resp[2] === 0x55`.
   7. Device re-enumerates back to 0x5002.
4. No `0x55` prefix and no report id 6 anywhere on this path (that is the BT-only encoding).
5. `0x8F` can be used as a probe: reply byte 9 === 1 means "in bootloader"; reply `byte[8]<<8|byte[7]` is the USB
   firmware version (`b469c422.js @3643`).

---

## 14. UNKNOWN / not proven by the code

* **UNKNOWN**: that the K98 PRO V2 actually re-enumerates as 0x3151:**0x5001**. The code contains no per-device mapping;
  the conclusion is inferred from the −1 pid pattern and the `helpYc3123` entry (§6) and must be confirmed on hardware.
* **UNKNOWN**: the meaning/size of the 64 KiB prefix skipped by `upgradeFirmware` (header? CRC table? reserved?).
  The client never parses it.
* **UNKNOWN**: the names of commands 0x7F (boot USB) and 0xF8 (boot RF) — no `FEA_CMD_*` constant for them exists in any chunk.
* **UNKNOWN**: whether the `0xBA 0xC0` field really is a block count on the device side (the client passes
  `ceil(payload/64)`; the K98 override stores it at offset 8 as u32 and drops the length field).
* **UNKNOWN**: whether a dongle-attached keyboard could in principle be flashed by hand-crafting the `"rf"` sequence
  (0xF8 → feature reports to the dongle interface). The app never tries it; link reliability is not derivable from the bundle.
* **UNKNOWN**: no upgrade path for the K98 PRO dongle itself (0x5006) exists — that pid appears only as a HID filter
  (`ng @1013959`), there is no device definition and it is not in the "dongle with own id" list
  `bB=[{vid:12625,pid:20487},{20512},{20543},{20544},{20555},{...}]` (`index @1566429`), so `dongleWhoAmI()`
  (`index @1573010`) returns without registering anything.

---

## 15. Appendix — offsets used in this document

~~~
index.630fe4af.js  @790919  K98PRO device definition (id 3780)      @1001383 K98PRO wired HID filter (ig)
                   @999311  ig[] start                              @1025188 Xx (BLE filters, report 6/65/out-input)
                   @1025282 hM bootKeyboard                         @1026352 hM entry vid12625/pid20481
                   @1027258 fM bootMouse                            @1028180 gM bootDongle
                   @1029281 Bd=[...hM,...fM,...gM]                  @1041317 default report feature/0/64
                   @498311  zt boot device list                     @499178  helpYc3123
                   @1561453 Wi (byte sum)                           @1562953 ki enum (Bit7/Bit8/None)
                   @1566588 class wB (dongle transport)             @1571354 ___encodeCmd
                   @1573762 class _K                                @1577273 ___sendFeature (USB)
                   @1578694 sendMsg                                 @1579639 commonMsg
                   @1557432 WebHID sendFeature                      @1558700 WebHID getFeature
                   @1569505 fd(id,"24g") keyboard                   @1570031 fd(id,"24g") mouse
                   @1584767 ___connectDev                           @1585290 connect bt|usb
                   @1668251 getFirmwareUpgradeListFromServer (gate) @1754465 findBootDevice
                   @1754801 findSameDevice                          @1754001 rr enum
                   @1755075 class tp                                @1755666 upgradeFirmware
                   @1756411 boot_usb                                @1756717 boot_rf
                   @1757008 upgrade_usb                             @1757203 upgrade_rf
                   @1757535 class Qp                                @1758279 Qp.writeToDevice
                   @1813994 getDeviceIsBoot + version probing       @1195634 downloadAllDevUpgradeFile
                   @1200244 API/download URLs                       @2523319 export map
1dadcb6b.js        @98 class r   @603 upgrade_usb   @795 class U   @813 getDeviceIsBoot
530511ba.js        @128 class e (Yc3123_kk_k98_pro_3m_1k)
b469c422.js        @1719 class at @35897 upgrade @36017 rfUpgrade @36233 oledUpgrade @36439 flashUpgrade
                   @2335 FEA_CMD_SET_FLASHCHIPERASSE=172 @3643 getUSBVersion @3828 getRFVersion
85888098.js        @94 class S @112 0x30 @235 enterBoot @1050 upgrade @1830 flashUpgrade
90cac215.js        @13995 FEA_CMD_SET_FLASHCHIPERASSE=172 @14027 setFlashChipErase
86db41a2.js        @3041 wired-only gate       a3768b21.js @2026 wired-only gate
f5daf7c6.js        @1361 recovery list builder 7bcf6f4b.js @627 upgrade dialog trigger
6289e0ab.js        @12098 getDeviceIsBoot with connect!=="usb" guard (other device family)
~~~
