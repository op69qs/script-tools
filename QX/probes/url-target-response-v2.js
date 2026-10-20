/* Report fixed response evidence only. No body/header/IP logging or fetch. */
(function () {
  'use strict';
  var result = {};
  try {
    var request = typeof $request !== 'undefined' ? $request : {};
    var response = typeof $response !== 'undefined' ? $response : {};
    var url = String(request.url || '').replace(/^https:\/\/(httpbin\.org|www\.cloudflare\.com):443\//,'https://$1/');
    var source = 'https://httpbin.org/anything/kelee-qx-url-target-probe';
    var cases = [
      {mode:'control',id:'qx953-v2-control',target:null},
      {mode:'same-origin',id:'qx953-v2-same',
        target:'https://httpbin.org/anything/kelee-qx-url-target-result?kelee_qx_probe=same-origin&id=qx953-v2-same'},
      {mode:'cross-host',id:'qx953-v2-cross',
        target:'https://www.cloudflare.com/cdn-cgi/trace?kelee_qx_probe=cross-host&id=qx953-v2-cross'},
      {mode:'cross-host-header',id:'qx953-v2-host',
        target:'https://www.cloudflare.com/cdn-cgi/trace?kelee_qx_probe=cross-host-header&id=qx953-v2-host'}
    ];
    cases.forEach(function (entry) {
      entry.source = source + '?mode=' + entry.mode + '&id=' + entry.id;
      entry.partial = /^cross-host/.test(entry.mode) ? entry.target.replace('www.cloudflare.com','httpbin.org') : null;
    });
    var selected = cases.filter(function (entry) {
      return entry.source === url || entry.target === url || entry.partial === url;
    })[0];
    if (String(request.method || '').toUpperCase() === 'GET' && selected) {
      var body = typeof response.body === 'string' ? response.body : '', echo = '';
      try { var parsed = JSON.parse(body); if (parsed && typeof parsed.url === 'string') echo = parsed.url; } catch (_) {}
      var status = Number(response.statusCode || 0);
      var sourceEcho = echo === selected.source;
      var targetEcho = !!selected.target && echo === selected.target;
      var targetSignature = /^cross-host/.test(selected.mode) &&
        /^h=www\.cloudflare\.com\r?$/m.test(body) && /^visit_scheme=https\r?$/m.test(body) &&
        /^tls=TLSv[0-9.]+\r?$/m.test(body);
      var verdict = 'inconclusive';
      if (status === 200) {
        if (selected.mode === 'control' && sourceEcho) verdict = 'control-origin-observed';
        else if (selected.mode === 'same-origin' && targetEcho) verdict = 'same-origin-path-observed';
        else if (targetSignature) verdict = 'target-service-signature-observed';
        else if (sourceEcho) verdict = 'original-endpoint-observed';
      }
      var record = {probe:'kelee-qx-url-target-v2',stage:'response',probeId:selected.id,mode:selected.mode,
        qxVersion:typeof $environment !== 'undefined' ? String($environment.version || '') : '',
        observedURLKind:url === selected.source ? 'source' : url === selected.target ? 'target' : 'partial',
        observedStatus:status,verdict:verdict,provesFullEquivalence:false,
        evidence:{sourceEcho:sourceEcho,targetEcho:targetEcho,targetServiceSignature:targetSignature,
          notFoundTemplateObserved:/\bNot Found\b/i.test(body) && /requested URL was not found on the server/i.test(body)},
        timestamp:Date.now()};
      try { console.log('[Kelee-QX probe] ' + JSON.stringify(record)); } catch (_) {}
      result = {body:JSON.stringify(record,null,2),
        headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}};
    }
  } catch (_) { result = {}; }
  $done(result);
})();
