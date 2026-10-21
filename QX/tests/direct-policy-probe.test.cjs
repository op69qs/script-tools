const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {test}=require('node:test'),assert=require('node:assert/strict');
const file=path.join(__dirname,'..','probes','direct-policy-v2.js');
const base='https://httpbin.org/anything/kelee-qx-direct-probe';
const runId='qx953-d2-1792542000000-12345678';
const key='kelee-qx.direct-policy.v2.'+runId;
const endpoint=mode=>base+'/request?mode='+mode+'&id='+runId+'-0';
function source(){assert.ok(fs.existsSync(file),'DIRECT policy probe implementation is missing');return fs.readFileSync(file,'utf8');}
async function run(url,options={}) {
  const prefs=options.prefs||new Map(),results=[],calls=[],logs=[];
  const context={$request:{method:options.method||'GET',url,headers:{Cookie:'COOKIE_SECRET'}},
    $environment:{version:'iOS 27.0.1 v1.9.0-build953'},$done:value=>results.push(value),
    $prefs:{valueForKey:k=>prefs.get(k),setValueForKey:(v,k)=>{prefs.set(k,v);return true;},removeValueForKey:k=>prefs.delete(k)},
    $task:{fetch:async request=>{calls.push(JSON.parse(JSON.stringify(request)));return options.fetcher(request);}},
    console:{log:value=>logs.push(value)}};
  if(options.response)context.$response=options.response;
  vm.runInNewContext(source(),context,{timeout:1000});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(results.length,1);
  return {result:JSON.parse(JSON.stringify(results[0])),calls,logs,prefs};
}
async function calibrated(direct='192.0.2.1',proxy='198.51.100.2') {
  const result=await run(base+'/calibration?id='+runId,{fetcher:async request=>({
    statusCode:200,body:JSON.stringify({url:request.url,origin:request.opts.policy==='direct'?direct:proxy})
  })});
  return result;
}
function echo(mode,origin,overrides={}) {
  return {statusCode:200,headers:{},body:JSON.stringify({url:endpoint(mode),origin,
    headers:{'X-Kelee-QX-Direct-Probe':runId+'-0'},...overrides})};
}
test('local reference fingerprint is standard SHA256 for ASCII input',()=>{
  const context={module:{exports:{}}};
  vm.runInNewContext(source(),context);
  for(const value of ['','abc','secret-salt|192.0.2.1','salt|2001:db8::1, 198.51.100.1'])
    assert.equal(context.module.exports.sha256(value),crypto.createHash('sha256').update(value).digest('hex'));
});
test('calibration uses documented direct and proxy fetches and stores no raw IP',async()=>{
  const {result,calls,prefs}=await calibrated();
  assert.deepEqual(calls.map(r=>r.opts.policy),['direct','proxy']);
  assert.ok(calls.every(r=>r.url==='https://httpbin.org/anything/kelee-qx-direct-probe-reference'));
  const report=JSON.parse(result.body);
  assert.equal(report.referencesDistinct,true);
  assert.equal(report.provesFullEquivalence,false);
  assert.equal(prefs.size,2);
  assert.ok(prefs.has(key));
  assert.ok(!JSON.stringify({result,prefs:[...prefs]}).match(/192\.0\.2\.1|198\.51\.100\.2|COOKIE_SECRET/));
});
test('equal direct and proxy reference egress remains non-discriminating',async()=>{
  const {result}=await calibrated('192.0.2.1','192.0.2.1');
  assert.equal(JSON.parse(result.body).referencesDistinct,false);
});
test('failed or unrecognizable fetch references cannot enable a positive result',async()=>{
  for(const fetcher of [async()=>{throw Error('PRIVATE_ERROR');},async()=>({statusCode:200,body:'{}'})]) {
    const {result,prefs}=await run(base+'/calibration?id='+runId,{fetcher});
    assert.equal(JSON.parse(result.body).referencesDistinct,false);
    assert.equal(prefs.size,0);
    assert.ok(!result.body.includes('PRIVATE_ERROR'));
  }
});
test('native test payloads only request direct and never fetch a replacement',async()=>{
  for(const mode of ['control','policy-direct','opts-direct']) {
    const {result,calls}=await run(endpoint(mode));
    assert.equal(result.headers['X-Kelee-QX-Direct-Probe'],runId+'-0');
    assert.equal(result.headers.Connection,'close');
    assert.ok(!JSON.stringify(result).includes('COOKIE_SECRET'));
    if(mode==='policy-direct')assert.equal(result.policy,'direct');
    else if(mode==='opts-direct')assert.deepEqual(result.opts,{policy:'direct'});
    else {assert.equal(result.policy,undefined);assert.equal(result.opts,undefined);}
    assert.deepEqual(calls,[]);
  }
});
test('the native response compares only this run and never returns raw egress data',async()=>{
  const {prefs}=await calibrated();
  for(const [origin,expected] of [['192.0.2.1','direct-reference-matched'],['198.51.100.2','proxy-reference-matched'],
    ['203.0.113.5','inconclusive']]) {
    const {result,logs}=await run(endpoint('policy-direct'),{prefs,response:echo('policy-direct',origin)});
    const report=JSON.parse(result.body);
    assert.equal(report.verdict,expected);
    assert.equal(report.provesFullEquivalence,false);
    assert.ok(!JSON.stringify({result,logs}).includes(origin));
    assert.equal(result.headers.Connection,'close');
  }
});
test('missing, expired and wrong-run references remain inconclusive',async()=>{
  for(const change of ['missing','expired','wrong']) {
    const {prefs}=await calibrated();
    if(change==='missing')prefs.clear();
    else {
      const record=JSON.parse(prefs.get(key));
      if(change==='expired')record.expiresAt=0;else record.runId='other';
      prefs.set(key,JSON.stringify(record));
    }
    const {result}=await run(endpoint('opts-direct'),{prefs,response:echo('opts-direct','192.0.2.1')});
    assert.equal(JSON.parse(result.body).verdict,'inconclusive');
  }
});
test('missing marker or wrong endpoint cannot establish route evidence',async()=>{
  const {prefs}=await calibrated();
  for(const overrides of [{headers:{}},{url:'https://other.example/'}]) {
    const {result}=await run(endpoint('opts-direct'),{prefs,response:echo('opts-direct','192.0.2.1',overrides)});
    assert.equal(JSON.parse(result.body).verdict,'inconclusive');
  }
});
test('cleanup deletes only its own reference and never a newer run',async()=>{
  const {prefs}=await calibrated();prefs.set('user.setting','USER_SECRET');
  await run(base+'/cleanup?id=qx953-d2-1792542000001-12345678',{prefs});
  assert.ok(prefs.has(key));
  const {result}=await run(base+'/cleanup?id='+runId,{prefs});
  assert.equal(JSON.parse(result.body).verdict,'reference-cleared');
  assert.equal(prefs.has(key),false);assert.equal(prefs.get('user.setting'),'USER_SECRET');
});
test('cleanup prevents an unfinished calibration from restoring its reference',async()=>{
  const prefs=new Map(),pending=[],results=[];
  vm.runInNewContext(source(),{
    $request:{method:'GET',url:base+'/calibration?id='+runId},$done:value=>results.push(value),
    $prefs:{valueForKey:k=>prefs.get(k),setValueForKey:(v,k)=>{prefs.set(k,v);return true;},removeValueForKey:k=>prefs.delete(k)},
    $task:{fetch:request=>new Promise(resolve=>pending.push({request,resolve}))}
  });
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pending.length,2);
  await run(base+'/cleanup?id='+runId,{prefs});
  for(const {request,resolve} of pending)resolve({statusCode:200,body:JSON.stringify({
    url:request.url,origin:request.opts.policy==='direct'?'192.0.2.1':'198.51.100.2'
  })});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(results.length,1);
  assert.equal(prefs.has(key),false);
  assert.equal(JSON.parse(results[0].body).verdict,'reference-cancelled');
});
test('verification checks both reference exits again before accepting route evidence',async()=>{
  const {prefs}=await calibrated();
  const stable=await run(base+'/verify?id='+runId,{prefs,fetcher:async request=>({
    statusCode:200,body:JSON.stringify({url:request.url,origin:request.opts.policy==='direct'?'192.0.2.1':'198.51.100.2'})
  })});
  assert.equal(JSON.parse(stable.result.body).directReferenceStable,true);
  assert.equal(JSON.parse(stable.result.body).proxyReferenceStable,true);
  const changed=await run(base+'/verify?id='+runId,{prefs,fetcher:async request=>({
    statusCode:200,body:JSON.stringify({url:request.url,origin:request.opts.policy==='direct'?'192.0.2.1':'203.0.113.8'})
  })});
  assert.equal(JSON.parse(changed.result.body).directReferenceStable,true);
  assert.equal(JSON.parse(changed.result.body).proxyReferenceStable,false);
});
test('source mismatches, extra parameters and non-GET methods remain inert',async()=>{
  for(const [url,method] of [[endpoint('policy-direct')+'&url=https://other.example','GET'],
    [endpoint('policy-direct').replace('httpbin.org','other.example'),'GET'],
    [endpoint('policy-direct'),'POST'],[base+'/dashboard?extra=1','GET']])
    assert.deepEqual((await run(url,{method})).result,{});
});
async function browserReports(controls,native) {
  const {result}=await run(base+'/dashboard');
  const script=result.body.match(/<script>([\s\S]*)<\/script>/)[1];
  const elements={start:{},copy:{},report:{value:''}},requests=[];let active=0,maxActive=0;
  const context={document:{getElementById:id=>elements[id]},navigator:{},AbortController,setTimeout,clearTimeout,Date,Math,
    fetch:async url=>{
      requests.push(url);maxActive=Math.max(maxActive,++active);
      await new Promise(resolve=>setImmediate(resolve));active--;
      let report={probe:'kelee-qx-direct-policy-v2',provesFullEquivalence:false};
      if(url.includes('/calibration'))report.referencesDistinct=true;
      else if(url.includes('/verify'))report={...report,directReferenceStable:true,proxyReferenceStable:true};
      else if(url.includes('/request?')) {
        const mode=new URL(url).searchParams.get('mode');
        report={...report,verdict:mode==='control'?controls:native[mode]};
      }
      return {status:200,json:async()=>report};
    }};
  vm.runInNewContext(script,context);await elements.start.onclick();
  return {report:JSON.parse(elements.report.value),requests,maxActive};
}
test('browser conclusions require proxy controls on both sides and a distinct direct reference',async()=>{
  const {report,requests,maxActive}=await browserReports('proxy-reference-matched',
    {'policy-direct':'direct-reference-matched','opts-direct':'proxy-reference-matched'});
  assert.equal(maxActive,1);
  assert.equal(report.assessment['policy-direct'],'direct-egress-observed-between-proxy-controls');
  assert.equal(report.assessment['opts-direct'],'direct-not-observed-with-this-payload');
  assert.equal(report.finished,true);
  assert.ok(requests.at(-1).includes('/cleanup?'));
  assert.equal(report.provesFullEquivalence,false);
});
test('already-direct and failed controls never prove a native DIRECT capability',async()=>{
  for(const control of ['direct-reference-matched','inconclusive']) {
    const {report}=await browserReports(control,{'policy-direct':'direct-reference-matched','opts-direct':'direct-reference-matched'});
    assert.equal(report.assessment['policy-direct'],'inconclusive');
    assert.equal(report.assessment['opts-direct'],'inconclusive');
  }
});
