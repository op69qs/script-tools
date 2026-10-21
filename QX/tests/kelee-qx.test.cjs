const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const api = require('../kelee-qx.js');
const sourceURL = 'https://kelee.one/Tool/Loon/Lpx/Example.lpx';
const atom = (kind, value) => ({kind, value});
const and = (...children) => ({kind:'AND', children});
const or = (...children) => ({kind:'OR', children});
const render = node => node.children
  ? node.kind + ', (' + node.children.map(child=>'('+render(child)+')').join(', ') + ')'
  : node.kind + ', ' + node.value;
function evaluate(node, host) {
  host=host.toLowerCase();
  if(node.kind==='AND')return node.children.every(child=>evaluate(child,host));
  if(node.kind==='OR')return node.children.some(child=>evaluate(child,host));
  const value=node.value.toLowerCase();
  if(node.kind==='DOMAIN')return host===value;
  if(node.kind==='DOMAIN-SUFFIX')return host===value || host.endsWith('.'+value);
  if(node.kind==='DOMAIN-KEYWORD')return host.includes(value);
  throw new Error('unknown oracle atom');
}
function globMatch(pattern, host) {
  const escaped=pattern.split('*').map(part=>part.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&')).join('.*');
  return new RegExp('^'+escaped+'$','i').test(host);
}
function converted(node, policy='REJECT') {
  const input='[Rule]\n'+render(node)+', '+policy;
  const result=api.prepareResourceContent(input,sourceURL);
  assert.ok(!/^(?:AND|OR),/m.test(result),'supported logical rule must be converted');
  const rules=result.split('\n').filter(line=>/^host-wildcard,/i.test(line)).map(line=>line.split(',').map(s=>s.trim()));
  for(const rule of rules)assert.equal(rule[2],policy);
  return {result,rules};
}
function check(node, hosts) {
  const {rules}=converted(node);
  for(const host of hosts)assert.equal(rules.some(rule=>globMatch(rule[1],host)),evaluate(node,host),host);
}
test('domain keyword and suffix keep both conditions and the suffix boundary',()=>{
  check(and(atom('DOMAIN-KEYWORD','-ad-'),atom('DOMAIN-SUFFIX','byteimg.com')),
    ['-ad-.byteimg.com','foo-ad-bar.byteimg.com','a.foo-ad-bar.byteimg.com','byteimg.com',
      'foo-ad-byteimg.com','-ad-.byteimg.com.evil','foo.byteimg.com','FOO-AD-BAR.BYTEIMG.COM']);
});
test('keyword intersection includes overlapping matches in either order',()=>{
  const node=and(atom('DOMAIN-KEYWORD','aba'),atom('DOMAIN-KEYWORD','bab'));
  check(node,['abab','baba','aba-bab','bab-aba','ababa','babab','aba','bab','abba','prefix.abab.test']);
});
test('keyword may overlap the domain suffix itself',()=>{
  check(and(atom('DOMAIN-KEYWORD','m.ex'),atom('DOMAIN-SUFFIX','example.com')),
    ['m.example.com','example.com','x.m.example.com','m.exexample.com','m.ex.example.com','example.com.m.ex']);
});
test('suffix includes its root when that root satisfies the keyword',()=>{
  check(and(atom('DOMAIN-KEYWORD','example'),atom('DOMAIN-SUFFIX','example.com')),
    ['example.com','a.example.com','notexample.com','example.com.evil','EXAMPLE.COM']);
});
test('adash and ut.taobao.com remain a conjunction',()=>{
  check(and(atom('DOMAIN-KEYWORD','adash'),atom('DOMAIN-SUFFIX','ut.taobao.com')),
    ['adash.ut.taobao.com','a.adash.ut.taobao.com','adash.taobao.com','ut.taobao.com',
      'adashut.taobao.com','adash.ut.taobao.com.evil']);
});
test('nested AND/OR retains DIRECT and the complete domain union',()=>{
  const node=and(atom('DOMAIN-KEYWORD','tnc'),or(...['capcutapi.com','zijieapi.com','isnssdk.com','toutiaoapi.com',
    'bytedance.com','snssdk.com','sgsnssdk.com'].map(value=>atom('DOMAIN-SUFFIX',value))));
  const {rules}=converted(node,'DIRECT');
  for(const host of ['tnc.capcutapi.com','x.tnc.snssdk.com','tnc.sgsnssdk.com','tnc.example.com',
    'capcutapi.com','tnc-capcutapi.com','tnc.zijieapi.com.evil'])
    assert.equal(rules.some(rule=>globMatch(rule[1],host)),evaluate(node,host),host);
});
test('both keyword orders and repeated keyword atoms retain intersection semantics',()=>{
  const node=and(atom('DOMAIN-KEYWORD','ads'),atom('DOMAIN-KEYWORD','-normal.zijieapi.com'),atom('DOMAIN-KEYWORD','ads'));
  check(node,['ads-normal.zijieapi.com','x-normal.zijieapi.com.ads','ads.example.com','x-normal.zijieapi.com',
    'ads-normal.zijieapi.com.evil']);
});
test('DOMAIN and nested suffix constraints do not broaden exact matches',()=>{
  check(and(atom('DOMAIN','api.example.com'),or(atom('DOMAIN-SUFFIX','example.com'),atom('DOMAIN','elsewhere'))),
    ['api.example.com','API.EXAMPLE.COM','sub.api.example.com','example.com','elsewhere']);
});
test('contradictory domain intersection matches nothing',()=>{
  const node=and(atom('DOMAIN','one.example'),atom('DOMAIN','two.example'));
  check(node,['one.example','two.example','one.example.two.example','']);
});
test('short alphabet exhaustive oracle catches epsilon and overlapping glob paths',()=>{
  const words=['a','b','aa','ab','ba','aba','bab','aab'];
  let hosts=[''];
  for(let length=1;length<=7;length++) {
    const current=[];
    for(let mask=0;mask<(1<<length);mask++)current.push(Array.from({length},(_,i)=>mask&(1<<i)?'a':'b').join(''));
    hosts.push(...current);
  }
  for(const a of words)for(const b of words)
    check(and(atom('DOMAIN-KEYWORD',a),atom('DOMAIN-KEYWORD',b)),hosts);
});
test('expansion stays at the original position and keeps the surrounding policy order',()=>{
  const input='[Rule]\nDOMAIN, before.example, DIRECT\n'+render(and(atom('DOMAIN-KEYWORD','ad'),atom('DOMAIN-SUFFIX','example.com')))+
    ', REJECT\nDOMAIN-SUFFIX, example.com, DIRECT\n';
  const result=api.prepareResourceContent(input,sourceURL),lines=result.split('\n');
  assert.ok(lines.indexOf('DOMAIN, before.example, DIRECT') < lines.findIndex(line=>/^host-wildcard,/.test(line)));
  assert.ok(lines.findLastIndex(line=>/^host-wildcard,/.test(line)) < lines.indexOf('DOMAIN-SUFFIX, example.com, DIRECT'));
});
for(const rule of [
  'AND, ((DOMAIN-SUFFIX, example.com), (PROTOCOL, QUIC)), REJECT',
  'AND, ((URL-REGEX, ^http:\\/\\/dns\\.example\\/d\\?), (USER-AGENT, App*)), DIRECT',
  'AND, ((URL-REGEX, "^http:\\/\\/dns\\.example\\/d\\?"), (USER-AGENT, "*App*")), PROXY',
  'NOT, ((DOMAIN, example.com)), REJECT',
  'AND, ((DOMAIN, *.example.com), (DOMAIN-KEYWORD, ad)), REJECT',
  'AND, ((DOMAIN-KEYWORD, "a?b"), (DOMAIN-SUFFIX, example.com)), REJECT',
  'AND, ((DOMAIN, example.com), (DOMAIN, example.com)), REJECT, no-resolve',
  'AND, ((DOMAIN, example.com), (DOMAIN-SUFFIX, example.com)), DIRECT garbage',
  'AND, ((DOMAIN, example.com), (DOMAIN-SUFFIX, example.com)),',
  'AND, ((DOMAIN, example.com), (DOMAIN-SUFFIX, example.com)), "DIRECT, REJECT"'
])test('unproven or malformed logical syntax remains an explicitly incomplete resource: '+rule,()=>{
  const details=[],input='[Rule]\n'+rule;
  const result=api.prepareResourceContent(input,sourceURL,details);
  assert.equal(result,input);
  assert.equal(details.length,1);
  assert.equal(details[0].status,'unsupported');
  assert.ok(details[0].reason);
});
test('large boolean expansion is rejected atomically instead of returning a subset',()=>{
  const node=and(atom('DOMAIN-KEYWORD','ad'),or(...Array.from({length:300},(_,i)=>atom('DOMAIN','ad'+i+'.example'))));
  const details=[],input='[Rule]\n'+render(node)+', REJECT';
  assert.equal(api.prepareResourceContent(input,sourceURL,details),input);
  assert.equal(details[0].status,'unsupported');
});
test('state-space limits also guard short inputs with a large intersection language',()=>{
  const node=and(or(...Array.from({length:16},(_,i)=>atom('DOMAIN-KEYWORD','a'+i))),
    or(...Array.from({length:17},(_,i)=>atom('DOMAIN-KEYWORD','b'+i))));
  const details=[],input='[Rule]\n'+render(node)+', REJECT';
  assert.equal(api.prepareResourceContent(input,sourceURL,details),input);
  assert.equal(details[0].status,'unsupported');
});
test('resource-wide budgets stop repeated individually valid expansions',()=>{
  const rules=Array.from({length:700},(_,i)=>
    render(and(atom('DOMAIN-KEYWORD','ad'),atom('DOMAIN','ad'+i+'.example')))+', REJECT');
  const details=[],result=api.prepareResourceContent('[Rule]\n'+rules.join('\n'),sourceURL,details);
  assert.equal(details.length,rules.length);
  assert.ok(details.some(entry=>entry.status==='converted'));
  assert.ok(details.some(entry=>entry.status==='unsupported'));
  const firstPending=details.findIndex(entry=>entry.status==='unsupported');
  assert.ok(details.slice(firstPending).every(entry=>entry.status==='unsupported'));
  for(let i=firstPending;i<rules.length;i++)assert.ok(result.includes(rules[i]));
});
test('comments and non-rule sections are not interpreted as logical rules',()=>{
  const input='/*\n[Rule]\nAND, ((DOMAIN, a), (DOMAIN, b)), REJECT\n*/\n[Script]\n# AND, ((DOMAIN, a), (DOMAIN, b)), REJECT\n';
  assert.equal(api.prepareResourceContent(input,sourceURL),input);
});
test('expanded logical rules do not shift an unsupported DSL source line in diagnostics',()=>{
  const input='[Rule]\n'+render(and(atom('DOMAIN-KEYWORD','ads'),atom('DOMAIN-KEYWORD','normal')))+', REJECT\n'+
    '[Rewrite]\nrequest if ${url} ~= /^https:\\/\\/example\\.com/ then unknown()';
  assert.throws(()=>api.prepareResourceContent(input,sourceURL),error=>error.keleeLine===4);
});
test('backend rejects unconverted logical rules and logs their original source line',async()=>{
  const body='#!name=example\n[Rule]\nAND, ((DOMAIN, example.com), (PROTOCOL, QUIC)), REJECT';
  const logs=[],context={module:{exports:{}},console:{log:value=>logs.push(value)}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','kelee-qx.js'),'utf8'),context);
  const response=await context.module.exports.backendResponse({url:'http://127.0.0.1:9999/kelee-qx/resource?url='+encodeURIComponent(sourceURL)},
    async()=>({statusCode:200,headers:{},body}));
  assert.match(response.status,/422/);
  assert.equal(response.headers['X-Kelee-QX-Conversion'],'rejected');
  const record=logs.map(value=>String(value)).find(value=>value.includes('"pendingLogical":1'));
  assert.ok(record && record.includes('"line":3') && record.includes('QUIC'));
});
test('pending logical diagnostics redact credentials before logging',async()=>{
  const body='[Rule]\nAND, ((URL-REGEX, "^https:\\/\\/dns\\.example\\/api?token=private-token"), (USER-AGENT, App*)), DIRECT';
  const logs=[],context={module:{exports:{}},console:{log:value=>logs.push(value)}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','kelee-qx.js'),'utf8'),context);
  await context.module.exports.backendResponse({url:'http://127.0.0.1:9999/kelee-qx/resource?url='+encodeURIComponent(sourceURL)},
    async()=>({statusCode:200,headers:{},body}));
  assert.ok(logs.some(value=>String(value).includes('pendingLogicalExamples')));
  assert.ok(!logs.some(value=>String(value).includes('private-token')));
});
test('regex query diagnostics hide arbitrary query values in a rejected resource',async()=>{
  const body='[Rule]\nAND, ((URL-REGEX, ^https:\\/\\/example\\.com\\/callback\\?code=OAUTH_SECRET&opaque=OTHER_SECRET), (USER-AGENT, App*)), DIRECT';
  const logs=[],context={module:{exports:{}},console:{log:value=>logs.push(value)}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','kelee-qx.js'),'utf8'),context);
  const response=await context.module.exports.backendResponse({url:'http://127.0.0.1:9999/kelee-qx/resource?url='+encodeURIComponent(sourceURL)},
    async()=>({statusCode:200,headers:{},body}));
  assert.match(response.status,/422/);
  assert.ok(!/OAUTH_SECRET|OTHER_SECRET/.test(response.body));
  assert.ok(!logs.some(value=>/OAUTH_SECRET|OTHER_SECRET/.test(String(value))));
});
test('Spotify-style URL replacement diagnoses the connection-target gap',()=>{
  const input='[Rewrite]\nrequest if ${url} ~= /^https:\\/\\/(?:a|b)\\.example\\/artist\\/(.*)&platform=iphone/i as match then '+
    'url.replace("https://b.example/artist/${match.1}&platform=ipad")';
  assert.throws(()=>api.prepareResourceContent(input,sourceURL),error=>/目标主机|连接目标/.test(error.message) && error.keleeLine===2);
});
test('remoteSnippet stays byte-identical to the stable v1.5.0 bootstrap',()=>{
  assert.equal(api.remoteSnippet(),[
    '# Kelee-QX - native Quantumult X rewrite resource',
    '# Import this resource with opt-parser=false; retain the http_backend bootstrap.',
    '# The script URL is served by the same independently configured local backend.',
    'hostname = hub.kelee.one','',
    /^https:\/\/hub\.kelee\.one\/__qx_kelee__\/(?:import|status)(?:\?|$)/.source+' url script-echo-response http://127.0.0.1:9999/kelee-qx/adapter.js',
    /^https:\/\/hub\.kelee\.one\/(?!__qx_kelee__\/)/.source+' url script-response-body http://127.0.0.1:9999/kelee-qx/adapter.js',''
  ].join('\n'));
});
