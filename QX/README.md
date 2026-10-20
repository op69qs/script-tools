# Kelee → Quantumult X 适配器

`kelee-qx.js` v1.6.0。继续使用现有本机后端与订阅地址；`remoteSnippet()` 和它引用的 `adapter.js` 地址保持不变，不追加版本号。

## 本次支持范围

纯域名正逻辑：`DOMAIN`、`DOMAIN-SUFFIX`、`DOMAIN-KEYWORD` 的 `AND` / `OR` 嵌套，策略限 `DIRECT`、`REJECT`、`PROXY`。

转换先求完整交集，再输出匹配集合相等的 `host-wildcard` 并集。它处理关键词的两个顺序和重叠情况，后缀包含根域及子域；不会把两个 AND 条件分别输出成独立规则。输出连续放在原规则位置，策略不变。输入字面量、语法及复杂度均受限，无法证明的规则保留原文。

例：`AND, ((DOMAIN-KEYWORD, -ad-), (DOMAIN-SUFFIX, byteimg.com)), REJECT` 可转换为 `host-wildcard, *-ad-*.byteimg.com, REJECT`，不会拦截其他后缀上的 `-ad-`。

每条及整份资源都有计算和输出预算。单条超限保留当前原文；整份资源预算耗尽后保留当前及剩余原文，不输出当前规则的部分分支。

## 仍有的缺口

- 域名与 `PROTOCOL, QUIC` 的交集：不能用全局关闭 QUIC 替代。
- `URL-REGEX` 与 `USER-AGENT` 的分流组合：`url-and-header` 可表达匹配交集，但尚未验证分流策略和优先级的等价转换，尤其是 `DIRECT` 例外。
- `NOT`、其他谓词、额外标记、未验证策略：保留原文并报告缺口。
- Spotify：跨主机 `url.replace` 尚无已验证的 QX 等价实现，插件继续整体返回 HTTP 422。未删除规则、改成 302 或通过 `$task.fetch` 重发请求。带参数二进制脚本也未在本版加入兼容层。

未转换的逻辑仍可能被全局资源解析器跳过。此时资源响应带有 `X-Kelee-QX-Conversion: incomplete`，QX 日志记录 `pendingLogical`、插件、来源、原始行号、原因及脱敏规则摘要。HTTP 200 仅代表资源已准备好交给解析器，不能据此认定整个插件可用。

纯域名转换验证的是匹配集合与文本顺序。Loon 与 QX 的全局规则优先级、混合分流资源装载、脚本实际运行及 App 内效果仍需 QX 实机核验。

接口依据：[Loon 逻辑规则](https://nsloon.app/en/docs/Rule/logic_rule/)、[Loon 匹配优先级](https://nsloon.app/en/docs/Rule/)、[QX 官方配置与 host-wildcard 示例](https://raw.githubusercontent.com/crossutility/Quantumult-X/master/sample.conf)、[QX 请求头脚本接口](https://raw.githubusercontent.com/crossutility/Quantumult-X/master/sample-rewrite-request-header.js)。

## 回归验证

使用 Node.js 18 或更新版本，在仓库根目录执行：

```sh
node --test QX/tests/kelee-qx.test.cjs
```

测试使用独立 AST 求值器和输出 glob 求值器对照，包括关键词重叠、后缀边界、空交集、策略与顺序、预算、日志脱敏、原始行号及稳定安装订阅。测试不等同于手机实机验收。
