# TF 原生 URL 返回接口探针

用于核实当前 TF 对 $done({url}) 的行为，不是 Spotify 去广告规则。它只使用固定测试 URL，不使用重定向或重新发请求作补偿。主适配器和 remoteSnippet 不会安装或启用它。

## DIRECT 原请求补测

### 当前：HTTP httpbingo v6

用户已确认一键临时分流导入后，filter 模式下按普通 HTTP 地址检查 httpbingo.org 时经过代理。现在更新现有 policy-probe.snippet（资源解析器关闭），保持该临时分流和分流模式，用 Safari 打开 [v6 HTTP 测试页面](http://httpbingo.org/anything/kelee-qx-direct-probe/dashboard)，点开始；出现 finished: true 后复制完整报告。报告开头应为 kelee-qx-direct-policy-browser-v6。不需要重装主脚本。

v6 只匹配固定 httpbingo.org 的 HTTP/80 专用路径，不增加 MitM hostname；HTTPS 升级或跳转不算本次有效观察。它读取服务回显的 origin 作为出口参考，不宣称该字段独立证明 TCP 对端或完整策略路径。[go-httpbin 实现](https://raw.githubusercontent.com/mccutchen/go-httpbin/main/httpbin/helpers.go)可能优先使用平台或转发头，因此发送前若已有这些客户端头部，原请求不加被测策略，观察标为不确定；服务在响应中回显的平台新增头不会单独触发污染判断。

状态 200、准确 HTTP URL、GET 回显和唯一 marker 同时通过才使用参考。固定 HTTP 主机的默认端口 :80 统一处理；IPv6 先规范化，IPv4 拒绝前导零，同一地址的不同写法不会建立不同出口参考。Go 头部值只接受字符串或恰有一个字符串的数组，重复大小写字段、多元素数组或格式异常保持不确定。原 Host、UA、Accept 等不改，测试原请求不经 FETCH 重发。独立 DIRECT FETCH 仅建立前后参考，并带本 run/phase 标记校验；只有初始 control 可区分、三条 control 的参考编号稳定、前后 DIRECT 参考稳定及模式为 filter，才分别解释两个被测 payload。报告使用 referenceKind: service-origin-echo、provesFullEquivalence: false；不输出 origin、原始头部、正文或存储盐/token。

失败的初始化会清除本次 pending；正常页面结束调用该 run 的 cleanup，迟到结果不恢复记录。旧 v5 仅保留 cleanup hook，旧 dashboard 和策略请求不再启用；旧手动读取留下的专用记录仍可用相同 runId 清理。v6 得到正结果后仍需核实 HTTPDNS 原 IP URL、编码 UA、条件交集及优先级，不能直接放行整份资源。Spotify 的跨主机和 timeout 不由此测试解决。

### 临时代理对照的一键入口

手机已确认后端 1.8.0，现有模式接口曾返回 all_proxy。按普通 HTTP 地址检查 httpbingo.org 时，全局模式经过代理，手工临时 host 规则在 filter 模式曾为 DIRECT；随后下述受控导入方式在 filter 模式建立了普通请求代理对照。它不能反推此前手填规则未生效的具体原因。

1. 点击[添加临时测试分流](https://quantumult.app/x/open-app/add-resource?remote-resource=%7B%22filter_remote%22%3A%5B%22https%3A%2F%2Fraw.githubusercontent.com%2Fop69qs%2Fscript-tools%2Fmain%2FQX%2Fprobes%2Fhttpbingo-proxy.filter%2C%20tag%3DKelee-QX%20DIRECT%20%E4%B8%B4%E6%97%B6%E6%B5%8B%E8%AF%95%2C%20force-policy%3Dproxy%2C%20inserted-resource%3Dtrue%2C%20opt-parser%3Dfalse%2C%20enabled%3Dtrue%22%5D%7D)，在 QX 确认添加名称为“Kelee-QX DIRECT 临时测试”的资源。它属于**分流引用**，只有 `host, httpbingo.org, proxy`，不需要资源解析器。
2. 保持分流模式，用 Safari 打开[普通 HTTP 对照](http://httpbingo.org/get?kelee_qx_route_check=20261020import)，查看这次新记录是否经过代理。无需复制网页正文。
3. 测试结束删除该独立临时订阅。内置 proxy 使用用户现有选中项；订阅不更改其选择。

一键入口使用官方 add-resource/filter_remote，仅追加这一条资源。备用 scheme：[打开 QX 添加页](quantumult-x:///add-resource?remote-resource=%7B%22filter_remote%22%3A%5B%22https%3A%2F%2Fraw.githubusercontent.com%2Fop69qs%2Fscript-tools%2Fmain%2FQX%2Fprobes%2Fhttpbingo-proxy.filter%2C%20tag%3DKelee-QX%20DIRECT%20%E4%B8%B4%E6%97%B6%E6%B5%8B%E8%AF%95%2C%20force-policy%3Dproxy%2C%20inserted-resource%3Dtrue%2C%20opt-parser%3Dfalse%2C%20enabled%3Dtrue%22%5D%7D)；原始文件为 [httpbingo-proxy.filter](httpbingo-proxy.filter)。如需手工导入原始文件，应添加到分流引用，不能添加到重写引用。inserted-resource=true 不在此被解释为覆盖所有其他插入资源的绝对优先级。

手动调用 calibration 读取模式后，使用相同 runId 的 `/cleanup?id=...` 清理本次专用记录；两分钟有效期只表示记录失效，不等于已经从 prefs 删除。完整 dashboard 正常结束时会执行自己的清理。

### v5 实现与历史操作

以下为历史 v5 说明；当前按上面的 v6 步骤操作。v5 完整测试 hooks 已停用，仅保留旧 run 的 cleanup；旧 `/kelee-qx-policy-probe/dashboard` 是 REJECT 测试。

已收到 HTTP v5 手机结果：control-0 正常回显，但与 DIRECT 参考相同；用户随后在该条活动中确认最终策略为 DIRECT。两种被测 DIRECT 参数尚未执行，不能据此判断它们有效或无效。先查看同一条 `/request?mode=control`、编号末尾 `-0` 记录的**命中规则及最终策略链**，不要查看本地生成的 dashboard 或本来就指定 DIRECT 的 `direct-probe-reference`。规则未生效前不重复整套测试。

v5 请求头现已修正：复制原头部，仅以不区分字段名大小写的方式替换测试标记、Cache-Control 和 Connection；保留 Host、User-Agent、Accept 及其他原字段，也不修改原对象。此前全新四字段头部会丢弃原字段，是已确认的探针缺陷；尚未证明这就是临时 host 分流未生效的原因。此修正不更改生产 HTTPDNS 规则。

1. 在 QX 添加最前面的临时本地分流：类型 host／主机名、内容 `httpbin.org`、策略选已确认可用的代理节点或组。这只建立测试对照，不修改 HTTPDNS 生产规则。
2. 更新现有 `policy-probe.snippet` 测试资源，资源解析器保持关闭；Safari 打开[HTTP DIRECT 页面](http://httpbin.org/anything/kelee-qx-direct-probe/dashboard)，点开始。HTTPDNS 原规则是明文 HTTP，因此本次优先测 HTTP。
3. 等 `finished: true` 后复制完整 JSON。测试完成删除临时 `httpbin.org` 分流。

v5 不再尝试代理 FETCH。它只用明确指定 DIRECT 的 FETCH 建立前后参考，然后**先执行浏览器 control-0**。通过状态 200、固定 URL、runId 与 marker 校验后，首个原生响应建立自己的出口参考；若与 DIRECT 参考相同，在这条原生请求之后停止，报告 `native-reference-not-distinct`，不把“同出口”解释成已经直连。

只有首个原生出口与 DIRECT 不同、三条 control 均匹配同一个原生参考、前后 DIRECT 参考稳定且运行模式为 filter，才分别解释 policy-direct 与 opts-direct 的结果。原生参考使用独立随机编号贯穿五个响应及最终核验，防止基线中途替换却被误认为稳定。被测请求匹配 DIRECT 时仅报告本次观察到出口效果，仍非任意请求的完整等价证明。报告不包含 IP、出口指纹、盐或内部 token；正常结束删除本 run 的专用记录，有效期两分钟，迟到结果不恢复清理后的记录。

报告的 `transport` 必须与实际 HTTP/HTTPS 一致，参考 FETCH、五个浏览器请求和核验使用同一协议，两种协议的存储完全分开。若 Safari 自动把 HTTP 页面升级为 HTTPS，页面与报告会明确显示 HTTPS，不计为 HTTPDNS 的证据；30x 或回显 URL 改变同样不计成功。需要单独比较 HTTPS 时，可打开[HTTPS 页面](https://httpbin.org/anything/kelee-qx-direct-probe/dashboard)，不能用其阴性结果否定明文 HTTP。

### v2–v4 历史校准

已收到 TF 953 的 v4 手机结果：direct 与默认路由参考均 200，但出口相同，referencesDistinct=false；显式 proxy 及其叶子仍失败。页面在校准后停止，未执行五个原请求，所以仍不能判断 DIRECT。重跑相同条件不会增加证据，本轮不要求重复测试。

v3 手机已确认策略状态和具体叶子可取得，但两种显式 policy FETCH 都失败；用户确认代理上网正常。v4 在同一固定 httpbin URL 上最多补一次不指定 `opts.policy` 的默认路由 FETCH，同时只返回有限错误分类及明确数字 code。默认路由不直接称为代理：只有它与 DIRECT 出口不同、前后稳定、三个原生对照均匹配，才能解释本次 DIRECT 结果。验证固定使用同一种默认路由方式，并不锁定底层实际路由；出口变化仍使结论不确定。每参考请求四秒等待上限，最多三个串行阶段约十二秒；仍不切换全局模式、不轮询节点、不重发原请求。没有增加第二个服务，也不会跨服务混用出口参考。

v2 手机报告已收到：两轮 DIRECT 参考均 200，proxy 参考均 0，未建立比较基线；五个原请求都正常回显，但不能由此判断 DIRECT 是否生效。v3 校准时只读检查内置 proxy 的选中链；proxy 请求失败或响应无法识别时，最多补试一个明确的选中服务器标签，成功后固定该标签供本 run 前后比较，不轮询其他节点、不修改策略选择。每次参考请求设六秒等待上限，配置读取一点五秒；迟到结果不恢复清理后的记录。校准不可判别时立即结束并清理，不继续五个没有基线的请求。

报告只返回策略状态是否取得、是否有具体叶子、有限的结果分类及状态码，不输出标签、原始异常或 IP。成功选中的服务器标签仅在本 run 专用 prefs 中短暂保存供第二轮固定参考使用，结束删除。若现有 control 与该参考不符，仍然无法判断，不会自动切换全局模式或替换原请求。

v4 使用的也是同一个 DIRECT 对照页面。v5 沿用资源与页面地址，使用独立脚本文件，避免旧脚本缓存。

测试前后分别用官方 FETCH 的 `opts.policy: direct/proxy` 建立出口参考，中间执行原生 control / policy-direct / control / opts-direct / control。FETCH 只建立参考，原请求不重发。比较只输出布尔值，原始 IP 不保存；运行期间每个 run 使用自己的专用 prefs 键，保存带随机盐的 SHA256、运行编号、两分钟有效期及清理用的 token，结束删除自己的键，不操作其他设置。超时清理后的迟到校准结果不会恢复参考记录。

只有前后参考稳定、DIRECT 与 PROXY 可区分、三个原生对照都呈现 PROXY 参考出口，且测试请求呈现 DIRECT 参考出口，页面才报告本次观察到 DIRECT 出口效应。对照已直连、出口轮换、网络失败或引用缺失均保持不确定。`Connection: close` 是尽力减少复用，不能保证排除 HTTP/2 连接复用；未观察到 DIRECT 不推断所有新连接或其他运行模式均不支持。页面读取当前运行模式作参考，不修改模式或策略组。

这一步直接验证 DIRECT 值，避免把下述 reject 写法没有执行的结果推广为所有策略值的结论。

## 响应脚本运行环境检查

用于确认带类型参数、二进制响应桥接所需的宿主能力。更新同一份 `policy-probe.snippet` 后，用 Safari 打开[响应环境检查](https://httpbin.org/anything/kelee-qx-response-runtime-probe)，页面会直接显示 `kelee-qx-response-runtime-v1` JSON，无须点按钮。

脚本仅作用于这个固定 GET 的响应；检查 `$response`、`$done`、`$argument` 的全局属性与脚本标识符能否同步替换，以及原生二进制正文是否可取得。随后恢复原属性描述符和存在状态，使用原回调输出布尔结果，不返回正文、头部或 IP，不修改策略、不重放请求、不写持久存储。词法绑定与全局对象属性分离、只读属性等负面环境也会尽力返回诊断。

用户 TF 953 已返回 `response-runtime-capabilities-observed`，三个可写项、词法同步、二进制输入及状态映射均为 true。这确认桥接所需宿主能力，可以继续发布响应处理层；不代表 Spotify 整份规则已等价适配，跨主机 URL 改写与超时仍须分别解决。无需重复本项检查。

## 原请求策略测试

用于判断 HTTPDNS 两条 DIRECT 例外是否有逐请求策略接口可以利用；不需要 Loon，也不需要再做 Spotify 的 URL 测试。

1. QX → 重写 → 引用/资源 → 添加，地址栏**只粘贴网址**：`https://raw.githubusercontent.com/op69qs/script-tools/main/QX/probes/policy-probe.snippet`。关闭“资源解析器”，保存并更新一次。
2. 保持 QX VPN、MitM 和已信任证书开启，用 Safari 打开[测试页面](https://httpbin.org/anything/kelee-qx-policy-probe/dashboard)，点“开始测试”。
3. 等结果出现 `"finished": true`，点“复制结果”并贴回对话。测试后可关闭这条测试资源。

页面按顺序执行：原生 GET 对照、`$done({policy:"reject"})`、对照、`$done({opts:{policy:"reject"}})`、对照。实际请求带固定标记；响应仅返回标记是否被服务器回显、状态及版本，不返回原始正文或 IP。另有一项独立 `$task.fetch` 的 reject 校准，不能将它当作原请求接口生效。

`reject-not-enforced-on-this-request` 表示请求脚本的标记到达了服务器，且拿到该固定端点的 200，所测 reject 没有阻止这次原请求。失败、超时、404 或缺少标记均不能单独证明策略生效；报告保持 `provesFullEquivalence: false`。测试不会修改任何生产规则、策略组或全局模式，也不将两条 DIRECT 例外改为重发请求。

用户在 TF 953 已完成本项：三次 control 均 200、原端点及标记回显为真；policy 与 opts-policy 两种 reject 写法也都收到同样的 200 回显。FETCH reject 校准为 Promise rejected。结论仅为这两种写法没有在这些原请求上执行 reject；不据此否定 DIRECT 或其他接口。

## 手动测试

在 QX 的重写资源列表点添加，**地址栏只粘贴下面这个网址**，不要带逗号或参数：

    https://raw.githubusercontent.com/op69qs/script-tools/main/QX/probes/url-target.snippet

名称填“TF URL 探针”，关闭该资源的“资源解析器”开关，启用后保存并更新一次。若在地址栏粘贴带 tag、opt-parser 的整条配置行，可能提示“资源无效”。

只有直接编辑主配置文件的 [rewrite_remote] 时，才使用下面这一整行：

    https://raw.githubusercontent.com/op69qs/script-tools/main/QX/probes/url-target.snippet, tag=Kelee-QX TF URL 探针, opt-parser=false, update-interval=86400, enabled=true

这个独立订阅声明的 MitM 主机是 httpbin.org、www.cloudflare.com。测试需要现有 QX MitM 和证书正常工作；测试后禁用或删除该探针订阅。它不修改生产订阅，也不自动打开任何网络地址。

## v2：已有首轮结果时

首轮在 TF build953 已观察到对照与同源成功，跨主机显示 Not Found。已有这三个结果时，不必重复前两项：先在 QX 更新“TF URL 探针”资源，随后用 Safari 依次打开：

1. [只改 URL](https://httpbin.org/anything/kelee-qx-url-target-probe?mode=cross-host&id=qx953-v2-cross)
2. [改 URL 并设置 Host](https://httpbin.org/anything/kelee-qx-url-target-probe?mode=cross-host-header&id=qx953-v2-host)

v2 增加“原主机＋目标路径”的响应匹配，尝试让先前无报告的 404 也显示 JSON。第二项会移除原有 Host/authority、Cookie、Authorization、Proxy-Authorization，再设置固定目标 Host，不记录这些头部。脚本使用新文件名和 v2 编号，区分旧缓存结果。请复制这两份 JSON；若仍无报告，说明对应编号和页面现象即可。

observedURLKind 的 source、partial、target 只代表响应脚本看到的固定 URL 形态；不能单独证明连接目的地、SNI 或路由策略。notFoundTemplateObserved 只说明看到了相似的 404 模板，不证明服务身份。

## 已收到的 TF 953 结果

用户实测：v1 对照 200，同源修改 200；v2 只改 URL 得到 partial / 404，URL＋Host 得到 target / 404。两项都观察到 Not Found 模板，没有目标服务特征，结论保持 inconclusive。显示 target 不能当作跨主机连接成功。

用户随后直接访问相同固定目标，收到 Cloudflare trace，h、https、TLS 特征符合目标服务；没有探针 JSON，未提供 HTTP 状态码。这份结果仅作为直接访问对照，不计为 URL 改写成功，也不证明目标响应脚本已经装载。当前两种改写没有得到同样的目标服务响应，仍不用于生产等价转换。实测结束后可以禁用或删除独立探针。

如果还缺目标自身的访问对照，可保持探针开启，直接打开[固定 Cloudflare 目标](https://www.cloudflare.com/cdn-cgi/trace?kelee_qx_probe=cross-host-header&id=qx953-v2-host)，并明确标注为“直接目标对照”。这里不会执行请求改写，只尝试复用响应观察脚本；编号与 Host 对照相同，必须结合操作说明和时间区分，不能将这份结果作为改写成功的证据。无需新增探针版本或改动生产订阅。

## 首次测试或排查装载

先确认在 Safari 打开 https://www.cloudflare.com/cdn-cgi/trace 能正常显示文本，再依次打开：

1. 对照：https://httpbin.org/anything/kelee-qx-url-target-probe?mode=control&id=qx953-v2-control
2. 同源：https://httpbin.org/anything/kelee-qx-url-target-probe?mode=same-origin&id=qx953-v2-same
3. 跨主机：https://httpbin.org/anything/kelee-qx-url-target-probe?mode=cross-host&id=qx953-v2-cross

页面应显示 JSON 报告。只需复制这三份报告；不要复制 Cloudflare 原始 trace 或完整抓包，它们可能带有 IP。若页面没有报告，在 QX 日志中查找 Kelee-QX probe 及对应 probeId；request 和 response 分别记同一个编号。

## 判断范围

- control-origin-observed：对照端点响应可识别。
- same-origin-path-observed：响应中观察到修改后的同源路径和查询。
- target-service-signature-observed：观察到目标服务预定的 h、https、tls 特征，只是跨主机请求的候选证据。
- original-endpoint-observed：仍收到原端点可识别的响应。
- inconclusive、超时或无报告：未得到结论；可能涉及网络、MitM、脚本匹配或接口行为，不能直接判定接口不支持。

报告不记录原始正文、IP、Cookie 或请求头。任何结果的 provesFullEquivalence 均为 false：一次 GET 无法证明全部 TLS、连接复用、路由策略、认证、原方法/正文、未匹配后缀和后续脚本行为，因此不会据此自动解除 Spotify 的转换拒绝。
