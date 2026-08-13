# EasyPic

[English](README.md)

**你的照片，你的质感，只在你的浏览器里完成。**

无需把原片交给远端修图服务，也能让一张普通的 JPG 或 PNG 拥有鲜明气质。打开照片、探索精选风格、对比每处细节、调节滤镜强度，再以原始像素尺寸导出。EasyPic 把创作过程变得轻松，也让照片始终留在你手中。

> 想看看这张照片还能呈现怎样的感觉？[在本地运行 EasyPic](#本地体验)，几分钟后就能开始探索。

## 为什么选择 EasyPic？

照片的解码、预览、滤镜处理和导出都在浏览器内完成，**不会上传到 EasyPic 服务器**。服务器只负责提供应用与已发布的滤镜参数，你可以放心尝试不同风格，无需把私人照片发送到网络另一端。

EasyPic 将 Nikon Picture Control（`.ncp`）数据转化为直观、易用的浏览器滤镜。这是一个独立项目，不承诺与 Nikon 软件的处理结果逐像素一致。

## 你可以做什么

- 拖入一张 JPG 或 PNG，无需注册即可开始编辑。
- 浏览基于 NCP 的精选滤镜，用自己的照片实时生成预览缩略图。
- 对比原图与滤镜效果，再将滤镜强度自由调整到 0–100%。
- 在桌面或移动设备上使用响应式界面，并随时切换明暗主题。
- 按照片原始像素尺寸导出 JPG，或导出无损 PNG。
- 由 Web Worker 承担图片处理，让操作界面保持流畅响应。
- 优先使用 WebGL 加速，并在不可用时自动回退到 Canvas 2D。

## 本地体验

请先安装 [Node.js](https://nodejs.org/) `>=20.19.0 <21` 或 `>=22.12.0`，以及 pnpm `9.12.1`。

```bash
git clone https://github.com/rendeyuwei/easypic.git
cd easypic
pnpm install
cp .env.local.example .env.local
```

打开 `.env.local`，将示例会话密钥和管理员密码替换为仅用于本地开发的值，然后启动完整服务：

```bash
pnpm dev
```

启动脚本会构建内部依赖，并同时运行 API、公开编辑器与管理后台。按 `Ctrl+C` 即可全部停止。

## 本地服务

| 服务 | 地址 | 用途 |
| --- | --- | --- |
| 公开编辑器 | <http://127.0.0.1:5173/> | 打开照片并探索滤镜 |
| 管理后台 | <http://127.0.0.1:5174/admin/> | 管理分类与已发布滤镜 |
| API 健康检查 | <http://127.0.0.1:3000/api/health> | 确认 API 与数据库已就绪 |

## 工作原理

1. 浏览器读取本地照片、修正 EXIF 方向，并生成适合当前设备的预览。
2. API 只提供已发布的 NCP 滤镜参数，不会接触照片像素。
3. Web Worker 通过 WebGL 或 Canvas 回退路径生成缩略图与主预览。
4. 你可以比较效果、选择强度，再通过同一套本地图片管线完成导出。

## 工作区结构

EasyPic 是一个 pnpm TypeScript monorepo，由职责清晰的包组成：

| 包 | 职责 |
| --- | --- |
| `@easypic/web-app` | 面向用户的 React/Vite 照片编辑器 |
| `@easypic/admin-app` | 需要登录的滤镜与分类管理界面 |
| `@easypic/api-server` | 基于 Fastify 的公开与管理 API |
| `@easypic/database` | SQLite 结构、迁移、会话与数据存储 |
| `@easypic/image-engine` | 解码、渲染、对比与导出管线 |
| `@easypic/ncp-parser` | 严格验证并解析 Nikon NCP 文件 |

## 开发与验证

在仓库根目录运行以下命令：

```bash
pnpm test                                      # 运行全部 Vitest 测试
pnpm test:dev-script                           # 检查本地启动脚本
pnpm -r build                                  # 构建所有工作区包
pnpm -r typecheck                              # 执行严格 TypeScript 检查
pnpm --filter @easypic/web-app test:e2e        # 运行公开编辑器 Playwright 测试
pnpm --filter @easypic/admin-app test:e2e      # 运行管理后台 Playwright 测试
pnpm --filter @easypic/image-engine test:browser # 检查浏览器渲染路径
```

仓库约定和提交前检查请参阅 [AGENTS.md](AGENTS.md)。

## 当前范围

EasyPic 目前一次处理一张 JPG 或 PNG，不接受 RAW/NEF、HEIF、`.np2` 或 `.np3` 输入，也暂不提供云端相册、普通用户账号和批量处理。滤镜管理面向单一管理员。保持第一版体验专注，才能让 EasyPic 足够快速、私密，也足够容易理解。

## 参与贡献

欢迎提交创意、修复、测试，以及经过认真打磨的新滤镜。对于有意义的改动，可以先创建 Issue 交流方向，再提交范围明确的 Pull Request，并附上验证命令和涉及界面变化的截图。一起让私密而富有表现力的照片编辑变得更简单。
