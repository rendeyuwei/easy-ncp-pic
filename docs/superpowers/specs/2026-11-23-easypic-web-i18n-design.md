# EasyPic 公共站中英文：实现规格

状态：按已批准的四站契约实现。契约原文是未合并的 `rendeyuwei/rende-site` PR #5，head `64701ced2b3e495f8e5237148096a5a665e41c17`，文件 `docs/superpowers/specs/2026-11-23-sites-i18n-design.md`。本轮只改 EasyPic 公共 `web-app`。不合并、不部署、不改服务器、ESA、Nginx 或生产缓存。管理后台、数据库、用户录入的滤镜名/分类名/描述都不在范围内。

## 1. 与契约对齐的部分

1. 中文仍是部署前缀下的现有 URL。英文是该前缀下的 `en/`。生产前缀为 `easypic` 时即 `/easypic/` 与 `/easypic/en/`。`EASYPIC_DEPLOY_PREFIX` 继续只决定挂载点，不把语言写进 Vite `base`。API、Worker、图片资源和导出下载仍从挂载点根路径取，不经过 `en/`。
2. 判定顺序与 `src/shell/lang.ts` 相同：路径 `en/` 是明确英文（不被 `?lang=zh` 或手选覆盖）；无 `en/` 且查询参数 `lang` 的值恰好是 `zh` 是明确中文；然后才是手选 `rf-lang`（localStorage，失败再读 cookie）；然后 `navigator.languages` 里按顺序第一个主标签为 `zh` 或 `en` 的项；都没有则英文。`zh-HK`、`zh-TW` 使用简体界面。
3. 只有点击共享顶栏切换器才写入偏好。EasyPic 不另做一套切换器，也不另写存储键。
4. 自动跳转只发生在「当前挂载点下、路径不是 `en/`、也没有 `lang=zh`」的页面，方向只有到对应的 `en/`。英文页不自动跳回。query（去掉或追加 `lang`）和 hash、`en/` 之后的剩余路径都保留。
5. 存储被禁用时，明确的 `?lang=zh` 仍停在中文；切换仍靠链接本身完成。跨站链接的 `?lang=zh` 继承由共享 `siteHref` 负责，EasyPic 不改 `window.rfLang`。
6. 两份静态 HTML 各自带 `lang`、自指 canonical、`hreflang="zh-CN|en|x-default"`。`x-default` 指向英文。中文页在这些 link 之后同步加载 `/shell/lang.js`，再决定是否进入英文。统计脚本先看 `rfLang.leaving`，再看本站兜底标志。
7. 顶栏仍是 `/shell/topbar.js`，不设 `data-home`。增加 `data-tool="easypic"`，让工具标记不依赖路径猜测。品牌名保持 EasyPic。

## 2. 本站类型

```ts
type AppLang = 'zh' | 'en';

interface LocalePlace {
  prefix: string; // '' 或 '/easypic'，无尾斜杠
  lang: AppLang;  // 只看路径
  rest: string;   // 去掉前缀和 en/ 之后的路径，无首斜杠
}

interface EnterDecision {
  redirectTo: string | null;
  lang: AppLang;
  source: 'url' | 'manual' | 'navigator' | 'default';
}
```

实现集中在 `packages/web-app/src/lib/locale.ts`：

| 函数 | 职责 |
|---|---|
| `prefixFromDeployValue` | `EASYPIC_DEPLOY_PREFIX` → `''` 或 `/easypic` |
| `normalizePrefix` | Vite `BASE_URL` → 同上 |
| `parsePlace` | 只在前缀之后识别 `en` 或 `en/` |
| `explicitZh` | 与主站相同的 `lang=zh` 查询判断 |
| `matchLanguages` | 与 `rfLang.match` 相同 |
| `readManualPref` / `readCookiePref` | 与 `rfLang.pref` 相同，存储访问包在 try/catch 里 |
| `languageQuery` / `languageHref` | 与 `rfLang.href` 相同的 query/hash 规则 |
| `decideEnter` | 与 `rfLang.enter` 相同的跳转条件，但使用调用方传入的前缀 |
| `bootLocale` | 前缀恰好是 `/easypic` 且 `window.rfLang.enter` 存在时只调用它；否则用 `decideEnter`，并设置 `window.__easypicLeaving` |
| `routerBasepath` | 中文用前缀，英文用 `前缀 + /en` |
| `pageLang` | 界面语言只看路径。`?lang=zh` 不能把英文页改成中文 |
| `appHomeHref` | 当前语言的工具首页。明确中文且手选没写成中文时带上 `?lang=zh` |
| `localeUrls` / `applyLocaleHtml` / `localeBootSource` | canonical 与 head 内联启动脚本 |

`packages/web-app/src/test/fixtures/shell-lang.js` 是上述 commit 编出的 `dist/shell/lang.js`。单测用它对照 `/easypic` 下的 `place`、`match`、`pref`、`href`、`enter`。不允许为了让用例通过去改这个文件或运行时改 `window.rfLang` 的方法。

## 3. 启动脚本与前缀缺口

中文 `index.html` 的顺序：hreflang、同步 `/shell/lang.js`、内联 `localeBootSource()`、统计、延迟的顶栏。英文 `en/index.html` 不内联启动脚本，因此不会跳走。

`bootLocale` 在前缀为 `/easypic` 且共享脚本已装上 `window.rfLang` 时调用 `rfLang.enter()`，不再自己算一遍。共享脚本 404（当前生产顶栏仍是旧文件）或前缀不是 `/easypic` 时，用本站同一套规则跳转。

已知缺口，本轮不修补共享方法：

- `rfLang.place` 的站点表把 easypic 写成死的 `/easypic/`，`en: false`。
- 其他 `EASYPIC_DEPLOY_PREFIX`（包括本地根路径 `/`）会被当成主站。此时若调用 `rfLang.enter()`，会跳到 `/en/<前缀>/`，而不是 `/<前缀>/en/`。
- 因此非 `/easypic` 挂载点不调用 `rfLang.enter()`，也不替换 `place` / `href`。共享顶栏在这些挂载点上的工具链接仍可能指错；页面自己的界面语言和 API 路径仍按 `data-easypic-prefix` 与 Vite `base` 计算。
- 主站英文页和 `siteHref('easypic')` 在 `en` 仍为 false 时继续指向 `/easypic/`，不会指向 `/easypic/en/`。这是有意的：英文页上线并验证之前不把注册表改成 true。本仓库不修改、不部署 rende-site。

上线 EasyPic 之后，主站还需要单独做两件事（本 PR 不做）：

1. 发布已构建的新 `/shell/lang.js` 与 `/shell/topbar.js`。在此之前，EasyPic 靠自己的兜底脚本完成 `/easypic` 的语言判断；旧顶栏没有切换器。
2. 确认 `/easypic/en/` 已对外可访问后，把 `lang.ts` 里 easypic 的 `en` 改为 `true` 并重新发布主站。`v` 保持 1。EasyPic 中文页是外链 `/shell/lang.js`，不是内联站点表，所以这一改动不需要重发 EasyPic。

## 4. 页面与路由

- `packages/web-app/index.html`：`lang="zh-CN"`。
- `packages/web-app/en/index.html`：`lang="en"`。
- Vite 多页输入两者。`base` 仍是 `deploymentBase(EASYPIC_DEPLOY_PREFIX)`。
- TanStack Router 的 `basepath` 只用部署前缀。中文路由是 `/`，英文路由是 `/en`，同一条无路径布局挂着编辑器，所以语言变化不会卸掉会话。
- canonical 来自 `https://rende.fun` 加构建前缀。生产构建前缀是 `easypic`。根前缀的 canonical 会和主站冲突，那不是生产挂载方式。
- 构建插件把 `__EASYPIC_PREFIX__`、`__EASYPIC_CANONICAL_ZH__`、`__EASYPIC_CANONICAL_EN__` 换掉，并把启动脚本内联进中文页。`preserveShellTopbarHtml` 继续把被 Vite 加上前缀的 `/shell/topbar.js` 和 `/shell/lang.js` 改回站点根。

## 5. 文案与错误

静态界面、title、description、html lang、加载/空态/校验、WebGL 回退、滤镜控件、导出对话框（格式、质量、进度、取消）、aria-label、alt 所用的名称、aria-valuetext 和对比滑块的键盘说明都走 `packages/web-app/src/lib/messages.ts`。`LocaleProvider` 的默认语言是中文，这样现有测试不包一层时行为不变。

用户数据保持原样：`category.name`、`filter.displayName`、`filter.description` 不翻译，也不因为出现汉字就标 `lang="zh"`。

引擎和校验失败映射到稳定 code，再取当前语言的句子：

`filters-unavailable`、`filters-stale`、`file-count`、`file-type`、`file-unreadable`、`dimension-side`、`dimension-total`、`worker-start`、`render-failed`、`export-failed`、`export-in-progress`、`export-no-filter`、`webgl-fallback`。

映射仍按现有消息形状识别（边长、总像素、worker、阶段），不改图像处理或导出字节。界面不再把引擎原文拼进句子。`use-theme` 和语言偏好读取都吞掉存储异常，主题切换在存储被禁用时仍然改 `documentElement`。

## 6. 会话与隐私

普通左键点击共享顶栏的 `a.rf-lang` 不整页加载。捕获阶段取消浏览器默认跳转，调用现有的 `rfLang.choose(lang)` 记下手动偏好，再用 TanStack history 把地址换成该链接的路径、query 和 hash。同一挂载点里的其他链接仍交给浏览器，包括英文页工具菜单里指向 `/easypic/` 的 EasyPic，不调用 `choose`。Ctrl、Meta、Shift、Alt、中键、`target="_blank"` 和 `download` 同样交给浏览器。返回和前进只改地址和界面语言，不写 `rf-lang`。直接打开或刷新仍由各自的静态 HTML 和启动脚本决定，英文页没有启动跳转，因此同页切换不会来回 `replace`。

照片、已选滤镜、强度、对比位置、打开中的导出格式和进行中的导出任务留在布局组件里，不重新跑导出。已出现的错误按稳定 code 用当前语言重画。照片字节不写入 storage，也不发到新的服务。

当前主站顶栏（rende-site `64701ced`）在启动时用 `place(location.pathname)` 定死 `lang` 和 `other`。按钮文案、`bar.lang`、工具菜单和 `siteHref` 都不再读地址。`hashchange` 和点击只把切换链接重写成 `href(other)`，`other` 仍是启动时的那一个。`pushState` 不触发 `hashchange`，`popstate` 也没有监听。因此同页换成另一种语言后，顶栏的文字和链接都还是旧的：再点一次不会切回去，而是对启动时的 `other` 再执行 `choose`，并走向那个旧链接。前进和后退同样不改顶栏，也不该写 `rf-lang`。

主站作者会另加向后兼容的同文档刷新，以及可选的显式挂载。本仓库不猜测函数名，不给 `rfLang` 加方法，也不改它的现有方法。预览在语言不一致时暂时去掉 `.rf-bar`、清掉一次性的 `__rfBar`，再插入原来的 `/shell/topbar.js`，让现有脚本按当时的地址自己画一遍。这不是壳层接口。重插会留下旧的 document 监听；脚本还没画完时再同步一次会直接返回，等那次脚本执行时读的是当时的地址。收到主站的正式约定后，改为只调用那个约定，并停用重插。

现有百度统计片段保留，不新增遥测。被启动脚本跳走的中文页不发统计。同页切换不标记 `leaving`。

## 7. 验收

- 单测：判定顺序、zh-HK/zh-TW、无匹配、手选、明确链接、存储异常、query/hash、无循环、`/easypic` 与共享脚本一致、其他前缀不调用 `rfLang.enter`、API 路径不含 `en/`、英文界面保留中文滤镜名、主题存储异常。
- `pnpm -r typecheck`、`pnpm -r build`、`pnpm -r test`。
- 用仓库内静态 `try_files`（`$uri`、`$uri/`、目录 `index.html`）提供生产构建。`/easypic/en/` 的原始 HTML 是英文壳。这不是生产 Nginx 或 ESA 的实测。
- 浏览器：两种语言直接进入、回退顺序、无匹配、手选、明确 URL、存储禁用、query/hash、筛选/处理/导出、320 与 390 以及桌面宽度不横向溢出。截图使用 `e2e/fixtures` 里的测试图。
