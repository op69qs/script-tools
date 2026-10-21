const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const api=require('../kelee-qx.js');
const target='https://kelee.one/Tool/Loon/Lpx/Example.lpx';
const url=String.raw`^http:\/\/192\.0\.2\.1\/d(\d)?\?`;
function input(pattern=url,ua='*com.example.app*',reverse=false,policy='REJECT') {
  const leaves=['(URL-REGEX, "'+pattern+'")','(USER-AGENT, "'+ua+'")'];
  if(reverse)leaves.reverse();
  return 'AND, ('+leaves.join(', ')+'), '+policy;
}
function compile(rule,extra='') {
  const details=[],output=api.prepareResourceContent('[Rule]\n'+rule+extra,target,details);
  const line=output.split('\n').find(line=>line.includes(' url-and-header '));
  assert.ok(line,'expected one native URL AND header rule');
  const match=line.match(/^(\S+) (\S+) url-and-header (reject-200)$/);
  assert.ok(match,'native tokens must not be split by spaces in a pattern');
  assert.equal(details[0].status,'converted');
  assert.equal(details[0].mechanism,'url-and-header');
  return {output,line,pattern:match[1],header:match[2],
    matches:(u,h)=>new RegExp(match[1]).test(u) && new RegExp(match[2]).test(h)};
}
const headers=value=>'GET /d? HTTP/1.1\r\nHost: 192.0.2.1\r\nUser-Agent: '+value+'\r\nAccept: */*\r\n';

test('URL and UA must both match, including IPv4 and IPv6 source patterns',()=>{
  for(const [pattern,good,bad] of [
    [url,'http://192.0.2.1/d1?x=1','http://192.0.2.2/d1?x=1'],
    [String.raw`^http:\/\/\[[0-9a-fA-F:]+\]\/d(\d)?\?`,'http://[2001:db8::1]/d?x=1','http://[2001:db8::1]/other?x=1']
  ]) {
    const {matches}=compile(input(pattern));
    for(const [u,urlOK] of [[good,true],[bad,false]])
      for(const [ua,uaOK] of [['Client/com.example.app/1',true],['Other/1',false]])
        assert.equal(matches(u,headers(ua)),urlOK && uaOK);
  }
});
test('matching is confined to the complete User-Agent field',()=>{
  const {matches}=compile(input()),u='http://192.0.2.1/d?x=1';
  for(const h of [
    'GET /com.example.app HTTP/1.1\r\nHost: example.com\r\n',
    'GET / HTTP/1.1\r\nX-User-Agent: com.example.app\r\n',
    'GET / HTTP/1.1\r\nCookie: User-Agent: com.example.app\r\n',
    'GET / HTTP/1.1\r\nUser-Agent: Other\r\nX-Note: com.example.app\r\n',
    'GET / HTTP/1.1\r\nUser-Agent: com.example.\r\napp\r\n'
  ])assert.equal(matches(u,h),false,h);
  for(const key of ['user-agent','USER-AGENT','uSeR-aGeNt'])
    assert.equal(matches(u,'GET / HTTP/1.1\r\n'+key+':\tcom.example.app\r\n'),true);
});
test('UA glob compilation preserves literal case and escapes regex punctuation',()=>{
  const {matches}=compile(input(url,'App/1.0 (a+b)[x]*'));
  assert.equal(matches('http://192.0.2.1/d?',headers('App/1.0 (a+b)[x]Zrest')),true);
  assert.equal(matches('http://192.0.2.1/d?',headers('App/1x0 (a+b)[x]Zrest')),false);
  assert.equal(matches('http://192.0.2.1/d?',headers('app/1.0 (a+b)[x]Zrest')),false);
  // This specifies literal-case compilation, not unobserved Loon engine behavior.
});
test('exact UA patterns do not become substring matches',()=>{
  const {matches}=compile(input(url,'Example'));
  for(const value of ['xExample','Examplex','xExamplex'])
    assert.equal(matches('http://192.0.2.1/d?',headers(value)),false);
  assert.equal(matches('http://192.0.2.1/d?',headers('Example')),true);
});
test('swapped leaves and quoted commas retain simultaneous matching',()=>{
  const first=compile(input(url,'App,Name*'));
  const second=compile(input(url,'App,Name*',true));
  assert.equal(first.line,second.line);
  assert.equal(first.matches('http://192.0.2.1/d?',headers('App,Name/1')),true);
});
test('the URL anchor and capture numbering survive native compilation',()=>{
  const {pattern,matches}=compile(input());
  assert.equal(new RegExp(pattern).exec('http://192.0.2.1/d7?')[1],'7');
  assert.equal(matches('https://elsewhere/?http://192.0.2.1/d?',headers('com.example.app')),false);
});
test('TF notes and original line metadata survive conversion',()=>{
  const details=[],rule='{# HTTP conjunction #} '+input();
  const result=api.prepareResourceContent('# comment\n[Rule]\n'+rule,target,details);
  assert.match(result,/^\{# HTTP conjunction #\} .* url-and-header reject-200$/m);
  assert.equal(details[0].line,3);
  assert.equal(details[0].rule,rule);
});
test('a complete supported resource is delivered through the real backend path',async()=>{
  const response=await api.backendResponse({url:'http://127.0.0.1:9999/kelee-qx/resource?url='+encodeURIComponent(target)},
    async()=>({statusCode:200,headers:{},body:'[Rule]\n'+input()}));
  assert.match(response.status,/200/);
  assert.match(response.body,/ url-and-header reject-200/);
});
test('all-reject resources retain the new HTTP rule among other filters',()=>{
  const {output}=compile(input(),'\nDOMAIN, ads.example.com, REJECT\nIP-CIDR, 192.0.2.0/24, REJECT');
  assert.ok(output.includes('DOMAIN, ads.example.com, REJECT'));
  assert.ok(output.includes('IP-CIDR, 192.0.2.0/24, REJECT'));
});
for(const extra of [
  'DOMAIN, example.com, DIRECT',
  'IP-CIDR, 192.0.2.0/24, DIRECT',
  'URL-REGEX, ^http://192, PROXY',
  'USER-AGENT, Other*, SomePolicy',
  'AND, ((DOMAIN, a), (DOMAIN-SUFFIX, b)), DIRECT'
])test('non-reject filters are respected before and after HTTP logic: '+extra,()=>{
  for(const body of ['[Rule]\n'+extra+'\n'+input(),'[Rule]\n'+input()+'\n'+extra]) {
    const details=[],out=api.prepareResourceContent(body,target,details);
    assert.ok(out.includes(input()));
    assert.ok(details.some(entry=>entry.rule===input() && entry.status==='unsupported'));
    assert.ok(!out.includes(' url-and-header '));
  }
});
test('comments and non-rule sections do not create false routing conflicts',()=>{
  const body='[Rule]\n# DOMAIN, a, DIRECT\n/*\nIP-CIDR, 0.0.0.0/0, DIRECT\n*/\n'+input()+
    '\n[Argument]\nnote=DOMAIN, a, DIRECT';
  assert.match(api.prepareResourceContent(body,target),/ url-and-header reject-200/);
});
test('strict mode keeps QUIC pending and DIRECT conjunctions cannot be omitted',async()=>{
  const previous=api.CONFIG.omitDomainQuicReject;
  api.CONFIG.omitDomainQuicReject=false;
  try {
  const body='[Rule]\n'+input()+'\nAND, ((DOMAIN, api.example.com), (PROTOCOL, QUIC)), REJECT';
  const details=[],prepared=api.prepareResourceContent(body,target,details);
  assert.match(prepared,/ url-and-header reject-200/);
  assert.equal(details[1].status,'unsupported');
  const response=await api.backendResponse({url:'http://127.0.0.1:9999/kelee-qx/resource?url='+encodeURIComponent(target)},
    async()=>({statusCode:200,headers:{},body}));
  assert.match(response.status,/422/);
  assert.match(response.body,/"pendingLogical":\s*1/);
  const direct='[Rule]\n'+input(url,'App*',false,'DIRECT');
  assert.equal(api.prepareResourceContent(direct,target),direct);
  }finally{api.CONFIG.omitDomainQuicReject=previous;}
});
test('unverified UA encoding and escape forms remain explicit failures',()=>{
  for(const ua of ['%E5%98%80*','中文*',String.raw`App\*`,'','*','**','App?',' * ']) {
    const body='[Rule]\n'+input(url,ua),details=[];
    assert.equal(api.prepareResourceContent(body,target,details),body);
    assert.equal(details[0].status,'unsupported');
  }
});
test('the self-contained adapter served to QX includes the new compiler',()=>{
  const context={module:{exports:{}},console:{log(){}}};
  vm.runInNewContext(api.adapterSource(),context);
  const deployed=context.module.exports;
  assert.equal(deployed.prepareResourceContent('[Rule]\n'+input(),target),
    api.prepareResourceContent('[Rule]\n'+input(),target));
  assert.match(deployed.prepareResourceContent('[Rule]\n'+input(),target),/ url-and-header reject-200/);
});
test('upstream KOP preserves both native predicates and notes', {skip:!process.env.KELEE_KOP_SOURCE},()=>{
  const source=fs.readFileSync(path.resolve(process.env.KELEE_KOP_SOURCE),'utf8');
  const content=api.prepareResourceContent('[Rule]\n{# both conditions #} '+input(),target);
  let result;const notices=[];
  vm.runInNewContext(source,{$resource:{link:target,type:'rewrite',tag:'Conjunction',content},
    $environment:{version:'Quantumult X 1.9.0 build 953'},$done:value=>result=value,
    $notify:(...args)=>notices.push(args),console:{log(){}}},{timeout:5000});
  const native=content.split('\n').find(line=>line.includes(' url-and-header '));
  assert.ok(native);
  assert.ok(result.content.split(/\r?\n/).includes(native));
  assert.deepEqual(notices,[]);
});
