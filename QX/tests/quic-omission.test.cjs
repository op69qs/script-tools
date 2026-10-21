const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const api=require('../kelee-qx.js');
const target='https://kelee.one/Tool/Loon/Lpx/Example.lpx';
const local='http://127.0.0.1:9999/kelee-qx/resource?url='+encodeURIComponent(target);
const rule=(domain='DOMAIN',reverse=false)=>{
  const leaves=['('+domain+', example.com)','(PROTOCOL, QUIC)'];
  if(reverse)leaves.reverse();
  return 'AND, ('+leaves.join(', ')+'), REJECT';
};
for(const kind of ['DOMAIN','DOMAIN-SUFFIX'])for(const reverse of [false,true])
  test('configured omission removes only the complete '+kind+' AND QUIC reject, reverse='+reverse,()=>{
    const details=[],input='[Rule]\nDOMAIN, before.example, DIRECT\n'+rule(kind,reverse)+'\nDOMAIN, after.example, PROXY';
    const output=api.prepareResourceContent(input,target,details);
    assert.ok(!output.includes('\nAND,'));
    assert.equal(output.split('\n').length,input.split('\n').length);
    assert.ok(!/^(?:host|DOMAIN|host-wildcard).*example\.com.*REJECT$/m.test(output));
    assert.match(output,/# Kelee-QX: omitted domain AND QUIC REJECT by configuration/);
    assert.ok(output.includes('DOMAIN, before.example, DIRECT\n'));
    assert.ok(output.endsWith('DOMAIN, after.example, PROXY'));
    assert.equal(details[0].status,'omitted-by-config');
    assert.equal(details[0].line,3);
    assert.equal(details[0].rule,rule(kind,reverse));
    assert.equal(details[0].outputRules,0);
  });
test('TF note and source line remain visible on the omission comment',()=>{
  const details=[],input='[Rule]\n{# source note #} '+rule();
  const output=api.prepareResourceContent(input,target,details);
  assert.match(output,/# Kelee-QX: omitted.*source note/);
  assert.equal(details[0].rule,'{# source note #} '+rule());
});
for(const unsupported of [
  rule().replace('AND,','OR,'),rule().replace('QUIC','UDP'),
  rule().replace('REJECT','DIRECT'),rule().replace('REJECT','PROXY'),
  rule('DOMAIN-KEYWORD'),rule().replace('(DOMAIN, example.com)','(DOMAIN, *.example.com)'),
  rule().replace(')), REJECT', '), (DOMAIN, third.example)), REJECT'),
  rule().replace('(DOMAIN, example.com)','(NOT, ((DOMAIN, example.com)))'),
  rule().replace('(PROTOCOL, QUIC)','(PROTOCOL, QUIC, extra)'),
  rule()+', no-resolve'
])test('other logic is not authorized for omission: '+unsupported,()=>{
  const details=[],input='[Rule]\n'+unsupported;
  assert.equal(api.prepareResourceContent(input,target,details),input);
  assert.equal(details[0].status,'unsupported');
});
test('strict configuration restores the original QUIC rule and whole-resource 422',async()=>{
  const previous=api.CONFIG.omitDomainQuicReject;
  api.CONFIG.omitDomainQuicReject=false;
  try {
    const input='[Rule]\n'+rule();
    assert.equal(api.prepareResourceContent(input,target),input);
    const response=await api.backendResponse({url:local},async()=>({statusCode:200,headers:{},body:input}));
    assert.match(response.status,/422/);
  }finally{api.CONFIG.omitDomainQuicReject=previous;}
});
test('ready output and logs disclose configured omission without claiming equivalence',async()=>{
  const logs=[],context={module:{exports:{}},console:{log:value=>logs.push(value)}};
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'..','kelee-qx.js'),'utf8'),context);
  context.module.exports.CONFIG.quicMode='global';
  const response=await context.module.exports.backendResponse({url:local},async()=>({
    statusCode:200,headers:{},body:'#!name=example\n[Rule]\n'+rule()
  }));
  assert.match(response.status,/200/);
  assert.equal(response.headers['X-Kelee-QX-Omitted-QUIC'],'1');
  assert.equal(response.headers['X-Kelee-QX-QUIC-Requirement'],'general-udp_drop_list-QUIC');
  const record=logs.map(value=>String(value)).find(value=>value.includes('"stage":"ready-for-parser"'));
  assert.ok(record && record.includes('"omittedQuic":1') && record.includes('"pendingLogical":0'));
  assert.ok(record.includes('"line":3') && record.includes('QUIC'));
  assert.ok(record.includes('device setting not verified'));
});
test('an omission cannot conceal another unsupported DIRECT exception',async()=>{
  const input='[Rule]\n'+rule()+'\nAND, ((URL-REGEX, ^http://example.com/d), (USER-AGENT, App*)), DIRECT';
  const response=await api.backendResponse({url:local},async()=>({statusCode:200,headers:{},body:input}));
  assert.match(response.status,/422/);
  assert.match(response.body,/"pendingLogical":\s*1/);
  assert.match(response.body,/"omittedQuic":\s*1/);
});
test('a resource-wide output limit cannot leave a retained rule marked as omitted',async()=>{
  const input='[Rule]\n'+Array.from({length:600},()=>rule().replace('example.com','a'.repeat(110)+'.example')).join('\n');
  const details=[],output=api.prepareResourceContent(input,target,details);
  assert.ok(output.includes('\nAND,'));
  const firstRetained=output.split('\n').findIndex(line=>line.startsWith('AND,'));
  assert.equal(details.find(entry=>entry.line===firstRetained+1).status,'unsupported');
  const boundary=input.split('\n').slice(0,firstRetained+1).join('\n');
  const response=await api.backendResponse({url:local},async()=>({statusCode:200,headers:{},body:boundary}));
  assert.match(response.status,/422/);
});
test('default MitM mode does not require global QUIC and reports an exact listed host',async()=>{
  const input='[Rule]\n'+rule()+'\n[MitM]\nhostname=example.com';
  const details=[],prepared=api.prepareResourceContent(input,target,details);
  const response=await api.backendResponse({url:local},async()=>({statusCode:200,headers:{},body:input}));
  assert.equal(response.headers['X-Kelee-QX-QUIC-Requirement'],'mitm-auto-quic');
  assert.equal(details[0].mitmCoverage,'exact-host-listed');
  assert.ok(prepared.endsWith('[MitM]\nhostname=example.com'));
  assert.ok(!prepared.includes('requires [general]'));
});
test('MitM mode exposes partial suffix coverage without adding TLS hostnames',()=>{
  const input='[Rule]\n'+rule('DOMAIN-SUFFIX')+'\n[MitM]\nhostname=api.example.com, www.example.com';
  const details=[],prepared=api.prepareResourceContent(input,target,details);
  assert.equal(details[0].mitmCoverage,'partial');
  assert.deepEqual(details[0].relatedMitmHostnames,['api.example.com','www.example.com']);
  assert.ok(prepared.endsWith('hostname=api.example.com, www.example.com'));
  assert.ok(!prepared.includes('hostname=*.example.com'));
});
test('an invalid QUIC mode restores rejection rather than silently relaxing rules',async()=>{
  const previous=api.CONFIG.quicMode;api.CONFIG.quicMode='typo';
  try {
    const response=await api.backendResponse({url:local},async()=>({statusCode:200,headers:{},body:'[Rule]\n'+rule()}));
    assert.match(response.status,/422/);
  }finally{api.CONFIG.quicMode=previous;}
});
