# C4 远程 MCP OAuth Resource Server 验收审计

日期：2026-10-08

## 结论

```text
C4=PASS
oauthResourceServerCodeReady=true
oauthConfigurationPreflightContractPassed=true
externalHttpsDeploymentVerified=false
publicInternetReleaseReady=false
fatalFindingCount=0
majorFindingCount=0
```

## 自动验收结果

- RFC 9728 metadata 字段与 path-aware 路径通过。
- 本地 RSA/JWKS 签发的 RS256 JWT 经 signature、issuer、audience、expiry、subject、FAMS user claim 和 scope 校验后，使用官方 MCP SDK 读取真实默认账户 16 个持仓。
- wrong issuer、wrong audience、wrong signature、expired 返回 401；missing scope 返回 403；challenge 包含 `resource_metadata`。
- `local_opaque_token` 与 `oauth_jwt` principal 明确分离，原本地 HTTP 验收继续通过，支付宝范围读取 9 个真实持仓。
- 工具仍为 10 个受控投资组合工具，不暴露 broker/order 工具。

审计产物：`backend/data/gpt-audit/portfolio-mcp-oauth/2026-10-08T10-44-21-058Z/portfolio_mcp_oauth_resource_server_audit.json`。

## 诚实限制

HTTPS 配置结构可通过预检，但本机没有部署公网域名、外部 IdP 登录/同意流程或回调。因此 `externalHttpsDeploymentVerified` 与 `publicInternetReleaseReady` 必须保持 false。
