# K98PRO (DAGK) — physical key layout for a WebHID re-implementation

Device under analysis (device-DB entry, byte offset **790900** of
`app/resources/app/dist/js/index.630fe4af.js`, array `dR`, offset 790896):

```js
{id:3780,vid:12625,pid:20482,keyLayout:c.Common98_Y98,name:"yc3123_kk_k98_pro_3m_1k",
 displayName:"K98PRO",company:"DAGK",type:"keyboard",layer:3,fnSysLayer:{win:1,mac:1},
 lightLayout:T,sideLightLayout:he,other:{noMagneticSwitch:!0,isYC3123:!0,sleep24:{…},sleepBT:{…}}}
```

Machine-readable output: **`data/layout98.json`**.
All byte offsets below are offsets into the stated file. `index.630fe4af.js` is minified
(one statement per line in places); offsets, not line numbers, are authoritative.

---

## (a) 1. The enum value of `c.Common98_Y98`

The enum object is created at offset **482199** by

```js
var c=(e=>(e.Common21_SKYPAD="常规21键(SKYPAD)", … ,e))(c||{})
```

i.e. `c` is a **string enum** (TypeScript `enum` with string initialisers). Therefore:

| expression | value |
|---|---|
| `c.Common98_Y98` | `"常规98键 Y98"` |
| `c.Common98_Y98PRO` | `"常规98键 Y98PRO,knob"` |
| `c.Common98_Y98B` | `"常规98键 (Y98B home 音量- 音量+ pause)"` |

(`index.630fe4af.js` @482199 ff.; the `e.Common98_Y98="常规98键 Y98"` assignment is at offset 496528.)

`layer:3` in the device entry means 3 configurable key layers; `fnSysLayer:{win:1,mac:1}`
means one Windows Fn layer and one Mac Fn layer.

## (a) 2. Which layout table the enum selects

Two independent resolution paths exist.

### Path A — synchronous key-name list: **works for this device**

```js
createKeyboardState=()=>{const e=this.initKeyboardState;switch(this.keyLayout){
  …
  case c.Common98_Y98:return e(B4);
  …}}
```
(`index.630fe4af.js` @1594528; the `case c.Common98_Y98` arm is at 1597931.)

`B4` is declared at offset **331541**:
```js
B4=["Backspace","Tab","CapsLock","Enter","ShiftLeft","ShiftRight","ControlLeft","MetaLeft",
    "AltLeft","Space","AltRight","Fn","Numpad0","NumpadAdd","NumpadEnter","Backslash",
    "Backquote","Digit1", … ,"Delete"]
```
It contains exactly **98** entries (`data/layout98.json → keyOrderArray`).

`initKeyboardState(names)` builds `{keys:{<name>: SB()}}`, and the whole UI addresses keys by
these names (e.g. `this.keyboardState.keys[this.当前选中按键_单键]`, @1603592).

### Path B — the geometry chunk

The chunk whose export name matches the device's `keyLayout` is registered in the dynamic
-import map at offset **1466049** of `index.630fe4af.js`:

```js
"./keyboard_ui_info/keyboard_98_y98_keymappings_ui_info.ts":
    ()=>p(()=>import("./2714b259.js"),[ … ],import.meta.url)
```

`app/resources/app/dist/js/2714b259.js` (6 945 bytes) is a one-liner:

```js
const e={width:881,height:281,layout:{Backspace:{x:599,y:56,width:87,height:40,type:"key",
  displayText:["BackSpace"]}, … }};
export{e as keyboard_98_y98_keymappings_ui_info};
```

**Confirmation that this is the right chunk for K98PRO:** its `Object.keys(layout)` is
**byte-for-byte identical (same order, 98 entries)** to the `B4` array that the
`case c.Common98_Y98` arm returns. `data/layout98.json → keyOrderArray.equalsObjectKeysOfLayout`
records this check as `true`.

### ⚠ UNKNOWN / BUG in the vendor build (important for re-implementation)

The **asynchronous** geometry resolver `Zp` (`index.630fe4af.js` @1409306) only consults

```js
LN={...SN,...CN}          // @1409241
Zp=async e=>{const t=LN[e]; if(!t) throw new Error(`未找到键盘布局 ${e} 的映射`); …}
```

Evaluating `SN` (@1401075) and `CN` (@~1402000) and merging gives **131** entries; the merged
map is reproduced in `data/layout98.json` (see `_ln_check`). Result:

* `LN["常规98键 Y98"]` → `undefined`  ← the K98PRO's own layout key is **missing**
* `LN["常规98键 Y98PRO,knob"]` → `"keyboard_98_y98pro_v2_keymappings_ui_info"` (chunk `39d54467.js`)

So in *this* build `Zp(c.Common98_Y98)` throws, and `createKeyboardStateAsync`
(@1602209) never gets the layout; the synchronous `B4` path is the only one that works for
the K98PRO. The geometry chunk `2714b259.js` is nevertheless present in the bundle (it is a
static dependency of the UILayOut index `13180701.js`, which imports it as `hn`). Whether the
app therefore renders K98PRO with the `2714b259.js` geometry, with another layout, or with a
fallback is **UNKNOWN** from static reading alone. The 98-key name list and `2714b259.js`
agree exactly, so `2714b259.js` is the best available geometry for K98PRO.

For reference the sibling layouts are: `keyboard_98_y98pro_keymappings_ui_info` →
`850dfb67.js` (`911×299`), `keyboard_98_y98pro_v2_keymappings_ui_info` → `39d54467.js`
(`954×286`), `keyboard_98_y98b_keymappings_ui_info` → `b721d8b4.js` (`904×281`).

## (a) 3. Full layout geometry

Canvas: `width = 881`, `height = 281` (vendor UI design units; 1 unit ≈ 1 px).

Every key object is `{x, y, width, height, type:"key", displayText:[…]}`; `x`/`y` is the
top-left corner. `displayText[0]` is the primary legend, `displayText[1]` (when present) is the
secondary/numpad legend. `data/layout98.json → keys[]` gives, for each of the 98 keys, in
layout-declaration order:

`order, id, x, y, width, height, type, displayText, hidCode, hidHex, scanCode, keyCode,
hidValue, matrixIndex, matrixIndexes, matrixCode[4], fnMatrixCode[4], fnMacMatrixCode[4]`

Rows in the physical keyboard are:

| y | contents |
|---|---|
| 1 | `Esc`, `F1`…`F12`, `Home`, `PgUp`, `PgDn`, `Pause` (+ `Del` at x=646) |
| 56 | ``~`, `1`…`0`, `-_`, `=+`, `BackSpace`, `Num`, `/`, `*`, `-` |
| 102 | `Tab`, `Q`…`P`, `[{`, `]}`, `\|`, `7`…`9` |
| 148 | `Caps`, `A`…`L`, `;:`, `‘”`, `Enter`, `4`…`6` |
| 194 | `Shift`, `Z`…`M`, `,<`, `.>`, `/?`, `r_Shift`, `↑`, `1`…`3` |
| 240 | `Ctrl`, `Win`, `Alt`, `Space`, `Alt`, `Fn`, `←`, `↓`, `→`, `0`, `.` |

Tall keys: `NumpadAdd` and `NumpadEnter` are `height:86`; `Enter` is `width:101`;
`Backspace` `width:87`; `ShiftLeft` `width:93`; `Space` `width:312`.

## (a) 4. Matrix index and the 4-byte matrix code

The matrix for the K98PRO is the class field `defaultMatrix` of class
`Yc3123_kk_k98_pro_3m_1k` in `app/resources/app/dist/js/530511ba.js` (file offset **236**;
the class is `class e extends t` with `import{C as t}from"./1dadcb6b.js"`, exported as
`export{e as Yc3123_kk_k98_pro_3m_1k}`). Also present: `defaultFnMatrix` (@1379),
`defaultFnMacMatrix` (@2463) and `COMMONCOLOR` (@146).

* Each matrix slot = **4 bytes**; the array is `512` bytes = **128 slots**.
* Slot index `i` covers `defaultMatrix[4*i .. 4*i+3]`.
* `matrixToHid` (see `docs/keycodes.md`) converts a slot to a HID-ish 32-bit value:

```js
if (b0===0 && b1===0 && b3===0)  value = b2            // plain HID usage, 0..255
else                             value = (b0<<24|b1<<16|b2<<8|b3) >>> 0
```

The app never splits the slot index into row/column; it is used **flat** (it is written to
`frame[2]` in `setKeyConfigSimple`, `b469c422.js` line 390 of `work/b469c422.fmt.txt`,
and to the light buffer as `index*3` in `setLightPic`). Observation (not used by the app):
slots `0..107` form **18 consecutive groups of 6** (`row=⌊i/6⌋, col=i%6`); 108/109 hold the
two volume keys and 110..127 are zero.

Counts:

* 101 non-zero slots, 27 zero slots (indices listed in `matrixZeroIndexes`).
* 98 of the non-zero slots are the 98 layout keys (each layout key matches **exactly one**
  slot — verified, `data/layout98.json → keys[].matrixIndex`).
* 3 non-zero slots carry no layout key (`matrixExtraNonZero`):
  * slot **75** = `[0,0,50,0]` → HID `0x32` (`IntlBackslash`, the `#~` key — the K98 Y98
    variant is a US-ANSI board, hence unused)
  * slot **108** = `[3,0,233,0]` → the vendor media code used by `_w["音量加"]` (Volume +)
  * slot **109** = `[3,0,234,0]` → `_w["音量减"]` (Volume −)

### How the join name → HID → matrix slot was made (exact, reproducible)

1. **name → HID** — the layout key ids are exactly the `htmlCode` field of the `Un` table
   (`data/keycodes.json → Un_hidUsageTable`, 183 entries). Every one of the 98 layout ids is
   present (0 missing). `xe.htmlCodeMapHIDCode(name)` (@202224 ff.) is the app's own version of
   this lookup.
2. **HID → slot** — the app's `findIndexInDefaultMatrix(hid, dupIndex)`
   (`b469c422.js`, line 308 of `work/b469c422.fmt.txt`) scans `defaultMatrix` in steps of 4 and
   returns `byteOffset/4` of the `dupIndex`-th slot whose 4 bytes equal
   `hidToMatrix(hid)`. Applying it to the K98PRO `defaultMatrix` yields one slot per key.

### Worked mapping (matrix slot order, first and last rows; full table in the JSON)

| slot | id | HID | x,y,w,h | label |
|---|---|---|---|---|
| 0 | `Escape` | 0x29 | 1,1,40,40 | Esc |
| 1 | `Backquote` | 0x35 | 1,56,40,40 | `~` |
| 2 | `Tab` | 0x2b | 1,102,66,40 | Tab |
| 4 | `ShiftLeft` | 0xe1 | 1,194,93,40 | Shift |
| 41 | `Space` | 0x2c | 163,240,312,40 | Space |
| 65 | `Fn` | 0x0a010000 | 535,240,48,40 | Fn |
| 79 | `Backspace` | 0x2a | 599,56,87,40 | BackSpace |
| 81 | `Enter` | 0x28 | 585,148,101,40 | Enter |
| 104 | `NumpadAdd` | 0x57 | 840,102,40,86 | + |
| 107 | `NumpadEnter` | 0x58 | 840,194,40,86 | Enter |

Note `Fn` is a *pseudo* key: its `Un` entry has `scanCode:0, keyCode:null,
hidCode:167837696 (0x0A010000)`, which is exactly `matrixToHid([10,1,0,0])` — the same 4 bytes
as `_w["fn"]` and `defaultFnMatrix[65]`. It is a firmware-level Fn, not a HID key.

## (a) 5. `lightLayout: T` and `sideLightLayout: he`

These are **not** geometry maps — they are the *capability descriptors* of the lighting
effects the device supports (the geometry-based light editor gets positions from the matrix,
not from these). They live in the same module scope as the device DB.

`T` — declared at offset **540200** of `index.630fe4af.js`:
```js
T={isRgb:!0,types:[{type:"LightWave",maxValue:4,maxSpeed:4,options:["向右","向左","向下","向上"],rgb:!0,dazzle:!0},
   {type:"LightRipple",…},{type:"LightRaindrop",…}, … {type:"LightScreenColor",maxValue:4}]}
```

`he` — declared at offset **556513**:
```js
he={isRgb:!0,types:[{type:"LightWave",maxValue:4,maxSpeed:3,rgb:!0,dazzle:!0},
    {type:"LightSnake",…},{type:"LightOff"},{type:"LightAlwaysOn",…},{type:"LightBreath",…},{type:"LightNeon",…}]}
```

Full verbatim values (and the exact source slice for each) are in
`data/layout98.json → lightLayout` and `→ sideLightLayout`. The sibling variable `ve`
(offset 544531) is the descriptor used by other devices in the same DB.

**UNKNOWN:** the *spatial* light layout (per-LED x/y) for K98PRO. The app derives LED
positions from the key matrix instead: `setLightPic` (`b469c422.js`, fmt line 147) writes
`rgb[i*3 …]` with `i = findIndexInDefaultMatrix(hid, dupIndex)`, and `getLightPic`
(fmt line 169) rebuilds `{hid, rgb, index}` from 128×3 bytes. So one RGB triple exists per
matrix slot, i.e. **128 LED slots**, and slot→position is the same mapping as
`data/layout98.json → keys[].matrixIndex`.

## (a) 6. Minimal WebHID usage recipe

1. Open the device (usage page `0xFF00`-style vendor collection; the Electron transport uses
   64-byte **feature** reports with report id 0 — see `pB` in `work/index.pretty.js`
   ~31089-31153).
2. Read the current 128×4 matrix: `FEA_CMD_GET_KEYMATRIX = 138` (0x8A) with `frame[1]=profile`,
   `frame[2]=255`, `frame[3]=page(0..7)`, `frame[4]=sonProfile` — 8 pages × 64 bytes = 512 bytes
   (`_getKeyMatrix`, `b469c422.js` fmt line 376; caller `getKeyConfig(profile, sonProfile)`,
   fmt line 394, reached as `this.dev.getKeyConfig(s, u)` in `index.630fe4af.js` @1729445).
3. Diff that against `defaultMatrix` to get the per-key configuration
   (`matrixToConfigs`, see `docs/keycodes.md`).
4. To write one key: `FEA_CMD_SET_KEYMATRIX = 10` with `frame[1]=profile`,
   `frame[2]=matrixSlot`, `frame[5]=commit`, `frame[6]=subProfile`, `frame[8..11]=4 matrix bytes`
   (`setKeyConfigSimple(config, profile, subProfile, commit)`, `b469c422.js` fmt lines 385-392;
   callers pass `(cfg, layer, 0, true)` for a single key and `(cfg[k], layer, k, k===last)`
   when writing the 4 magnet sub-profiles, `index.630fe4af.js` @1742381/@1744728).
   `frame[3]`, `frame[4]`, `frame[7]` are left 0; the frame is a 64-byte feature report
   (`sendMsg(a, h.Bit7)`).
5. Use `keys[].matrixIndex` from `data/layout98.json` for the slot, and
   `hidToMatrix(hidCode)` for the 4 bytes.
