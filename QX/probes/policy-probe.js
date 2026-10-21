/* Opt-in native-request policy test. Fixed GET endpoints, no global policy changes. */
(function () {
  'use strict';
  var base = 'https://httpbin.org/anything/kelee-qx-policy-probe';
  var request = typeof $request !== 'undefined' ? $request : {};
  var url = String(request.url || '').replace(/^https:\/\/httpbin\.org:443\//,'https://httpbin.org/');
  function reply(body, type) {
    return {status:'HTTP/1.1 200 OK',
      headers:{'Content-Type':type || 'application/json; charset=utf-8','Cache-Control':'no-store'},
      body:typeof body === 'string' ? body : JSON.stringify(body,null,2)};
  }
  function report(mode, id) {
    return {probe:'kelee-qx-native-policy-v1',mode:mode,probeId:id,
      qxVersion:typeof $environment !== 'undefined' ? String($environment.version || '') : '',
      provesFullEquivalence:false,timestamp:Date.now()};
  }
  function browserDashboard() {
    var base = 'https://httpbin.org/anything/kelee-qx-policy-probe';
    var output = document.getElementById('report'), start = document.getElementById('start');
    var sequence = ['control','policy','control','opts-policy','control'];
    async function read(url) {
      var controller = new AbortController(), timer = setTimeout(function () {controller.abort();},15000);
      try {
        var response = await fetch(url,{cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal});
        var data = await response.json();
        if (!data || data.probe !== 'kelee-qx-native-policy-v1')
          return {outcome:'no-probe-report',httpStatus:response.status};
        return data;
      } catch (_) {
        return {outcome:'request-failed-or-no-report'};
      } finally { clearTimeout(timer); }
    }
    start.onclick = async function () {
      start.disabled = true;
      var result = {probe:'kelee-qx-native-policy-browser-v1',provesFullEquivalence:false,results:[]};
      function show() { output.value = JSON.stringify(result,null,2); }
      show();
      result.calibration = await read(base + '/calibration'); show();
      for (var i = 0; i < sequence.length; i++) {
        var mode = sequence[i], id = 'qx953-p1-' + Date.now() + i;
        var data = await read(base + '/request?mode=' + mode + '&id=' + id);
        result.results.push({test:mode,report:data}); show();
      }
      result.finished = true; show(); start.disabled = false;
    };
    document.getElementById('copy').onclick = async function () {
      try { await navigator.clipboard.writeText(output.value); }
      catch (_) { output.focus(); output.select(); }
    };
  }
  if (String(request.method || '').toUpperCase() !== 'GET') { $done({}); return; }
  if (url === base + '/dashboard') {
    var html = '<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta charset="utf-8"><title>QX 原请求策略测试</title>' +
      '<style>body{font:17px -apple-system,sans-serif;margin:24px;line-height:1.5}button{font:inherit;padding:12px;margin:0 8px 12px 0}' +
      'textarea{width:100%;min-height:65vh;box-sizing:border-box;font:13px monospace}</style>' +
      '<h2>QX 原请求策略测试</h2><p>点一次开始，等待“finished: true”，复制结果回对话。预计需要 10–60 秒。</p>' +
      '<button id="start">开始测试</button><button id="copy">复制结果</button><textarea id="report" readonly></textarea>' +
      '<p>仅测试固定地址；不会切换全局模式或策略组。测试后可关闭这条测试重写资源。</p>' +
      '<script>(' + browserDashboard.toString() + ')();</script></html>';
    $done(reply(html,'text/html; charset=utf-8')); return;
  }
  if (url === base + '/calibration') {
    var record = report('fetch-reject-calibration','fixed-calibration');
    if (typeof $task === 'undefined' || typeof $task.fetch !== 'function') {
      record.verdict = 'fetch-unavailable'; $done(reply(record)); return;
    }
    // A separate calibration of the documented FETCH interface. The browser
    // cases below are native requests and never pass through this fetch.
    $task.fetch({url:'https://httpbin.org/anything/kelee-qx-policy-probe-calibration',method:'GET',
      headers:{Accept:'application/json'},
      opts:{policy:'reject',redirection:false,'auto-cookie':false}}).then(function (response) {
      record.verdict = 'fetch-reject-response-observed';
      record.observedStatus = Number(response.statusCode || 0); $done(reply(record));
    },function () {
      record.verdict = 'fetch-reject-promise-rejected'; $done(reply(record));
    });
    return;
  }
  var selected = url.match(/^https:\/\/httpbin\.org\/anything\/kelee-qx-policy-probe\/request\?mode=(control|policy|opts-policy)&id=(qx953-p1-[0-9]{8,20})$/);
  if (!selected) { $done({}); return; }
  var mode = selected[1], id = selected[2];
  if (typeof $response === 'undefined') {
    // Keep all native cases identical except for the tested policy field.
    // Use a minimal header set so httpbin never echoes browser credentials.
    var result = {headers:{Accept:'application/json','Cache-Control':'no-cache','X-Kelee-QX-Policy-Probe':id}};
    if (mode === 'policy') result.policy = 'reject';
    else if (mode === 'opts-policy') result.opts = {policy:'reject'};
    $done(result); return;
  }
  var response = $response, status = Number(response.statusCode || 0), echo = {};
  try { echo = JSON.parse(String(response.body || '')); } catch (_) {}
  var marker = '', headers = echo.headers || {};
  Object.keys(headers).forEach(function (key) {
    if (key.toLowerCase() === 'x-kelee-qx-policy-probe') marker = headers[key];
  });
  var observed = report(mode,id);
  observed.observedStatus = status;
  observed.sourceEcho = echo.url === url;
  observed.requestMarkerEcho = marker === id;
  observed.verdict = status === 200 && observed.sourceEcho && observed.requestMarkerEcho
    ? (mode === 'control' ? 'control-echo-observed' : 'reject-not-enforced-on-this-request') : 'inconclusive';
  try { console.log('[Kelee-QX native policy probe] ' + JSON.stringify(observed)); } catch (_) {}
  // Do not log or return the raw echo response, IP, headers or cookies.
  $done({body:JSON.stringify(observed,null,2),
    headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
})();
