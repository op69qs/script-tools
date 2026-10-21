# Kelee → Quantumult X 适配器

`kelee-qx.js` v1.8.0。以用户使用的 TF 1.9.0（953）为本轮研究与解析器验证基准。继续使用现有本机后端与订阅地址；`remoteSnippet()` 和它引用的 `adapter.js` 地址保持不变，不追加版本号。

## 本次支持范围

v1.8.0 加入新式 `response ... then script(...)` 的正文及参数桥接，适用于显式 `requires_body=true`、单个 URL 正则条件及允许下载的 Kelee 脚本。`binary_body_mode=true` 将原生 ArrayBuffer 按精确字节范围作为 Loon 形式的 Uint8Array 传入；返回 Uint8Array 子视图时只输出该视图的范围，不误带前后缓冲区。普通字符串参数保持字符串；插件对象参数仅绑定唯一声明的 Boolean switch，保留默认值与显式 false，不把布尔值改成字符串。

可在原 `/resource?url=...` 后追加 `&args=` 加经过 URL 编码的 JSON 布尔对象覆盖已引用 switch，例如编码前为 `{"tab":false,"useractivity":true}`；不传时沿用插件默认值。未知或未引用的参数整体报错，不静默忽略。当前不适配 select/input、字符串模板、Raw String、请求阶段的正文桥接或显式 timeout。旧式脚本声明的执行选项限制保持原样。

桥接只在带描述符的本机脚本地址上启用，未选中的脚本仍原样下载。原脚本保持顶层执行，保留严格模式与全局声明；不会通过包裹函数改变顶层变量作用域。TF 953 手机已确认桥接所需的全局绑定可替换、脚本标识符同步更新及二进制输入可用。真实 Spotify 原版脚本在两类有效 Protobuf 响应、四组开关组合下，桥接输出与 Loon 形式运行的输出逐字节相等，并且都确实修改了输入。这证明响应处理层的适配，不代表整份 Spotify 插件或 App 内效果已通过。

这层仅转换正文、参数及基础响应结果，不提供完整 Loon API。未支持的返回字段保留原响应并记录原因；原脚本自身异常继续由宿主引擎处理。它不修改请求的匹配条件、地址、策略或发送次数。二进制接口依据为 [QX 官方示例](https://raw.githubusercontent.com/crossutility/Quantumult-X/master/sample-bytes-rewrite.js)，参数类型依据为 [Loon Script](https://nsloon.app/en/docs/Script/script_v2/#argument)。

v1.7.2 默认 `CONFIG.quicMode = 'mitm'`：依赖 QX 已有的 MitM 相关 QUIC 自动拦截，**不再要求全局禁用 QUIC**。保持 QX MitM 和相应资源启用，沿用原插件的 hostname，不为 QUIC 扩大 TCP 的解密范围。[官方说明](https://t.me/QuanXNews/302)及[旧版 Google QUIC 支持](https://t.me/QuanXNews/399)。

脚本默认 `CONFIG.omitDomainQuicReject = true`，仅将两个叶子的 `AND(DOMAIN 或 DOMAIN-SUFFIX, PROTOCOL QUIC) → REJECT` 留为注释。PDD 的精确 api 主机已在原 MitM 列表；RedPaper、Spotify 的原域名后缀比现有 MitM 列表更大，默认仅依赖已列出主机的自动机制，其余范围按已允许的 QUIC 放宽处理。日志的 `mitmCoverage` 与 `relatedMitmHostnames` 是本插件主机文字覆盖信息，不是对手机启用状态、所有端口或完整行为等价的证明。

`CONFIG.quicMode = 'global'` 保留全局方案，此时需在主配置 `[general]` 让 `udp_drop_list` 包含 `QUIC`（保留原端口和协议项）。默认 MitM 方案下不需要为了本适配器新增这项；若之前专为 v1.7.1 加入 QUIC，可仅移除该项，保留列表其余内容。重写订阅不能设置全局列表，后端也未核验设备配置。将 `omitDomainQuicReject` 设为 `false` 可恢复严格 422。其他协议、策略、嵌套逻辑和额外参数继续检查，不能借此绕过 DIRECT 例外。

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

- 域名与 `PROTOCOL, QUIC` 的交集：默认按上述现有 MitM 方案放宽，可选全局模式；严格模式仍拒绝，未声称三种行为等价。
- `URL-REGEX` 与 `USER-AGENT` 的 DIRECT/PROXY 组合、嵌套混合条件及超出上述 UA 范围的规则仍未适配；`url-and-header` 不自行赋予原请求 DIRECT 策略。
- `NOT`、其他谓词、额外标记、未验证策略：整体拒绝并报告缺口。
- Spotify：跨主机 `url.replace` 与显式 `timeout=5` 尚无已验证的完整等价实现，插件继续整体返回 HTTP 422。手机 TF 953 测试中，只改 URL 和 URL＋Host 两种写法均返回 404；后者显示目标 URL 形态仍不代表连接已经迁移。未删除规则、改成 302 或通过 `$task.fetch` 重发请求。v1.8.0 已实现带布尔参数的二进制响应处理层；其 QUIC 条目沿用上述已获授权的放宽。

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

仓库内测试使用独立 AST 求值器和输出 glob 求值器对照，包括关键词重叠、后缀边界、空交集、策略与顺序、预算、原子拒绝、TF 备注、旧式声明、日志脱敏、原始行号、稳定安装订阅及探针边界。桥接测试额外覆盖精确视图、空正文、类型、全局作用域、指令前缀、参数覆盖和资产下载链路。

设置 `KELEE_KOP_SOURCE` 为真实 KOP 文件路径，可运行解析器链路测试；设置 `KELEE_SPOTIFY_SOURCE` 为刚下载的原版 Spotify JS 路径，可运行八组 Protobuf 字节对照，不将第三方脚本复制进仓库。本轮本地验证同时启用二者。测试不等同于手机 App 内验收。
