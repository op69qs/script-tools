const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const api=require('../kelee-qx.js');
const target='https://kelee.one/Tool/Loon/Lpx/Example.lpx',asset='https://kelee.one/Resource/JavaScript/Example/example.js';
const dsl=(args='',options='binary_body_mode=true')=>'[Script]\nresponse if ${url} ~= /^https:\\/\\/example\\.com/i then script("'+asset+'"'+args+') with requires_body=true'+(options?', '+options:'');
function execute(source,spec,response,logger=()=>{}) {
  assert.equal(typeof api.wrapLoonResponseScript,'function','response bridge is missing');
  const calls=[];
  vm.runInNewContext(api.wrapLoonResponseScript(source,spec),{$request:{url:'https://example.com/api',method:'POST',headers:{Keep:'yes'}},
    $response:response,$done:value=>calls.push(value),console:{log:logger}},{timeout:1000});
  return calls;
}
test('binary input and nonzero-offset output use the precise byte range',()=>{
  const result=execute('if($response.status!==200)throw Error("status"); $done({body:$response.body.subarray(1,3)});',
    {binary:true,argument:null},{statusCode:200,bodyBytes:Uint8Array.from([1,2,255,4]).buffer});
  assert.equal(result.length,1);
  assert.deepEqual([...new Uint8Array(result[0].bodyBytes)],[2,255]);
  assert.equal(result[0].body,undefined);
});
test('empty binary body is a change, while no body result is preserved as no change',()=>{
  const response={statusCode:200,bodyBytes:new ArrayBuffer(0)};
  assert.equal(execute('$done({body:$response.body});',{binary:true,argument:null},response)[0].bodyBytes.byteLength,0);
  assert.deepEqual(JSON.parse(JSON.stringify(execute('$done({});',{binary:true,argument:null},response)[0])),{});
});
test('argument booleans, numbers, strings and null retain their types',()=>{
  const argument={flag:false,count:2,text:'quote"\\line',missing:null};
  const result=execute('$done({body:JSON.stringify([$argument,typeof $argument.flag,$request.method,$request.headers.Keep])});',
    {binary:false,argument},{statusCode:201,body:'original'})[0];
  assert.deepEqual(JSON.parse(result.body),[argument,'boolean','POST','yes']);
});
test('only the first done is delivered; upstream exceptions keep their original engine behavior',()=>{
  const result=execute('$done({body:"first"}); $done({body:"later"});',
    {binary:false,argument:null},{statusCode:200,body:'original'});
  assert.equal(result.length,1);assert.equal(result[0].body,'first');
  assert.throws(()=>execute('throw Error("UPSTREAM_ERROR");',
    {binary:false,argument:null},{statusCode:200,body:'original'}),/UPSTREAM_ERROR/);
});
test('the bridge preserves a sloppy script and the script own strict-mode declaration',()=>{
  const response={statusCode:200,body:'original'};
  assert.equal(execute('temporaryBody=$response.body+" changed";$done({body:temporaryBody});',
    {binary:false,argument:null},response)[0].body,'original changed');
  assert.equal(execute('"use strict";try{missingVariable=1;}catch(_){$done({body:"strict preserved"});}',
    {binary:false,argument:null},response)[0].body,'strict preserved');
  assert.equal(execute('"use strict";$done({body:this===globalThis?"global":"other"});',
    {binary:false,argument:null},response)[0].body,'global');
});

test('upstream code retains top-level variables, global bindings and absence of function arguments',()=>{
  const response={statusCode:200,body:'original'};
  for(const [source,expected] of [
    ['var shared=17;$done({body:String(globalThis.shared)});','17'],
    ['$done({body:String(globalThis.$response.status)});','200'],
    ['$done({body:typeof arguments});','undefined']
  ])assert.equal(execute(source,{binary:false,argument:null},response)[0].body,expected);
});
test('a failing diagnostic sink cannot prevent unsupported-result completion',()=>{
  const calls=execute('$done({unexpected:true});',{binary:false,argument:null},
    {statusCode:200,body:'original'},()=>{throw Error('sink failed');});
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{}]);
});

test('a host with immutable bindings finishes once and does not execute upstream',()=>{
  const calls=[],context={$done:r=>calls.push(r),console:{log(){throw Error('sink failed');}}};
  Object.defineProperty(context,'$response',{value:{statusCode:200,body:'original'},writable:false});
  assert.throws(()=>vm.runInNewContext(api.wrapLoonResponseScript('throw Error("must not run");',
    {binary:false,argument:null}),context),/bridge initialization failed/);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{}]);
});

test('directive prologues retain strictness, comments and automatic semicolon insertion',()=>{
  const response={statusCode:200,body:'original'};
  const strict=['"use strict";','// first\n"use strict"\n','<!-- old comment\n"use strict";','--> old comment\n"use strict";',
    '/* first */\n"other"; /* a\nb */ \'use strict\' /* x\ny */ ',
    '#!ignored\n"use strict";','"other"\n"use strict"\n'];
  const check='try{neverDeclared=1;$done({body:"sloppy"});}catch(_){$done({body:"strict"});}';
  for(const prefix of strict)assert.equal(execute(prefix+check,{binary:false,argument:null},response)[0].body,'strict',prefix);
  for(const terminator of ['\r','\n','\r\n','\u2028','\u2029'])
    assert.equal(execute('#!ignored'+terminator+'$done({body:String($response.status)});',
      {binary:false,argument:null},response)[0].body,'200');
  for(const expression of ['"use strict"\n+-1;','"use strict"\n-+1;','"use strict"\n+1;',
    '"use strict"\n[0];','"use strict"\n.toString();','"use strict"\n? 1 : 2;',
    '"use strict"\n/2;','"use\\x20strict";'])
    assert.equal(execute(expression+check,{binary:false,argument:null},response)[0].body,'sloppy',expression);
});

test('Unicode identifiers after a newline cannot be mistaken for binary operator keywords',()=>{
  const response={statusCode:200,body:'original'};
  for(const [name,binding] of [['in\u00e9','in\u00e9'],['instanceof\u4e2d','instanceof\u4e2d'],
    ['in$thing','in$thing'],['instanceof_thing','instanceof_thing'],[String.raw`in\u00e9`,'in\u00e9']]) {
    const source='"use strict"\n'+name+';try{notDeclared=1;$done({body:"sloppy"});}catch(_){$done({body:"strict"});}';
    const calls=[],context={$request:{},$response:response,$done:r=>calls.push(r),[binding]:true,console:{log(){}}};
    vm.runInNewContext(api.wrapLoonResponseScript(source,{binary:false,argument:null}),context);
    assert.equal(calls[0].body,'strict',name);
  }
  for(const whitespace of [' ','\u00a0','\uFEFF','\u2028'])
    assert.equal(execute('"use strict"\nin'+whitespace+'{};notDeclared=1;$done({body:"sloppy"});',
      {binary:false,argument:null},response)[0].body,'sloppy');
});
test('binary DSL emits a self-contained local asset bridge without changing its regex or stage',()=>{
  const result=api.prepareResourceContent(dsl(),target);
  const url=result.split(' url script-response-body ')[1].trim();
  assert.equal(new URL(url).searchParams.get('url'),asset);
  assert.deepEqual(JSON.parse(new URL(url).searchParams.get('loon')), {binary:true,argument:null});
});
test('literal script arguments use the original string rather than parsing it as JSON',()=>{
  const result=api.prepareResourceContent(dsl(', "{\\"flag\\":false}"',''),target);
  const spec=JSON.parse(new URL(result.split(' url script-response-body ')[1].trim()).searchParams.get('loon'));
  assert.equal(spec.argument,'{"flag":false}');assert.equal(spec.binary,false);
});
test('plugin object arguments bind switch defaults and preserve explicit false overrides',()=>{
  const input='[Argument]\nflag=switch,true,false,tag=Flag\nother=switch,false,true,tag=Other\n'+dsl(', {${flag}, ${other}}');
  const result=api.prepareResourceContent(input,target,undefined,{flag:false,other:true});
  const spec=JSON.parse(new URL(result.split(' url script-response-body ')[1].trim()).searchParams.get('loon'));
  assert.deepEqual(spec.argument,{flag:false,other:true});
  const defaults=api.prepareResourceContent(input,target);
  assert.deepEqual(JSON.parse(new URL(defaults.split(' url script-response-body ')[1].trim()).searchParams.get('loon')).argument,
    {flag:true,other:false});
});
test('unsupported argument bindings, deadlines and body stages remain explicit conversion errors',()=>{
  for(const input of [dsl(', {${missing}}'),dsl(', {${same}, ${same}}'),
    dsl(', true'),dsl(', "hello ${flag}"',''),dsl('', 'binary_body_mode=true, timeout=5'),
    dsl().replace('response if','request if'),dsl().replace('requires_body=true','requires_body=false')])
    assert.throws(()=>api.prepareResourceContent(input,target),/第/);
  assert.throws(()=>api.prepareResourceContent(dsl(),target,undefined,{unknown:true}),/未被.*引用/);
});

test('resource URL arguments preserve false overrides through the delivered asset descriptor',async()=>{
  const input='[Argument]\nflag=switch,true,false\n'+dsl(', {${flag}}');
  const url='http://127.0.0.1:9999/kelee-qx/resource?url='+encodeURIComponent(target);
  const response=await api.backendResponse({url:url+'&args='+encodeURIComponent('{"flag":false}')},
    async()=>({statusCode:200,headers:{},body:input}));
  assert.match(response.status,/200/);
  const descriptor=JSON.parse(new URL(response.body.split(' url script-response-body ')[1].trim()).searchParams.get('loon'));
  assert.deepEqual(descriptor.argument,{flag:false});
  const unknown=await api.backendResponse({url:url+'&args='+encodeURIComponent('{"unknown":false}')},
    async()=>({statusCode:200,headers:{},body:input}));
  assert.match(unknown.status,/422/);
  for(const query of ['&args=%7B%22flag%22%3A%22false%22%7D','&args=%7B%7D&args=%7B%7D']) {
    let calls=0;
    const invalid=await api.backendResponse({url:url+query},async()=>{calls++;return {statusCode:200,body:input};});
    assert.match(invalid.status,/400/);assert.equal(calls,0);
  }
});

test('invalid or oversized bound arguments keep their source line and conversion status',async()=>{
  const inputs=[
    '[Argument]\nconstructor=switch,true,false\n'+dsl(', {${constructor}}'),
    dsl(', "'+'x'.repeat(8192)+'"','')
  ];
  for(const input of inputs) {
    assert.throws(()=>api.prepareResourceContent(input,target),error=>
      error.keleeStage==='resource-conversion' && Number.isInteger(error.keleeLine));
    const response=await api.backendResponse({url:'http://127.0.0.1:9999/kelee-qx/resource?url='+encodeURIComponent(target)},
      async()=>({statusCode:200,headers:{},body:input}));
    assert.match(response.status,/422/);
    assert.equal(response.headers['X-Kelee-QX-Stage'],'resource-conversion');
  }
});

test('the real KOP parser retains the bridge descriptor and its response-body stage',
  {skip:!process.env.KELEE_KOP_SOURCE},async()=>{
    const fs=require('node:fs'),path=require('node:path');
    const prepared=api.prepareResourceContent('[Argument]\nflag=switch,false,true\n'+dsl(', {${flag}}'),target);
    const expected=prepared.split(' url script-response-body ')[1].trim();
    let result;const notices=[];
    vm.runInNewContext(fs.readFileSync(path.resolve(process.env.KELEE_KOP_SOURCE),'utf8'),{
      $resource:{link:target,type:'rewrite',tag:'Bridge fixture',content:prepared},
      $environment:{version:'Quantumult X 1.9.0 build 953'},$done:value=>result=value,
      $notify:(...args)=>notices.push(args),console:{log(){}}
    },{timeout:5000});
    assert.ok(result && result.content);
    const line=result.content.split('\n').find(line=>line.includes(' url script-response-body '));
    assert.ok(line);assert.equal(line.split(' url script-response-body ')[1].trim(),expected);
    assert.equal(notices.length,0);
    const wrapped=await api.backendResponse({url:expected},async()=>({statusCode:200,headers:{},
      body:'$done({body:Uint8Array.from([$argument.flag?1:0,$response.body[0]])});'}));
    const calls=[];
    vm.runInNewContext(wrapped.body,{$request:{url:'https://example.com'},$response:{
      statusCode:200,bodyBytes:Uint8Array.from([255]).buffer},$done:r=>calls.push(r),console:{log(){}}});
    assert.deepEqual([...new Uint8Array(calls[0].bodyBytes)],[0,255]);
  });
test('backend serves the generated bridge while unadorned assets remain byte-identical',async()=>{
  const original='$done({body:$response.body.subarray(1)});';
  const plain='http://127.0.0.1:9999/kelee-qx/asset.js?url='+encodeURIComponent(asset);
  const request=plain+'&loon='+encodeURIComponent(JSON.stringify({binary:true,argument:null}));
  const wrapped=await api.backendResponse({url:request},async()=>({statusCode:200,headers:{},body:original}));
  assert.match(wrapped.status,/200/);
  const calls=[];
  vm.runInNewContext(wrapped.body,{$request:{url:'https://example.com'},$response:{
    statusCode:200,bodyBytes:Uint8Array.from([1,2,3]).buffer},$done:r=>calls.push(r),console:{log(){}}});
  assert.deepEqual([...new Uint8Array(calls[0].bodyBytes)],[2,3]);
  const unwrapped=await api.backendResponse({url:plain},async()=>({statusCode:200,headers:{},body:original}));
  assert.equal(unwrapped.body,original);
});
test('malformed wrapper specs cannot fetch upstream or silently deliver an unwrapped script',async()=>{
  for(const spec of ['bad','{"binary":"true"}','{"binary":true,"timeout":1}','{"binary":true,"argument":{"a":[]}}']){
    let calls=0;
    const result=await api.backendResponse({url:'http://127.0.0.1:9999/kelee-qx/asset.js?url='+encodeURIComponent(asset)+'&loon='+encodeURIComponent(spec)},
      async()=>{calls++;return {statusCode:200,headers:{},body:'$done({});'};});
    assert.match(result.status,/400/);assert.equal(calls,0);
  }
});
