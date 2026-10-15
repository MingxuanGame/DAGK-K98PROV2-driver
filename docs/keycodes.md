# K98PRO / YC3123 keyboard — key-code tables and codecs

Source: `app/resources/app/dist/js/index.630fe4af.js` unless stated otherwise.
Offsets are **byte offsets** in that file (it is minified; some "lines" are >1 MB).
Machine-readable output: **`data/keycodes.json`** (all tables verbatim, plus the verbatim
minified source slice of every function).

## 0. Module wiring (how the tables reach the driver)

The matrix/config codec lives in the namespace object `sr`, built at offset **1723293**
(`var sr;(e=>{…})(sr||{})`):

```js
const ws=(e,t)=>Object.keys(e).find(i=>Ir(e[i],t)),        // @1723144
      Jk=(e,t)=>{const i=Object.keys(e).find(r=>Ir(e[Number(r)],t)); return i===void 0?void 0:Number(i)};
var sr;(e=>{ e.hidToMatrix=…; e.matrixToHid=…; e.matrixToConfigs=…; e.configToMatrix=…;
             e.changeArrToConfig=… })(sr||{});
```

The bundle's export list (end of file, offset ≈2524740) publishes
`ah: sr`, `af: Ie`, `ag: Na`, `ai: Ir`, `ak: za`, `ay: kue`, `ab: xe`, `b6: CT`, `bD: yL`.
`app/resources/app/dist/js/b469c422.js` (keyboard base class) imports them as
`{ah as I, af as N, ai as L, ay as G, ak as $, ab(?), ar as k, …}` — hence `I.matrixToHid`,
`N.Left` (mouse), `L` (deep-equal), `G` (u32 from 4 bytes) inside that file.

`Ir` (@279709) is lodash-style deep equality (`var S3=ea(function(t,i){return Gf(t,i,[],[])});
const Ir=S3;`), i.e. **array equality is structural**, this is the workhorse of every table
lookup below.

---

## 1. Matrix ⇄ HID

Verbatim (from `data/keycodes.json → functions`):

```js
hidToMatrix = t=>{let i=[];if(t<=255)i=[0,0,t,0];
  else{const r=t>>24&255,n=t>>16&255,a=t>>8&255,o=t&255;i=[r,n,a,o]}return i}

matrixToHid = t=>{let i=0;
  if(t[0]===0&&t[1]===0&&t[3]===0)i=t[2];
  else{const r=Number(ws(Na,t));isNaN(r)?i=t[0]<<24|t[1]<<16|t[2]<<8|t[3]:i=r}
  return i}
```

* A matrix slot is **4 bytes**.
* `hidToMatrix`: values ≤ 0xFF become `[0,0,v,0]` (plain HID usage); larger values are
  stored **big-endian** in all 4 bytes.
* `matrixToHid` is *not* always the inverse:
  * `[0,0,x,0]` → `x` (plain HID usage).
  * otherwise it first tries to reverse-map the 4 bytes to a **mouse key** via `Na`
    (`ws(Na,t)` = *first key of `Na` whose value deep-equals `t`*); if found, that key is
    returned (a negative number, e.g. `-1000` for Left). Only if no mouse key matches does it
    return the raw `(b0<<24|b1<<16|b2<<8|b3)>>>0`.
* Helper `kue` (@188963): `t=>{let i=0;return e.length===4&&(i=e[0]<<24|e[1]<<16|e[2]<<8|e[3]),t}`
  — the plain big-endian u32 read (no mouse-key reverse map), used for the "changed-key" scan.

### `matrixToConfigs(savedMatrix, currentMatrix)` — matrix → UI config objects

```js
matrixToConfigs=(t,i)=>{const r=[],n=H1(!1),a=j_(!1);
 for(let o=0;o<i.length;o+=4){
   const l=i.slice(o,o+4), s=t.slice(o,o+4);        // l = official/default, s = device value
   let u=0;
   if(Ir(l,s))continue;                              // unchanged -> not reported
   for(let y=0;y<o;y+=4) if(Ir(s,t.slice(y,y+4))) u++;   // duplicate ordinal of this HID
   let m=(0,e.matrixToHid)(s);
   if(m!==0){
     if(Ir(l,[0,0,0,0]))            r.push({type:"forbidden",original:m,index:u});
     else if(l[0]===9)              r.push({type:"ConfigMacro",original:m,index:u,macro:[],
                                            macroType:<0:"repeat_times"|1:"on_off"|2:"touch_repeat">,
                                            repeatCount:0,macroIndex:l[2]});
     else if(l[0]===1)              r.push({type:"ConfigMouse",original:m,index:u,key:Jk(Na,l)});
     else if(l[0]===21)             {const y=ws(V_,[...l]); y!==void 0 &&
                                     r.push({type:"ConfigGamepad",original:m,index:u,key:y});}
     else if(l[0]===0)              r.push({type:"combo",original:m,index:u,
                                            skey:l[1],key:l[2],key2:l[3]});
     else if(n.some(y=>Ir(y,l)))    {const y=ws(a,[...l]); y===void 0
                                       ? r.push({type:"ConfigUnknown",original:m,index:u,value:l})
                                       : r.push({type:"ConfigFunction",original:m,index:u,key:y});}
     else if(l[0]===11)             r.push({type:"ConfigFunction",original:m,index:u,key:"火力",value:l});
     else if(l[0]===22&&(l[1]===4||l[1]===6||l[1]===7))
                                    r.push({type:"ConfigControlRecoil",original:m,index:u,
                                            method:<4:"normal"|6:"switch_keep"|7:"switch_toggle">,
                                            bulletCount:0,bulletValue:[],gunIndex:l[2]});
     else if(l[0]===22)             r.push({type:"ConfigSnap",original:m,index:u,number:l[1],keyCode:l[2]});
     else if(l[0]===23)             r.push({type:"ConfigMDS", original:m,index:u,number:l[1],keyCode:l[2]});
     else if(l[0]===24)             r.push({type:"ConfigMT",  original:m,index:u,keyCode:l[1],
                                            keyCode2:l[2],time:l[3]*10});
     else                           r.push({type:"ConfigUnknown",original:m,index:u,value:l});
   }}
 return r}
```

Key points:

* `t` = the **reference** matrix (normally `device.defaultMatrix`, i.e. factory defaults);
  `i` = the matrix read back from the device. Both must be the same length.
* Unchanged slots are dropped, **but the duplicate ordinal `index` still counts every earlier
  occurrence of the same 4 bytes in `t`**, which is how the UI distinguishes the two
  `MediaPlayPause` codes / duplicated HIDs.
* `original` is the HID-ish value from `matrixToHid`, and is the key used everywhere in the
  UI (`keyboardState`, key highlighting, `findIndexInDefaultMatrix`).
* `H1(!1)`/`j_(!1)` = the "without 倒计时" variants (see §3).

### `configToMatrix(config)` — UI config object → 4 bytes (exact inverse)

```js
configToMatrix=t=>{let i=[0,0,0,0];const r=j_(!1);
 switch(t.type){
  case"forbidden":      i=[0,0,0,0]; break;
  case"combo":          t.key<=255 ? i=[0,t.skey,t.key,t.key2] : i=[...hL(t.key)]; break;
  case"ConfigMouse":    Na[t.key]!==void 0 && (i=[...Na[t.key]]); break;
  case"ConfigFunction": t.value!==void 0 ? i=[...t.value] : i=[...r[t.key]]; break;
  case"ConfigUnknown":  i=[...t.value]; break;
  case"ConfigGamepad":  i=[...V_[t.key]]; break;
  case"ConfigMacro":    i=[9, <repeat_times:0|on_off:1|touch_repeat:2>, t.macroIndex, 0]; break;
  case"ConfigSnap":     i=[22,t.number,t.keyCode,0]; break;
  case"ConfigMDS":      i=[23,t.number,t.keyCode,0]; break;
  case"ConfigMT":       i=[24,t.keyCode,t.keyCode2,t.time/10]; break;
  case"ConfigControlRecoil": i=[22,<normal:4|switch_keep:6|switch_toggle:7>,t.gunIndex,0]; break;
  default:              i=[0,0,0,0];
 }
 return i}
```

### `changeArrToConfig(bytes, original, index)` — single slot → config object

Byte-0 dispatch (verbatim in `data/keycodes.json → functions.changeArrToConfig`):

| byte0 | result |
|---|---|
| `[0,0,1,0]` | `ConfigUnknown` |
| `[0,0,0,0]` or `[0,0,3,0]` | `forbidden` |
| `0` | if bytes ∈ `kL` → `ConfigFunction` (key = `ws(yw, bytes)`), else `combo{skey:b1,key:b2,key2:b3}` |
| `1` | `ConfigMouse`, key = `Jk(Na,bytes)` |
| `3,6,8,10,13,14,18,19,2,22` | `ConfigFunction` (key = `ws(yw, bytes)`); `[10,24,0,0]` (倒计时) is forced to `ConfigUnknown`; for `22` with `b1∈{6,7}` the raw bytes are kept in `value` |
| `9` | `ConfigMacro` (`macroType` from b1, `macroIndex` = b2) |
| `21` | `ConfigGamepad` (key = `ws(V_, bytes)`) |
| anything else | `undefined` |

---

## 2. `Na` — mouse-key table (27 entries)

```js
const Ie=(e=>(e[e.Left=-1e3]="Left",e[e.Right=-999]="Right",e[e.Middle=-998]="Middle",
  e[e.Forward=-997]="Forward",e[e.Back=-996]="Back",e[e.Dpi=-995]="Dpi",
  e[e.WheelForward=-994]="WheelForward",e[e.WheelBack=-993]="WheelBack",
  e[e.WheelLeft=-992]="WheelLeft",e[e.WheelRight=-991]="WheelRight", … ))(Ie||{})
```
(`index.630fe4af.js` @159923; full enum in `data/keycodes.json → Ie_mouseKeyEnum`.)

`Na={[Ie.Left]:[1,0,240,0], …}` (@205640) — keys are the **enum member *names*** (the minifier
emits a *computed* key from `Ie.Left` etc., which in JS stringifies to the member's **value**
as a decimal string, i.e. `"-1000"`). Verbatim:

```json
{"-1000":[1,0,240,0], "-999":[1,0,241,0], "-998":[1,0,242,0], "-997":[1,0,244,0],
 "-996":[1,0,243,0],  "-995":[20,0,0,0],  "-994":[1,0,247,0], "-993":[1,0,248,0],
 "-992":[1,0,245,0],  "-991":[1,0,246,0], "-990":[],  "-989":[],
 "-988":[1,0,245,1],  "-987":[1,0,245,255], "-986":[1,0,246,251], "-985":[1,0,246,5],
 "-984":[1,0,247,251],"-983":[1,0,247,5],   "-982":[0,227,225,114], "-981":[0,0,70,0],
 "-980":[0,0,227,7],  "-979":[20,0,1,0],    "-978":[0,2,0,20],   "-977":[0,0,224,6],
 "-976":[0,0,224,25], "-975":[0,0,224,27],  "-974":[10,5,0,0]}
```

Because keys are strings, `Jk(Na,l)` (`Number(key)`) converts back to the numeric enum value,
and `Na[t.key]` works for both numeric and string keys.

---

## 3. Function-key tables: `_w`, `fL`, `yw`, `hw`, `kL`, `bL`, `j_()`, `H1()`

```js
const _w={ 上一曲:[3,0,182,0], 下一曲:[3,0,181,0], 停止:[3,0,183,0], 播放暂停:[3,0,205,0],
  播放器:[3,0,131,1], 火力:[11,0,0,0], 狙击键:[], 静音:[3,0,226,0], 音量减:[3,0,234,0],
  音量加:[3,0,233,0], 计算器:[3,0,146,1], fn:[10,1,0,0], … , KEYCODE_F13:[0,104,0,0] };   // @203182
const fL={ 倒计时:[10,24,0,0] };                                                          // @204578
yw=Object.assign(_w,{}),  kL=Object.values(yw),
hw=Object.assign(_w,fL),  bL=Object.values(hw),
H1=e=>e?bL:kL,  j_=e=>e?hw:yw;                                                            // @206886
```

* `_w` — **72** base "ConfigFunction" logical keys (Chinese names; a few English/mixed):
  上一曲 下一曲 停止 播放暂停 播放器 火力 狙击键 静音 音量减 音量加 计算器 fn 邮件 我的电脑 搜索
  主页 亮度减 亮度加 呼出siri 压枪 开关压枪(持续) 开关压枪(切换) 枪械切换加 枪械切换减 枪械切换(循环)
  系统电源 系统睡眠 电脑唤醒 ( ) { } 切换输入法 缩小 放大 "AI function" 麦克风开关 返回 fn锁屏 锁屏 r_FN
  音量<->键盘亮度 音量<->键盘亮度2 音量<->键盘亮度3 刷新 程序打开1 程序打开2 程序打开3 dpi_loop dpi+ dpi-
  dpi_shift profile_value Profile加 Profile减 profile_loop profile_exchange profile_exchange2 …
  "Open website" OLED_FontColor OLED_BackColor OLED_Confirm WIN_L Ctrl_SHIFT_ESC WIN_D WIN_E
  Ctrl_C Ctrl_V KEYCODE_F13
* `fL` — the single extra key 倒计时 (`[10,24,0,0]`) that only some firmwares expose.
* CAUTION: `Object.assign(_w,{})` copies `_w`; but `Object.assign(_w,fL)` **mutates `_w`**
  (adds 倒计时) and returns it. So after that statement `yw` (the earlier copy) has 72 keys and
  `_w`/`hw` have 73. `kL` was captured as `Object.values(yw)` **before** the mutation (72),
  `bL` as `Object.values(hw)` after (73). Reproduced faithfully in the JSON.
* `j_(withCountdown)` → object map (`hw`/`yw`); `H1(withCountdown)` → the corresponding
  **array** of 4-byte codes (`bL`/`kL`). `matrixToConfigs`/changeArrToConfig use the
  `false` (= no 倒计时) variants.

## 4. `hL()` — combo encoding for key codes > 255

```js
hL = e => e>4294967295 ? [0,0,0,0]
        : [(e&4294967295)>>24, (e&16777215)>>16, (e&65535)>>8, e&255]      // @188963
```

Big-endian split of a 32-bit key code into the 4 matrix bytes; used by
`configToMatrix` case `"combo"` only when `t.key > 255` (for `key <= 255` the "combo" form
`[0, skey, key, key2]` is used instead — byte 1 is the modifier mask, bytes 2/3 the
"key"/"key2" HID usages). Inverse: `kue` (u32 from 4 bytes, @189049) and `matrixToHid`.

## 5. `V_` — gamepad table (54 entries)

```js
V_={XRIGHT:[21,1,0,0],XLEFT:[21,1,1,0],YUP:[21,1,2,0],YDOWN:[21,1,3,0],ZFORWARD:[21,1,4,0],
    ZBACKWARD:[21,1,5,0],XRN:[21,1,6,0],XRP:[21,1,7,0],YRP:[21,1,8,0],YRN:[21,1,9,0],
    ZRP:[21,1,10,0],ZRN:[21,1,11,0],TH:[21,2,0,0],Elevator:[21,2,1,0],Accelerator:[21,2,2,0],
    Rudder:[21,2,3,0],Trigger:[21,2,4,0],UP:[21,3,0,0],DOWN:[21,3,1,0],LEFT:[21,3,2,0],
    RIGHT:[21,3,3,0],Dirbut1..Dirbut12:[21,0,n,0],LUP,LDOWN,LLEFT,LRIGHT,LCLICK,LT,RT,LB,RB,
    RUP,RDOWN,RLEFT,RRIGHT,RCLICK,A,B,X,Y,START,SELECT,MENU}
```
(@204599; byte 0 = `21` (0x15) marks gamepad, byte 1 = group, byte 2 = index. Full 54-entry
map in `data/keycodes.json → V_gamepadTable`.)

## 6. `Un` — HID usage / key-name table used by the UI (183 entries)

```js
Un=[{value:"`",scanCode:41,hidCode:53,keyCode:192,htmlCode:"Backquote"},
    {value:"1",scanCode:2,hidCode:30,keyCode:49,htmlCode:"Digit1"}, … ,
    {value:"Ctrl_V",scanCode:null,hidCode:57369,keyCode:null,htmlCode:"Ctrl_V"}]   // @189123
```

Fields:

* `htmlCode` — the **key id** used by the layout chunks and by the React UI
  (`Backquote`, `Digit1`, `Escape`, `Numpad0`, `AudioVolumeUp`, …). These are exactly the 98
  ids in `data/layout98.json`.
* `hidCode` — the value stored in / compared against the matrix (≤255 = plain HID usage;
  >255 = packed vendor code, e.g. `0x0300E900` = AudioVolumeUp, `0x0A010000` = Fn).
* `value` — the human/vendor name (`BackSpace`, `r_Shift`, `num_+`, `U+`, `Play`, …).
* `scanCode`, `keyCode` — legacy Windows scan code / DOM keyCode (`null` for pseudo keys).

The lookup helpers are the `xe` namespace (built at @202224), all verbatim in
`data/keycodes.json → functions`:

| helper | mapping |
|---|---|
| `keyCodeMapHIDCode(keyCode)` | DOM keyCode → hidCode |
| `hidToKeyCode(hid)` | hidCode → keyCode (0 if not found) |
| `scanCodeMapHIDCode(sc)` | scan code → hidCode |
| `hidCodeMapKeyName(hid)` | hidCode → `value` |
| `htmlCodeMapHIDCode(html)` | **layout key id → hidCode** (used to join layout ↔ matrix) |
| `htmlCodeMapKeyName(html)` | layout key id → `value` |
| `keyNameMapHtmlCode(name)` | `value` → layout key id |
| `hidCodeMapHtmlCode(hid, dupIndex?)` | hidCode → layout key id; when `dupIndex` is given, prefers an entry whose `htmlCode` **ends with** `String(dupIndex)` (disambiguates duplicates such as the numpad `Home/↑/PgUp …` vs the nav cluster) |

Notes / gotchas found while extracting:

* 46 of the 183 entries have `hidCode > 255`.
* `MediaPlayPause` occurs **twice**: `hidCode:50384128` (`0x0300CD00`) and
  `hidCode:50449664` (`0x0300E200`). `findIndexInDefaultMatrix` rewrites the second to the
  first (`t===50449664&&(t=50384128)`, `b469c422.js` fmt line 308). Both are listed in the JSON.
* The `Fn` entry has `scanCode:0, keyCode:null, hidCode:167837696` (= `0x0A010000`).

## 7. Macro codec

### UI event → bytes: `macroEventToByte(event, delayEvent)` (namespace `za`, @479470; fn @481077)

```js
macroEventToByte=(t,i)=>{const r=[],n=i.value;
 if(t.type==="keyboard"||t.type==="mouse_button"){
   switch(t.type){case"keyboard": r.push(t.value); break;
                  case"mouse_button": r.push(Na[t.value][2]); break}
   n<=127 ? r.push(t.action==="down" ? n+128 : n)
          : (r.push(t.action==="down"?128:0), r.push(n&255, n>>8));
 }
 if(t.type==="mouse_move"){
   r.push(249);
   n<=127 ? r.push(n) : r.push(0);
   r.push(t.dx); r.push(t.dy);
   if(n>127) r.push(n&255, n>>8);
 }
 return new Uint8Array(r)}
```

* 1 event+delay pair is emitted as 2 bytes when the delay ≤ 127 (the delay is in the low 7 bits,
  bit 7 = key-down), and 3 bytes otherwise (delay hi/lo appended little-endian).
* `mouse_move` is emitted as byte `249` followed by delay and `dx`,`dy` as **signed bytes**
  (`Int8Array` on the way back).

### bytes → UI events: `buffToMacroEvents(buffer)` (`b469c422.js`, fmt line 340)

```js
buffToMacroEvents=t=>{const e=[],n=new DataView(t.buffer).getUint16(0,!0);   // repeatCount, LE
 let i=2,s=t.slice(i,i+4); for(i+=4;i<t.length;){
   if(s[0]===249){                                   // mouse move
     const r=new Int8Array(s.buffer);
     e.push({type:"mouse_move",dx:r[2],dy:r[3]});
     let a=0;
     if(s[1]!==0) a=s[1]>>1;                          // delay stored >>1 when non-zero
     else {const c=t.slice(i,i+2); i+=2; a=new DataView(c.buffer).getUint16(0,!0)}
     e.push({type:"delay",value:a});
   } else {
     if(s[0]<=239&&s[0]>=4) e.push({type:"keyboard",action:s[1]<=127?"up":"down",value:s[0]});
     else { let a;
       switch(s[0]){case 240:a=N.Left;break; case 241:a=N.Right;break; case 242:a=N.Middle;break;
                    case 243:a=N.Back;break; case 244:a=N.Forward;break}
       a!==void 0 && e.push({type:"mouse_button",action:s[1]<=127?"up":"down",value:a})}
     let r=0;
     s[1]&127 ? (r=s[1]&127, i-=2) : r=new DataView(s.buffer).getUint16(2,!0);
     e.push({type:"delay",value:r});
   }
   if(s=t.slice(i,i+4), L([...s],[0,0,0,0])) break;   // 4 zero bytes terminate
   i+=4; }
 return {macroEvents:e.filter(r=>!(r.type==="delay"&&r.value===0)), repeatCount:n}}
```

Format summary (little-endian 16-bit repeatCount first):

| byte | meaning |
|---|---|
| 0..1 | `repeatCount` (uint16 LE) |
| 2.. | 4-byte records; `[0,0,0,0]` terminates |
| `b0 = 4..239` | keyboard HID usage; `b1 & 0x80` ⇒ down, else up; `b1 & 0x7F` = delay (if 0, delay is `getUint16(b2,b3,LE)`) |
| `b0 = 240..244` | mouse Left/Right/Middle/Back/Forward; same `b1` semantics |
| `b0 = 249` | mouse_move; `b2`, `b3` signed dx/dy; delay in `b1>>1` or the next 2 bytes |

### UI-side wrappers (namespace `za`, all verbatim in the JSON)

* `uiMacroEventListToMacroList(list)` — converts the React event list into
  `{type:"keyboard"|"mouse_button"|"mouse_move"|"delay"}` events, using
  `xe.htmlCodeMapHIDCode(keyCode)` for keyboard events and `Ie.*` for mouse buttons.
* `getEvent(domEvent, "down"|"up", lastTimestamp)` — DOM `KeyboardEvent` → `{type:"keyboard",
  delay, isDown, code}` (delay capped at 65535), else `{type:"mouse", …}`.
* `mouseEventButtonToMouseKey(button)` — 0→`mouse_left`, 1→`mouse_middle`, 2→`mouse_right`,
  3→`mouse_back`, 4→`mouse_forward`.
* `uiMacroTypeToMacroType(s)` — `"循环次数"→"repeat_times"`, `"使用指派按键切换开/关播放"→"on_off"`,
  `"按下播放"`→`"touch_repeat"`.
* `checkIsSharedMacroLengthFull(list)` — total byte budget > 256 → full.
* `checkUiMacroListIsFull(list)` — > 248 → full.
* `CT(list)` (@481525, exported as `b6`) — the reverse of `uiMacroEventListToMacroList`:
  bytes-side events → UI events, using `xe.hidCodeMapHtmlCode(value)`.

Device-side macro transfer (`b469c422.js`): `FEA_CMD_GET_MACRO=139` with
`frame[1]=macroIndex`, `frame[2]=page 0..3` (`getMacro`, fmt line 329) and
`FEA_CMD_SET_MACRO=11` (`setMacro`). `matrixToConfigValues` (fmt line 317) decorates each
`ConfigMacro` entry with the fetched `macroEvents`/`repeatCount`.

## 8. Mouse display names and other small tables

```js
vue={mouse_left:"鼠标左键",mouse_right:"鼠标右键",mouse_middle:"鼠标滚轮点击",
     mouse_forward:"鼠标前进",mouse_back:"鼠标后退"}      // @479366 (literal starts at 479370)
```

## 9. Explicit UNKNOWNs

* The **meaning of every byte** in the non-`0`/`1`/`9`/`21`/`22`/`23`/`24` byte-0 families is
  only inferable from the tables above; there is no spec in the bundle. Families seen in
  `_w`/`Na`/`V_`: `2` (system power/sleep/wake), `3` (consumer/media), `6` (mic / "程序打开"),
  `8` (profile), `10` (firmware/OLED/音量<->亮度), `11` (火力 / OLED colour), `13` (numpad-ish
  FN codes), `14` (lighting), `18` (Siri / Open website), `20` (DPI), `21` (gamepad).
* `Na["-990"]` and `Na["-989"]` (`Ie.Key_1`, `Ie.Key_2`) are **empty arrays** — no encoding
  is defined for them.
* `_w["狙击键"]` is also an empty array.
* Why `H1/j_` take a boolean is only visible through their call sites (`true` = "supports
  倒计时"); the boolean has no other effect.
* No key-id → matrix mapping table exists as data; it is **computed** (see
  `docs/layout-98y98.md` §4).
