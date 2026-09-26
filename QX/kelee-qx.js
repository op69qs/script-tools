/*
 * Kelee → Quantumult X install adapter, v1.0.0 (2026-09-25)
 * Original local-use implementation. Not affiliated with Kelee or Quantumult X.
 * Save in Quantumult X/Scripts/kelee-qx.js. See README.md and install.conf.
 *
 * One file, three jobs:
 * 1. Rewrite the hub's standard Loon installation links.
 * 2. Serve a local installation fallback/status page (script-echo-response).
 * 3. Fetch allow-listed resources using a candidate Loon UA (http_backend).
 *
 * This is an installer/download adapter, NOT a Loon engine or LPX decryptor.
 * The global resource parser still has to convert the fetched configuration.
 * No external relay, analytics, TLS-verification bypass, or global UA changes.
 */
(function () {
  'use strict';

  // Candidate product/version string, NOT a captured/verified Loon request.
  // If your own successful request uses a different UA, change this one value.
  var CONFIG = {
    version: '1.0.0',
    loonUA: 'Loon/3.5.1',
    hubOrigin: 'https://hub.kelee.one/',
    backendOrigin: 'http://127.0.0.1:9999/',
    maxChars: 3 * 1024 * 1024,
    maxRedirects: 2
  };
  var tools = createLinkTools(CONFIG);

  /** Browser-safe URL helpers. Does not rely on the URL API in QX's JS runtime. */
  function createLinkTools(cfg) {
    var bridge = cfg.hubOrigin + '__qx_kelee__/import?plugin=';
    function parseURL(value) {
      if (typeof value !== 'string' || /[\x00-\x20\x7f\\]/.test(value)) return null;
      var m = value.match(/^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/i);
      if (!m || /@/.test(m[2])) return null;
      return { scheme: m[1].toLowerCase(), authority: m[2].toLowerCase(),
        path: m[3] || '/', query: m[4] || '', hash: m[5] || '' };
    }
    function validHTTPS(value) {
      var p = parseURL(value);
      return !!p && p.scheme === 'https' && /^[a-z0-9.-]+(?::[0-9]+)?$/i.test(p.authority);
    }
    function allowed(value, kind) {
      var p = parseURL(value);
      if (!p || p.scheme !== 'https' || p.authority !== 'kelee.one') return false;
      var path;
      try { path = decodeURIComponent(p.path); } catch (_) { return false; }
      if (/[\x00-\x20\x7f\\%]/.test(path) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(path)) return false;
      if (kind === 'asset') return /^\/Tool\/Loon\/.+\.js$/i.test(path);
      return /^\/Tool\/Loon\/(?:Lpx|Plugin)\/[^/]+\.(?:lpx|plugin)$/i.test(path);
    }
    function extractPlugin(link) {
      if (typeof link !== 'string') return null;
      var m = link.match(/^(?:loon:\/\/import|https:\/\/www\.nsloon\.com\/openloon\/import|https:\/\/hub\.kelee\.one\/__qx_kelee__\/import)\?plugin=([\s\S]+)$/i);
      if (!m) return null;
      var value = m[1];
      // Raw HTTPS input (the user's example) must NOT be decoded a second time.
      // With raw input, all following & characters belong to the plugin URL.
      if (!/^https:\/\//i.test(value)) {
        try { value = decodeURIComponent(value.split(/[&#]/)[0]); } catch (_) { return null; }
      }
      return validHTTPS(value) ? value : null;
    }
    function localResource(value, kind) {
      var p = parseURL(value);
      var hash = p ? p.hash : '';
      var wireURL = hash ? value.slice(0, -hash.length) : value;
      return cfg.backendOrigin + 'kelee-qx/' + (kind || 'resource') + '?url=' +
        encodeURIComponent(wireURL) + hash;
    }
    function tagFor(value) {
      var p = parseURL(value);
      var tag = p ? p.path.split('/').pop() : 'Plugin';
      try { tag = decodeURIComponent(tag); } catch (_) {}
      return 'Kelee · ' + (tag.replace(/\.(?:plugin|lpx)$/i, '')
        .replace(/[\x00-\x1f\x7f,=]/g, '_').slice(0, 100) || 'Plugin');
    }
    function toQX(link) {
      var original = extractPlugin(link);
      if (!original) return null;
      var resource = allowed(original, 'resource') ? localResource(original) : original;
      var line = resource.replace(/,/g, '%2C') + ', opt-parser=true, enabled=true, tag=' + tagFor(original);
      return 'quantumult-x:///add-resource?remote-resource=' +
        encodeURIComponent(JSON.stringify({rewrite_remote: [line]}));
    }
    return {parseURL: parseURL, validHTTPS: validHTTPS, allowed: allowed,
      extractPlugin: extractPlugin, localResource: localResource, toQX: toQX, bridge: bridge};
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c];
    });
  }
  function jsonForScript(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }
  function header(headers, name) {
    var keys = Object.keys(headers || {});
    for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === name.toLowerCase()) return String(headers[keys[i]]);
    return '';
  }
  function queryValue(url, name) {
    var query = String(url).split('?')[1] || '';
    var entries = query.split('#')[0].split('&');
    for (var i = 0; i < entries.length; i++) {
      var at = entries[i].indexOf('=');
      if (at > -1 && entries[i].slice(0, at) === name) {
        try { return decodeURIComponent(entries[i].slice(at + 1)); } catch (_) { return null; }
      }
    }
    return null;
  }
  function patchPrefixes(body) {
    var plain = tools.bridge;
    var escaped = plain.replace(/\//g, '\\/');
    return body
      .replace(/loon:\/\/import\?plugin=/gi, function () { return plain; })
      .replace(/https:\/\/www\.nsloon\.com\/openloon\/import\?plugin=/gi, function () { return plain; })
      .replace(/loon:\\\/\\\/import\?plugin=/gi, function () { return escaped; })
      .replace(/https:\\\/\\\/www\.nsloon\.com\\\/openloon\\\/import\?plugin=/gi, function () { return escaped; });
  }

  /** Runs only inside the user's browser, never in the QX backend. */
  function browserHelper(cfg, makeTools) {
    if (window.__keleeQXBridge) return;
    var links = makeTools(cfg);
    window.__keleeQXBridge = {version: cfg.version, convert: links.toQX};
    function patchAnchor(anchor) {
      if (!anchor || !anchor.getAttribute) return;
      var raw = anchor.getAttribute('href');
      var qx = links.toQX(raw);
      if (qx) {
        anchor.setAttribute('href', qx);
        anchor.setAttribute('data-kelee-qx', '1');
        anchor.setAttribute('title', '添加到 Quantumult X（插件兼容性由资源解析器决定）');
        anchor.removeAttribute('target');
      }
    }
    function scan(root) {
      if (!root) return;
      if (root.nodeType === 1 && root.tagName === 'A') patchAnchor(root);
      if (root.querySelectorAll) {
        var all = root.querySelectorAll('a[href]');
        for (var i = 0; i < all.length; i++) patchAnchor(all[i]);
      }
    }
    // Capturing listener runs before normal delegated handlers on the page.
    window.addEventListener('click', function (event) {
      var el = event.target && event.target.nodeType === 3 ? event.target.parentElement : event.target;
      var a = el && el.closest ? el.closest('a[href]') : null;
      if (!a) return;
      var raw = a.getAttribute('href') || '';
      var qx = links.toQX(raw);
      if (!qx && a.getAttribute('data-kelee-qx') === '1' && /^quantumult-x:\/\/\/add-resource\?/.test(raw)) qx = raw;
      if (!qx) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.href = qx;
    }, true);
    var nativeOpen = window.open;
    window.open = function (url) {
      var qx = links.toQX(typeof url === 'string' ? url : '');
      if (qx) { window.location.href = qx; return null; }
      return nativeOpen.apply(window, arguments);
    };
    var scheduled = false;
    function scheduleScan() {
      if (scheduled) return;
      scheduled = true;
      setTimeout(function () { scheduled = false; scan(document); }, 0);
    }
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(scheduleScan).observe(document.documentElement || document, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['href']
      });
    }
    function ready() {
      scan(document);
      if (!document.body || document.getElementById('kelee-qx-badge')) return;
      var badge = document.createElement('a');
      badge.id = 'kelee-qx-badge';
      badge.href = cfg.hubOrigin + '__qx_kelee__/status';
      badge.textContent = 'QX 适配已启用 · 检查';
      badge.style.cssText = 'position:fixed;right:12px;bottom:20px;z-index:2147483646;padding:9px 12px;border-radius:20px;background:#17212b;color:#fff;font:12px -apple-system,sans-serif;text-decoration:none;box-shadow:0 2px 8px #0003;';
      document.body.appendChild(badge);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, {once:true});
    else ready();
  }

  function rewriteResponse(url, response) {
    var p = tools.parseURL(url);
    if (!p || p.scheme !== 'https' || p.authority !== 'hub.kelee.one' || /^\/__qx_kelee__\//.test(p.path)) return {};
    if (!response || typeof response.body !== 'string' || !response.body || response.body.length > CONFIG.maxChars) return {};
    var status = Number(response.statusCode || 200);
    if (status < 200 || status >= 300) return {};
    var body = response.body;
    var ct = header(response.headers, 'content-type');
    var html = /text\/html/i.test(ct) || (!ct && /^\s*(?:<!doctype\s+html|<html\b)/i.test(body));
    var code = /(?:javascript|ecmascript|application\/json|text\/json)/i.test(ct) || (!ct && /\.(?:m?js|json)$/i.test(p.path));
    if (!html && !code) return {};
    if (html && body.indexOf('id="kelee-qx-helper"') !== -1) return {};
    var modified = patchPrefixes(body);
    if (html) {
      var nonce = body.match(/<script\b[^>]*\bnonce\s*=\s*["']([^"']+)["']/i);
      var script = '<script id="kelee-qx-helper"' + (nonce ? ' nonce="' + escapeHTML(nonce[1]) + '"' : '') + '>' +
        '(' + browserHelper.toString() + ')(' + jsonForScript(CONFIG) + ',' + createLinkTools.toString() + ');</script>';
      if (/<head\b[^>]*>/i.test(modified)) modified = modified.replace(/<head\b[^>]*>/i, function (m) { return m + script; });
      else if (/<html\b[^>]*>/i.test(modified)) modified = modified.replace(/<html\b[^>]*>/i, function (m) { return m + script; });
      else modified = script + modified;
    }
    // QX handles body length/encoding automatically. Preserve CSP and SRI.
    return modified === body ? {} : {body: modified, headers: response.headers || {}};
  }

  function reply(code, body, type) {
    var reason = {200:'OK',400:'Bad Request',404:'Not Found',405:'Method Not Allowed',502:'Bad Gateway',504:'Gateway Timeout'}[code] || 'Error';
    return {status:'HTTP/1.1 ' + code + ' ' + reason, headers: {
      'Content-Type': (type || 'text/plain') + '; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer'
    }, body:body};
  }
  function page(title, inside) {
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + escapeHTML(title) + '</title><style>body{font:16px/1.65 -apple-system,BlinkMacSystemFont,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;overflow-wrap:anywhere}h1{font-size:24px}a{display:inline-block;margin:8px 0}code,pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}button,input{font:inherit}small{opacity:.75}.button{padding:12px 18px;background:#17212b;color:#fff;text-decoration:none;border-radius:10px}table{border-collapse:collapse}td,th{border:1px solid #aaa;padding:8px;text-align:left}</style></head><body>' +
      '<h1>' + escapeHTML(title) + '</h1>' + inside + '<hr><small>Kelee → QX ' + CONFIG.version + ' · 个人本机适配，非官方项目</small></body></html>';
  }
  var EXAMPLE = 'https://kelee.one/Tool/Loon/Lpx/BlockAdvertisers.lpx';
  function statusPage() {
    return page('适配脚本已运行', '<p>这一页证明网页重写入口已运行，不代表下载或插件转换已成功。</p>' +
      '<p><a class="button" href="' + CONFIG.backendOrigin + 'kelee-qx/health">检查本机下载服务</a></p>' +
      '<p><a href="' + escapeHTML(tools.bridge + encodeURIComponent(EXAMPLE)) + '">用 BlockAdvertisers 测试导入</a></p>' +
      '<p>如点击安装后出现中转页，再点“添加到 Quantumult X”。浏览器和 QX 仍可能要求确认。</p>');
  }
  function bridgeResponse(request) {
    var p = tools.parseURL(request.url);
    if (!p || p.authority !== 'hub.kelee.one' || p.scheme !== 'https') return {};
    if (p.path === '/__qx_kelee__/status') return reply(200, statusPage(), 'text/html');
    if (p.path !== '/__qx_kelee__/import') return reply(404, 'Unknown local bridge route.');
    var qx = tools.toQX(request.url);
    if (!qx) return reply(400, page('链接无效', '<p>需要标准 Loon 插件安装链接，目标必须是无账号密码的 HTTPS 地址。</p>'), 'text/html');
    var original = tools.extractPlugin(request.url);
    return reply(200, page('添加到 Quantumult X', '<p>原始资源：</p><pre>' + escapeHTML(original) + '</pre>' +
      '<p><a id="open-qx" class="button" href="' + escapeHTML(qx) + '">添加到 Quantumult X</a></p>' +
      '<p>如未自动打开，请点上面的按钮。只添加资源，不替换现有配置。</p>' +
      '<p>可莉资源由 QX 本机下载服务使用候选 Loon UA 获取；解析器负责格式转换，二者都可能单独失败。</p>' +
      '<script>setTimeout(function(){window.location.href=' + jsonForScript(qx) + ';},60);</script>'), 'text/html');
  }

  function resolveRelative(base, target) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return target;
    var p = tools.parseURL(base);
    if (!p) return null;
    if (target.indexOf('//') === 0) return p.scheme + ':' + target;
    if (target.charAt(0) === '?') return p.scheme + '://' + p.authority + p.path + target;
    if (target.charAt(0) === '#') return base.split('#')[0] + target;
    var suffix = target.match(/[?#][\s\S]*$/);
    var plain = suffix ? target.slice(0, -suffix[0].length) : target;
    var path = plain.charAt(0) === '/' ? plain : p.path.slice(0, p.path.lastIndexOf('/') + 1) + plain;
    var parts = [];
    path.split('/').forEach(function (part) {
      if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part);
    });
    return p.scheme + '://' + p.authority + '/' + parts.join('/') + (suffix ? suffix[0] : '');
  }
  function rewriteDependencies(content, originalURL) {
    // Only script-path fields. Never modify URL regexes, scripts or arbitrary text.
    return content.split('\n').map(function (line) {
      if (/^\s*(?:#|;|\/\/)/.test(line)) return line;
      return line.replace(/(\bscript-path\s*=\s*)(?:"([^"]+)"|'([^']+)'|([^,\s]+))/gi, function (all, prefix, dq, sq, bare) {
        var value = dq || sq || bare;
        var absolute = resolveRelative(originalURL, value);
        if (!absolute) return all;
        var next = tools.allowed(absolute, 'asset') ? tools.localResource(absolute, 'asset') : absolute;
        if (next === value) return all;
        var quote = dq !== undefined ? '"' : sq !== undefined ? "'" : '';
        return prefix + quote + next + quote;
      });
    }).join('\n');
  }
  function bodyProblem(response, kind) {
    var status = Number(response.statusCode || 0);
    if (status < 200 || status >= 300) return '上游 HTTP ' + status + '。UA 可能不足以通过，请打开诊断页。';
    var body = typeof response.body === 'string' ? response.body : '';
    if (!body.trim()) return '上游响应为空，未作为成功配置保存。';
    if (body.length > CONFIG.maxChars) return '响应超过本机适配脚本的大小限制。';
    if (/text\/html/i.test(header(response.headers,'content-type')) || /^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b|<script\b)/i.test(body)) return '上游返回 HTML 页面而非资源，可能是 block 或验证页面。';
    if (/[\x00\ufffd]/.test(body)) return '响应不是可识别的文本格式；本脚本不处理加密或二进制 LPX。';
    if (kind === 'resource' && !/^\s*\[(?:General|Rule|Rewrite|Script|Mitm|Argument|Host|URL Rewrite|Map Local)\]\s*$/im.test(body)) return '未识别到 Loon 文本配置区段；不把未知 LPX 格式当成可转换插件。';
    return null;
  }
  function messageOf(error) { return String(error && (error.message || error.error) || error || 'Unknown error'); }
  async function fetchAllowed(url, kind, ua, fetcher) {
    var current = url.split('#')[0];
    for (var i = 0; i <= CONFIG.maxRedirects; i++) {
      if (!tools.allowed(current, kind)) throw new Error('目标不在允许的 kelee.one/Tool/Loon/ 资源范围内。');
      var response = await fetcher({url:current,method:'GET',headers:{
        'User-Agent':ua, 'Accept':'text/plain, */*;q=0.8'
      },opts:{redirection:false,'skip-cert-verify':false,'auto-cookie':false}});
      var code = Number(response.statusCode);
      if ([301,302,303,307,308].indexOf(code) < 0) return {response:response,url:current};
      var next = resolveRelative(current, header(response.headers,'location'));
      if (!next || !tools.allowed(next, kind)) throw new Error('上游重定向到允许范围外，未跟随。HTTP ' + code);
      current = next;
    }
    throw new Error('上游重定向次数超过限制。');
  }
  function healthPage() {
    var diagnostic = CONFIG.backendOrigin + 'kelee-qx/diagnose?url=' + encodeURIComponent(EXAMPLE);
    var qx = tools.toQX('loon://import?plugin=' + EXAMPLE);
    return page('本机下载服务已运行', '<p>这证明 <code>[http_backend]</code> 配置可用。还没有下载任何插件。</p>' +
      '<p>候选 UA：<code>' + escapeHTML(CONFIG.loonUA) + '</code>。这不是已经验证过的真实 Loon 完整请求。</p>' +
      '<p><a class="button" href="' + escapeHTML(diagnostic) + '">检查 BlockAdvertisers 下载</a></p>' +
      '<p><a href="' + escapeHTML(qx) + '">将 BlockAdvertisers 添加到 QX</a></p>' +
      '<p>诊断会向原站发送两次请求，对比 Safari 风格 UA 与候选 Loon UA；不是破解验证或解密 LPX。</p>' +
      '<p>需要换 UA 时，编辑脚本顶部 <code>CONFIG.loonUA</code>。如修改本机端口，也同步修改 <code>backendOrigin</code>。</p>');
  }
  async function diagnose(url, fetcher) {
    var browserUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
    var rows = await Promise.all([{label:'Safari 风格 UA',ua:browserUA},{label:'候选 Loon UA',ua:CONFIG.loonUA}].map(async function (item) {
      try {
        var fetched = await fetchAllowed(url,'resource',item.ua,fetcher);
        var r = fetched.response;
        return {label:item.label,ua:item.ua,status:r.statusCode,type:header(r.headers,'content-type'),length:(r.body||'').length,problem:bodyProblem(r,'resource')};
      } catch (error) { return {label:item.label,ua:item.ua,status:'请求失败',type:'',length:0,problem:messageOf(error)}; }
    }));
    var content = '<p>仅比较 HTTP 标识，不代表模拟完整 Loon/TLS 行为。目标：</p><pre>' + escapeHTML(url) + '</pre>' +
      '<table><tr><th>请求</th><th>状态</th><th>内容检查</th></tr>';
    rows.forEach(function (r) {
      content += '<tr><td>' + escapeHTML(r.label) + '</td><td>' + escapeHTML(r.status) + '</td><td>' +
        escapeHTML(r.problem || '识别到文本插件；尚未验证 QX 转换') + '<br><small>' + escapeHTML(r.type || '未声明类型') + ' · ' + r.length + ' 字符</small></td></tr>';
    });
    content += '</table><p>只有 Loon 行出现 200 且识别到文本插件，才支持“此 UA 在当前网络可用于下载”的判断。两行均失败时，不能归因于 UA，也不要反复重试。</p>' +
      '<p>获取成功不代表规则、脚本、参数和外部依赖已兼容 QX。</p><p><a href="' + escapeHTML(tools.toQX('loon://import?plugin=' + url)) + '">添加到 Quantumult X</a></p>';
    return reply(200,page('资源下载诊断',content),'text/html');
  }
  async function backendResponse(request, fetcher) {
    var p = tools.parseURL(request.url);
    if (!p || !/^http$/.test(p.scheme) || !/^(?:127\.0\.0\.1|localhost|quantumult-x):[0-9]+$/.test(p.authority)) return reply(400,'Only local backend URLs are accepted.');
    if ((request.method || 'GET') !== 'GET') return reply(405,'Only GET is supported.');
    if (p.path === '/kelee-qx/health') return reply(200,healthPage(),'text/html');
    var kind = p.path === '/kelee-qx/asset' ? 'asset' : p.path === '/kelee-qx/resource' || p.path === '/kelee-qx/diagnose' ? 'resource' : null;
    if (!kind) return reply(404,'Unknown local backend route.');
    var target = queryValue(request.url,'url');
    if (!target || !tools.allowed(target,kind)) return reply(400,'目标不在允许的 kelee.one/Tool/Loon/ 资源范围内。');
    if (typeof fetcher !== 'function') return reply(502,'QX $task.fetch 不可用。请检查 http_backend 配置。');
    if (p.path === '/kelee-qx/diagnose') return diagnose(target,fetcher);
    try {
      var fetched = await fetchAllowed(target,kind,CONFIG.loonUA,fetcher);
      var problem = bodyProblem(fetched.response,kind);
      if (problem) return reply(502,'Kelee-QX 下载失败：' + problem);
      var content = kind === 'resource' ? rewriteDependencies(fetched.response.body,fetched.url) : fetched.response.body;
      return reply(200,content,kind === 'asset' ? 'application/javascript' : 'text/plain');
    } catch (error) { return reply(502,'Kelee-QX 下载失败：' + messageOf(error)); }
  }

  var exportsAPI = {
    CONFIG: CONFIG, toQX:tools.toQX, extractPlugin:tools.extractPlugin,
    patchPrefixes:patchPrefixes, rewriteResponse:rewriteResponse,
    rewriteDependencies:rewriteDependencies, backendResponse:backendResponse,
    bodyProblem:bodyProblem, browserHelper:browserHelper, createLinkTools:createLinkTools
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsAPI;

  if (typeof $request !== 'undefined' && typeof $done === 'function') {
    var completed = false, timer = null;
    function finish(result) {
      if (completed) return;
      completed = true;
      if (timer !== null && typeof clearTimeout === 'function') clearTimeout(timer);
      $done(result || {});
    }
    try {
      var parsed = tools.parseURL($request.url);
      if (typeof $response !== 'undefined') finish(rewriteResponse($request.url,$response));
      else if (parsed && parsed.authority === 'hub.kelee.one' && /^\/__qx_kelee__\//.test(parsed.path)) finish(bridgeResponse($request));
      else if (parsed && /^\/kelee-qx\//.test(parsed.path)) {
        if (typeof setTimeout === 'function') timer = setTimeout(function () { finish(reply(504,'本机下载处理超时，未返回成功配置。')); },25000);
        var fetcher = typeof $task !== 'undefined' && typeof $task.fetch === 'function' ? function(r){return $task.fetch(r);} : null;
        backendResponse($request,fetcher).then(finish,function(e){finish(reply(502,messageOf(e)));});
      } else finish({});
    } catch (error) {
      console.log('[Kelee-QX] ' + messageOf(error));
      finish({});
    }
  }
})();
