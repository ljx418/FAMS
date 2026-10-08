# C4 远程 MCP OAuth Resource Server 开发计划

日期：2026-10-08

## 标准基线

FAMS MCP 作为 OAuth resource server：验证外部授权服务器签发的 access token，发布 RFC 9728 protected-resource metadata，并在 401/403 challenge 中给出 `resource_metadata`。FAMS 不签发 OAuth token，不实现登录、授权码或客户端注册。

## 实现实体

1. `PortfolioMcpOAuthService`：配置、metadata、JWKS 缓存、JWT signature/issuer/audience/exp/scope/user claim 校验与发布前置检查。
2. `portfolioMcpAuthService.authenticateHttpBearer()`：明确区分 `local_opaque_token` 与 `oauth_jwt` principal，保留本地 token 兼容。
3. `portfolioMcpOAuthMetadataRouter`：发布根路径和 path-aware metadata、只读 readiness。
4. `portfolioHttp.ts`：401/403 返回标准 Bearer challenge；所有 MCP 工具仍走现有 scope 和用户隔离。
5. `verify-portfolio-mcp-oauth-resource-server.ts`：本地 RSA/JWKS、真实默认账户只读 MCP 调用、错误 issuer/audience/scope/token、metadata、preflight 和本地 token 回归。

## 发布口径

自动化最多声明：

```text
oauthResourceServerCodeReady=true
oauthConfigurationPreflightReady=true|false
externalHttpsDeploymentVerified=false
publicInternetReleaseReady=false
```

真实 HTTPS 域名、外部 IdP 配置、回调/同意流程和公网连通性必须在外部环境与集中人工阶段核查。
