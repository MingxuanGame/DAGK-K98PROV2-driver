# AGENTS.md — 给 AI 编码代理 / 贡献者的项目说明

> 本文件面向**改代码的人（或 AI 代理）**。想"用"这个驱动的读者请看 [README.md](./README.md)。

## 1. 这个仓库是什么

把原厂 Windows 驱动 `DAGK-K98PROV2驱动.exe`（Electron + **WebHID**）逆向之后，
用**纯静态网页**复刻出来的键盘驱动：界面 1:1、协议逐字节一致、**去掉了原厂的 AI 功能**。

- 纯前端：无构建步骤、无依赖、无后端。`web/` 就是整个产物（直接丢到任意静态托管即可）。
- 通信：浏览器 **WebHID**（`navigator.hid`），厂商通道 = interface #2（usagePage `0xFFFF` / usage `0x0002`），
  64 字节 Feature Report，reportId = 0。
- 设备：有线 `3151:5002`；2.4G 接收器 `3151:5006`（同一个 64 字节报文，接收器负责转发）。

原厂材料（安装包 / 解包目录 / 逆向工作目录）**不在仓库里**，见第 8 节。

## 2. 常用命令

| 命令 | 作用 | 需要真机？ |
|---|---|---|
| `npm run dev` | 本地静态服务 http://127.0.0.1:8177/web/index.html | 否 |
| `npm test` | 单元测试（协议编解码 / 配置模型 / 灯效表）；有线用例没插设备时自动跳过 | 否 |
| `npm run test:keymap` | 键盘页冒烟（98 键渲染 / 改键 / 写入 / 板载切换 / 未保存提醒） | 否 |
| `npm run test:rf` | 2.4G 转发自测（假接收器） | 否 |
| `npm run test:frames` | **与原厂驱动逐字节比对发出的 64 字节帧** | 否 |
| `npm run test:deploy` | 预部署校验（把 `web/` 当域名根来跑） | 否 |
| `npm run test:e2e` | 真 Chrome + 假 WebHID 的完整 UI 流程（默认会自己起静态服务） | 否 |
| `npm run test:all` | 上面全部 | 否 |
| `npm run test:hw` | 有线真机全功能回环（读→写回原值→再读，md5 比对） | ✅ |
| `npm run hw:status` / `hw:protocol` / `hw:dongle` / `hw:session` | 绕过浏览器、直接用 hidraw 验证协议 | ✅ |

**测试门控**：`tests/detect-mode.mjs` 会探测当前插着什么设备，只跑对应那一组用例；
`FORCE=1` 用假设备强制全跑（CI 用这个），`K98_NO_DEVICE=1` 模拟"什么都没插"。
2.4G 的用例**默认不跑**（`npm run test:rf` 单独跑），因为接收器的厂商通道很脆。

## 3. 目录结构

```
web/                     ← 部署产物（唯一需要发布的目录）
  index.html             页面骨架：欢迎页 / 顶栏 / 侧栏 5 页 / 底栏 / 键盘测试浮层
  css/style.css          原厂设计变量(:root) + 全部样式
  js/
    app.js               壳：连接/断开、导航、顶栏「读取设备配置」、未保存提醒、键盘测试
    transport.js         WebHID 收发 + 2.4G 接收器转发(DongleRelay) + 串行锁
    protocol.js          命令层：0x8F/0x83/0x8A/0x0A/0x87/0x88/0x8B/0x90…（帧在这里拼）
    keymap.js            键盘设置 + Fn层设置（两个实例，含 104 键盘选键面板、98 键图）
    lighting.js          灯光设置（主灯效 / 侧灯 / 单键背光）
    macro.js             宏编辑
    config.js            配置管理（读取 / 应用 / 导入导出 / localStorage）
    kcfg.js,kcfg-tables.js  原厂按键配置模型逐字移植（AI 条目已剔除）
    layout.js            98 键布局坐标表；keycodes.js HID 码表；notify.js 掉线通知
  robots.txt, sitemap.xml, site.webmanifest, 404.html   SEO / PWA / 404（域名写死在里面）
  assets/                图标（favicon / 192 / apple-touch）+ 分享大图 og-cover.png(1200x630)
tests/                   ← 全部测试与假设备
  fake-hid.js            注入页面的假 WebHID（含假接收器转发、__matrixByLayer 注入）
  mock-device.mjs        Node 侧的假设备（单元测试用）
  detect-mode.mjs        真机探测 + 用例门控
  fixtures/              录好的原厂帧（orig-frames.json）
data/                    ← 从原厂包里抽出来的表 + 真机抓的矩阵（生成物的存档）
docs/                    ← 协议笔记、真机测试记录、部署说明、界面截图
work/                    ← 逆向过程的工作目录（不入库；见第 8 节）
```

## 4. 必须守住的不变量

1. **帧要与原厂逐字节一致**。任何改 `protocol.js` 帧构造的改动，都要让 `npm run test:frames` 保持通过。
   校验和：`f[7]=0xFF-(sum(f[0..6])&0xFF)`（Bit7）、`f[8]=0xFF-(sum(f[0..7])&0xFF)`（Bit8）。
2. **界面 1:1 复刻**。颜色/字号/几何/四态按键配色都有断言（`test:e2e` 的样式段），不要"顺手美化"。
3. **原厂功能一个都不能少，AI 功能一个都不能有**（`kcfg-tables.js` 里已剔除 AI 条目，
   tests 里有 `kcfg: 表数据来自原厂且已剔除 AI` 守着）。
4. **按键配置模型**：128 个位置 × 4 字节 = 512 B / 层，3 层（板载 1/2/3）。
   普通键 `[0,0,hid,0]`；组合键 `[0,skey,key,key2]`；全 0 = 固件禁用；
   原厂认不出的字节 = 系统按键。**只显示与出厂不同的键**（照抄原厂 `cN()` 的调用方式）。
5. **读之前先对齐板载**：`0x84` 问设备"现在用哪一档"，再读那一层（`syncProfile()`）。
6. **读取要排队**：`keymap.js` 的 `queueRead()` + `DongleRelay._serialize()`。
   自动读取(连接后) / 进页面自动读取 / 手动读取 / 扫描会同时发生，不排队就会在接收器的
   同一条控制通道上互相穿插 —— 真机表现为读回旧数据或把接收器 stall 成 EPIPE。
7. **2.4G 绝不后台轮询、绝不重试风暴**。`autoPoll` 默认关；一页只做 1 次 F7 预检；
   任何一页失败立即中止，不把剩下几页打完。
8. **顶部「读取设备配置」是唯一的读取入口**（用户明确要求删掉各页面里的读取按钮）。
   它按当前可见页面转发到对应模块，**读取期间会 disabled** —— 点击前要确认可用，
   自动化测试里点它是空操作（历史踩坑）。
9. **有改动没写入要提醒**：`reportDirty()` → 顶栏徽标 + `beforeunload`。
10. **每次连接都要自动读取一次**（`autoReadFor === state.device` 判断，不是布尔开关）。
11. **SEO / 分享标签与域名保持一致**：`index.html` 的 canonical、og:url、og:image、JSON-LD，
    以及 `sitemap.xml`、`robots.txt` 里写死的域名必须同步（`npm run test:deploy` 会逐项校验）。
    换域名时照 `docs/deploy-saas.md` 第 6.1 节的 `sed` 一行替换，别只改一半。

## 5. 协议速查（详见 docs/protocol-parity.md）

| 命令 | 作用 | 回包要点 |
|---|---|---|
| `0x8F` | 设备识别 | `f[1..2]` 小端 = 3780(0x0EC4) |
| `0x80` | RF 版本 | 仅 2.4G |
| `0x97` | 自动识别系统 | |
| `0xAD`/`0xAE` | OLED / 矩阵灯版本 | |
| `0x83` | 回报率 | `f[2]`=索引(3→1000Hz) |
| `0x84` | 当前板载 | `f[1]` = 0/1/2 |
| `0x86` | 去抖 | |
| `0x87`/`0x88` | 主灯效 / 侧灯 | `f[1]`效果 `f[2]`速度 `f[3]`亮度 `f[5..7]`RGB |
| `0x89` | 键盘选项（含 WASD 互换） | |
| `0x8A` | 读按键矩阵 | `f[1]`层 `f[2]=255` `f[3]`页(8 页×64B) |
| `0x0A` | 写按键（整层分页 / 单键） | 单键：`f[2]`位置 `f[5]=1` `f[8..11]`四字节 |
| `0x90`/`0x10` | 读 / 写 Fn 层 | `f[1]`系统(win0/mac1) `f[2]`层 `f[4]`页 |
| `0x8B`/`0x0B` | 宏读 / 写 | 槽位 `f[1]` |
| `0x8C`/`0x0C` | 单键背光读 / 写 | 6 页读 / 7 页写 |
| `0x91` | 休眠时间 | |
| `0x04` | 设为当前板载（SET_PROFILE） | |
| `0x01` | 恢复出厂 | |
| `0xF7`/`0xF6`/`0xFC` | 2.4G：状态 / 选目标(键盘=10) / 通知读取 | 接收器本地帧 |

## 6. 已知的坑（都踩过）

- **`.navitem` 有 `background .18s` 过渡**：点完立刻 `getComputedStyle` 会读到过渡起点
  `rgba(0,0,0,0)`。测颜色前先 `sleep(500)`。
- **`[hidden]` 会被 `display:flex` 覆盖**：`style.css` 里有 `[hidden]{display:none!important}`。
- **小键盘键名必须带 `Num` 前缀**（`Num7`…）：以前数字行 `7` 和数字键盘 `7` 同名，
  用户点错，把 Home 写成了小键盘 7（有回归断言）。
- **2.4G 的 `isCanRead` 经常不回 1**，但应答其实已经躺好了 → 以"回包内容是否像本次命令的应答"判定成败。
- **假设备的 `0x84` 默认返回 1**（板载2）；要比对原厂录制的帧时用 `window.__profile=0`。
- **不要用"按下标切片"的脚本改大文件**（曾把 e2e 文件改坏到只剩 188 行）。
  用精确字符串替换，改完立刻 `node --check`。

## 7. 提交前自检

```bash
npm run test:all      # 单测 + 键盘页冒烟 + 2.4G + 帧比对 + 预部署 + 浏览器端到端
```

有真机时再补一条 `npm run test:hw`（会写回原值并比对 md5，是安全的）。

## 8. 仓库里没有的东西

逆向用的原厂材料体积大（约 500 MB）且版权属于厂商，**不入库**（见 `.gitignore`）：

| 路径 | 是什么 | 用到了什么 |
|---|---|---|
| `DAGK-K98PROV2驱动.exe` | 原厂安装包 | 帧格式、命令表、界面资源的唯一来源 |
| `app/` | 解包后的 Electron 应用（`resources/app/dist`） | 跑起来抓真实 DOM / 帧记录 |
| `extract/` | 安装包解包中间产物 | |
| `work/` | 逆向工作目录：反编译产物、一次性脚本、对照报告 | `ui-parity.mjs`、`orig-ui/frames-orig.mjs` 等 |

其中两份**产物**已经搬进仓库，所以相关测试不需要原厂文件也能跑：
`tests/fixtures/orig-frames.json`（原厂发出的帧）和 `data/wired-matrix.json`（真机抓的层数据）。
