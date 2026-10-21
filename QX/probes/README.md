# TF 原生 URL 返回接口探针

用于核实当前 TF 对 $done({url}) 的行为，不是 Spotify 去广告规则。它只使用固定测试 URL，不使用重定向或重新发请求作补偿。主适配器和 remoteSnippet 不会安装或启用它。

## DIRECT 原请求补测

当前使用 v4，页面地址仍是下方 DIRECT 页面，报告开头应为 `kelee-qx-direct-policy-browser-v4`；旧 `/kelee-qx-policy-probe/dashboard` 是 REJECT 测试，不用于本次补测。

已收到 TF 953 的 v4 手机结果：direct 与默认路由参考均 200，但出口相同，referencesDistinct=false；显式 proxy 及其叶子仍失败。页面在校准后停止，未执行五个原请求，所以仍不能判断 DIRECT。重跑相同条件不会增加证据，本轮不要求重复测试。

v3 手机已确认策略状态和具体叶子可取得，但两种显式 policy FETCH 都失败；用户确认代理上网正常。v4 在同一固定 httpbin URL 上最多补一次不指定 `opts.policy` 的默认路由 FETCH，同时只返回有限错误分类及明确数字 code。默认路由不直接称为代理：只有它与 DIRECT 出口不同、前后稳定、三个原生对照均匹配，才能解释本次 DIRECT 结果。验证固定使用同一种默认路由方式，并不锁定底层实际路由；出口变化仍使结论不确定。每参考请求四秒等待上限，最多三个串行阶段约十二秒；仍不切换全局模式、不轮询节点、不重发原请求。没有增加第二个服务，也不会跨服务混用出口参考。

v2 手机报告已收到：两轮 DIRECT 参考均 200，proxy 参考均 0，未建立比较基线；五个原请求都正常回显，但不能由此判断 DIRECT 是否生效。v3 校准时只读检查内置 proxy 的选中链；proxy 请求失败或响应无法识别时，最多补试一个明确的选中服务器标签，成功后固定该标签供本 run 前后比较，不轮询其他节点、不修改策略选择。每次参考请求设六秒等待上限，配置读取一点五秒；迟到结果不恢复清理后的记录。校准不可判别时立即结束并清理，不继续五个没有基线的请求。

报告只返回策略状态是否取得、是否有具体叶子、有限的结果分类及状态码，不输出标签、原始异常或 IP。成功选中的服务器标签仅在本 run 专用 prefs 中短暂保存供第二轮固定参考使用，结束删除。若现有 control 与该参考不符，仍然无法判断，不会自动切换全局模式或替换原请求。

已完成下面的 reject 测试时，只需在 QX 更新已有 `policy-probe.snippet` 资源，再用 Safari 打开[DIRECT 对照页面](https://httpbin.org/anything/kelee-qx-direct-probe/dashboard)，点“开始测试”，等 `"finished": true` 后复制结果。新脚本使用独立文件地址，避开上一轮脚本缓存；无需修改生产分流或全局模式。

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
