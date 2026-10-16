# EasyPic 管理后台

独立的 React 管理应用，发布在 `/admin/` 路径下。

## 本地命令

在仓库根目录运行：

```bash
pnpm --filter @easypic/admin-app dev
pnpm --filter @easypic/admin-app test
pnpm --filter @easypic/admin-app build
pnpm --filter @easypic/admin-app test:e2e
```

开发服务器会将 `/api` 代理到 Fastify（默认 `http://127.0.0.1:3000`，可通过 `EASYPIC_ADMIN_API_ORIGIN` 覆盖）。生产环境应单独将 `/api` 反向代理到 Fastify。

## 部署

Nginx 直接提供 `/opt/easypic/current/packages/admin-app/dist`，挂在 `/easypic/admin/`。未知的前端路由回退到该目录的 `index.html`，`/easypic/api/` 单独反代到 Fastify。
