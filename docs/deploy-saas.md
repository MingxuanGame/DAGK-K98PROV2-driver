# 部署到公网（SaaS / 静态托管）

这个驱动**没有后端**：整个应用就是仓库里 `web/` 目录的静态文件
（HTML + CSS + 原生 ES Module，没有构建步骤、没有依赖、没有 API 调用）。
所以"部署到 SaaS"= **把 `web/` 发布到任意一个支持 HTTPS 的静态托管**。

> 本项目的线上实例（可作为参考）：**<https://dagk.mxgame.top>**
> 换域名时记得改 `web/index.html`、`web/sitemap.xml`、`web/robots.txt` 里写死的域名，见第 6.1 节。

---

## 0. 四条硬性要求

| 要求 | 为什么 | 怎么办 |
|---|---|---|
| **HTTPS** | `navigator.hid` 只在**安全上下文**里可用（`https://` 或 `http://localhost`） | Vercel / Cloudflare Pages / Netlify / GitHub Pages 默认给 HTTPS；自建就上 Let's Encrypt |
| **发布目录 = `web/`** | 仓库根目录里还有测试、文档、逆向材料，都不该发布 | 各平台设置 Output / Publish Directory 为 `web` |
| **域名要改成你自己的** | `index.html` 的 canonical / Open Graph / 结构化数据，以及 sitemap、robots 里写死了线上域名 | 全局替换 `dagk.mxgame.top`（见 6.1 节），否则搜索引擎会认错站点 |
| **公网域名下没有 `/api/*`** | 本地小服务器提供 `/api/ping`、`/api/notify`（桌面通知桥），公网上不存在 | 页面已做降级：探测 404 后自动改用"页面横幅 + 浏览器通知"，不会报错 |

**可选加固**：给所有响应加一条 `Permissions-Policy: hid=(self)`
（限制只有同源页面能用 HID；不加也能正常工作）。

**部署前自检**（把 `web/` 当成域名根跑一遍，等价于线上环境）：

```bash
npm run test:deploy        # 14 项：资源无 404 / 模块加载 / 能连上设备 / 无 JS 异常
```

---

## 1. Vercel（仓库里已经配好）

仓库根目录已经有 `vercel.json`：

```json
{ "outputDirectory": "web",
  "headers": [{ "source": "/(.*)", "headers": [{ "key": "Permissions-Policy", "value": "hid=(self)" }] }] }
```

以及 `.vercelignore`（把 `app/`、`extract/`、`work/` 这些几百 MB 的逆向材料排除在上传之外）。

### 方式 A：命令行（最快）

```bash
npx vercel login
npx vercel --prod          # 输出 https://<project>.vercel.app
```

### 方式 B：连 Git 仓库自动部署

1. 把仓库推到 GitHub / GitLab；
2. Vercel → **Add New → Project** → 选中该仓库；
3. 配置：
   - **Root Directory**：留空（= 仓库根目录）
   - **Framework Preset**：`Other`
   - **Build Command**：留空
   - **Output Directory**：**留空**（`vercel.json` 里已经写了 `outputDirectory: "web"`）
4. Deploy。

> ⚠️ 常见坑：把 **Root Directory 设成 `web`** 的同时 `vercel.json` 又写着
> `outputDirectory: "web"`，Vercel 会去找 `web/web`，直接 404。
> 二选一：要么 Root 留空 + vercel.json 生效，要么 Root 填 `web` + 删掉 `vercel.json` 里的 `outputDirectory`。

---

## 2. Cloudflare Pages

- **Connect to Git** → 选仓库 →
  - Build command：**留空**
  - Build output directory：`web`
- 或者不用 Git，直接命令行上传：

```bash
npx wrangler pages deploy web --project-name dagk-k98pro
```

自定义响应头放在 `web/_headers`（Cloudflare Pages 专用文件）：

```
/*
  Permissions-Policy: hid=(self)
  X-Content-Type-Options: nosniff
```

---

## 3. Netlify

仓库根目录放一个 `netlify.toml`（本仓库没带，按需自建）：

```toml
[build]
  command = ""
  publish = "web"

[[headers]]
  for = "/*"
  [headers.values]
    Permissions-Policy = "hid=(self)"
    X-Content-Type-Options = "nosniff"
```

或者命令行：`npx netlify deploy --prod --dir=web`

---

## 4. GitHub Pages

GitHub Pages 只发布仓库里的目录，所以最简单的做法是用 Actions 把 `web/` 传上去。
新建 `.github/workflows/pages.yml`：

```yaml
name: Deploy web to Pages
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: web           # ← 只发布 web/
      - id: deployment
        uses: actions/deploy-pages@v4
```

然后在仓库 **Settings → Pages → Source** 选 `GitHub Actions`。

> GitHub Pages **不能**自定义响应头（没有 `Permissions-Policy`）。
> 这不影响使用：Permissions-Policy 缺省就允许同源页面使用 HID。

---

## 5. 自己的服务器

### nginx

```nginx
server {
  listen 443 ssl http2;
  server_name k98.example.com;

  root /var/www/k98/web;          # ← 只把 web/ 放上去
  index index.html;

  add_header Permissions-Policy "hid=(self)" always;
  add_header X-Content-Type-Options "nosniff" always;

  # 入口页别长缓存，JS/CSS 可以
  location = /index.html { add_header Cache-Control "no-cache"; }
  location ~* \.(js|css|png|svg|ico)$ { add_header Cache-Control "public, max-age=86400"; }
}
```

### Caddy（自动 HTTPS，最省事）

```
k98.example.com {
    root * /var/www/k98/web
    file_server
    header Permissions-Policy "hid=(self)"
    header X-Content-Type-Options "nosniff"
}
```

### Docker 快速验证（本机）

```bash
docker run -d --name k98 -p 8080:80 -v "$PWD/web:/usr/share/nginx/html:ro" nginx
# 打开 http://localhost:8080 —— localhost 属于安全上下文，WebHID 可用
```

> 注意：从别的机器用 `http://<IP>:8080` 访问**不行**（非安全上下文，WebHID 直接不可用），
> 必须 HTTPS 或本机 localhost。

### 对象存储 / CDN

阿里云 OSS、腾讯云 COS、AWS S3 + CloudFront 都可以：把 `web/` 里的文件原样上传，
开启"静态网站托管"，绑定 HTTPS 域名即可。记得把 `index.html` 设为默认首页。

---

## 6. 部署之后

1. 用 Chrome / Edge 打开 `https://你的域名/`；
2. 点「连接有线键盘 / 连接 2.4G 接收器」，在浏览器弹窗里选中设备；
   **浏览器按"站点"记住授权**，所以每个域名第一次都要手选一次；
3. 连上后会自动读取键盘配置，直接就能改键。

### 6.1 换域名时要改的文件（SEO）

`web/` 里下面这些地方写死了线上域名 `https://dagk.mxgame.top`，换成你的域名时一起替换：

| 文件 | 内容 | 作用 |
|---|---|---|
| `web/index.html` | `<link rel="canonical">`、`og:url`、`og:image`、`twitter:image`、JSON-LD 里的 `url`/`license`/`codeRepository` | 标题描述、社交分享卡片、结构化数据 |
| `web/sitemap.xml` | `<loc>` | 提交给搜索引擎的站点地图 |
| `web/robots.txt` | `Sitemap:` 行 | 允许抓取并指向站点地图 |

```bash
# 一行搞定（把新域名替换进去）
grep -rl 'dagk.mxgame.top' web/ | xargs sed -i 's|https://dagk.mxgame.top|https://你的域名|g'
```

SEO 相关文件清单（都已随 `web/` 发布）：

- `index.html`：title / description / keywords / robots / canonical / OG / Twitter / JSON-LD(`WebApplication`) / `<noscript>` 兜底
- `site.webmanifest`：PWA 名称、图标（`icon-192.png`、`icon.png`、`apple-touch-icon.png`）、主题色
- `robots.txt`、`sitemap.xml`、`404.html`
- `assets/og-cover.png`（1200×630，分享卡片用）

部署完可以用这几个方式验证：

```bash
curl -sI https://你的域名/robots.txt          # 200
curl -s  https://你的域名/sitemap.xml | head  # <loc> 是你的域名
# 富媒体结果测试：https://search.google.com/test/rich-results
# 分享卡片预览：https://cards-dev.twitter.com/validator 或直接发给自己看看
```

### 别忘了告诉使用者两件事

- **Linux 使用者仍需在自己机器上装 udev 规则**（见 [README 第 2 节](../README.md#第二步--linux-放行-hid-设备其他系统跳过)）。
  浏览器能不能拿到 `/dev/hidraw*` 由**本机**决定，和网页放在哪里无关。
- **键盘要处于有线或 2.4G 档**；蓝牙模式下浏览器看不到厂商配置通道。

### 想嵌到别的页面里？

WebHID 在 iframe 里默认被拦，需要显式授权：

```html
<iframe src="https://k98.example.com/" allow="hid" width="1200" height="800"></iframe>
```

自己用没问题，面向公众时建议直接给顶级页面（少一层权限麻烦）。

---

## 7. 常见问题

**Q：部署后页面能打开，但点连接没反应 / 弹窗里没设备？**
A：① 必须是 `https://`（或本机 localhost）；② 用 Chrome/Edge 89+；
③ Linux 装 udev 规则；④ 键盘插好、开关在正确档位。

**Q：控制台一直报 `/api/ping` 404？**
A：正常。那是本地通知桥，公网上没有，页面已降级。想彻底安静可以把
`web/js/notify.js` 里的探测关掉，或自己实现一个同名接口。

**Q：界面是白屏？**
A：多半是发布目录不对（要发布 `web/` 的内容，而不是仓库根目录），
或者服务器没给 `.js` 正确的 `Content-Type: text/javascript`。跑 `npm run test:deploy` 能看到具体哪一步挂了。

**Q：改了键没生效？**
A：改动只写进"当前选中的板载档"，写之前要点「写入设备」，写完还要确认键盘正在用那一档
（点「把这一档设为键盘当前板载」）。
