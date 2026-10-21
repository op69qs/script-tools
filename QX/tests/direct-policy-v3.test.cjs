const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const folder=path.join(__dirname,'..','probes'),next=path.join(folder,'direct-policy-v3.js');
function source(){return fs.readFileSync(fs.existsSync(next)?next:path.join(folder,'direct-policy-v2.js'),'utf8');}
const base='https://httpbin.org/anything/kelee-qx-direct-probe',id='qx953-d2-1792542000000-12345678';
async function run(op,{prefs=new Map(),leaf='PRIVATE_NODE',fetcher,configFails=false,clock={setTimeout,clearTimeout}}={}) {
  const results=[],calls=[],actions=[];
  vm.runInNewContext(source(),{...clock,$request:{method:'GET',url:base+'/'+op+'?id='+id},
    $done:value=>results.push(value),$environment:{version:'QX TF953'},
    $prefs:{valueForKey:k=>prefs.get(k),setValueForKey:(v,k)=>{prefs.set(k,v);return true;},removeValueForKey:k=>prefs.delete(k)},
    $configuration:{sendMessage:async message=>{
      actions.push(message.action);
      if(configFails)throw Error('PRIVATE_CONFIG_ERROR');
      return {ret:message.action==='get_policy_state'?{proxy:['proxy',leaf]}:'filter'};
    }},
    $task:{fetch:async request=>{
      calls.push(request.opts.policy);
      if(fetcher)return fetcher(request);
      if(request.opts.policy==='proxy')throw Error('PRIVATE_FETCH_ERROR');
      return {statusCode:200,body:JSON.stringify({url:request.url,
        origin:request.opts.policy==='direct'?'192.0.2.1':'198.51.100.2'})};
    }}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(results.length,1);
  return {report:JSON.parse(results[0].body),prefs,calls,actions};
}
test('a failed proxy reference tries only the selected actual server, without exposing its tag',async()=>{
  const {report,calls,actions}=await run('calibration');
  assert.equal(report.verdict,'references-recorded');
  assert.equal(report.referencesDistinct,true);
  assert.deepEqual(calls,['direct','proxy','PRIVATE_NODE']);
  assert.ok(actions.includes('get_policy_state'));
  assert.ok(actions.every(action=>action.startsWith('get_')));
  assert.equal(report.referenceDiagnostics.proxyPolicyStatus,0);
  assert.equal(report.referenceDiagnostics.leafAttempted,true);
  assert.equal(report.referenceDiagnostics.leafStatus,200);
  assert.ok(!JSON.stringify(report).match(/PRIVATE|192\.0\.2|198\.51\.100/));
});
test('verification pins the same successful server reference instead of silently using a new selection',async()=>{
  const first=await run('calibration');
  const second=await run('verify',{prefs:first.prefs,leaf:'OTHER_PRIVATE_NODE'});
  assert.deepEqual(second.calls,['direct','PRIVATE_NODE']);
  assert.equal(second.report.directReferenceStable,true);
  assert.equal(second.report.proxyReferenceStable,true);
  assert.ok(!JSON.stringify(second.report).includes('PRIVATE_NODE'));
});
test('a working proxy policy does not generate a fallback server request',async()=>{
  const result=await run('calibration',{fetcher:async request=>({
    statusCode:200,body:JSON.stringify({url:request.url,
      origin:request.opts.policy==='direct'?'192.0.2.1':'198.51.100.2'})})});
  assert.deepEqual(result.calls,['direct','proxy']);
  assert.equal(result.report.referenceDiagnostics.leafAttempted,false);
});
test('missing selection and failed leaves stay inconclusive with finite safe diagnostics',async()=>{
  for(const options of [{configFails:true},{leaf:'direct'},{leaf:'reject'},{leaf:'proxy'},
    {fetcher:async()=>{throw Error('PRIVATE_FAILURE');}}]) {
    const {report,calls}=await run('calibration',options);
    assert.equal(report.referencesDistinct,false);
    assert.equal(report.verdict,'reference-unavailable');
    assert.ok(calls.length<=3);
    assert.ok(!JSON.stringify(report).includes('PRIVATE'));
  }
});
test('failed calibration ends the browser test before native requests and still clears its state',async()=>{
  const results=[];
  vm.runInNewContext(source(),{$request:{method:'GET',url:base+'/dashboard'},$done:r=>results.push(r)});
  const script=results[0].body.match(/<script>([\s\S]*)<\/script>/)[1];
  const elements={start:{},copy:{},report:{value:''}},calls=[];
  const context={document:{getElementById:key=>elements[key]},navigator:{},AbortController,setTimeout,clearTimeout,
    fetch:async url=>{
      calls.push(url);
      return {json:async()=>({probe:'kelee-qx-direct-policy-v3',referencesDistinct:false,verdict:'reference-unavailable'})};
    }};
  vm.runInNewContext(script,context);
  await elements.start.onclick();
  const result=JSON.parse(elements.report.value);
  assert.equal(result.finished,true);
  assert.equal(result.results.length,0);
  assert.equal(calls.length,2);
  assert.ok(calls.at(-1).includes('/cleanup?'));
  assert.equal(result.assessment['policy-direct'],'inconclusive');
});
test('late v3 calibration cannot recreate references after cleanup',async()=>{
  const prefs=new Map(),pending=[],results=[];
  vm.runInNewContext(source(),{$request:{method:'GET',url:base+'/calibration?id='+id},$done:r=>results.push(r),
    $prefs:{valueForKey:k=>prefs.get(k),setValueForKey:(v,k)=>{prefs.set(k,v);return true;},removeValueForKey:k=>prefs.delete(k)},
    $task:{fetch:request=>new Promise(resolve=>pending.push({request,resolve}))}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pending.length,2);
  await run('cleanup',{prefs});
  for(const {request,resolve} of pending)resolve({statusCode:200,body:JSON.stringify({
    url:request.url,origin:request.opts.policy==='direct'?'192.0.2.1':'198.51.100.2'
  })});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(prefs.size,0);
  assert.equal(JSON.parse(results[0].body).verdict,'reference-cancelled');
});
test('a slow failed proxy gets a bounded selected-server fallback before the browser deadline',async()=>{
  const delays=[];
  const result=await run('calibration',{clock:{
    setTimeout:(fn,ms)=>{delays.push(ms);return setImmediate(fn);},clearTimeout:clearImmediate
  },fetcher:request=>request.opts.policy==='proxy'?new Promise(()=>{}):Promise.resolve({
    statusCode:200,body:JSON.stringify({url:request.url,origin:request.opts.policy==='direct'?'192.0.2.1':'198.51.100.2'})
  })});
  assert.equal(result.report.verdict,'references-recorded');
  assert.equal(result.report.referenceDiagnostics.leafAttempted,true);
  assert.ok(delays.filter(ms=>ms===6000).length>=3);
  assert.ok(!JSON.stringify(result.report).includes('PRIVATE_NODE'));
});
