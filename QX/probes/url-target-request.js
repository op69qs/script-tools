/* Opt-in TF probe. Fixed GET test URLs only; this is not a Spotify adapter. */
(function () {
  'use strict';
  var result = {};
  try {
    var request = typeof $request !== 'undefined' ? $request : {};
    var url = String(request.url || '').replace(/^https:\/\/httpbin\.org:443\//,'https://httpbin.org/');
    var source = 'https://httpbin.org/anything/kelee-qx-url-target-probe';
    var cases = [
      {mode:'control',id:'qx953-control',source:source + '?mode=control&id=qx953-control',target:null},
      {mode:'same-origin',id:'qx953-same',source:source + '?mode=same-origin&id=qx953-same',
        target:'https://httpbin.org/anything/kelee-qx-url-target-result?kelee_qx_probe=same-origin&id=qx953-same'},
      {mode:'cross-host',id:'qx953-cross',source:source + '?mode=cross-host&id=qx953-cross',
        target:'https://www.cloudflare.com/cdn-cgi/trace?kelee_qx_probe=cross-host&id=qx953-cross'}
    ];
    var selected = cases.filter(function (entry) { return entry.source === url; })[0];
    if (String(request.method || '').toUpperCase() === 'GET' && selected) {
      var record = {probe:'kelee-qx-url-target-v1',stage:'request',probeId:selected.id,mode:selected.mode,
        qxVersion:typeof $environment !== 'undefined' ? String($environment.version || '') : '',
        proposedURL:selected.target,timestamp:Date.now()};
      try { console.log('[Kelee-QX probe] ' + JSON.stringify(record)); } catch (_) {}
      if (selected.target) result = {url:selected.target};
    }
  } catch (_) { result = {}; }
  $done(result);
})();
