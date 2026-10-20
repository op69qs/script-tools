/* Opt-in TF probe v2. Fixed GET URLs; no fetch or redirect compensation. */
(function () {
  'use strict';
  var result = {};
  try {
    var request = typeof $request !== 'undefined' ? $request : {};
    var url = String(request.url || '').replace(/^https:\/\/httpbin\.org:443\//,'https://httpbin.org/');
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
    var selected = cases.filter(function (entry) {
      return source + '?mode=' + entry.mode + '&id=' + entry.id === url;
    })[0];
    if (String(request.method || '').toUpperCase() === 'GET' && selected) {
      if (selected.target) result = {url:selected.target};
      if (selected.mode === 'cross-host-header') {
        var headers = Object.create(null);
        Object.keys(request.headers || {}).forEach(function (key) {
          if (!/^(?:host|:authority|cookie|authorization|proxy-authorization)$/i.test(key))
            headers[key] = request.headers[key];
        });
        headers.Host = 'www.cloudflare.com';
        result.headers = headers;
      }
      var record = {probe:'kelee-qx-url-target-v2',stage:'request',probeId:selected.id,mode:selected.mode,
        qxVersion:typeof $environment !== 'undefined' ? String($environment.version || '') : '',
        proposedURL:selected.target,hostOverride:selected.mode === 'cross-host-header',timestamp:Date.now()};
      try { console.log('[Kelee-QX probe] ' + JSON.stringify(record)); } catch (_) {}
    }
  } catch (_) { result = {}; }
  $done(result);
})();
