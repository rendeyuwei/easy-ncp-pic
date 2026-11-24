# EasyPic 公共站中英文实现计划

规格：`docs/superpowers/specs/2026-11-23-easypic-web-i18n-design.md`。只改 `packages/web-app` 和这两份文档。管理后台、数据库、API 行为、图像引擎输出、Nginx、ESA 不动。

## 基线

- 公共站现在只有 `packages/web-app/index.html`，`lang="zh-CN"`，文案写在组件里。
- Vite `base` 来自 `EASYPIC_DEPLOY_PREFIX`。`webPath` / `webBasepath` 已把 API 放在前缀下。
- 路由只有 TanStack 的 `/`，`basepath` 是部署前缀。
- 顶栏标签由 `preserveShellTopbarHtml` 固定成站点根的 `/shell/topbar.<sha256>.js`。中文页的语言脚本同样钉住 `/shell/lang.<sha256>.js`。
- `use-theme` 直接读写 `localStorage`，存储抛错时首屏会中断。
- 共享语言脚本尚未进入生产。对照物是 rende-site `64701ced2b3e495f8e5237148096a5a665e41c17` 的 `dist/shell/lang.js`，已放入 `packages/web-app/src/test/fixtures/shell-lang.js`。该脚本里 easypic 的 `en` 仍是 `false`。

## 任务 1：语言决策

文件：

- 新建 `packages/web-app/src/lib/locale.ts`
- 新建 `packages/web-app/src/test/locale.test.ts`
- 夹具 `packages/web-app/src/test/fixtures/shell-lang.js`

测试先写这些行为，再让实现通过：

- `parsePlace('/easypic/en/work', '/easypic/')` → `{ prefix: '/easypic', lang: 'en', rest: 'work' }`
- `parsePlace('/easypic', '/easypic')` 归中文，rest 为空
- `parsePlace('/preview/en/', '/preview')` 是英文；`/other/en/` 在前缀 `/preview` 下不是本站英文
- `explicitZh('?album=1&lang=zh')` 为真；`lang=zh-CN`、`lang=en` 不是明确中文
- `matchLanguages(['fr-FR', 'zh-HK', 'en'])` 为 `zh`；`['en-US', 'zh-CN']` 为 `en`；`['fr', 'de']` 为 `null`
- `decideEnter`：英文路径不跳；`?lang=zh` 不跳；手选中文不跳；手选英文跳到 `en/` 并保留其余 query 与 hash；无匹配且页面声明了英文 hreflang 时跳到英文；未声明则不跳
- `languageHref` 切到中文时追加 `lang=zh` 并删掉原来的 `lang`，切到英文时只删 `lang`
- 存储 `getItem` / `cookie` 抛错时 `readManualPref` 返回 `null`
- 与夹具脚本在 `/easypic` 上的 `place`、`match`、`pref`、`href`、`enter` 结果一致
- `bootLocale`：前缀 `/easypic` 且存在 `rfLang.enter` 时只调用它；前缀 `/preview` 时不调用它，而是 `replace('/preview/en/...')`
- `routerBasepath('/easypic/en/', '/easypic/')` 为 `/easypic`（语言是路由，不是 base）；`pageLang` 在英文路径上忽略 `?lang=zh`
- `localeUrls('easypic')` 得到 `https://rende.fun/easypic/` 与 `https://rende.fun/easypic/en/`
- `localeBootSource()` 可在 vm 里执行，并且不包含 `</script`

## 任务 2：路由、HTML、顶栏路径

文件：

- 修改 `packages/web-app/src/router.tsx`、`src/main.tsx`、`vite.config.ts`
- 修改 `packages/web-app/index.html`，新建 `packages/web-app/en/index.html`
- 修改 `src/lib/shell-topbar-html.ts` 与 `src/test/shell-topbar-html.test.ts`
- 修改 `src/test/routing.test.ts`
- 新建 `src/test/locale-html.test.ts`

要点：

- `createWebRouter` 的默认 `basepath` 用 `routerBasepath(location.pathname, BASE_URL)`
- 中文页包含 hreflang、`data-easypic-prefix`、同步 `/shell/lang.js`、`<script data-easypic-boot></script>`、带 leaving 判断的原百度片段、`data-tool="easypic"` 的顶栏
- 英文页有对应的英文 title/description/noscript，没有启动脚本
- Vite 输入两份 HTML。插件替换三个占位符并内联启动脚本。`base` 不含 `/en/`
- 顶栏与 lang 脚本被加上部署前缀后，再写回 `/shell/...`

## 任务 3：文案、错误码、存储

文件：

- 新建 `src/lib/messages.ts`、`src/lib/app-error.ts`、`src/locale-context.tsx`
- 新建 `src/test/messages.test.ts`、`src/test/app-error.test.ts`、`src/test/i18n-ui.test.tsx`、`src/test/use-theme.test.tsx`
- 修改 `src/app.tsx`、`src/components/*`、`src/components/ui/dialog.tsx`、`src/hooks/use-image-session.ts`、`src/hooks/use-theme.ts`
- 修改 `src/styles.css` 里按钮的 `min-width: 0`，避免英文换行时撑出横向滚动
- 更新 `use-image-session` 里导出失败句子的断言：不再拼接引擎原文

中文句子保持现在测试所依赖的原文。英文是独立译文。滤镜名、分类名、描述原样渲染。

`codeForEngineMessage` 的顺序与现在的 `userError` 相同。`AppError` 带 `code`，`message` 用当前语言的句子，因此「已有导出任务正在进行。」这类断言仍然成立。

## 任务 4：浏览器与静态路由

文件：

- 新建 `packages/web-app/scripts/serve-locale-preview.mjs`
- 新建 `packages/web-app/playwright.locale.config.ts`
- 新建 `packages/web-app/e2e/locale.spec.ts`
- 修改 `packages/web-app/playwright.config.ts`，现有用例固定 `locale: 'zh-CN'`，避免无前缀开发服务器上的英文浏览器被送去 `/en/`
- `package.json` 增加 `test:e2e:locale`。默认 `pnpm test` 仍是 Vitest

静态服务器只做 `try_files`：文件、目录、目录下的 `index.html`。`/shell` 指向本地构建的新主站 `dist`，`/easypic` 指向 `EASYPIC_DEPLOY_PREFIX=easypic` 的 web-app `dist`。预览不用生产上的旧顶栏，也不改 Nginx。

浏览器用例覆盖：原始中英 HTML、有序语言、无匹配、手选、明确 URL、存储禁用、query/hash、两侧的选图/处理/导出、API 不落到 `/en/api`、320/390/桌面无横向溢出。截图用 `e2e/fixtures/photo.jpg`。

## 验证命令

```bash
pnpm -r typecheck
pnpm -r build
pnpm -r test
EASYPIC_DEPLOY_PREFIX=easypic pnpm --filter @easypic/web-app build
pnpm --filter @easypic/web-app test:e2e
pnpm --filter @easypic/web-app test:e2e:locale
```

现有 `test:e2e` 仍走 Vite 开发服务器。`test:e2e:locale` 走上面的生产构建和本地新顶栏。

## 同页切换

`v >= 2` 时，`packages/web-app/src/lib/language-switch.ts` 只用 `router.navigate` 改一次地址，再 `choose` 并派发 `rf:locale`。不重放 `topbar.js`，不改 `__rfBar`。回归覆盖五次点击和 Enter、后退前进、离线无新请求、同一顶栏节点、监听次数、焦点、`/pics/` 文案，以及 ASTIA、强度 97、对比 46 和解码后的导出。
