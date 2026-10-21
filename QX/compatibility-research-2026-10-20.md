# TF 1.9.0 适配研究记录

核查日期：2026-10-20；以下日期按 America/Los_Angeles。用户使用 TestFlight，因此本轮以公开可核实的 **TF 1.9.0（953）** 为基准。版本更新、规则解析成功、手机运行和跨客户端行为等价分别验证，不相互替代。

## 官方 TF 新变化

| 版本 | 官方公布内容 | 对本适配器的影响 |
| --- | --- | --- |
| [1.9.0（952）](https://t.me/QuanXNews/434)，2026-10-08 | 同域名模式的 DNS 设置叠加并发；分流与重写支持前置 `{# note #}`；本地/iCloud 资源支持 `#` 后解析参数；新增 `reflected_routes` | v1.6.1 保留并识别备注前缀，防止备注遮蔽未适配条件。DNS、路由变化没有提供已证实的逻辑分流等价方案。 |
| [1.9.0（953）](https://t.me/QuanXNews/435)，2026-10-12 | 同模式静态地址映射叠加，返回多个 IPv4/IPv6 地址并竞速连接 | 不代表新增 AND、按域名阻断 QUIC 或跨主机 URL 改写接口。 |
| [1.5.2（851）](https://t.me/QuanXNews/302)，2025-05-23 | 自动阻断 MitM 相关 QUIC，促使连接转为 TCP | 是域名/QUIC 组合的候选覆盖机制，仍须检查主机范围、MitM 状态及行为差异。 |
| [1.5.6（925）](https://t.me/QuanXNews/399)，2026-05-13 | `udp_drop_list` 改发 ICMP port unreachable；识别旧版 Google QUIC，适用于全局列表及 MitM QUIC enforcement | 不能继续按旧 sample.conf 的“静默丢包”注释推断现行行为，也不能用全局 QUIC 设置替换局部规则。 |

官方 sample.conf 文件自身更新于 2026-04-15，内部版本标记仍为旧 build，不能据此断言最新 TF 没有某项能力。本轮同时核查官方频道和[官方请求脚本接口](https://github.com/crossutility/Quantumult-X/blob/master/sample-rewrite-request-header.js)、[官方二进制响应接口](https://github.com/crossutility/Quantumult-X/blob/master/sample-bytes-rewrite.js)。目前查阅的公开资料未证明下面各项完整等价，不将“文档未写”视为“不可能支持”。

另有 [TF 921 资源解析器 UA 重试协议](https://t.me/QuanXNews/388)：可返回 `{retry:{user_agent:"..."}}`，每资源最多一次。当前本机适配器已经自己使用所需 UA 下载 Kelee；该接口解决下载差异，不解决语法和策略差异。

## v1.7.0 URL/UA 通用编译

本轮重新检查官方 TF 频道，最新可见条目仍为 [1.9.0（953）](https://t.me/QuanXNews/435)。已加入两叶 URL-REGEX AND USER-AGENT REJECT 的原生 `url-and-header reject-200` 编译，PDD 的两条规则属于此范围。没有按插件名称分支，也没有拆分 AND。相同资源存在任一非 REJECT 分流时不启用这种跨层转换，以保护类别优先级及 DIRECT/PROXY。

UA 大小写依据来自[官方 Loon4Mac 0.4.0（991）发布包](https://github.com/Loon0x00/Loon4Mac/releases/tag/0.4.0%28991%29)内 `LoonDepend.framework` 的静态实现审查。核心 SHA256：`1e6899e8559a740c0b5bb8ff46fd684d8291dd7fbb732ed4a6e21029178a7776`。x86_64 切片的类型表索引 3 为 USER-AGENT；UA 不进入小写化分支；`Rule isMatch...` 的 UA 参数经 UTF8String 进入 `DCUtils isWildcardMatch:p:`（0x1d8ba），逐字节比较，无大小写折叠。AND 递归保留同一 UA 参数。入口排除空 UA，因此当前编译明确拒绝纯星号；为避免 UTF-8 字节与字符的差异，不支持 `?`。

上述为 Mac 991 的一手实现证据，支持当前保留字面大小写的实现选择；没有声称在 iOS 原引擎实测或两平台二进制完全相同。QX 输出限定完整 User-Agent 字段，UA 字面字符转为十六进制正则字面量，避免触发 KOP 的格式猜测。固定 UA 模式、URL 锚点、捕获组及同时满足条件由独立测试核对，真实 KOP 在模拟 TF 953 环境中保留输出。

维护中转换器也重新核查了具体文件：[Sub-Store 的 QX 规则导出](https://github.com/sub-store-org/Sub-Store/blob/master/backend/src/core/rule-utils/producers.js)仍将 URL-REGEX、PROTOCOL 等列为未支持，文件最近提交为 2024-03-14（仓库本身仍在更新）；KOP 的最新文件仍为 2026-10-12 的 f0177f5。未找到可直接套用的原请求 DIRECT 或域名/QUIC 等价转换。`NSNanoCat/util` 的 `done.mjs` 虽先设置 opts.policy，随后 pick 的字段列表排除了 opts，不能把 README 的策略映射表当作 QX 原生接口证据。

为继续核实原请求策略接口，新增[单页自动策略测试](probes/README.md#原请求策略测试)，分别测试 policy、opts.policy 并穿插对照。失败不当作生效证据，原请求不经 fetch 重发。该测试独立启用，不加入 remoteSnippet。

该测试只验证这两种携带 reject 的写法，不由结果推断所有逐请求策略接口或 DIRECT 的支持情况。校准 Promise 被拒绝也不自动证明 reject 策略合法且已经生效。

## 原六条逻辑（其中两条已编译）

| 来源 | 条数与原条件 | 候选方案 | 仍缺的等价性证据 |
| --- | --- | --- | --- |
| RedPaper | 1：xiaohongshu.com 后缀 AND QUIC → REJECT | 自动 MitM QUIC enforcement | 原 MitM 只有 ci、edith、rec、so、www 等主机，未覆盖整个后缀。扩大 MitM 会改变 TCP 解密范围，不能作为等价转换。 |
| PinDuoDuo | 1：api.pinduoduo.com AND QUIC → REJECT | 该主机已在原 MitM 列表，自动 enforcement 可能覆盖 | 仍依赖 MitM 开关、协议识别、端口与连接行为，尚未证明与原分流规则的策略和优先级相同，因此未删此规则。 |
| PinDuoDuo | 2：URL-REGEX AND USER-AGENT → REJECT | v1.7.0 编译为原生 `url-and-header reject-200`，两条件保持交集 | UA 实现及优先级保护见上节；整份 PDD 仍被 QUIC 规则阻断，不能把两条编译成功说成插件已恢复。 |
| Block_HTTPDNS | 2：119.29.29.90 / 119.28.28.90 的 /d? 路径 AND 特定 USER-AGENT → DIRECT | URL/头交集、重写排除、脚本指定策略 | 尚无已验证的原连接 DIRECT 与后续匹配行为；不使用重发请求或合成响应模拟 DIRECT。 |

不能将 AND 子项分别输出。全局关闭 QUIC、整域拒绝、整 IP 直连、替换为另一个维护者的规则集都会改变匹配范围。

### v1.6.0 的已复现反例

v1.6.0 保留原始 AND 并返回 HTTP 200 / incomplete，真实 KOP 却跳过两条 DIRECT。对原规则能匹配的 `http://119.29.29.90/d?dn=example.com`（另一 IP 同样成立）与指定出行 App UA，后续宽泛 URL 拒绝规则仍会被转换并命中。原策略应为 DIRECT，解析后可能成为 reject-200。

v1.6.1 因此对任一未适配逻辑整体返回 HTTP 422，保留定位信息，不返回部分配置。这个修复阻止后端交付上述错误替换；没有声称六条逻辑已经得到等价实现，也没有保证 QX 更新失败后一定保留某种缓存状态。

## Spotify：可继续验证的方向

Kelee 源包含命名正则捕获、跨主机 `url.replace`、后续响应脚本以及带参数的二进制脚本。命名捕获不是唯一障碍：必须保持原请求的方法、正文、未匹配后缀、路由策略、TLS 主机、认证及后续脚本行为。

已维护的 app2smile JSON 脚本使用 `$done({url})`，但它只去掉同主机 `:443` 和改路径参数。其存在不足以证明 QX 能把一个主机的请求原生迁移到另一个主机。官方请求头示例公开的是 `path/headers`；GitHub issue #99 中普通用户的推测不作为开发者确认。

本仓库提供[独立 TF URL 探针](probes/README.md)，分对照、同主机、跨主机三项；只返回固定目标，无 fetch、302 或补偿请求。它只输出选定的响应证据，所有报告的 `provesFullEquivalence` 均为 false。需要对应 request/response 日志和手机结果后，才能设计下一层验证；直接访问目标 URL 得到的报告不能单独证明发生过跨主机修改。

用户实测环境为 `iOS 27.0.1 v1.9.0-build953`，结果如下：

| 操作 | 探针版本 | observedURLKind | 状态 | 选定响应证据 |
| --- | --- | --- | --- | --- |
| 对照 | v1 | 未记录此字段 | 200 | 原端点 JSON 可识别。 |
| 同主机 URL 修改 | v1 | 未记录此字段 | 200 | 修改后的路径与查询被目标端点回显。 |
| 跨主机，只返回 url | v2 | partial | 404 | Not Found 模板；无目标服务特征。 |
| 跨主机，返回 url 并修改 Host | v2 | target | 404 | Not Found 模板；无目标服务特征。 |
| 直接访问固定 Cloudflare 目标，对照 | 直接访问，未得到探针 JSON | 未记录 | 未提供 HTTP 状态码 | 收到 Cloudflare trace，包含目标 h、https 与 TLS 特征。 |

对照与同源成功证实设备可执行探针及同源路径修改。只改 url 时看到“原主机＋新路径”；加 Host 后看到 target 形态，但该字段来自响应脚本的 `$request.url`，不是连接目的 IP、TLS SNI 或所用策略的证据。两次 404 均保持 inconclusive；相同错误模板不能证明服务身份，显示 target 也不能作为跨主机改写成功的依据。

用户随后直接访问同一个固定 Cloudflare 目标，收到原始 trace，其 h、visit_scheme、tls 字段符合目标特征。这是独立的直接访问对照，不是改写成功的证据。直接访问未出现探针 JSON，因此也未证明目标上的响应脚本实际执行，更未记录其 HTTP 状态码。只保留以上选定结论，不保存 trace 中的 IP、UA 或其他原始字段。

直接访问与两次改写结果不同，进一步表明当前两种写法不能据现有证据用于等价转换。404 模板和 URL 形态仍不足以确定实际连接 IP、SNI 或具体失败层；不同路由/重写路径的影响未被排除。生产适配器继续拒绝 Spotify，此结论仅限上述实测写法，不宣称 QX 所有跨主机实现都不可能。

Spotify 不止这一处阻断：上游第 18 行还有 `spotify.com 后缀 AND QUIC → REJECT`，原 MitM 仅覆盖 spclient 相关主机，不能以其自动 QUIC enforcement 替换整个后缀；二进制脚本仍带自定义参数和超时要求。即使 URL 探针成功，也不能单凭这一项解除整份插件的 422。“剩余六条”仅计 RedPaper、PinDuoDuo、Block_HTTPDNS 三份，未包含 Spotify 的这条 QUIC 逻辑。

## 手机截图中的四个 422

v1.6.1 后端在任一规则无法完整转换时主动返回 422，截图中的四份与本轮联网验证一致：

| 资源 | 首个已知阻断 | 后续已知缺口 |
| --- | --- | --- |
| RedPaper_remove_ads | 第 14 行，xiaohongshu.com 后缀与 QUIC 的交集 | 无已验证的全范围等价方案。 |
| PinDuoDuo_remove_ads | v1.7.0 首个阻断变为第 16 行，精确域名/QUIC 组合 | 两条 URL/UA REJECT 已编译，仍有 1 条逻辑待适配。 |
| Spotify_remove_ads | 第 23 行，跨主机 url.replace | 二进制参数、超时及第 18 行的全后缀 QUIC 逻辑。 |
| Block_HTTPDNS | 第 22 行，URL 与 UA 的 DIRECT 例外 | 共 2 条 DIRECT 例外，不能删除后继续交付宽泛 REJECT。 |

上游文件下载在验证时为 HTTP 200，422 来自本机转换检查。它表示这四份仍未完整适配，不是可忽略的成功提示。后端错误正文和 QX 日志已有插件、来源、原始行号与脱敏规则；没有把未适配规则改成独立条件，也没有伪装返回 200。

原生 `url-and-header` 能匹配 URL 和请求头的交集，并不自动提供分流层 DIRECT 策略。[官方 opts.policy 示例](https://github.com/crossutility/Quantumult-X/blob/master/sample-fetch-opts-policy.js)针对 `$task.fetch` 创建的新请求，且说明连接复用行为不同，不能据此把原连接的 DIRECT 例外改成脚本重发。

QX 原生支持二进制 bodyBytes；当前维护的 protobuf 脚本也有 QX 专门分支。通用兼容层还须处理输入 Uint8Array/ArrayBuffer、输出视图偏移及参数注入，不能静默删除 `binary-body-mode` 或 `argument`。本版对未完整适配的旧式执行选项及声明形态整体拒绝。

## 仍在维护的项目与具体文件

本轮同时核查仓库活跃状态和目标文件的最近提交。仓库更新不等于该 Spotify/HTTPDNS 文件刚更新；以下是核查时的文件日期，不是对未来维护的承诺。

| 项目与具体文件 | 文件最近提交 | 观察与适用范围 |
| --- | --- | --- |
| [app2smile/rules：spotify-proto.js](https://github.com/app2smile/rules/blob/master/js/spotify-proto.js) | [2026-02-25](https://github.com/app2smile/rules/commit/e2c6f341eff294ce863658b95a490143183314b9) | 有实际 QX bodyBytes 分支和二进制视图切片，可作为接口参考。 |
| [app2smile：spotify-json.js](https://github.com/app2smile/rules/blob/master/js/spotify-json.js)、[spotify.conf](https://github.com/app2smile/rules/blob/master/module/spotify.conf) | JSON [2025-06-20](https://github.com/app2smile/rules/commit/5fa39a5fbc670e13878b774d8436f6e559850d04)；配置 [2025-06-27](https://github.com/app2smile/rules/commit/254c2ef4172c973604496692cf07c5d6eebc8ca9) | 同主机 URL 返回用法可实测；规则覆盖与 Kelee 不同，不能直接替换后宣称等价。 |
| [fmz200：Spotify.snippet](https://github.com/fmz200/wool_scripts/blob/main/QuantumultX/rewrite/split/partS/Spotify.snippet) | [2026-04-25](https://github.com/fmz200/wool_scripts/commit/715cecc18651e00c78fee85178aeb4647b816ef1) | 主要引用 app2smile 三项，再加特定 ad 地址拒绝；没有独立证明跨主机 API。 |
| [blackmatrix7：QX BlockHTTPDNS.conf](https://github.com/blackmatrix7/ios_rule_script/blob/master/rewrite/QuantumultX/BlockHTTPDNS/BlockHTTPDNS.conf) 与同目录 .list | [2025-06-17](https://github.com/blackmatrix7/ios_rule_script/commit/0fa60782abfe70f58da510e90d9086136cf0d855) | 仓库仍活跃，但该文件是 21 条明确 URL 拒绝，域名/IP 分流另装；没有 Kelee 两条出行 App DIRECT 例外，不是等价替代。 |
| [001ProMax：Spotify.sgmodule](https://github.com/001ProMax/Surge/blob/main/Module/AD/Spotify.sgmodule) | [2026-03-15](https://github.com/001ProMax/Surge/commit/b33bc6cb7212c368f48929e2f344be3936ad2ff6) | Surge 的跨主机 header、map-local 和二进制参数不能直接证明 QX 兼容；其 Loon 文件为 2025-08-10。 |
| [ddgksf2013：spotify-proto.js](https://github.com/ddgksf2013/Scripts/blob/master/spotify-proto.js) | [2022-11-29](https://github.com/ddgksf2013/Scripts/commit/ac42040aa02e2c04235cac53234f1a5e61a3c56f) | 仓库近期有活动，但此目标脚本多年未提交，不按“新 Spotify 脚本”推荐。 |
| [KOP-XIAO：resource-parser.js](https://github.com/KOP-XIAO/QuantumultX/blob/master/Scripts/resource-parser.js) | [2026-10-12](https://github.com/KOP-XIAO/QuantumultX/commit/f0177f5ea2f62681ab2592a4ed54677dfbbc4b78) | 本轮使用的解析器与该最新文件 SHA256 一致；仅升级解析器仍不会解决六条组合。 |

KOP SHA256：`1315ad57a31a2431a9fdf3d9fa0c892f7e91b9fa74f1c81bdaac04d521817b67`。

## 验证边界

v1.6.1 主适配器提交时 149 项自动测试通过，其中仓库内 63 项；其余为任务中的真实 KOP、jq 及上游快照回归。另重新下载用户提供的 11 份最新插件：7 份通过后端与 KOP 文本链，4 份整体 422，未交付被跳过的逻辑。通过项的 14 个脚本依赖均下载并核验字节未变及 JavaScript 语法；安装 snippet 与 v1.3.0 原文一致，没有版本参数。

四条纯域名逻辑的输出匹配集合由独立求值器对照。跨客户端全局优先级仍受 QX [分流匹配优化](https://t.me/QuanXNews/240)等设置影响；模拟 TF 953 的解析结果、依赖语法检查不代表 iPhone 上的装载、运行或 App 内效果已经验收。
