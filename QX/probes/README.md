# TF 原生 URL 返回接口探针

用于核实当前 TF 对 $done({url}) 的行为，不是 Spotify 去广告规则。它只使用固定测试 URL，不使用重定向或重新发请求作补偿。主适配器和 remoteSnippet 不会安装或启用它。

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
