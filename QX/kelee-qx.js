/*
 * Kelee → Quantumult X install adapter, v1.7.0 (2026-10-20)
 * Original local-use implementation. Not affiliated with Kelee or Quantumult X.
 * Save in Quantumult X/Scripts/kelee-qx.js. See README.md and install.conf.
 * The backend now serves a native rewrite_remote subscription and its script.
 *
 * One file, four jobs:
 * 1. Rewrite the hub's standard Loon installation links.
 * 2. Serve a local installation fallback/status page (script-echo-response).
 * 3. Fetch allow-listed resources and Kelee JavaScript dependencies (http_backend).
 * 4. Normalize Loon scripts, conditional rewrites and supported domain/HTTP logic before the resource parser sees them.
 *
 * This is an installer/download adapter, NOT a Loon engine or LPX decryptor.
 * The global resource parser still has to convert the fetched configuration.
 * No external relay, analytics, TLS-verification bypass, or global UA changes.
 */
(function keleeQXAdapter() {
  'use strict';

  // Published iOS resource UA: https://t.me/s/LoonNews (post 2016, 2026-09-16).
  // Keep remoteSnippet/adapter URLs stable: no version suffix is appended.
  // Kelee may apply different access controls to plugin files and JavaScript assets,
  // so upstream errors are surfaced instead of being treated as a successful resource.
  var CONFIG = {
    version: '1.7.0',
    loonUA: 'Loon/991 CFNetwork/3896.100.1.1.1 Darwin/27.0.0',
    accept: 'text/plain, */*;q=0.8',
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
      if (kind === 'asset') return /^\/Tool\/Loon\/.+\.js$/i.test(path) || /^\/Resource\/JavaScript\/.+\.js$/i.test(path);
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
      var route = kind === 'asset' ? 'asset.js' : (kind || 'resource');
      return cfg.backendOrigin + 'kelee-qx/' + route + '?url=' +
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
    var reason = {200:'OK',400:'Bad Request',401:'Unauthorized',403:'Forbidden',404:'Not Found',405:'Method Not Allowed',422:'Unprocessable Content',429:'Too Many Requests',500:'Internal Server Error',502:'Bad Gateway',503:'Service Unavailable',504:'Gateway Timeout'}[code] || 'Error';
    return {status:'HTTP/1.1 ' + code + ' ' + reason, headers: {
      'Content-Type': (type || 'text/plain') + '; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer', 'X-Kelee-QX-Version': CONFIG.version
    }, body:body};
  }
  /** Native QX remote rewrite format: hostname plus rules, no INI sections. */
  function remoteSnippet() {
    var source = CONFIG.backendOrigin + 'kelee-qx/adapter.js';
    return [
      '# Kelee-QX - native Quantumult X rewrite resource',
      '# Import this resource with opt-parser=false; retain the http_backend bootstrap.',
      '# The script URL is served by the same independently configured local backend.',
      'hostname = hub.kelee.one',
      '',
      /^https:\/\/hub\.kelee\.one\/__qx_kelee__\/(?:import|status)(?:\?|$)/.source + ' url script-echo-response ' + source,
      /^https:\/\/hub\.kelee\.one\/(?!__qx_kelee__\/)/.source + ' url script-response-body ' + source,
      ''
    ].join('\n');
  }
  function adapterSource() {
    // Named, self-contained IIFE: export only this adapter, without reading files,
    // fetching itself, or depending on rewrite interception of QX's own requests.
    return '// Kelee-QX ' + CONFIG.version + ' - generated by the local HTTP backend\n(' +
      keleeQXAdapter.toString() + ')();\n';
  }
  function bootstrapImportURL() {
    var line = CONFIG.backendOrigin + 'kelee-qx/rewrite.snippet, tag=Kelee-QX 网页安装适配, update-interval=86400, opt-parser=false, enabled=true';
    return 'quantumult-x:///add-resource?remote-resource=' +
      encodeURIComponent(JSON.stringify({rewrite_remote:[line]}));
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
      '<p>可莉资源由 QX 本机下载服务使用公布的 Loon UA 获取；解析器负责格式转换，二者都可能单独失败。</p>' +
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
    // Only recognized script declarations. JSON values may literally contain
    // "script-path=...", which must never be interpreted as dependencies.
    var inComment = false;
    return content.split('\n').map(function (line) {
      var text = line.trim();
      if (inComment) { if (text.indexOf('*/') !== -1) inComment = false; return line; }
      if (/^\/\*/.test(text)) { inComment = text.indexOf('*/',2) === -1; return line; }
      if (/^\s*(?:#|;|\/\/)/.test(line)) return line;
      if (!/^\s*http-(?:request|response)\s+\S+\s+script-path\s*=/i.test(line) &&
          !/^\s*(?:[\w.-]+\s*=\s*)?type\s*=\s*http-(?:request|response)\b/i.test(line)) return line;
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
  function protectParserPattern(pattern) {
    // KOP removes the literal substring "^http" even when the anchor is
    // semantically necessary. An empty noncapturing group preserves that
    // anchor without shifting capture numbers. Escape literal carets instead.
    var out = '', inClass = false;
    for (var i = 0; i < pattern.length; i++) {
      var c = pattern.charAt(i);
      if (c === '\\' && i + 1 < pattern.length) {
        if (pattern.charAt(i + 1) === '^' && pattern.slice(i + 2, i + 6) === 'http') out += '\\x5e';
        else out += c + pattern.charAt(i + 1);
        i++; continue;
      }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      if (c === '^' && pattern.slice(i + 1, i + 5) === 'http') {
        if (inClass && pattern.charAt(i - 1) === '[') { out += '^\\x68'; i++; }
        else out += inClass ? '\\x5e' : '^(?:)';
      }
      else out += c;
    }
    return out;
  }
  /**
   * Parse the observed conditional DSL as data; never eval upstream content.
   * Supported: URL regex + script(), request reject*(), JSON replace/jq/delete.
   * Consume the entire line, preserve regex groups/flags, and fail atomically.
   * Unsupported actions/conditions are not silently removed from a subscription.
   */
  function normalizeConditionalRules(content, originalURL) {
    var section = '', inComment = false;
    return String(content || '').split('\n').map(function (line, index) {
      var text = line.trim();
      if (inComment) { if (text.indexOf('*/') !== -1) inComment = false; return line; }
      if (/^\/\*/.test(text)) { inComment = text.indexOf('*/', 2) === -1; return line; }
      if (/^\[[^\]]+\]$/.test(text)) { section = text.toLowerCase(); return line; }
      if (!/^\[(?:script|rewrite|url rewrite|body rewrite)\]$/.test(section) ||
          !/^(?:request|response)\s+if\b/i.test(text)) return line;
      function fail(reason) {
        var error = new Error('第 ' + (index + 1) + ' 行 ' + section + '：' + reason);
        error.keleeStage = 'resource-conversion';
        error.keleeLine = index + 1;
        error.keleeSection = section;
        error.keleeRule = line;
        throw error;
      }
      var head = text.match(/^(request|response)\s+if\s+\$\{url\}\s*~=\s*/i);
      if (!head) fail('仅支持单个 URL 正则条件。');
      var mode = head[1].toLowerCase(), at = head[0].length;
      if (text.charAt(at++) !== '/') fail('URL 条件必须是 /pattern/flags。');
      var start = at, escaped = false, inClass = false, end = -1;
      for (; at < text.length; at++) {
        var ch = text.charAt(at);
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) { end = at++; break; }
      }
      if (end < 0) fail('正则未闭合。');
      var pattern = text.slice(start, end);
      var flags = (text.slice(at).match(/^[a-z]*/i) || [''])[0];
      at += flags.length;
      if (/[^ims]/.test(flags) || /(.).*\1/.test(flags)) fail('正则标志仅支持不重复的 i、m、s。');
      if (!pattern || /\s/.test(pattern)) fail('正则必须非空；空白请写为 \\x20 或 \\s 等转义。');
      try { new RegExp(pattern, flags); } catch (_) { fail('正则语法无效或当前运行环境不支持。'); }
      if (flags) pattern = '(?' + ['i','m','s'].filter(function (f) { return flags.indexOf(f) !== -1; }).join('') + ')' + pattern;
      function space() { while (/\s/.test(text.charAt(at)) && at < text.length) at++; }
      function token(value) {
        space();
        if (text.slice(at, at + value.length) !== value) fail('动作或参数格式不支持。');
        at += value.length;
      }
      var then = text.slice(at).match(/^\s+then\s+/i);
      var urlReplaceReason = 'url.replace（包括 as 捕获）需要保持连接目标主机、TLS 及匹配范围外的后缀；QX 公开接口尚无已验证的等价转换。';
      if (!then && /^\s+as\s+[a-z_]\w*\s+then\b/i.test(text.slice(at))) {
        if (/\bthen\s+url\.replace\s*\(/i.test(text.slice(at))) fail(urlReplaceReason);
        fail('命名 URL 捕获（as）尚无已验证的等价转换。');
      }
      if (!then) fail('正则后仅支持 then，不支持附加条件。');
      at += then[0].length;
      function value(depth) {
        if (depth > 4) fail('参数嵌套过深。');
        space();
        var quote = text.charAt(at), out = '';
        if (quote === '"' || quote === "'") {
          at++;
          while (at < text.length) {
            var c = text.charAt(at++);
            if (c === quote) return out;
            if (c === '\\') {
              var e = text.charAt(at++);
              var escapes = {'"':'"', "'":"'", '\\':'\\', '/':'/', b:'\b', f:'\f', n:'\n', r:'\r', t:'\t'};
              if (Object.prototype.hasOwnProperty.call(escapes, e)) out += escapes[e];
              else if (e === 'u' && /^[0-9a-f]{4}$/i.test(text.slice(at, at + 4))) {
                out += String.fromCharCode(parseInt(text.slice(at, at + 4),16)); at += 4;
              } else fail('字符串包含不支持的转义。');
            } else { if (c.charCodeAt(0) < 32) fail('字符串含控制字符。'); out += c; }
          }
          fail('字符串未闭合。');
        }
        if (quote === '[') {
          at++; space(); var items = [];
          if (text.charAt(at) === ']') { at++; return items; }
          while (at < text.length) {
            items.push(value(depth + 1)); space();
            if (text.charAt(at) === ']') { at++; return items; }
            token(',');
          }
          fail('数组未闭合。');
        }
        var scalar = text.slice(at).match(/^(true|false|[01])(?=\s|,|\)|\]|$)/);
        if (scalar) {
          at += scalar[0].length;
          return scalar[0] === 'true' ? true : scalar[0] === 'false' ? false : Number(scalar[0]);
        }
        fail('参数必须是带引号的字符串、数组或布尔值。');
      }
      function finish() {
        space();
        if (at !== text.length) fail('动作后存在不支持的参数或尾随内容。');
      }
      var action = text.slice(at).match(/^([a-z_][a-z0-9_.]*)\s*\(/i);
      if (!action) fail('未识别的条件动作。');
      var name = action[1]; at += action[0].length;
      if (name === 'url.replace') fail(urlReplaceReason);
      var jsonAction = name.match(/^(request|response)\.json\.(jq|delete)$/);
      if (jsonAction) {
        if (mode !== jsonAction[1]) fail('JSON 动作与 request/response 阶段不一致。');
        var argument = value(0); token(')'); finish();
        var expression;
        if (jsonAction[2] === 'jq') {
          if (typeof argument !== 'string' || !argument.trim() || /[\r\n\x00]/.test(argument))
            fail('jq 必须是非空单行表达式。');
          expression = argument;
        } else {
          var deletePaths = Array.isArray(argument) ? argument : [argument];
          if (!deletePaths.length) fail('delete 路径数组不能为空。');
          expression = deletePaths.map(function (path) {
            if (typeof path !== 'string' || !path) fail('delete 路径必须是非空字符串。');
            var cursor = 0, segments = [];
            while (cursor < path.length) {
              var field = path.slice(cursor).match(/^(?:\.?)([a-zA-Z_][a-zA-Z0-9_]*)/);
              var item = path.slice(cursor).match(/^\[(0|[1-9][0-9]*)\]/);
              if (field && (cursor === 0 || path.charAt(cursor) === '.')) {
                segments.push(field[1]); cursor += field[0].length;
              } else if (item && Number(item[1]) <= 9007199254740991) {
                segments.push(Number(item[1])); cursor += item[0].length;
              } else fail('delete 仅支持字段名、点分隔及非负数组下标。');
            }
            // Loon batch actions run in order. Never merge/deduplicate array
            // indices: a previous deletion can move the following index.
            return '(. as $kelee_original | try delpaths(' + JSON.stringify([segments]) + ') catch $kelee_original)';
          }).join(' | ');
        }
        return protectParserPattern(pattern) + ' url jsonjq-' + mode + '-body ' +
          "'" + expression.replace(/'/g,"\\'") + "'";
      }
      if (name === 'script') {
        var script = value(0); token(')');
        if (typeof script !== 'string' || !script) fail('脚本地址必须是非空字符串。');
        space();
        if (!/^with\s+/.test(text.slice(at))) fail('脚本必须显式指定 requires_body。');
        at += text.slice(at).match(/^with\s+/)[0].length;
        var options = Object.create(null);
        while (at < text.length) {
          space();
          var key = text.slice(at).match(/^([a-z_][a-z0-9_-]*)\s*=/i);
          if (!key) fail('脚本选项格式无效。');
          at += key[0].length;
          var option = key[1].replace(/-/g,'_');
          if ((option !== 'requires_body' && option !== 'tag') || Object.prototype.hasOwnProperty.call(options,option)) fail('脚本含未知或重复选项。');
          options[option] = value(0); space();
          if (at === text.length) break;
          token(',');
          space(); if (at === text.length) fail('脚本选项不能以逗号结尾。');
        }
        if (options.requires_body !== true && options.requires_body !== false && options.requires_body !== 1 && options.requires_body !== 0) fail('requires_body 必须显式设为 true/false 或 1/0。');
        if (options.tag !== undefined && typeof options.tag !== 'string') fail('tag 必须是字符串。');
        finish();
        var absolute = resolveRelative(originalURL,script);
        if (!absolute || !tools.validHTTPS(absolute)) fail('脚本地址必须解析为有效的 HTTPS 地址。');
        var next = tools.allowed(absolute,'asset') ? tools.localResource(absolute,'asset') : absolute;
        // QX rules are whitespace-delimited. Percent-encode URL punctuation only.
        next = next.replace(/,/g,'%2C');
        return protectParserPattern(pattern) + ' url script-' + mode + '-' + (options.requires_body ? 'body' : 'header') + ' ' + next;
      }
      if (/^reject(?:_img|_dict|_array)?$/.test(name)) {
        if (mode !== 'request') fail('reject 动作仅支持 request 阶段。');
        space(); var status = text.slice(at).match(/^(200|404)(?=\s*\))/);
        if (!status) fail('reject 状态码没有可靠的 QX 等价动作。');
        at += status[0].length; token(')'); finish();
        if (name !== 'reject' && status[1] !== '200') fail('带响应类型的 reject 仅支持 HTTP 200。');
        var reject = name === 'reject' ? (status[1] === '404' ? 'reject' : 'reject-200') : name.replace('_','-');
        return protectParserPattern(pattern) + ' url ' + reject;
      }
      if (name === 'response.json.replace') {
        if (mode !== 'response') fail('response.json.replace 只能用于 response 阶段。');
        var paths = value(0); token(','); var values = value(0); token(')'); finish();
        if (!Array.isArray(paths) && !Array.isArray(values)) { paths = [paths]; values = [values]; }
        if (!Array.isArray(paths) || !Array.isArray(values) || !paths.length || paths.length !== values.length) fail('JSON 路径与替换值数组必须非空且等长。');
        var object = Object.create(null), seen = [];
        paths.forEach(function (path, n) {
          if (typeof path !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(path)) fail('JSON 替换仅支持点分隔的字段路径。');
          if (seen.some(function (p) { return p === path || p.indexOf(path + '.') === 0 || path.indexOf(p + '.') === 0; })) fail('JSON 路径重复或相互覆盖。');
          if (typeof values[n] !== 'string') fail('JSON 替换值必须是 JSON 编码的字符串。');
          try { object[path] = JSON.parse(values[n]); } catch (_) { fail('JSON 替换值不是有效 JSON。'); }
          seen.push(path);
        });
        // The existing global parser handles JSON→jq, including missing fields.
        return pattern + ' response-body-json-replace ' + JSON.stringify(object);
      }
      fail('此条件动作尚无可靠转换，未返回不完整配置。');
    }).join('\n');
  }
  function normalizeLoonScriptRules(content) {
    var section = '', inComment = false;
    return String(content || '').split('\n').map(function (line, index) {
      var trimmed = line.trim();
      if (inComment) { if (trimmed.indexOf('*/') !== -1) inComment = false; return line; }
      if (/^\/\*/.test(trimmed)) { inComment = trimmed.indexOf('*/',2) === -1; return line; }
      if (/^\[[^\]]+\]$/.test(trimmed)) { section = trimmed.toLowerCase(); return line; }
      if (section !== '[script]' || !trimmed || /^(?:#|;|\/\/)/.test(trimmed)) return line;
      function fail(reason) {
        var error = new Error('第 ' + (index + 1) + ' 行 ' + section + '：' + reason);
        error.keleeStage = 'resource-conversion'; error.keleeLine = index + 1;
        error.keleeSection = section; error.keleeRule = line; throw error;
      }
      var m = trimmed.match(/^(http-response|http-request)\s+(\S+)\s+script-path\s*=\s*(?:"([^"]+)"|'([^']+)'|([^,\s]+))([\s\S]*)$/i);
      if (!m) {
        // KOP also accepts named/type= declarations and other option orders,
        // but may silently discard binary/argument/timeout execution options.
        if (/^http-(?:request|response)\b|(?:^|[=,])\s*type\s*=\s*http-(?:request|response)\b/i.test(trimmed))
          fail('旧式脚本声明尚不能完整解析；拒绝让解析器忽略执行选项。');
        return line;
      }
      var mode = m[1].toLowerCase();
      var pattern = protectParserPattern(m[2]);
      var script = m[3] || m[4] || m[5];
      var rest = (m[6] || '').trim(), seen = Object.create(null), requiresBody = false;
      while (rest) {
        var option = rest.match(/^,\s*([a-z][a-z0-9-]*)\s*=\s*/i);
        if (!option) fail('旧式脚本选项格式无法可靠转换。');
        var key = option[1].toLowerCase();
        if (seen[key]) fail('旧式脚本选项重复：' + key);
        if (key !== 'requires-body' && key !== 'tag') fail('旧式脚本选项尚未适配：' + key + '；未忽略执行条件。');
        seen[key] = true; rest = rest.slice(option[0].length);
        if (key === 'requires-body') {
          var body = rest.match(/^(true|false|1|0)(?=\s*(?:,|$))/i);
          if (!body) fail('requires-body 必须为 true/false 或 1/0。');
          requiresBody = /^(?:true|1)$/i.test(body[1]); rest = rest.slice(body[0].length);
        } else {
          var tag = rest.match(/^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,\r\n"'=]+)/);
          if (!tag) fail('旧式脚本 tag 格式无法识别。');
          rest = rest.slice(tag[0].length);
        }
        rest = rest.trim();
      }
      var action = mode === 'http-response'
        ? (requiresBody ? 'script-response-body' : 'script-response-header')
        : (requiresBody ? 'script-request-body' : 'script-request-header');
      return pattern + ' url ' + action + ' ' + script;
    }).join('\n');
  }
  function normalizeSafeLoonRewritePatterns(content) {
    var section = '';
    return String(content || '').split('\n').map(function (line) {
      var trimmed = line.trim();
      if (/^\[[^\]]+\]$/.test(trimmed)) { section = trimmed.toLowerCase(); return line; }
      if (section !== '[rewrite]' || !trimmed || /^(?:#|;|\/\/)/.test(trimmed)) return line;
      var m = trimmed.match(/^(\S+)\s+([\s\S]+)$/);
      if (!m) return line;
      var action = m[2];
      if (!/^(?:reject(?:-[\w-]+)?|response-body-json-(?:replace|del|jq)|request-body-json-jq)(?:\s|$)/i.test(action)) return line;
      return m[1] + ' ' + action;
    }).join('\n');
  }
  /**
   * Compile positive domain logic in the domain layer, never as URL rewrites.
   * A union of output globs denotes the SAME set as the input predicate.
   * Intersect literal+* NFAs: indices only advance, except the common * loop.
   * Epsilon exits and overlapping literal matches must both be retained.
   */
  function ruleAnnotation(line) {
    var match = line.match(/^([ \t]*\{#[^\r\n]*?#\}[ \t]*)([^\r\n]*)\r?$/);
    return match ? {prefix:match[1],body:match[2],invalid:/^\s*\{#/.test(match[2])} :
      {prefix:'',body:line,invalid:/^\s*\{#/.test(line)};
  }
  function normalizeLogicalRules(content, details) {
    var section = '', inComment = false, totalWork = 0, totalRules = 0, totalChars = 0, exhausted = false;
    // Loon gives some filter classes priority over HTTP rules regardless of line
    // order. Never move an HTTP reject across a possible DIRECT/PROXY exception.
    // This is deliberately conservative; unrelated rules can be narrowed later.
    var filterSection = '', filterComment = false, routingConflict = false;
    String(content || '').split('\n').forEach(function (line) {
      var text = line.trim();
      if (filterComment) { if (text.indexOf('*/') !== -1) filterComment = false; return; }
      if (/^\/\*/.test(text)) { filterComment = text.indexOf('*/',2) === -1; return; }
      text = ruleAnnotation(line).body.trim();
      if (/^\[[^\]]+\]$/.test(text)) { filterSection = text.toLowerCase(); return; }
      if (filterSection !== '[rule]' || !text || /^(?:#|;|\/\/)/.test(text)) return;
      if (!/,\s*REJECT\s*$/i.test(text)) routingConflict = true;
    });
    return String(content || '').split('\n').map(function (line, index) {
      var text = line.trim();
      if (inComment) { if (text.indexOf('*/') !== -1) inComment = false; return line; }
      if (/^\/\*/.test(text)) { inComment = text.indexOf('*/', 2) === -1; return line; }
      var annotation = ruleAnnotation(line);
      text = annotation.body.trim();
      if (/^\[[^\]]+\]$/.test(text)) { section = text.toLowerCase(); return line; }
      if (section !== '[rule]' || !/^(?:AND|OR|NOT)\s*,/i.test(text)) return line;
      var record = {line:index + 1, status:'unsupported', rule:line};
      try {
        var budget = 0, nodes = 0;
        function stop(reason) { throw new Error(reason); }
        function resourceStop(reason) { exhausted = true; stop(reason); }
        function spend() {
          if (++totalWork > 100000) resourceStop('整份资源的域名逻辑计算预算已耗尽，保留剩余原文。');
          if (++budget > 20000) stop('域名逻辑计算超过工作量限制，未输出部分分支。');
        }
        function split(value) {
          var fields = [], start = 0, depth = 0, quote = '', escaped = false;
          for (var i = 0; i < value.length; i++) {
            var c = value.charAt(i);
            if (escaped) { escaped = false; continue; }
            if (c === '\\') { escaped = true; continue; }
            if (quote) { if (c === quote) quote = ''; continue; }
            if (c === '"' || c === "'") { quote = c; continue; }
            if (c === '(') depth++;
            else if (c === ')') { if (--depth < 0) stop('逻辑规则括号不平衡。'); }
            else if (c === ',' && depth === 0) { fields.push(value.slice(start,i).trim()); start = i + 1; }
          }
          if (depth || quote || escaped) stop('逻辑规则括号、引号或转义未闭合。');
          fields.push(value.slice(start).trim());
          return fields;
        }
        function unwrap(value) {
          if (value.charAt(0) !== '(' || value.charAt(value.length - 1) !== ')') stop('逻辑子规则必须用括号包围。');
          return value.slice(1,-1);
        }
        function httpReject(root) {
          if (root[0].toUpperCase() !== 'AND' || root[2].toUpperCase() !== 'REJECT') return null;
          var children = split(unwrap(root[1]));
          if (children.length !== 2) return null;
          var a = split(unwrap(children[0])), b = split(unwrap(children[1]));
          if (a[0].toUpperCase() === 'USER-AGENT') { var swap = a; a = b; b = swap; }
          if (a[0].toUpperCase() !== 'URL-REGEX' || b[0].toUpperCase() !== 'USER-AGENT') return null;
          if (a.length !== 2 || b.length !== 2) stop('HTTP 逻辑子规则含额外参数。');
          if (routingConflict) stop('资源中还有非 REJECT 分流；不能让 HTTP 重写越过可能优先匹配的策略。');
          function literal(value) {
            return value.replace(/^(["'])([\s\S]*)\1$/,'$2');
          }
          var pattern = literal(a[1]), ua = literal(b[1]);
          if (!pattern || pattern.length > 4096 || /[\s"']/.test(pattern))
            stop('HTTP 组合的 URL 正则为空、过长或包含未适配的空白/引号。');
          // These substrings trigger unrelated KOP heuristics even in native
          // rules. Keep the original rule instead of letting KOP reinterpret it.
          if (/URL-REGEX|http-r|data=/.test(pattern) || /pattern/.test(pattern) && /type/.test(pattern))
            stop('URL 正则含会被资源解析器误判的语法，尚不能可靠透传。');
          if (!ua || ua.length > 512 || !/[^*\s]/.test(ua) ||
              /[^\x20-\x7e]|[%\\"'?]/.test(ua) || /^\s|\s$/.test(ua))
            stop('UA 组合仅适配非空 ASCII 字面量及 *，尚不转换纯星号、?、编码或复杂转义。');
          var valuePattern = '';
          for (var i = 0; i < ua.length; i++) {
            var c = ua.charAt(i);
            // Hex literals also prevent a UA containing "URL-REGEX" or
            // "http-request" from triggering KOP's format-detection heuristics.
            valuePattern += c === '*' ? '[^\\r\\n]*' :
              '\\x' + ('0' + ua.charCodeAt(i).toString(16)).slice(-2);
          }
          // Official Loon4Mac 991 core: USER-AGENT reaches the byte-comparing
          // DCUtils wildcard matcher without case folding (see research note).
          // Restrict '?' and empty/pure-star cases; '*' with ASCII literals is
          // representable without assuming Unicode byte/character equivalence.
          var headerPattern = '(?:^|\\r?\\n)[Uu][Ss][Ee][Rr]-[Aa][Gg][Ee][Nn][Tt]:[\\x20\\t]*' +
            valuePattern + '[\\x20\\t]*(?=\\r?\\n|$)';
          record.mechanism = 'url-and-header';
          // Match KOP's existing URL-REGEX REJECT -> reject-200 convention.
          return annotation.prefix + protectParserPattern(pattern) + ' ' + headerPattern + ' url-and-header reject-200';
        }
        function unique(values) {
          var seen = Object.create(null), out = [];
          values.forEach(function (value) {
            spend();
            value = value.replace(/\*+/g,'*');
            if (value.length > 256) stop('域名通配符超过长度限制。');
            if (!Object.prototype.hasOwnProperty.call(seen,value)) {
              seen[value] = true; out.push(value);
              if (out.length > 128) stop('域名逻辑展开超过 128 条，未输出部分分支。');
            }
          });
          return out;
        }
        function intersect(p, q) {
          if (p === q) return [p];
          var memo = Object.create(null), states = 0;
          function visit(i, j) {
            var key = i + ':' + j;
            if (Object.prototype.hasOwnProperty.call(memo,key)) return memo[key];
            spend();
            if (++states > 4096) stop('域名逻辑乘积超过状态限制。');
            var result;
            if (i === p.length) result = /^\**$/.test(q.slice(j)) ? [''] : [];
            else if (j === q.length) result = /^\**$/.test(p.slice(i)) ? [''] : [];
            else {
              var a = p.charAt(i), b = q.charAt(j);
              if (a === '*' && b === '*') {
                result = unique(visit(i + 1,j).concat(visit(i,j + 1))).map(function (tail) { return '*' + tail; });
              } else if (a === '*') {
                result = visit(i + 1,j).concat(visit(i,j + 1).map(function (tail) { return b + tail; }));
              } else if (b === '*') {
                result = visit(i,j + 1).concat(visit(i + 1,j).map(function (tail) { return a + tail; }));
              } else result = a === b ? visit(i + 1,j + 1).map(function (tail) { return a + tail; }) : [];
            }
            memo[key] = unique(result);
            return memo[key];
          }
          return visit(0,0);
        }
        function compile(value, depth) {
          if (depth > 16 || ++nodes > 128) stop('域名逻辑嵌套或节点数量超过限制。');
          var fields = split(value), kind = fields[0].toUpperCase();
          if (kind === 'NOT') stop('NOT 的补集尚无已验证的主机通配符转换，保留原规则。');
          if (kind === 'AND' || kind === 'OR') {
            if (fields.length !== 2) stop('逻辑节点含额外参数。');
            var children = split(unwrap(fields[1]));
            if (!children.length || !children[0]) stop('逻辑子规则不能为空。');
            // Compile every child, even an unreachable one, before claiming support.
            var sets = children.map(function (child) { return compile(unwrap(child),depth + 1); });
            if (kind === 'OR') return unique([].concat.apply([],sets));
            var result = sets[0];
            for (var n = 1; n < sets.length; n++) {
              var next = [];
              result.forEach(function (a) {
                sets[n].forEach(function (b) { spend(); next = unique(next.concat(intersect(a,b))); });
              });
              result = next;
            }
            return result;
          }
          if (!/^DOMAIN(?:-SUFFIX|-KEYWORD)?$/.test(kind)) {
            if (kind === 'PROTOCOL') stop('协议与域名的交集没有已验证的 QX 分流语法；不能用全局关闭 QUIC 替代。');
            if (kind === 'URL-REGEX' || kind === 'USER-AGENT')
              stop('当前仅适配无其他路由策略的两叶 URL-REGEX AND USER-AGENT REJECT；DIRECT、PROXY 及其他组合保留原规则。');
            stop('逻辑子规则类型尚未适配：' + kind.slice(0,40));
          }
          if (fields.length !== 2) stop('域名子规则含额外参数。');
          var literal = fields[1].replace(/^(["'])([\s\S]*)\1$/,'$2').toLowerCase();
          if (!literal || literal.length > 128 || !/^[a-z0-9_.-]+$/.test(literal))
            stop('域名逻辑仅接受 ASCII 字面量；不能把特殊字符当作通配符。');
          if (kind !== 'DOMAIN-KEYWORD' && !/^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/.test(literal))
            stop('域名或后缀格式无效。');
          return kind === 'DOMAIN' ? [literal] : kind === 'DOMAIN-SUFFIX' ? [literal,'*.' + literal] : ['*' + literal + '*'];
        }
        if (exhausted) stop('整份资源的域名逻辑预算已耗尽，保留剩余原文。');
        if (text.length > 8192) stop('逻辑规则超过长度限制。');
        var root = split(text);
        if (root.length !== 3 || !/^(?:DIRECT|REJECT|PROXY)$/i.test(root[2]))
          stop('域名逻辑仅验证了 DIRECT/REJECT/PROXY 策略，且不接受额外参数。');
        var block = httpReject(root), outputCount;
        if (block !== null) outputCount = 1;
        else {
          var globs = compile(root[0] + ',' + root[1],0);
          block = globs.length ? globs.map(function (glob) { return annotation.prefix + 'host-wildcard, ' + glob + ', ' + root[2]; }).join('\n') :
            '# Kelee-QX: domain logic has an empty intersection.';
          outputCount = globs.length;
        }
        if (totalRules + outputCount > 512 || totalChars + block.length > 131072)
          resourceStop('整份资源的域名逻辑输出预算已耗尽，保留剩余原文。');
        totalRules += outputCount; totalChars += block.length;
        record.status = 'converted'; record.outputRules = outputCount;
        if (Array.isArray(details)) details.push(record);
        return block;
      } catch (error) {
        record.reason = messageOf(error);
        if (Array.isArray(details)) details.push(record);
        return line; // The parser may skip it; report the gap, never claim equivalence.
      }
    }).join('\n');
  }
  function prepareResourceContent(content, originalURL, logicalDetails) {
    var original = String(content || '').split('\n'), notes = [], section = '', inComment = false;
    var bare = original.map(function (line, index) {
      var text = line.trim();
      notes[index] = '';
      if (inComment) { if (text.indexOf('*/') !== -1) inComment = false; return line; }
      if (/^\/\*/.test(text)) { inComment = text.indexOf('*/',2) === -1; return line; }
      if (/^\[[^\]]+\]$/.test(text)) section = text.toLowerCase();
      var annotation = ruleAnnotation(line);
      if (annotation.invalid) {
        var error = new Error('第 ' + (index + 1) + ' 行 ' + section + '：规则备注未闭合或包含多个前缀。');
        error.keleeStage = 'resource-conversion'; error.keleeLine = index + 1;
        error.keleeSection = section; error.keleeRule = line; throw error;
      }
      notes[index] = annotation.prefix;
      return annotation.body;
    }).join('\n');
    try {
      var dependencies = rewriteDependencies(normalizeConditionalRules(bare,originalURL),originalURL);
      var normalized = normalizeLoonScriptRules(normalizeSafeLoonRewritePatterns(dependencies));
      // All preceding transforms retain one line per input; expand logic LAST.
      var annotated = normalized.split('\n').map(function (line,index) { return notes[index] + line; }).join('\n');
      return normalizeLogicalRules(annotated,logicalDetails);
    } catch (error) {
      if (error && error.keleeLine) error.keleeRule = original[error.keleeLine - 1];
      throw error;
    }
  }

  function bodyProblem(response, kind) {
    var status = Number(response.statusCode || 0);
    if (status < 200 || status >= 300) return '上游 HTTP ' + status + '。请查看诊断的响应头与错误摘要，不能仅凭状态码确定拒绝原因。';
    var body = typeof response.body === 'string' ? response.body : '';
    if (!body.trim()) return '上游响应为空，未作为成功配置保存。';
    if (body.length > CONFIG.maxChars) return '响应超过本机适配脚本的大小限制。';
    if (/text\/html/i.test(header(response.headers,'content-type')) || /^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b|<script\b)/i.test(body)) return '上游返回 HTML 页面而非资源，可能是 block 或验证页面。';
    // U+FFFD can be intentional JavaScript data (e.g. an HTML entity table).
    // Keep strict config decoding checks, but do not reject valid JS literals.
    if (/\x00/.test(body) || (kind === 'resource' && /\ufffd/.test(body))) return '响应不是可识别的文本格式；本脚本不处理加密或二进制 LPX。';
    if (kind === 'resource' && !/^\s*\[(?:General|Rule|Rewrite|Script|Mitm|Argument|Host|URL Rewrite|Map Local)\]\s*$/im.test(body)) return '未识别到 Loon 文本配置区段；不把未知 LPX 格式当成可转换插件。';
    return null;
  }
  function messageOf(error) { return String(error && (error.message || error.error) || error || 'Unknown error'); }
  async function fetchAllowed(url, kind, ua, fetcher, accept) {
    var current = url.split('#')[0];
    for (var i = 0; i <= CONFIG.maxRedirects; i++) {
      if (!tools.allowed(current, kind)) throw new Error('目标不在允许的 kelee.one 插件/脚本资源范围内。');
      var response = await fetcher({url:current,method:'GET',headers:{
        'User-Agent':ua, 'Accept':typeof accept === 'string' ? accept : CONFIG.accept
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
    return page('本机下载服务已运行', '<p>当前后端版本：<strong>' + escapeHTML(CONFIG.version) + '</strong>。此页只证明后端可用，不代表原站下载成功。</p>' +
      '<p><a id="install-rewrite" class="button" href="' + escapeHTML(bootstrapImportURL()) + '">添加网页适配重写订阅到 QX</a></p>' +
      '<p>已有订阅不需要重加；替换脚本后更新一次现有网页适配订阅即可。</p>' +
      '<p><a href="' + CONFIG.backendOrigin + 'kelee-qx/rewrite.snippet">查看原生重写内容</a> · <a href="' + CONFIG.backendOrigin + 'kelee-qx/adapter.js">查看当前适配脚本</a></p>' +
      '<p>脚本提交的 UA：<code>' + escapeHTML(CONFIG.loonUA) + '</code></p>' +
      '<p>Accept：<code>' + escapeHTML(CONFIG.accept) + '</code>。不同 Kelee 路径可能采用不同访问控制；以当前资源/脚本的实际状态为准。</p>' +
      '<p><a class="button" href="' + escapeHTML(diagnostic) + '">检查 BlockAdvertisers 下载</a></p>' +
      '<form action="' + CONFIG.backendOrigin + 'kelee-qx/diagnose" method="get"><label for="resource-url">也可检查其他可莉插件原始地址：</label><br>' +
      '<input id="resource-url" name="url" type="url" required style="width:100%;box-sizing:border-box" value="' + escapeHTML(EXAMPLE) + '"><button type="submit">检查此资源</button></form>' +
      '<p><a href="' + escapeHTML(qx) + '">将 BlockAdvertisers 添加到 QX</a></p>' +
      '<p>诊断比较三组请求：A 旧 UA；B 公布的 UA（仅改 UA）；C 公布的 UA 加 Accept: */*。普通下载只用当前配置，不自动轮换 UA 或重试 403。</p>' +
      '<p>支持旧式 Loon 脚本及 URL 正则条件下的 script、reject、JSON jq/delete 和 response.json.replace。批量删除保持执行顺序，允许范围内的 Kelee JavaScript 依赖走本机后端；未支持的条件动作返回带插件名称、资源 URL、行号和原始规则的转换错误。JSON 规则仍需全局资源解析器。</p>' +
      '<p>纯域名 AND/OR 可转为 host-wildcard，保留原位置及 DIRECT/REJECT/PROXY 策略。两叶 URL-REGEX AND USER-AGENT REJECT 可转为 url-and-header，UA 限非空 ASCII 字面值和星号；插件内存在其他路由策略时不做该跨层转换。支持 TF 规则备注。任一逻辑无法转换时整份资源仍返回 422，日志附原始行号。</p>' +
      '<p>仍为 403 时，查看诊断页的响应摘要和可复制报告；不需要重复添加订阅。成功获取文本后仍需验证解析器兼容性。</p>');
  }
  /** Local report only. Never export cookies, Authorization, full plugin bodies or all headers. */
  function redact(value) {
    return String(value == null ? '' : value)
      .replace(/(https?:\/\/[^\s<>"'?]+)\?[^\s<>"']*/gi, '$1?[redacted]')
      .replace(/([?&]|\b)(token|access_token|api_key|apikey|key|secret|password|auth|authorization|cookie|session|signature|sig)(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s&<>;,]+)/gi, '$1$2$3[redacted]')
      .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]')
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP redacted]')
      .replace(/(?:[a-f0-9]{1,4}:){2,}[a-f0-9:]{0,39}/gi, '[IPv6 redacted]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email redacted]');
  }
  function safeURL(value) {
    var p = tools.parseURL(value);
    return p ? p.scheme + '://' + p.authority + p.path + (p.query ? '?[redacted]' : '') : '[invalid URL]';
  }
  function resourceRuleCounts(content) {
    var dsl = 0, scripts = 0, inComment = false;
    String(content || '').split('\n').forEach(function (line) {
      var text = line.trim();
      if (inComment) { if (text.indexOf('*/') !== -1) inComment = false; return; }
      if (/^\/\*/.test(text)) { inComment = text.indexOf('*/',2) === -1; return; }
      if (/^(?:#|;|\/\/)/.test(text)) return;
      text = ruleAnnotation(text).body.trim();
      if (/^(?:request|response)\s+if\b/i.test(text)) dsl++;
      if (/\surl\s+script-(?:request|response)-(?:body|header)\s/.test(text)) scripts++;
    });
    return {dsl:dsl, scripts:scripts};
  }
  function redactRule(value) {
    return redact(value)
      // Regex-escaped URL queries can contain arbitrary keys, not just token.
      // Hide the remainder conservatively in diagnostics; never edit the rule.
      .replace(/\\\?[\s\S]*/, '\\?[query and following text redacted]')
      // Unsupported DSL may contain credentials in header conditions.
      .replace(/(\$\{[^}\r\n]*\b(?:cookie|authorization|api[_-]?key|token|secret|password|session)[^}\r\n]*\}\s*(?:===?|!==?|~=|=~)\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,)]+)/gi, '$1"[redacted]"')
      // Cover JSON/object keys, including keys inside escaped string literals.
      .replace(/((?:\\?["'])(?:token|access_token|api_key|apikey|key|secret|password|auth|authorization|cookie|session|signature|sig)(?:\\?["'])\s*:\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,\s}\]]+)/gi, '$1"[redacted]"')
      // Regex literals escape assignments (e.g. token\=...), unlike URLs.
      .replace(/(\b(?:token|access_token|api_key|apikey|key|secret|password|auth|authorization|cookie|session|signature|sig)\\[=:])[^/\r\n]*/gi, '$1[redacted]');
  }
  function traceResource(stage, target, fetched, error, output, logicalDetails) {
    var source = fetched && fetched.url || target;
    var parsed = tools.parseURL(source);
    var filename = parsed ? parsed.path.split('/').pop() : 'Unknown';
    try { filename = decodeURIComponent(filename); } catch (_) {}
    var body = fetched && fetched.response && fetched.response.body || '';
    var name = body.match(/^\s*#!name\s*=\s*([^\r\n]*)/im);
    var record = {version:CONFIG.version,stage:stage,
      plugin:redact(name && name[1].trim() || filename).slice(0,160),
      filename:redact(filename).slice(0,160),
      source:safeURL(target),finalSource:safeURL(source)};
    if (fetched) record.upstreamStatus = Number(fetched.response.statusCode || 0);
    if (typeof output === 'string') {
      var before = resourceRuleCounts(body), after = resourceRuleCounts(output);
      record.inputDSL = before.dsl;
      record.convertedDSL = before.dsl - after.dsl;
      record.remainingDSL = after.dsl;
      record.scriptRules = after.scripts;
    }
    if (Array.isArray(logicalDetails) && logicalDetails.length) {
      record.inputLogical = logicalDetails.length;
      record.convertedLogical = logicalDetails.filter(function (entry) { return entry.status === 'converted'; }).length;
      record.pendingLogical = record.inputLogical - record.convertedLogical;
      record.logicalState = record.pendingLogical ? 'rejected' : 'matching-set-converted';
      record.pendingLogicalExamples = logicalDetails.filter(function (entry) { return entry.status !== 'converted'; }).slice(0,10).map(function (entry) {
        return {line:entry.line,reason:redact(entry.reason),rule:redactRule(entry.rule).slice(0,2048)};
      });
    }
    if (error) {
      record.reason = redact(messageOf(error));
      if (error.keleeLine) {
        record.line = error.keleeLine;
        record.section = error.keleeSection;
        var rule = redactRule(error.keleeRule || '');
        record.truncated = rule.length > 2048;
        record.rule = rule.slice(0,2048);
      }
    }
    // Same structured record goes to QX logs and, on conversion failure,
    // the HTTP error body. Never log the entire plugin or URL query secrets.
    try {
      if (typeof console !== 'undefined' && typeof console.log === 'function')
        console.log('[Kelee-QX ' + CONFIG.version + '] ' + JSON.stringify(record));
    } catch (_) { /* Diagnostic logging must never change a resource response. */ }
    return record;
  }
  function selectedHeaders(headers) {
    var result = {};
    ['content-type','server','cf-ray','cf-mitigated','retry-after'].forEach(function (name) {
      var value = header(headers, name);
      if (value) result[name] = redact(value).slice(0,256);
    });
    return result;
  }
  function errorExcerpt(body) {
    // Limit inspection and output. Strip scripts/styles before stripping HTML tags.
    return redact(String(body || '').slice(0,32768)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,' ')
      .replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()).slice(0,900);
  }
  function responseEvidence(response, kind) {
    var problem = bodyProblem(response, kind);
    var code = Number(response.statusCode || 0);
    var classification;
    // A Cloudflare Server or CF-Ray header alone does NOT prove a bot challenge.
    if (header(response.headers, 'cf-mitigated').toLowerCase() === 'challenge') classification = 'challenge-evidence';
    else if (code === 401 || code === 403) classification = 'http-denied';
    else if (code === 429) classification = 'rate-limited';
    else if (code < 200 || code >= 300) classification = 'http-error';
    else if (problem && /HTML/.test(problem)) classification = 'unexpected-html';
    else if (problem) classification = 'unrecognized-content';
    else classification = kind === 'resource' ? 'text-plugin' : 'script-text-unvalidated';
    return {status:code, classification:classification, problem:problem,
      responseHeaders:selectedHeaders(response.headers),
      length:typeof response.body === 'string' ? response.body.length : 0,
      errorExcerpt:problem ? errorExcerpt(response.body) : ''};
  }
  function responseError(fetched, kind, ua) {
    var evidence = responseEvidence(fetched.response, kind);
    var upstream = Number(fetched.response.statusCode || 0);
    var isHTTPError = upstream >= 400 && upstream <= 599;
    var stage = isHTTPError ? 'upstream-http' : 'resource-validation';
    var report = {version:CONFIG.version, stage:stage, target:safeURL(fetched.url),
      requestedUserAgent:ua, requestedAccept:CONFIG.accept, evidence:evidence};
    var r = reply(isHTTPError ? upstream : 502, 'Kelee-QX 下载失败\n' +
      evidence.problem + '\n\n' + JSON.stringify(report,null,2) +
      '\n\n打开本机 health 页进行诊断。403/429 不会自动重试，错误内容不会冒充成功配置。');
    r.headers['X-Kelee-QX-Upstream-Status'] = String(upstream);
    r.headers['X-Kelee-QX-Stage'] = stage;
    console.log('[Kelee-QX ' + CONFIG.version + '] ' + stage + ' upstream=' + upstream + ' ' + safeURL(fetched.url));
    return r;
  }
  async function diagnose(url, fetcher) {
    var profiles = [
      {label:'A · 旧版 UA（对照）',ua:'Loon/3.5.1',accept:CONFIG.accept},
      {label:'B · 公布的完整 UA（当前下载配置）',ua:CONFIG.loonUA,accept:CONFIG.accept},
      {label:'C · 完整 UA + Accept: */*',ua:CONFIG.loonUA,accept:'*/*'}
    ];
    var rows = await Promise.all(profiles.map(async function (item) {
      var start = Date.now();
      try {
        var fetched = await fetchAllowed(url,'resource',item.ua,fetcher,item.accept);
        var evidence = responseEvidence(fetched.response,'resource');
        evidence.label = item.label;
        evidence.ua = item.ua;
        evidence.accept = item.accept;
        evidence.elapsedMs = Date.now() - start;
        evidence.finalURL = safeURL(fetched.url);
        return evidence;
      } catch (error) {
        return {label:item.label,ua:item.ua,accept:item.accept,status:0,
          elapsedMs:Date.now()-start,classification:'transport-or-redirect-error',
          responseHeaders:{},length:0,problem:redact(messageOf(error)),errorExcerpt:''};
      }
    }));
    var report = {version:CONFIG.version,generatedAt:new Date().toISOString(),target:safeURL(url),rows:rows};
    var content = '<p>A → B 仅改变 UA；B → C 仅改变 Accept。B 是当前正常资源下载使用的配置。</p>' +
      '<p>目标：</p><pre>' + escapeHTML(safeURL(url)) + '</pre><table><tr><th>请求</th><th>状态</th><th>内容检查</th></tr>';
    rows.forEach(function (r) {
      content += '<tr><td>' + escapeHTML(r.label) + '</td><td>' + escapeHTML(r.status || '请求失败') + '</td><td>' +
        escapeHTML(r.problem || '识别到文本插件；尚未验证 QX 转换') + '<br><small>' + r.length + ' 字符 · ' + r.elapsedMs + ' ms</small></td></tr>';
    });
    content += '</table>';
    rows.forEach(function (r) {
      content += '<details><summary>' + escapeHTML(r.label) + ' · 请求/响应详情</summary><pre>' + escapeHTML(JSON.stringify(r,null,2)) + '</pre></details>';
    });
    content += '<p><strong>判断：</strong>B 返回 200 且识别到文本插件后，在 QX 更新原来失败的那条插件资源即可，不需要重新添加。' +
      '若只有 C 成功，可把脚本顶部 <code>CONFIG.accept</code> 改为 <code>"*/*"</code>，保存并重载后再更新资源。</p>' +
      '<p>B/C 都为 403 时，请看响应详情。<code>server=cloudflare</code> 本身不能证明是验证码；只有明确的 challenge 标志才标记为 challenge-evidence。' +
      '更换 UA 不等于模拟 Cookie、TLS 指纹或登录授权；不要反复点更新。</p>' +
      '<p>下方是当前这次结果的脱敏报告；长按全选复制即可，不会再次请求原站。已排除 Cookie 和 Authorization 响应头，分享前仍请检查摘要是否含个人信息。</p>' +
      '<textarea id="kelee-qx-report" readonly rows="16" style="width:100%;box-sizing:border-box;font:12px monospace">' + escapeHTML(JSON.stringify(report,null,2)) + '</textarea>' +
      '<p>HTTP 200 不等于插件可用：正文须为文本配置，之后还要通过解析器和依赖检查。</p>' +
      '<p><a href="' + escapeHTML(tools.toQX('loon://import?plugin=' + url)) + '">添加到 Quantumult X</a> · <a href="' + CONFIG.backendOrigin + 'kelee-qx/health">返回检查页</a></p>';
    return reply(200,page('资源下载诊断',content),'text/html');
  }
  async function backendResponse(request, fetcher) {
    var p = tools.parseURL(request.url);
    if (!p || !/^http$/.test(p.scheme) || !/^(?:127\.0\.0\.1|localhost|quantumult-x):[0-9]+$/.test(p.authority)) return reply(400,'Only local backend URLs are accepted.');
    var method = String(request.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return reply(405,'Only GET and HEAD are supported.');
    var localResult = null;
    if (p.path === '/kelee-qx/health') localResult = reply(200,healthPage(),'text/html');
    else if (p.path === '/kelee-qx/rewrite.snippet') localResult = reply(200,remoteSnippet(),'text/plain');
    else if (p.path === '/kelee-qx/adapter.js') localResult = reply(200,adapterSource(),'application/javascript');
    if (localResult) {
      if (method === 'HEAD') localResult.body = '';
      return localResult;
    }
    // HEAD never initiates an upstream resource download or diagnostic.
    if (method === 'HEAD') return reply(405,'Use GET for resource downloads and diagnostics.');
    var kind = p.path === '/kelee-qx/asset.js' ? 'asset' : p.path === '/kelee-qx/resource' || p.path === '/kelee-qx/diagnose' ? 'resource' : null;
    if (!kind) return reply(404,'Unknown local backend route.');
    var target = queryValue(request.url,'url');
    if (!target || !tools.allowed(target,kind)) return reply(400,'目标不在允许的 kelee.one 插件/脚本资源范围内。');
    if (typeof fetcher !== 'function') return reply(502,'QX $task.fetch 不可用。请检查 http_backend 配置。');
    if (p.path === '/kelee-qx/diagnose') return diagnose(target,fetcher);
    traceResource('download-start',target);
    try {
      var fetched = await fetchAllowed(target,kind,CONFIG.loonUA,fetcher);
      var problem = bodyProblem(fetched.response,kind);
      if (problem) return responseError(fetched,kind,CONFIG.loonUA);
      var logicalDetails = [];
      var content = kind === 'resource' ? prepareResourceContent(fetched.response.body,fetched.url,logicalDetails) : fetched.response.body;
      var pending = logicalDetails.filter(function (entry) { return entry.status !== 'converted'; });
      if (pending.length) {
        var first = pending[0], error = new Error('第 ' + first.line + ' 行 [rule]：尚有 ' + pending.length +
          ' 条逻辑规则无法等价转换，拒绝提供部分配置。' + first.reason);
        error.keleeStage = 'resource-conversion'; error.keleeLine = first.line;
        error.keleeSection = '[rule]'; error.keleeRule = first.rule; throw error;
      }
      var success = reply(200,content,kind === 'asset' ? 'application/javascript' : 'text/plain');
      success.headers['X-Kelee-QX-Upstream-Status'] = String(fetched.response.statusCode);
      success.headers['X-Kelee-QX-Stage'] = kind === 'resource' ? 'ready-for-parser' : 'script-downloaded';
      if (kind === 'resource') success.headers['X-Kelee-QX-Conversion'] = 'ready-for-parser';
      traceResource(success.headers['X-Kelee-QX-Stage'],target,fetched,null,kind === 'resource' ? content : undefined,logicalDetails);
      return success;
    } catch (error) {
      if (error && error.keleeStage === 'resource-conversion') {
        var record = traceResource('resource-conversion',target,fetched,error,undefined,logicalDetails);
        var conversion = reply(422,'Kelee-QX 资源转换失败\n' + redact(messageOf(error)) +
          '\n插件：' + record.plugin + ' (' + record.filename + ')' +
          '\n资源：' + record.finalSource + '\n后端版本：' + CONFIG.version +
          '\n原始规则' + (record.truncated ? '（已截断，完整行请查看原始插件）' : '') + '：\n' + record.rule +
          '\n\n诊断报告（与 QX 日志相同）：\n' + JSON.stringify(record,null,2) +
          '\n未返回部分成功配置。请保留原配置，反馈时附上这份诊断报告。');
        conversion.headers['X-Kelee-QX-Stage'] = 'resource-conversion';
        conversion.headers['X-Kelee-QX-Conversion'] = 'rejected';
        conversion.headers['X-Kelee-QX-Upstream-Status'] = String(record.upstreamStatus || 0);
        return conversion;
      }
      traceResource('transport',target,fetched,error);
      var failure = reply(502,'Kelee-QX 请求未完成（网络或重定向校验失败）：' + redact(messageOf(error)));
      failure.headers['X-Kelee-QX-Stage'] = 'transport';
      return failure;
    }
  }

  var exportsAPI = {
    CONFIG: CONFIG, toQX:tools.toQX, extractPlugin:tools.extractPlugin,
    patchPrefixes:patchPrefixes, rewriteResponse:rewriteResponse,
    rewriteDependencies:rewriteDependencies, normalizeConditionalRules:normalizeConditionalRules, normalizeLoonScriptRules:normalizeLoonScriptRules, normalizeSafeLoonRewritePatterns:normalizeSafeLoonRewritePatterns, prepareResourceContent:prepareResourceContent, backendResponse:backendResponse,
    bodyProblem:bodyProblem, browserHelper:browserHelper, createLinkTools:createLinkTools,
    remoteSnippet:remoteSnippet, adapterSource:adapterSource, bootstrapImportURL:bootstrapImportURL
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
