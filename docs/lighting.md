# DAGK K98 PRO V2 — RGB / lighting protocol (reverse-engineered from the Electron driver)

Device: **DAGK K98 PRO V2**, USB `vid 0x3151 (12625)`, wired `pid 0x5002 (20482)`, 2.4 G dongle `pid 0x5006 (20486)`.
Driver inspected: `app/resources/app/dist/js/` (Vite chunks of the unpacked Electron app).

Every claim below cites either
* a minified chunk + byte offset (`index.630fe4af.js@NNNNNN`),
* the pre-split readable copy of the keyboard base protocol `work/b469c422.fmt.txt:<line>`
  (source: `app/resources/app/dist/js/b469c422.js`, one physical line), or
* the beautified copies produced for this analysis (`work/*.fmt.txt`).

**UNKNOWN** marks anything not determinable from the driver code.

---

## 0. Class chain used by the K98 PRO

| step | chunk | class | evidence |
|---|---|---|---|
| 1 | `b469c422.js` | `at` (exported as `C`) — generic FEA keyboard base protocol | `work/b469c422.fmt.txt:8`, export at `:940` |
| 2 | `1dadcb6b.js` | `U` (exported as `C`) — extends `C`, only adds `getDeviceIsBoot` + `upgrade` | `app/resources/app/dist/js/1dadcb6b.js` (single line) |
| 3 | `530511ba.js` | `Yc3123_kk_k98_pro_3m_1k` — extends `1dadcb6b.C`, overrides **only** `COMMONCOLOR`, `defaultMatrix`, `defaultFnMatrix`, `defaultFnMacMatrix` | `app/resources/app/dist/js/530511ba.js` |
| 4 | `index.630fe4af.js@1573762` | `class _K` — transport/protocol root (exported `ae`) | — |

Chunk registry entry (`work/8eaa0b27.pretty.js`, chunk-map file `app/resources/app/dist/js/8eaa0b27.js`):

    yc3123_kk_k98_pro_3m_1k: () => import("./530511ba.js")
      deps: ["./530511ba.js","./1dadcb6b.js","./b469c422.js","./index.630fe4af.js",
             "../assets/css/index.755a37e6.css","./85888098.js","./de3119a2.js"]
      -> default: Yc3123_kk_k98_pro_3m_1k

`90cac215.js` (`CommonKbYc500`) and `b189996d.js` (`C`) are **not** in that dependency list, so a
K98 PRO never loads them. See section 11 for what they contain anyway.

Device-database entry (`index.630fe4af.js@790960`), from the array later assigned to `dR`:

    {id:3780, vid:12625, pid:20482,
     keyLayout: c.Common98_Y98,          // "regular 98-key Y98"
     name:"yc3123_kk_k98_pro_3m_1k", displayName:"K98PRO", company:"DAGK",
     type:"keyboard", layer:3, fnSysLayer:{win:1, mac:1},
     lightLayout: T, sideLightLayout: he,
     other:{ noMagneticSwitch:true, isYC3123:true,
             sleep24:{sleep:{min:0,max:18*60*60,default:2*60*60},
                      deep:{min:10,max:18*60*60,default:30*60}},
             sleepBT:{...identical...} }}

* `isYC3123` is consumed only by the key-remap UI (`index.630fe4af.js@1642861`, `@1645036`,
  `@2237125`) — it has **no** effect on the lighting protocol.
* `layer:3` = 3 on-board profiles (`setCurrentProfile(0..2)`, cmd 4).
* no `screen` and no `magnetism` key, so no OLED/TFT and no magnetic-switch commands for this device.

Companion analyses in this workspace: `docs/layout-98y98.md` (key names / UI geometry),
`docs/keycodes.md`, `docs/upgrade.md`, `docs/wireless.md`.

### 0.1 HID open parameters (needed for WebHID)

Filter table `index.630fe4af.js@1001368` (wired) and `@1013949` (dongle):

    {type:"keyboard", vendorId:12625, productId:20482, usage:2, usagePage:65535, interfaceNumber:2}
    {type:"dongle",   vendorId:12625, productId:20486, usage:2, usagePage:65535, interfaceNumber:2}

No `reports` field, so the default in `class kg` (`index.630fe4af.js@1559915`) applies:

    reports = [{ reportId: 0, reportCount: 64, type: "feature" }]

WebHID transport `class pB` (`index.630fe4af.js@1558223`), verbatim behaviour:

* `sendFeature(reportId, data)` calls `device.sendFeatureReport(reportId, data padded with 0x00 to reportCount)`.
  Resolves `false` if `data.length > 64`.
* `getFeature(reportId)` calls `device.receiveFeatureReport(reportId)`; the result is copied to a
  `Uint8Array` and, **only when reportId !== 0**, the first byte is sliced off. With reportId 0 the
  64 raw bytes are returned as-is.
* `write(reportId, data)` uses `device.sendReport(...)` (output report) — **not used** by this device.

---

## 1. Framing, padding and checksum

`___encodeCmd` — `index.630fe4af.js@1578417`:

    ___encodeCmd = (t, i) => {
      const r = t.length > 9 ? t : new Uint8Array([...t, ...new Uint8Array(9 - t.length)]);  // pad to 9
      if (i === Bit7) { const n = Wi([...r].slice(0, 7)); r[7] = 255 - (n & 255); }           // checksum @7
      if (i === Bit8) { const n = Wi([...r].slice(0, 8)); r[8] = 255 - (n & 255); }           // checksum @8
      return this.CONNECT === "bt" ? new Uint8Array([85, ...r]) : r;                          // BT prefix
    }

`Wi = e => e.reduce((t,i)=>t+i,0)` — plain wrapping 8-bit sum, `index.630fe4af.js@1561452`.
`Bit7 = 0, Bit8 = 1, None = 2` — enum `ki`, `index.630fe4af.js@1562956`.

Consequences for a WebHID re-implementation:

* The array passed to `sendFeatureReport` is **always zero-padded to 64 bytes** by the transport.
* A frame shorter than 9 bytes is first zero-padded to 9, so a `Bit7` command always has room for the
  checksum at byte 7 and a `Bit8` command for the checksum at byte 8.
* Commands built as `new Uint8Array(64)` are *not* re-padded; their checksum byte overwrites a payload
  byte at index 7 (Bit7) or 8 (Bit8) that is normally the first byte of the payload area.
* The `Bit7` checksum covers **bytes 0..6 only**; `Bit8` covers **bytes 0..7 only**. Everything after the
  checksum byte (i.e. the payload) is excluded from the sum.
* `None` means no checksum byte is written.
* The BT path prepends `0x55`; irrelevant for USB / 2.4 G.

`sendMsg` / `readMsg` / `commonMsg` — `index.630fe4af.js@1578694`, `@1578906`, `@1579639`:

    sendMsg(t, i, r = SEND_TIME)    // SEND_TIME = 10 ms; sleeps r ms, then sends the feature report
    readMsg(t = READ_TIME)          // READ_TIME = 10 ms; sleeps t ms, then getFeature
    commonMsg(t, i, r = 10, n = 10) // sendMsg(t,i,r) then readMsg(n); returns the raw report or undefined

`vendorSleep(t)` — `index.630fe4af.js@1579985`: sleeps `t ?? defaultVendorSleepTime`; the keyboard base
class sets `defaultVendorSleepTime = 100` ms (`index.630fe4af.js@1573762`). On Windows the driver posts
the delay to a native queue instead of sleeping; for a web port `await sleep(ms)` is equivalent.

---

## 2. Key (per-key RGB) light — FEA_CMD_SET_LEDPARAM = 7 / FEA_CMD_GET_LEDPARAM = 135

Constants inherited from `b469c422.js` (`work/b469c422.fmt.txt:223-228`):

    MAXSPEED = 4
    DAZZLE   = 8
    NORMAL   = 7
    LightList = { 0:"LightOff", 1:"LightAlwaysOn", 2:"LightBreath", 3:"LightNeon", 4:"LightWave",
                  5:"LightRipple", 6:"LightRaindrop", 7:"LightSnake", 8:"LightPressAction",
                  9:"LightConverage", 10:"LightSineWave", 11:"LightKaleidoscope", 12:"LightLineWave",
                  13:"LightUserPicture", 14:"LightLaser", 15:"LightCircleWave", 16:"LightDazzing",
                  17:"LightRainDown", 18:"LightMeteor", 19:"LightPressActionOff",
                  20:"LightMusicFollow3", 21:"LightScreenColor", 22:"LightMusicFollow2",
                  23:"LightTrain", 24:"LightFireWorks", 25:"LightUserColor" }

The K98 PRO chunk (`530511ba.js`) does **not** override `LightList`, `MAXSPEED`, `DAZZLE`, `NORMAL` or
either LEDPARAM method — it only replaces `COMMONCOLOR` and the three matrices.

### 2.1 SET_LEDPARAM (0x07) — request

Built in `setLightSetting` (`work/b469c422.fmt.txt:230-243`) as `new Uint8Array(64)`, sent with
**`Bit8`**, so the checksum sits at byte 8 and bytes 9..63 stay 0.

| byte | value | meaning |
|---|---|---|
| 0 | `7` | command |
| 1 | effect id | `LightList` key for `type` (`xue`/`aq` = "find key by value", `index.630fe4af.js@283117`); `0` if not found |
| 2 | `4 - speed` | speed, **inverted**: driver writes `MAXSPEED - t.speed`, so UI speed 0..4 maps to byte 0..4 (0 = fastest) |
| 3 | `bright` | brightness 0..4 |
| 4 | `option*16 + mode` | high nibble = option/pattern index; low nibble = mode (see 2.4) |
| 5 | `rgb.r` | red |
| 6 | `rgb.g` | green |
| 7 | `rgb.b` | blue |
| 8 | checksum | `255 - (sum(bytes 0..7) & 0xFF)` |
| 9..63 | 0 | unused |

Overrides applied to byte 4 (`work/b469c422.fmt.txt:236`), in this exact order:

1. base: `a = (option << 4) + (dazzle ? 8 : 7)`
2. `LightUserPicture` (13): `a = option << 4` (low nibble forced to 0)
3. `LightMusicFollow3` (20) / `LightMusicFollow2` (22): `a = (option << 4) + (dazzle ? 0 : 4)`
4. `LightScreenColor` (21): `a = 0` (whole byte zero)

Overrides applied to bytes 5..7:

* if `"rgb" in t && t.rgb !== undefined`:
  `u = t.rgb; if (u === 16777215) u = 16449530;  {r,g,b} = numToRgb(u)`
  i.e. UI white `0xFFFFFF` is transmitted as the sentinel **16449530 = 0xFB00FA**.
* then, unconditionally for `LightUserPicture`: `e[5]=0, e[6]=200, e[7]=200` (0x00C8C8).

### 2.2 GET_LEDPARAM (0x87 = 135) — request / response

Request (`getLightSetting`, `work/b469c422.fmt.txt:244-246`): `new Uint8Array(64)` with `[0]=135`, sent
with **`Bit7`** (checksum at byte 7); bytes 1..6 are 0, bytes 8..63 are 0.

Response (raw 64-byte feature report; layout inferred from the getter's byte indices):

| byte | meaning |
|---|---|
| 0 | echo of the command (135) — *not checked by the driver* |
| 1 | effect id (`LightList` key) |
| 2 | `MAXSPEED - speed`, so UI speed = `4 - byte2` |
| 3 | brightness |
| 4 | `option*16 + mode` |
| 5,6,7 | r, g, b |
| 8.. | UNKNOWN (the driver never reads past byte 7; whether the firmware puts a checksum at byte 8 is **UNKNOWN**) |

Read-back transformation (`work/b469c422.fmt.txt:248-256`):

    option = byte4 >> 4;  mode = byte4 & 15
    rgb    = rgbToNum(byte5, byte6, byte7)
    if (mode !== DAZZLE(8) && mode !== NORMAL(7)) {
        const c = COMMONCOLOR[mode];      // COMMONCOLOR of the K98 PRO, see 2.5
        if (c !== undefined) rgb = c;     // the preset overrides the transmitted colour
    }
    if (rgb === 16449530) rgb = 16777215; // wire white sentinel -> UI white
    dazzle = (type === "LightMusicFollow3" || type === "LightMusicFollow2") ? (mode === 0) : (mode === 8)

### 2.3 Effect ids actually offered by the K98 PRO

`T` (section 8) lists 21 effects; the type-to-byte1 mapping is the base `LightList` above. The K98 PRO UI
can therefore send byte1 in 0..22 but never 23/24/25 (`LightTrain`, `LightFireWorks`, `LightUserColor`
are absent from `T`), although the firmware may still accept them.

### 2.4 speed / bright / option / dazzle semantics

* **speed** — UI slider `速度_value` in `[0, 速度_max]` with `速度_max = maxSpeed` from the layout
  (`index.630fe4af.js@1562956` onwards, class `灯光设置`: `速度_value = floor(maxSpeed/2)`,
  `速度_max = maxSpeed`). The wire value is inverted: byte 2 = `4 - speed`.
  Effects whose layout entry has no `maxSpeed` (so 0) always send `byte2 = 4`.
* **bright** — UI `亮度_value` in `[0, maxValue]`, `亮度_max = maxValue` (always 4 in `T`), sent as-is.
* **option** — index into the layout entry's `options[]` array; sent in the high nibble.
  `T` options: `LightWave` [right,left,down,up], `LightSnake` [Z-shape,square],
  `LightKaleidoscope` [outward,inward], `LightLineWave` [right,left], `LightCircleWave` [ccw,cw],
  `LightUserPicture` [pattern1..pattern5], `LightMusicFollow2` [upright,separate,intersect].
  Effects without `options` always send 0.
* **dazzle** — the UI "colourful / single colour" switch (`color_type`), carried in the low nibble of
  byte 4: `7` = NORMAL (single colour; bytes 5..7 are meaningful), `8` = DAZZLE (rainbow/multicolour;
  the colour bytes are ignored), `0` = music-follow with dazzle, `4` = music-follow single colour.
  On the *read* path a low nibble of 0..6 selects a preset colour from `COMMONCOLOR` (2.5). The UI
  never sends 0..6; it only ever sends 7 or 8 (and 0/4 for the music effects).

### 2.5 Colour encoding

`numToRgb` / `rgbToNum` — namespace `Kt`, `index.630fe4af.js@281400` (exported as `al`):

    numToRgb(n)      = { r: (n >> 16) & 0xFF, g: (n >> 8) & 0xFF, b: n & 0xFF }
    rgbToNum(r,g,b)  = (r << 16) | (g << 8) | b

24-bit RGB inside a 32-bit number, big-endian; on the wire the three channels occupy bytes 5, 6, 7.

**Special value 16449530 (`0xFB00FA`) — the wire-level "white / default" sentinel:**

* write path: UI `16777215` (`0xFFFFFF`) is replaced by `16449530` before `numToRgb`
  (`b469c422.fmt.txt:237`; `:279` for the side light);
* read path: `16449530` from the device is replaced by `16777215`
  (`b469c422.fmt.txt:254`; `:295`).

`COMMONCOLOR` preset table — **overridden by the K98 PRO** (`530511ba.js`, single line):

| mode nibble | K98 PRO value | hex | colour |
|---|---|---|---|
| 0 | 16777215 | 0xFFFFFF | white |
| 1 | 16711680 | 0xFF0000 | red |
| 2 | 16744192 | 0xFF8000 | orange |
| 3 | 16776960 | 0xFFFF00 | yellow |
| 4 | 65280 | 0x00FF00 | green |
| 5 | 65535 | 0x00FFFF | cyan |
| 6 | 255 | 0x0000FF | blue |
| 7 | 9109759 | 0x8B00FF | violet |

Base-class table for comparison (`work/b469c422.fmt.txt:226`):
`{0:0xFF0000, 1:0xFFA000, 2:0xFFFF00, 3:0x00FF00, 4:0x00FFFF, 5:0x0000FF, 6:0xFF00FF}`.

Because the read-back rule skips mode 7 and 8, **violet (index 7) is unreachable through
`getLightSetting`** even though the K98 PRO table defines it.

---

## 3. Side light — FEA_CMD_SET_SLEDPARAM = 8 / FEA_CMD_GET_SLEDPARAM = 136

The K98 PRO chunk contains **no** side-light override; the base implementation in `b469c422.js` is used
(`work/b469c422.fmt.txt:259-306`). `sideLightLayout: he` only selects which effects the UI offers
(section 8).

### 3.1 SET_SLEDPARAM (0x08)

`new Uint8Array(64)`, sent with **`Bit8`** (checksum at byte 8).

| byte | value | meaning |
|---|---|---|
| 0 | `8` | command |
| 1 | effect id | see the switch below (**side-light-local numbering, NOT `LightList`**) |
| 2 | `speed` | speed **as-is** (0..3 for the K98 PRO) — *not* inverted, unlike the key light |
| 3 | `bright` | brightness 0..4 |
| 4 | `option*16 + mode` | mode = `dazzle ? 8 : 7`, with the special cases below |
| 5,6,7 | r,g,b | same encoding as 2.5 (white becomes `0xFB00FA`) |
| 8 | checksum | `255 - (sum(bytes 0..7) & 0xFF)` |
| 9..63 | 0 | unused |

Effect switch (`b469c422.fmt.txt:264-277`):

| UI type | byte 1 | byte 4 adjustment |
|---|---|---|
| `LightOff` | 0 | — |
| `LightAlwaysOn` | 1 | — |
| `LightBreath` | 2 | — |
| `LightNeon` | 3 | **byte 4 = 8** (forced; the option and mode nibbles are discarded) |
| `LightWave` | 4 | — |
| `LightSnake` | 5 | — |
| `LightMusicFollow2` | 6 | `byte4 = (option << 4) + (dazzle ? 0 : 4)` |
| anything else | 0 | — |

### 3.2 GET_SLEDPARAM (0x88 = 136)

Request: `new Uint8Array(64)` with `[0] = 136`, `Bit7` (checksum at byte 7).
Response: byte 1 = effect id, byte 2 = speed (as-is), byte 3 = bright, byte 4 = `option*16+mode`,
bytes 5..7 = r,g,b; converted back with the same `COMMONCOLOR` / `0xFB00FA` rules as 2.2.

Effect id to type table used by the getter (`b469c422.fmt.txt:296-304`):
`{0:LightOff, 1:LightAlwaysOn, 2:LightBreath, 3:LightNeon, 4:LightWave, 5:LightSnake, 6:LightMusicFollow2}`;
for id 6 the `dazzle` flag is `mode === 0`.

---

## 4. Per-key RGB "user picture" — FEA_CMD_SET_USERPIC = 12 / FEA_CMD_GET_USERPIC = 140

Source: `work/b469c422.fmt.txt:138-176`.

### 4.1 Buffer layout

`setLightPic(pic, layerIndex)` (`:147-155`) builds a flat array

    i = new Array(ceil(defaultMatrix.length / 4) * 3).fill(0)     // K98 PRO: 128 * 3 = 384 bytes
    for each { hid, index, rgb } of pic:
        a = findIndexInDefaultMatrix(hid, index)                  // a = LED index, see section 9
        if (a === undefined) continue
        {r,g,b} = numToRgb(rgb)
        i[a*3] = r;  i[a*3+1] = g;  i[a*3+2] = b

So the **LED index is the index of the 4-byte slot inside `defaultMatrix`** (section 9), stored as an
RGB triple in that order. The K98 PRO has 128 slots (101 non-zero) and the LED order is a matrix-scan
order, not a raster order.

`findIndexInDefaultMatrix(hid, index)` (`:308-315`):

    if (hid === 50449664) hid = 50384128;         // 0x0301CD00 = [3,1,205,0]  ->  0x0300CD00 = [3,0,205,0]
    m = hidToMatrix(hid)
    walk defaultMatrix in steps of 4; count the slots equal to m; return slot/4 for the index-th match

`hidToMatrix` (`index.630fe4af.js@1723293`):
`hid <= 255 ? [0,0,hid,0] : [hid>>>24, (hid>>>16)&255, (hid>>>8)&255, hid&255]`.
`50449664` / `50384128` decode to `[3,1,205,0]` / `[3,0,205,0]`; `[3,0,205,0]` is "play/pause" in the
driver's function-key table `_w` (`index.630fe4af.js@203245`).

`getLightPic` (`:169-176`) is the exact inverse:

    data = _getLightPic(layerIndex)                       // 384 bytes, 3 per LED
    for (i = 0; i < data.length; i += 3):
        rgb = rgbToNum(data[i], data[i+1], data[i+2])
        hid = findHidWithIndexInMatrix(i / 3)             // matrixToHid(defaultMatrix[3k .. 3k+4])
        if (hid !== 0 && hid !== undefined)
            push { hid, rgb, index: <number of already-pushed entries with the same hid> }

### 4.2 Write paging — `_setLightPic` (`:138-145`)

    const n = new Uint8Array(8);
    n[0] = 12;  n[1] = layerIndex ?? 0;  n[2] = 255;
    for (let i = 0; i < 7; i++) {
        n[3] = i;                              // page
        n[4] = (i === 6) ? 378 - 56*6 : 56;    // -> 42 on the last page
        n[5] = (i === 6) ? 1 : 0;              // last-page flag
        let s = data.slice(i*56, (i+1)*56);
        if (s.length < 56) s = [...s, ...new Array(56 - s.length).fill(0)];
        sendMsg(new Uint8Array([...n, ...s]), Bit7);      // 8 + 56 = 64 bytes
    }

| byte | value |
|---|---|
| 0 | 12 |
| 1 | layer / picture index (0..4) |
| 2 | 255 (constant; meaning **UNKNOWN**, probably "all profiles") |
| 3 | page 0..6 |
| 4 | 56 for pages 0..5, **42** for page 6 |
| 5 | 0 for pages 0..5, 1 for page 6 |
| 6 | 0 |
| 7 | checksum `255 - (sum(bytes 0..6) & 0xFF)` (Bit7) |
| 8..63 | 56 payload bytes |

**Paging arithmetic (byte-exact):** 7 pages x 56 = 392 bytes are transmitted, but the declared valid
length is `6*56 + 42 = 378` bytes = **126 LEDs**. `setLightPic` supplies 384 bytes (128 LEDs), so LED
indices 126 and 127 are never transmitted. For the K98 PRO both of those slots are `[0,0,0,0]`
(non-existent), so nothing is lost — but a WebHID implementation must reproduce the 378-byte limit to
stay byte-identical.

### 4.3 Read paging — `_getLightPic` (`:156-164`)

    const n = new Uint8Array(8);
    n[0] = 140;  n[1] = layerIndex ?? 0;  n[2] = 255;
    let out = [];
    for (let i = 0; i < 6; i++) {
        n[3] = i;                              // page
        const s = await commonMsg(n, Bit7);    // 64-byte response
        out = [...out, ...(s ?? new Array(64).fill(0))];
    }
    return out;                                // 6 * 64 = 384 bytes

Request frame: `[140, layer, 255, page, 0,0,0, checksum]`, padded to 64 bytes.
Response: 64 bytes per page, 6 pages, so **384 bytes** = 128 LEDs x 3.

> Asymmetry worth knowing: **write = 7 x 56 = 392 (378 valid), read = 6 x 64 = 384.**
> A round trip is still consistent for the K98 PRO because LEDs 126/127 are empty.

### 4.4 Layer index

The UI keeps 5 user pictures (`index.630fe4af.js@157943`: `自定义层_max = 5`) and passes the same
0-based index both to `SET/GET_USERPIC` byte 1 and to the LEDPARAM option nibble while
`LightUserPicture` is active (`index.630fe4af.js@1689740`, `@1690238`:
`读取/写入自定义层_index = selectedCustomizationLayer - 1`, `option_value = same`).

---

## 5. Music-follow / screen-colour streaming — command 15 (0x0F)

The two live-light modes are ordinary `LightList` effects (20 = `LightMusicFollow3`,
21 = `LightScreenColor`, 22 = `LightMusicFollow2`) selected with SET_LEDPARAM; the per-frame colours are
then streamed with a separate, undocumented command **15**.

`sendSyncColor` (`work/b469c422.fmt.txt:921-929`):

    const e = new Uint8Array(8);
    e[0] = 15;  e[1] = 1;  e[3] = 56;
    const pages = Math.ceil(data.length / 56);
    for (let i = 0; i < pages; i++) {
        e[2] = i;                            // page
        e[4] = (i === pages - 1) ? 1 : 0;    // last-page flag
        const s = [...e, ...data.slice(i*56, (i+1)*56)];
        await sendMsg(new Uint8Array(s), Bit7, 0);   // Bit7 -> checksum at byte 7
    }

| byte | value |
|---|---|
| 0 | 15 |
| 1 | 1 (constant) |
| 2 | page index |
| 3 | 56 (constant; page size) |
| 4 | 1 on the last page, else 0 |
| 5,6 | 0 |
| 7 | checksum `255 - (sum(bytes 0..6) & 0xFF)` |
| 8.. | payload `data[i*56 .. i*56+56)` (at most 56 bytes, not padded — the transport zero-pads to 64) |

Payload: the app's rhythm/screen painter produces a **21 x 6 = 126 LED raster**, flat `[r,g,b]` triples,
378 bytes, so 7 frames (6 x 56 + 42). Painter `class gae`, `index.630fe4af.js@2347090`
(`cols = 21, rows = 6`; `updateOutputs()` pushes r,g,b for each of the 21*6 canvas pixels with alpha
pre-multiplied by a/255); the sync page sets `setSize(21*15, 6*15)` = `(315, 90)` at
`index.630fe4af.js@2353412`.

Enabling flow (`index.630fe4af.js@1812933` `Mn`, `@1727345` `qi`, `@1766100` onwards `___checkChanges`):

1. `checkLightChange()` writes the effect with `setLightSetting` (byte 1 = 20/21/22).
2. `___checkChanges` first calls `qi.stopLight(devAddr)`, then after 3 s `Mn()` calls
   `qi.startLight(devAddr, type)`; any `LightMusicFollow*` is normalised to `LightMusicFollow2`.
3. The painter then calls `dev.sendSyncColor(frame)` about every 30 ms (music) or 8 ms (screen).

`supportsLightSync()` (`work/b469c422.fmt.txt:931-933`): only over USB
(`deviceType.connect === "usb"`) and only if the `FEA_CMD_GET_USB_VERSION` (143) response has
**byte 11 === 1**. The result is cached on `deviceType.supportsLightSync`
(`index.630fe4af.js@1814155`) and gates the whole light-sync page (`index.630fe4af.js@1718212`).

> **UNKNOWN:** whether the firmware treats the cmd-15 buffer as the same 126-entry buffer as the cmd-12
> picture (i.e. in `defaultMatrix` order) or as a separate raster in painter (row-major) order. The
> driver never reorders the painter output. Suggested hardware test: stream a frame with r=255 for
> entry 0 only and observe which physical key lights up.

---

## 6. User GIF / animated user light — FEA_CMD_SET_USERGIF = 18

Present in the K98 PRO's base class but **dormant in this build**: the UI flag `是否支持动态灯效` is
initialised to `false` (`index.630fe4af.js@157984`) and is never set anywhere in `index.630fe4af.js`,
so `setUserGifStart` / `setUserGif` are never reached by the shipping UI.

Start (`work/b469c422.fmt.txt:872-875`): 8-byte frame `[18,0,0,0,0,0,0,cs]` (Bit7), then
`vendorSleep(300)`.

Frame upload (`:877-890`), sent with `Bit7`, payload 56 bytes (zero padded) so the frame is 64 bytes:

| byte | value |
|---|---|
| 0 | 18 |
| 1 | `currentFrame` (0-based frame index) |
| 2 | page 0..6 |
| 3 | 1 (constant) |
| 4 | `frameNum` (total number of frames) |
| 5 | `frameDelay & 0xFF` |
| 6 | `(frameDelay >> 8) & 0xFF` |
| 7 | checksum `255 - (sum(bytes 0..6) & 0xFF)` |
| 8..63 | 56 payload bytes |

Payload: the same 384-byte (128 LED x 3) buffer as section 4, built from `[{hid,index,rgb}]` through
`numToRgb` + `findIndexInDefaultMatrix`. 7 pages per frame are sent back to back with a 5 ms gap
(`await k(5)`), `sendMsg(..., Bit7, 0)`. UI driver: `index.630fe4af.js@1767208` (`checkLightEdit`,
branch `写入动态灯效`).

---

## 7. Other commands reachable on this device

| constant | value | method | frame / notes |
|---|---|---|---|
| FEA_CMD_SET_RESERT | 1 | `reset()` `:65-68` | 64-byte `[1,0,...]`, Bit7; then `vendorSleep(2000)` |
| FEA_CMD_SET_PROFILE | 4 | `setCurrentProfile(p)` `:101-105` | 8-byte `[4,p,0,...]`, Bit7; p in 0..2 (`layer:3`) |
| FEA_CMD_GET_PROFILE | 132 | `getCurrentProfile()` `:106-110` | response byte 1 |
| FEA_CMD_GET_LEDONOFF | 133 | `getKbPowerSaveMode()` `:729-730` | response **byte 1 === 1** means power-save on; `setKbPowerSaveMode()` returns `false` (unsupported) |
| FEA_CMD_SET_SLEEPTIME | 17 | `setSleepTime()` `:119-128` | 64-byte frame, Bit7 at byte 7; payload at bytes 8..15: `time_bt` u16 LE, `time_24` u16 LE, `deepTime_bt` u16 LE, `deepTime_24` u16 LE (seconds). K98 PRO defaults: 7200 s sleep / 1800 s deep sleep |
| FEA_CMD_GET_SLEEPTIME | 145 | `getSleepTime()` `:130-136` | reads bytes 8..15 the same way; fallback `{120,120,1680,1680}` |
| FEA_CMD_SET_FLASHCHIPERASSE | 172 | `setFlashChipErase()` `:218-221` | 64-byte `[172,0,...]`, Bit7; success iff response `[0]=172 && [1]=170 && [2]=170 && [3]=85 && [4]=85` |
| FEA_CMD_SET_KBOPTION | 9 | `setKBOption()` `:706-709` | `[9,0,fnIndex,防误触,RTStab/25,WASDSwap,0,0]`, Bit7. `setOldKBOption`/`getOldKBOption` are stubs returning `false`/`undefined` |
| FEA_CMD_GET_KBOPTION | 137 | `getKBOption()` `:711-727` | returns `{防误触开关, RTStab, WASDSwap, system, fnIndex}` |
| FEA_CMD_SET_REPORT | 3 | `setReportRate()` `:820-836` | byte 2 = rate code (8k=0, 4k=1, 2k=2, 1k=3, 500=4, 250=5, 125=6) |
| FEA_CMD_GET_USB_VERSION | 143 | `getUSBVersion()` `:70-73` | version = `byte8 << 8 | byte7`; **byte 11 === 1 means supportsLightSync** |
| FEA_CMD_GETMLED_VERSION | 174 | `getMledVersion()` `:84-88` | |
| FEA_CMD_GETOLED_VERSION | 173 | `getOledVersion()` `:90-95` | no OLED on this device, unused |
| FEA_CMD_SET_CMD_AUTOOSEN | 23 | `setAutoOsen()` `:852-853` | |
| FEA_CMD_GET_SKU | 208 | `getSku()` `:862-866` | returns 0 unless `company === "TITANHUB"` (K98 PRO is "DAGK"), so unused |
| FEA_CMD_SET_MULTI_MAGNETISM | 101 | magnetic-switch API `:588-704` | implemented in the base class, but the K98 PRO DB entry has no `magnetism` key, so unused |
| OLED/TFT (34/37/39/40/41/165/169/176/177/178) | — | `setOLEDClock`, `setTFTLCDDataRGBImg`, ... | implemented in `b469c422.js` / `85888098.js`, but the K98 PRO DB entry has no `screen`, so unused |

---

## 8. The two layout tables referenced by the K98 PRO DB entry

Both are plain effect-descriptor objects — **neither contains LED indices**. They only drive the UI
(effect list, slider maxima, option lists, colour/dazzle availability); see the UI model classes
`灯光设置` / `灯带设置` at `index.630fe4af.js@1562956`.

### 8.1 `T` — lightLayout (`index.630fe4af.js@540200`, the only definition; used at `@790960`)

    T = { isRgb: true, types: [ ... 21 entries ... ] }

| # | type | maxValue (brightness max) | maxSpeed (speed max) | rgb (colour picker) | dazzle (colourful switch) | options (option nibble) |
|---|---|---|---|---|---|---|
| 0 | LightWave | 4 | 4 | yes | yes | 0=向右, 1=向左, 2=向下, 3=向上 |
| 1 | LightRipple | 4 | 4 | yes | yes | - |
| 2 | LightRaindrop | 4 | 4 | yes | yes | - |
| 3 | LightSnake | 4 | 4 | yes | yes | 0=Z字形, 1=回形 |
| 4 | LightPressAction | 4 | 4 | yes | yes | - |
| 5 | LightConverage | 4 | 4 | yes | yes | - |
| 6 | LightSineWave | 4 | 4 | yes | yes | - |
| 7 | LightKaleidoscope | 4 | 4 | yes | yes | 0=向外, 1=向内 |
| 8 | LightPressActionOff | 4 | 4 | yes | yes | - |
| 9 | LightLineWave | 4 | 4 | yes | yes | 0=向右, 1=向左 |
| 10 | LightLaser | 4 | 4 | yes | yes | - |
| 11 | LightCircleWave | 4 | 4 | yes | yes | 0=逆时针, 1=顺时针 |
| 12 | LightDazzing | 4 | 4 | yes | yes | - |
| 13 | LightRainDown | 4 | 4 | yes | yes | - |
| 14 | LightMeteor | 4 | 4 | yes | yes | - |
| 15 | LightAlwaysOn | 4 | - (fixed 0) | yes | yes | - |
| 16 | LightBreath | 4 | 4 | yes | yes | - |
| 17 | LightNeon | 4 | 4 | no | no | - |
| 18 | LightUserPicture | 4 | - (fixed 0) | no | no | 0=图案1, 1=图案2, 2=图案3, 3=图案4, 4=图案5 |
| 19 | LightMusicFollow2 | 4 | - (fixed 0) | yes | yes | 0=upright, 1=separate, 2=intersect |
| 20 | LightScreenColor | 4 | - (fixed 0) | no | no | - |

### 8.2 `he` — sideLightLayout (`index.630fe4af.js@556513`, the only definition; used at `@790960`)

    he = { isRgb: true, types: [ ... 6 entries ... ] }

| # | type | maxValue (brightness max) | maxSpeed (speed max) | rgb (colour picker) | dazzle (colourful switch) | options (option nibble) |
|---|---|---|---|---|---|---|
| 0 | LightWave | 4 | 3 | yes | yes | - |
| 1 | LightSnake | 4 | 3 | yes | yes | - |
| 2 | LightOff | - | - (fixed 0) | no | no | - |
| 3 | LightAlwaysOn | 4 | - (fixed 0) | yes | yes | - |
| 4 | LightBreath | 4 | 3 | yes | yes | - |
| 5 | LightNeon | 4 | 3 | no | no | - |

`maxValue` bounds the brightness slider (`亮度_max`), `maxSpeed` the speed slider (`速度_max`);
`rgb: true` enables the colour picker, `dazzle: true` enables the colourful/single-colour switch, and
`options[]` becomes the option dropdown. Note that `LightNeon` has neither `rgb` nor `dazzle`: the UI
sends the effect with `color_type = 单色` and `color_value = 16777215` (so `0xFB00FA` on the wire) and
the firmware ignores that colour for this effect.

**Where the LED indices actually come from:** the per-LED mapping used by the picture/GIF commands is
the `defaultMatrix` of `530511ba.js` (section 9); `T` and `he` are unrelated to it apart from living in
the same DB entry.

---

## 9. LED index table (LED index to defaultMatrix slot to HID usage code to physical key)

`defaultMatrix` is `530511ba.js`'s own override (128 slots x 4 bytes = 512 numbers). The decode below
uses `matrixToHid` (`index.630fe4af.js@1723293`) plus the mouse table `Na` and the function-key table
`_w` (`index.630fe4af.js@205640`, `@203245`).
"HID" is the USB HID Keyboard/Keypad usage id when the slot decodes to `[0,0,x,0]`; the last rows in
the table decode through the driver's function-key table instead. `in126` marks whether the slot is
inside the 126-entry range that the picture/sync commands actually transmit (section 4.2).

| LED | defaultMatrix slot | hid (dec) | hid (hex) | key | in 126-LED range |
|---|---|---|---|---|---|
| 0 | [0,0,41,0] | 41 | 0x29 | Esc | yes |
| 1 | [0,0,53,0] | 53 | 0x35 | Backquote | yes |
| 2 | [0,0,43,0] | 43 | 0x2B | Tab | yes |
| 3 | [0,0,57,0] | 57 | 0x39 | CapsLock | yes |
| 4 | [0,0,225,0] | 225 | 0xE1 | ShiftLeft | yes |
| 5 | [0,0,224,0] | 224 | 0xE0 | ControlLeft | yes |
| 6 | [0,0,58,0] | 58 | 0x3A | F1 | yes |
| 7 | [0,0,30,0] | 30 | 0x1E | 1 | yes |
| 8 | [0,0,20,0] | 20 | 0x14 | Q | yes |
| 9 | [0,0,4,0] | 4 | 0x4 | A | yes |
| 10 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 11 | [0,0,227,0] | 227 | 0xE3 | MetaLeft | yes |
| 12 | [0,0,59,0] | 59 | 0x3B | F2 | yes |
| 13 | [0,0,31,0] | 31 | 0x1F | 2 | yes |
| 14 | [0,0,26,0] | 26 | 0x1A | W | yes |
| 15 | [0,0,22,0] | 22 | 0x16 | S | yes |
| 16 | [0,0,29,0] | 29 | 0x1D | Z | yes |
| 17 | [0,0,226,0] | 226 | 0xE2 | AltLeft | yes |
| 18 | [0,0,60,0] | 60 | 0x3C | F3 | yes |
| 19 | [0,0,32,0] | 32 | 0x20 | 3 | yes |
| 20 | [0,0,8,0] | 8 | 0x8 | E | yes |
| 21 | [0,0,7,0] | 7 | 0x7 | D | yes |
| 22 | [0,0,27,0] | 27 | 0x1B | X | yes |
| 23 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 24 | [0,0,61,0] | 61 | 0x3D | F4 | yes |
| 25 | [0,0,33,0] | 33 | 0x21 | 4 | yes |
| 26 | [0,0,21,0] | 21 | 0x15 | R | yes |
| 27 | [0,0,9,0] | 9 | 0x9 | F | yes |
| 28 | [0,0,6,0] | 6 | 0x6 | C | yes |
| 29 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 30 | [0,0,62,0] | 62 | 0x3E | F5 | yes |
| 31 | [0,0,34,0] | 34 | 0x22 | 5 | yes |
| 32 | [0,0,23,0] | 23 | 0x17 | T | yes |
| 33 | [0,0,10,0] | 10 | 0xA | G | yes |
| 34 | [0,0,25,0] | 25 | 0x19 | V | yes |
| 35 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 36 | [0,0,63,0] | 63 | 0x3F | F6 | yes |
| 37 | [0,0,35,0] | 35 | 0x23 | 6 | yes |
| 38 | [0,0,28,0] | 28 | 0x1C | Y | yes |
| 39 | [0,0,11,0] | 11 | 0xB | H | yes |
| 40 | [0,0,5,0] | 5 | 0x5 | B | yes |
| 41 | [0,0,44,0] | 44 | 0x2C | Space | yes |
| 42 | [0,0,64,0] | 64 | 0x40 | F7 | yes |
| 43 | [0,0,36,0] | 36 | 0x24 | 7 | yes |
| 44 | [0,0,24,0] | 24 | 0x18 | U | yes |
| 45 | [0,0,13,0] | 13 | 0xD | J | yes |
| 46 | [0,0,17,0] | 17 | 0x11 | N | yes |
| 47 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 48 | [0,0,65,0] | 65 | 0x41 | F8 | yes |
| 49 | [0,0,37,0] | 37 | 0x25 | 8 | yes |
| 50 | [0,0,12,0] | 12 | 0xC | I | yes |
| 51 | [0,0,14,0] | 14 | 0xE | K | yes |
| 52 | [0,0,16,0] | 16 | 0x10 | M | yes |
| 53 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 54 | [0,0,66,0] | 66 | 0x42 | F9 | yes |
| 55 | [0,0,38,0] | 38 | 0x26 | 9 | yes |
| 56 | [0,0,18,0] | 18 | 0x12 | O | yes |
| 57 | [0,0,15,0] | 15 | 0xF | L | yes |
| 58 | [0,0,54,0] | 54 | 0x36 | Comma ,< | yes |
| 59 | [0,0,230,0] | 230 | 0xE6 | AltRight | yes |
| 60 | [0,0,67,0] | 67 | 0x43 | F10 | yes |
| 61 | [0,0,39,0] | 39 | 0x27 | 0 | yes |
| 62 | [0,0,19,0] | 19 | 0x13 | P | yes |
| 63 | [0,0,51,0] | 51 | 0x33 | Semicolon ;: | yes |
| 64 | [0,0,55,0] | 55 | 0x37 | Period .> | yes |
| 65 | [10,1,0,0] | 167837696 | 0xA010000 | ? | yes |
| 66 | [0,0,68,0] | 68 | 0x44 | F11 | yes |
| 67 | [0,0,45,0] | 45 | 0x2D | Minus -_ | yes |
| 68 | [0,0,47,0] | 47 | 0x2F | BracketLeft [{ | yes |
| 69 | [0,0,52,0] | 52 | 0x34 | Quote | yes |
| 70 | [0,0,56,0] | 56 | 0x38 | Slash /? | yes |
| 71 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 72 | [0,0,69,0] | 69 | 0x45 | F12 | yes |
| 73 | [0,0,46,0] | 46 | 0x2E | Equal =+ | yes |
| 74 | [0,0,48,0] | 48 | 0x30 | BracketRight ]} | yes |
| 75 | [0,0,50,0] | 50 | 0x32 | ? | yes |
| 76 | [0,0,229,0] | 229 | 0xE5 | ShiftRight | yes |
| 77 | [0,0,80,0] | 80 | 0x50 | ArrowLeft | yes |
| 78 | [0,0,76,0] | 76 | 0x4C | Delete | yes |
| 79 | [0,0,42,0] | 42 | 0x2A | Backspace | yes |
| 80 | [0,0,49,0] | 49 | 0x31 | Backslash | yes |
| 81 | [0,0,40,0] | 40 | 0x28 | Enter | yes |
| 82 | [0,0,82,0] | 82 | 0x52 | ArrowUp | yes |
| 83 | [0,0,81,0] | 81 | 0x51 | ArrowDown | yes |
| 84 | [0,0,74,0] | 74 | 0x4A | Home | yes |
| 85 | [0,0,83,0] | 83 | 0x53 | NumLock | yes |
| 86 | [0,0,95,0] | 95 | 0x5F | Numpad7 | yes |
| 87 | [0,0,92,0] | 92 | 0x5C | Numpad4 | yes |
| 88 | [0,0,89,0] | 89 | 0x59 | Numpad1 | yes |
| 89 | [0,0,79,0] | 79 | 0x4F | ArrowRight | yes |
| 90 | [0,0,75,0] | 75 | 0x4B | PageUp | yes |
| 91 | [0,0,84,0] | 84 | 0x54 | NumpadDivide | yes |
| 92 | [0,0,96,0] | 96 | 0x60 | Numpad8 | yes |
| 93 | [0,0,93,0] | 93 | 0x5D | Numpad5 | yes |
| 94 | [0,0,90,0] | 90 | 0x5A | Numpad2 | yes |
| 95 | [0,0,98,0] | 98 | 0x62 | Numpad0 | yes |
| 96 | [0,0,78,0] | 78 | 0x4E | PageDown | yes |
| 97 | [0,0,85,0] | 85 | 0x55 | NumpadMultiply | yes |
| 98 | [0,0,97,0] | 97 | 0x61 | Numpad9 | yes |
| 99 | [0,0,94,0] | 94 | 0x5E | Numpad6 | yes |
| 100 | [0,0,91,0] | 91 | 0x5B | Numpad3 | yes |
| 101 | [0,0,99,0] | 99 | 0x63 | NumpadDecimal | yes |
| 102 | [0,0,72,0] | 72 | 0x48 | ? | yes |
| 103 | [0,0,86,0] | 86 | 0x56 | NumpadSubtract | yes |
| 104 | [0,0,87,0] | 87 | 0x57 | NumpadAdd | yes |
| 105 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 106 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 107 | [0,0,88,0] | 88 | 0x58 | NumpadEnter | yes |
| 108 | [3,0,233,0] | 50391296 | 0x300E900 | ? | yes |
| 109 | [3,0,234,0] | 50391552 | 0x300EA00 | ? | yes |
| 110 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 111 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 112 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 113 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 114 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 115 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 116 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 117 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 118 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 119 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 120 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 121 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 122 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 123 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 124 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 125 | [0,0,0,0] | 0 | 0x0 | (empty slot) | yes |
| 126 | [0,0,0,0] | 0 | 0x0 | (empty slot) | **no** |
| 127 | [0,0,0,0] | 0 | 0x0 | (empty slot) | **no** |

`defaultFnMatrix` and `defaultFnMacMatrix` (also 512 numbers each, dumped into `data/lighting.json`)
are the Fn-layer matrices; they are **not** used for lighting and matter only for key remapping.

---

## 10. Minimal WebHID recipe

1. `navigator.hid.requestDevice({filters:[{vendorId:0x3151, productId:0x5002}, {vendorId:0x3151, productId:0x5006}]})`
   (the driver additionally matches `usagePage 0xFFFF, usage 2, interfaceNumber 2`).
2. Open the device and use **feature reports, reportId 0, 64 bytes**.
3. Read with `device.receiveFeatureReport(0)` after writing the request. The driver sleeps 10 ms after
   the write and 10 ms before the read, and 100 ms (`vendorSleep()`) after mutating commands.
4. Build every frame with the padding and checksum rules of section 1.
5. Read the current state with `GET_LEDPARAM` / `GET_SLEDPARAM` before writing so that unmodified fields
   keep their values.

---

## 11. The other protocol families in this bundle (not used by the K98 PRO)

### 11.1 `b189996d.js` — `class F` (exported `C`), an older FEA keyboard base

`app/resources/app/dist/js/b189996d.js` (beautified: `work/b189996d.fmt.txt`). Differences that matter
if such a device is ever targeted:

* `MAXSPEED = 5`, `DAZZLE = 6`, `NORMAL = 7` (`:306-308`) — *different numbers*.
* `COMMONCOLOR = {0:0xFF0000, 1:0x00FF00, 2:0x0000FF, 3:0xFF5000, 4:0xFF00FF, 5:0xFFFF00, 6:0xFFFFFF}` (`:309`).
* `LIGHTLIST` = the `b469c422` list minus `LightUserColor` (`:312`).
* `_setLightPic` (`:152-164`): byte1 = 0, **bytes 2..3 = total byte count u16 LE**
  (`64 * floor(defaultMatrix.length/4*3/64)`), byte4 = page 0..6, 56-byte payload, `Bit7`.
* `_getLightPic` (`:177-188`): 6 pages, page number in **byte 2**, 64 bytes per page.
* No side light: `setSideLightSetting = async t => false`.
* `FEA_CMD_SET_DEBOUNCE = 17` and `GET_DEBOUNCE = 145` — the ids the K98 PRO uses for sleep time.

### 11.2 `90cac215.js` — `class P extends b189996d.C`, `class V extends P` (exported `CommonKbYc500`)

`work/90cac215.fmt.txt`. Also not used by the K98 PRO. Notable:

* `P` declares `DAZZLE = 8`, `NORMAL = 7` and a `COMMONCOLOR` identical to the base `b469c422` table
  (`:12-16`); `MAXSPEED = 5` is inherited from `b189996d.F`.
* `P.FEA_CMD_SET_SLEEPTIME = 18` / `FEA_CMD_GET_SLEEPTIME = 146` with the payload at bytes **1..8**
  (four u16 LE values, `work/90cac215.fmt.txt:18-40`) — a different sleep command and offset than the
  K98 PRO's 17/145 with the payload at bytes 8..15.
* `P.SIDELIGHTLIST` (`:41-43`) uses the **global** `LightList` numbering for the side light
  (`20:LightMusicFollow3, 21:LightScreenColor, 22:LightMusicFollow2`) instead of the K98 PRO's
  side-light-local numbering 0..6.
* `V.setUserGif` (`:226-240`) uses `i[1] = page, i[2] = currentFrame, i[3] = frameNum,
  i[4] = frameDelay` — a different byte order from `b469c422`.
* `V` uses a completely different command-id set for key config (19, 21, 22, 24, 25).
* `V.defaultMatrix` / `defaultFnMatrix` are that device's own tables.

**Nothing from `90cac215.js` or `b189996d.js` is reachable from `530511ba.js`.**

### 11.3 `85888098.js` — OLED bootloader / TFT-flash helper (imported by the K98 PRO chunk)

Imported (`import "./85888098.js"`) and used only for firmware upgrade (`oledUpgrade` /
`flashUpgrade`, `b469c422` `:902-912`). Its commands (48/176/49/177/50/178) target OLED/TFT screens;
the K98 PRO DB entry has no `screen`, so they are never exercised.

---

## 12. Example frames

Frames are shown exactly as the driver hands them to the transport, which then zero-pads to the
64-byte feature report. Every frame below is 64 bytes **except** the last `SYNC_COLOR` example, which
is 50 bytes (8 command bytes + a 42-byte final page) because `sendSyncColor` never pads its last page.
Checksums were recomputed from the rules in section 1.

### GET_LEDPARAM (135) - read current key-light parameters

    87 00 00 00 00 00 00 78 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00

### GET_SLEDPARAM (136) - read current side-light parameters

    88 00 00 00 00 00 00 77 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00

### SET_LEDPARAM: LightAlwaysOn, option 0, speed 0 -> byte2 = 4, bright 4, single colour (mode 7), white (0xFB00FA)

    07 01 04 04 07 FB 00 FA F3 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00

### SET_LEDPARAM: LightAlwaysOn ... colourful (mode 8), red 0xFF0000

    07 01 04 04 08 FF 00 00 E8 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00

### SET_LEDPARAM: LightWave, option 1 (left), speed 2 -> byte2 = 2, bright 4, colourful, orange

    07 04 02 04 18 FF 80 00 57 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00

### SET_LEDPARAM: LightUserPicture, option 0 (pattern 1), speed 0, bright 4 -> byte4 = 0x00, bytes 5..7 forced to 0,200,200

    07 0D 04 04 00 00 C8 C8 53 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00

### SET_LEDPARAM: LightScreenColor -> byte4 forced to 0x00

    07 15 04 04 00 FB 00 FA E6 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00

### SET_LEDPARAM: LightMusicFollow2, option 2 (intersect), colourful -> mode 0

    07 16 02 04 20 FB 00 FA C7 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00

### SET_SLEDPARAM: LightBreath, speed 2 (as-is), bright 4, mode 7, white

    08 02 02 04 07 FB 00 FA F3 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00

### SET_SLEDPARAM: LightNeon -> byte4 forced to 0x08

    08 03 02 04 08 FB 00 FA F1 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00

### SET_USERPIC page 0: layer 0, byte2 = 255, page 0, length 56, last 0, then 56 payload bytes

    0C 00 FF 00 38 00 00 BC 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00

### SET_USERPIC page 6 (last): page 6, declared length 42, last flag 1, then 56 payload bytes

    0C 00 FF 06 2A 01 00 C3 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00

### GET_USERPIC page 0: layer 0, byte2 = 255, page 0

    8C 00 FF 00 00 00 00 74 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00

### SET_USERGIFSTART (18)

    12 00 00 00 00 00 00 ED 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00

### SET_USERGIF: frame 0, page 0, byte3 = 1, frameNum = 0, frameDelay = 0, then 56 payload bytes

    12 00 00 01 00 00 00 EC 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00

### SYNC_COLOR (15) page 0: page 0, pageSize 56, last 0, then 56 payload bytes

    0F 01 00 38 00 00 00 B7 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00

### SYNC_COLOR (15) last page (index 6): last flag 1; only 42 payload bytes are appended (transport pads to 64)

    0F 01 06 38 01 00 00 B0 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00

### SET_FLASHCHIPERASSE (172) - success iff response bytes 1..4 == AA AA 55 55

    AC 00 00 00 00 00 00 53 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00

### SET_SLEEPTIME (17): time_bt = 7200, time_24 = 7200, deepTime_bt = 1800, deepTime_24 = 1800 (u16 LE at bytes 8..15)

    11 00 00 00 00 00 00 EE 20 1C 20 1C 08 07 08 07 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00

### GET_SLEEPTIME (145)

    91 00 00 00 00 00 00 6E 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00

### GET_USB_VERSION (143) - response byte 11 == 1 means light-sync (cmd 15) is supported

    8F 00 00 00 00 00 00 70 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00

### FEA_CMD_SET_RESERT (1)

    01 00 00 00 00 00 00 FE 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00


---

## 13. UNKNOWN list

1. **Meaning of `SET_USERPIC` byte 2 = 255.** Constant in `_setLightPic` *and* `_getLightPic`; the
   driver never varies it. Probably a "profile/sub-index = all" marker. Not verified.
2. **Whether GET responses carry a checksum** (for example `GET_LEDPARAM` byte 8). The driver validates
   nothing except byte 0 for a few commands, so this cannot be settled statically.
3. **Firmware interpretation of the cmd-15 (sync colour) payload order** — see the note in section 5.
4. **Whether the firmware honours the declared last-page length 42** rather than the 56 transmitted
   bytes (48 meaningful) on `SET_USERPIC` page 6.
5. **The exact firmware effect ids for `LightScreenColor` (21) / `LightMusicFollow3` (20)**: the driver
   sends the `LightList` key; that the firmware expects 20/21/22 is inferred from the round-trip getter,
   not verified on hardware.
6. **Partially resolved — see `docs/layout-98y98.md` (sibling analysis).** The **asynchronous**
   geometry resolver `Zp` (`index.630fe4af.js@1409307`) consults `LN = {...SN, ...CN}`
   (`@1401075`, `@1401883`, merged at `@1409241`) and that merged map has **no** `c.Common98_Y98`
   entry (it only has `c.Common98_Y98PRO -> keyboard_98_y98pro_v2_keymappings_ui_info`), so `Zp`
   throws "keyboard layout not found" for the K98 PRO. The **synchronous** path
   `createKeyboardState` (`index.630fe4af.js@1597931`, name list `B4` at `@331541`) *does* have a
   `case c.Common98_Y98` arm and yields the 98 key names; the geometry chunk `2714b259.js`
   (`keyboard_98_y98_keymappings_ui_info`) matches that name list exactly. What remains **UNKNOWN** is
   only whether the shipping UI actually renders K98 PRO with that geometry or with a fallback.
   This does not affect the wire protocol, which works on HID codes.
7. **`[3,0,233,0]` / `[3,0,234,0]` at LED 108/109** are "volume up" / "volume down" per the function-key
   table `_w`; whether those two LED slots physically exist on the K98 PRO PCB is not determinable here.
8. **Side-light LED count / zone geometry** is not in the driver at all: the side light is driven purely
   by the firmware effect selected with cmd 8; there is no per-side-LED data path.
9. Whether the 126-entry picture/sync buffer **includes** the side-light LEDs.

---

## 14. Machine-readable dump

`data/lighting.json` contains: device metadata, the command table, both layout tables, both
`COMMONCOLOR` tables, the paging parameters, the full 128-slot LED table, the raw `defaultMatrix` /
`defaultFnMatrix` / `defaultFnMacMatrix` arrays and the example frames.
