const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const folder=path.join(__dirname,'..','probes'),next=path.join(folder,'direct-policy-v4.js');
const source=()=>fs.readFileSync(fs.existsSync(next)?next:path.join(folder,'direct-policy-v3.js'),'utf8');
const base='https://httpbin.org/anything/kelee-qx-direct-probe',id='qx953-d2-1792542000000-12345678';
async function run(op,{prefs=new Map(),fetcher,defaultOrigin='198.51.100.2'}={}) {
  const results=[],calls=[];
  vm.runInNewContext(source(),{$request:{method:'GET',url:base+'/'+op+'?id='+id},setTimeout,clearTimeout,
    $done:r=>results.push(r),$environment:{version:'QX TF953'},
    $prefs:{valueForKey:k=>prefs.get(k),setValueForKey:(v,k)=>{prefs.set(k,v);return true;},removeValueForKey:k=>prefs.delete(k)},
    $configuration:{sendMessage:async message=>({ret:message.action==='get_policy_state'?{proxy:['proxy','PRIVATE_NODE']}:'filter'})},
    $task:{fetch:async request=>{
      const policy=request.opts.policy;
      calls.push(policy||'default');
      if(fetcher)return fetcher(request);
      if(policy && policy!=='direct')throw {error:'PRIVATE_NODE connection refused 192.0.2.33',code:-1004};
      return {statusCode:200,body:JSON.stringify({url:request.url,origin:policy==='direct'?'192.0.2.1':defaultOrigin})};
    }}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(results.length,1);
  return {report:JSON.parse(results[0].body),calls,prefs};
}
test('an unspecified-policy fetch on the SAME endpoint can establish a distinct reference',async()=>{
  const {report,calls}=await run('calibration');
  assert.deepEqual(calls,['direct','proxy','PRIVATE_NODE','default']);
  assert.equal(report.referencesDistinct,true);
  assert.equal(report.verdict,'references-recorded');
  assert.equal(report.referenceDiagnostics.referenceKind,'default-route');
  assert.equal(report.referenceDiagnostics.defaultAttempted,true);
  assert.equal(report.referenceDiagnostics.defaultStatus,200);
  assert.ok(!JSON.stringify(report).match(/PRIVATE|192\.0\.2|198\.51\.100/));
});
test('a default-route reference is pinned for verification without retrying other policies',async()=>{
  const first=await run('calibration'),second=await run('verify',{prefs:first.prefs});
  assert.deepEqual(second.calls,['direct','default']);
  assert.equal(second.report.directReferenceStable,true);
  assert.equal(second.report.alternativeReferenceStable,true);
});
test('a successful default route identical to DIRECT cannot distinguish the native policy',async()=>{
  const {report}=await run('calibration',{defaultOrigin:'192.0.2.1'});
  assert.equal(report.referencesDistinct,false);
});
test('finite errors retain only safe categories and explicit numeric codes',async()=>{
  const {report,calls}=await run('calibration',{fetcher:async()=>{throw {
    error:'PRIVATE_NODE certificate failed 192.0.2.11',code:-1200
  };}});
  assert.equal(report.referencesDistinct,false);
  assert.ok(calls.length<=4);
  assert.equal(report.referenceDiagnostics.policyErrorCategory,'tls');
  assert.equal(report.referenceDiagnostics.policyErrorCode,-1200);
  assert.ok(!JSON.stringify(report).match(/PRIVATE|192\.0\.2/));
});

test('string, documented error objects and Error.message all retain only a finite category',async()=>{
  for(const [reason,category] of [
    ['PRIVATE_NODE connection timeout 192.0.2.11','timeout'],
    [{error:'PRIVATE_NODE invalid policy 192.0.2.11'},'policy-or-node'],
    [new Error('PRIVATE_NODE certificate rejected 192.0.2.11'),'tls']
  ]) {
    const {report}=await run('calibration',{fetcher:async()=>{throw reason;}});
    assert.equal(report.referenceDiagnostics.policyErrorCategory,category);
    assert.equal(report.referenceDiagnostics.policyErrorCode,null);
    assert.ok(!JSON.stringify(report).match(/PRIVATE|192\.0\.2/));
  }
});
test('a default reference is not called proxy, and browser conclusions still require stable controls',async()=>{
  const values=[];
  vm.runInNewContext(source(),{$request:{method:'GET',url:base+'/dashboard'},$done:r=>values.push(r)});
  const code=values[0].body.match(/<script>([\s\S]*)<\/script>/)[1];
  for(const control of ['alternative-reference-matched','direct-reference-matched']) {
    const elements={start:{},copy:{},report:{value:''}},calls=[];
    vm.runInNewContext(code,{document:{getElementById:key=>elements[key]},navigator:{},AbortController,setTimeout,clearTimeout,
      fetch:async url=>{
        calls.push(url);
        const data={probe:'kelee-qx-direct-policy-v4',referencesDistinct:true,
          directReferenceStable:true,alternativeReferenceStable:true,
          verdict:url.includes('mode=control')?control:'direct-reference-matched'};
        return {json:async()=>data};
      }});
    await elements.start.onclick();
    const report=JSON.parse(elements.report.value);
    assert.equal(report.assessment['policy-direct'],control==='alternative-reference-matched'
      ?'direct-egress-observed-between-reference-controls':'inconclusive');
    assert.equal(report.assessment['opts-direct'],report.assessment['policy-direct']);
    assert.equal(report.finished,true);
    assert.ok(calls.at(-1).includes('/cleanup?'));
  }
});
