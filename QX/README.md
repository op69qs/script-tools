# Kelee → Quantumult X 适配器

`kelee-qx.js` v1.7.1。以用户使用的 TF 1.9.0（953）为本轮研究与解析器验证基准。继续使用现有本机后端与订阅地址；`remoteSnippet()` 和它引用的 `adapter.js` 地址保持不变，不追加版本号。

## 本次支持范围

v1.7.1 按允许全局禁用 QUIC 的配置交付 RedPaper 和 PinDuoDuo。**先在 QX 主配置的 `[general]` 设置 `udp_drop_list = QUIC`**；已有 `udp_drop_list` 时在原列表中加入 `QUIC`，保留原端口和协议项，不要另建重复设置。该项作用于所有域名；重写订阅不能设置 `[general]`，后端也没有核验手机设置。

脚本默认 `CONFIG.omitDomainQuicReject = true`，仅将两个叶子的 `AND(DOMAIN 或 DOMAIN-SUFFIX, PROTOCOL QUIC) → REJECT` 留为注释，由上述全局 QUIC 拦截承担；不生成整域 REJECT，也不扩大 TCP 的 MitM 主机列表。这是已允许的范围放宽，不标为匹配集合等价。设为 `false` 可恢复严格检查与 422。其他协议、策略、嵌套逻辑和额外参数继续检查，不能借此绕过 DIRECT 例外。

转换注释、日志的 `omittedQuic` / `quicRequirement` 以及响应头 `X-Kelee-QX-Omitted-QUIC` / `X-Kelee-QX-QUIC-Requirement` 会标明省略条数和安装前提。完整 TXT 与 `QX/kelee-qx.js` 内容一致；替换手机 `Scripts/kelee-qx.js` 后，再更新现有资源。

纯域名正逻辑：`DOMAIN`、`DOMAIN-SUFFIX`、`DOMAIN-KEYWORD` 的 `AND` / `OR` 嵌套，策略限 `DIRECT`、`REJECT`、`PROXY`。

转换先求完整交集，再输出匹配集合相等的 `host-wildcard` 并集。它处理关键词的两个顺序和重叠情况，后缀包含根域及子域；不会把两个 AND 条件分别输出成独立规则。输出连续放在原规则位置，策略不变。输入字面量、语法及复杂度均受限。

例：`AND, ((DOMAIN-KEYWORD, -ad-), (DOMAIN-SUFFIX, byteimg.com)), REJECT` 可转换为 `host-wildcard, *-ad-*.byteimg.com, REJECT`，不会拦截其他后缀上的 `-ad-`。

每条及整份资源都有计算和输出预算。任一逻辑超限或无法转换，后端整体返回 HTTP 422，不提供部分成功配置。内部规范化函数保留原文供诊断，订阅接口不会将其交给会跳过这些逻辑的解析器。

支持 TF 的 `{# 备注 #}` 前缀，包括条件重写、旧式脚本和域名逻辑的每个输出分支。错误恢复原始规则和行号；未闭合或多个备注前缀拒绝转换。

v1.7.0 加入两叶 `AND(URL-REGEX, USER-AGENT) → REJECT` 的通用编译，两条件互换顺序也支持。输出一条原生 `url-and-header reject-200`，保留完整 URL 正则与 UA 交集；拒绝动作沿用 KOP 对 URL-REGEX REJECT 的现有映射。UA 限非空 ASCII 字面值和 `*`，大小写保留，只匹配完整 User-Agent 字段，不会把 Cookie、其他头或请求路径中的同名文本当作 UA。暂不接受纯星号、`?`、编码及复杂转义。

插件任一有效分流若使用非 REJECT 策略，则不移动该 HTTP 规则到重写层，避免越过可能优先匹配的 DIRECT/PROXY。此保护同时检查前置和后置规则。依据为官方 Loon4Mac 991 核心静态实现审查，以及 QX 官方 URL/头部双条件接口；详见[实现依据](compatibility-research-2026-10-20.md#v170-urlua-通用编译)。这不是 iOS 原引擎实测记录。

旧式 `http-request/response 正则 script-path=...` 只接受已经适配的 `requires-body` 与 `tag` 选项。二进制模式、参数、超时、启用条件等未知执行选项，以及尚不能完整解析的命名 `type=` 或其他参数顺序，均整体拒绝，防止资源解析器静默丢失执行行为。块注释内的声明不参与转换。

## 仍有的缺口

- 域名与 `PROTOCOL, QUIC` 的交集：v1.7.1 默认按上述已允许的全局禁用 QUIC 方案处理；严格模式仍拒绝，未声称全局方案与原域名范围相等。
- `URL-REGEX` 与 `USER-AGENT` 的 DIRECT/PROXY 组合、嵌套混合条件及超出上述 UA 范围的规则仍未适配；`url-and-header` 不自行赋予原请求 DIRECT 策略。
- `NOT`、其他谓词、额外标记、未验证策略：整体拒绝并报告缺口。
- Spotify：跨主机 `url.replace` 尚无已验证的 QX 等价实现，插件继续整体返回 HTTP 422。手机 TF 953 测试中，只改 URL 和 URL＋Host 两种写法均返回 404；后者显示目标 URL 形态仍不代表连接已经迁移。未删除规则、改成 302 或通过 `$task.fetch` 重发请求。带参数二进制脚本、超时及全 spotify.com 后缀的 QUIC 组合也未完成等价适配。

v1.6.0 的 HTTP 200 / incomplete 仍会让解析器跳过逻辑。本次已复现 HTTPDNS 的 DIRECT 例外丢失后落入更宽 REJECT 的反例，因此改成整体 422，响应带有 `X-Kelee-QX-Conversion: rejected`。QX 日志和错误正文记录 `pendingLogical`、插件、来源、原始行号、原因及脱敏规则摘要。后端拒绝不完整替换，不承诺客户端遇到更新失败后的缓存行为。

v1.7.1 对 11 份最新上游执行完整下载、转换及真实 KOP 解析：9 份通过，Spotify 与 Block_HTTPDNS 仍整体拒绝。RedPaper 和 PinDuoDuo 各按配置省略一条 QUIC 拒绝；拼多多两条 URL/UA REJECT 仍保留，21 条 RedPaper 重写、29 条 PinDuoDuo 重写及其余分流、MitM 主机均完成文本核对。16 个交付脚本依赖下载成功、内容未改且语法检查通过。BlockAdvertisers 的 4 条纯域名组合仍转成 11 条交集分支。上述为文本和解析器验证，不代替手机运行。

历史截图的四个 422 及原始测试见[研究记录](compatibility-research-2026-10-20.md#手机截图中的四个-422)。本次 RedPaper、PinDuoDuo 已通过交付检查；Spotify 的跨主机 URL 转换错误仍先终止检查，不会为了省略其 QUIC 条目而绕过后续错误。

TF 变化、仍在维护的脚本及等价性分析见[研究记录](compatibility-research-2026-10-20.md)。Spotify 原生 URL 行为可用[独立手机探针](probes/README.md)验证；探针需手动启用，不随生产订阅安装。

确认原请求 `policy`/`opts.policy` 是否生效，可用[一个页面自动完成的策略测试](probes/README.md#原请求策略测试)。它只测试固定 GET 请求和局部 reject，不切换全局模式或策略组。

纯域名转换验证的是匹配集合与文本顺序。Loon 与 QX 的全局规则优先级、混合分流资源装载、脚本实际运行及 App 内效果仍需 QX 实机核验。

接口依据：[Loon 逻辑规则](https://nsloon.app/en/docs/Rule/logic_rule/)、[Loon 匹配优先级](https://nsloon.app/en/docs/Rule/)、[QX 官方配置与 host-wildcard 示例](https://raw.githubusercontent.com/crossutility/Quantumult-X/master/sample.conf)、[QX 请求头脚本接口](https://raw.githubusercontent.com/crossutility/Quantumult-X/master/sample-rewrite-request-header.js)。

## 回归验证

使用 Node.js 18 或更新版本，在仓库根目录执行：

```sh
node --test QX/tests/*.test.cjs
```

仓库内测试使用独立 AST 求值器和输出 glob 求值器对照，包括关键词重叠、后缀边界、空交集、策略与顺序、预算、原子拒绝、TF 备注、旧式声明、日志脱敏、原始行号、稳定安装订阅及探针边界。本轮另用上游真实 KOP 在模拟 TF 953 环境验证 11 份最新资源与 14 个交付脚本依赖。测试不等同于手机实机验收。
