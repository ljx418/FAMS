# C4 远程 MCP OAuth Resource Server 验收计划

日期：2026-10-08

## 自动门槛

1. metadata 包含规范 `resource`、`authorization_servers`、`scopes_supported` 和 header bearer method。
2. RS256 JWT 必须校验 signature、issuer、audience、exp、subject、FAMS user claim 和 scope。
3. 合法 `portfolio:read` JWT 能通过官方 MCP SDK读取真实默认账户；错误 issuer/audience/signature/过期 token 返回 401；缺 scope 返回 403。
4. 401/403 带 `WWW-Authenticate: Bearer ... resource_metadata=...`。
5. 本地 `fams_mcp_*` opaque token 继续通过原验收，且不能被标为 OAuth。
6. 明文公网 URL、缺 issuer/audience/JWKS/origin 时 preflight 不得通过。
7. 自动化始终保持 `externalHttpsDeploymentVerified=false`、`publicInternetReleaseReady=false`。
8. 工具列表不包含订单工具，四项交易锁保持 false。

## 命令

```text
cd backend
node node_modules/typescript/bin/tsc
npm run test:portfolio-mcp-oauth-resource-server
npm run test:portfolio-mcp-http
```

## 打回条件

- FAMS 自行签发 OAuth token 或实现不受控授权服务器。
- 跳过 signature/issuer/audience/scope 任一校验。
- 仅凭配置即声明公网部署成功。
- 破坏本地 token 兼容或暴露交易工具。
