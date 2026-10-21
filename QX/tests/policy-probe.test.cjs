const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test'),assert=require('node:assert/strict');
const file=path.join(__dirname,'..','probes','policy-probe.js');
const base='https://httpbin.org/anything/kelee-qx-policy-probe';
const url=mode=>base+'/request?mode='+mode+'&id=qx953-p1-12345678';
async function run(request,response,fetcher) {
  assert.ok(fs.existsSync(file),'native policy probe implementation is missing');
  const results=[],logs=[],calls=[];
  const context={$request:request,$environment:{version:'iOS 27.0.1 v1.9.0-build953'},
    $done:value=>results.push(value),console:{log:value=>logs.push(value)},
    $task:{fetch:async request=>{calls.push(request);return fetcher(request);}}};
  if(response)context.$response=response;
  vm.runInNewContext(fs.readFileSync(file,'utf8'),context,{timeout:1000});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(results.length,1);
  return {result:JSON.parse(JSON.stringify(results[0])),logs,calls:JSON.parse(JSON.stringify(calls))};
}
test('control and both tested policy payloads modify the same fixed GET operation',async()=>{
  for(const mode of ['control','policy','opts-policy']) {
    const {result,calls}=await run({method:'GET',url:url(mode),headers:{Cookie:'SECRET',Authorization:'SECRET'}});
    assert.equal(result.headers['X-Kelee-QX-Policy-Probe'],'qx953-p1-12345678');
    assert.ok(!JSON.stringify(result).includes('SECRET'));
    assert.equal(result.url,undefined);
    if(mode==='policy')assert.equal(result.policy,'reject');
    else if(mode==='opts-policy')assert.deepEqual(result.opts,{policy:'reject'});
    else {assert.equal(result.policy,undefined);assert.equal(result.opts,undefined);}
    assert.deepEqual(calls,[],'native request tests must never be replaced with fetch');
  }
});
test('an echo after requesting reject establishes only non-enforcement on this request',async()=>{
  const request={method:'GET',url:url('policy')};
  const body=JSON.stringify({url:request.url,headers:{'X-Kelee-Qx-Policy-Probe':'qx953-p1-12345678',
    Cookie:'COOKIE_SECRET'},origin:'IP_SECRET'});
  const {result,logs}=await run(request,{statusCode:200,headers:{},body});
  const report=JSON.parse(result.body);
  assert.equal(report.verdict,'reject-not-enforced-on-this-request');
  assert.equal(report.requestMarkerEcho,true);
  assert.equal(report.provesFullEquivalence,false);
  assert.ok(!JSON.stringify({result,logs}).match(/COOKIE_SECRET|IP_SECRET/));
});
test('missing source identity or missing request marker remains inconclusive',async()=>{
  for(const body of [
    '{}',JSON.stringify({url:url('policy'),headers:{}}),
    JSON.stringify({url:'https://other.example/',headers:{'X-Kelee-QX-Policy-Probe':'qx953-p1-12345678'}})
  ]) {
    const {result}=await run({method:'GET',url:url('policy')},{statusCode:200,headers:{},body});
    assert.equal(JSON.parse(result.body).verdict,'inconclusive');
  }
});
test('the response control proves hooks and the fixed echo endpoint work',async()=>{
  const {result}=await run({method:'GET',url:url('control')},{statusCode:200,headers:{},
    body:JSON.stringify({url:url('control'),headers:{'X-Kelee-QX-Policy-Probe':'qx953-p1-12345678'}})});
  assert.equal(JSON.parse(result.body).verdict,'control-echo-observed');
});
test('a 404 is never described as reject-policy enforcement',async()=>{
  const {result}=await run({method:'GET',url:url('opts-policy')},{statusCode:404,body:'Not Found IP_SECRET'});
  assert.equal(JSON.parse(result.body).verdict,'inconclusive');
  assert.ok(!result.body.includes('IP_SECRET'));
});
for(const request of [
  {method:'POST',url:url('policy')},
  {method:'GET',url:url('policy')+'&url=https://other.example'},
  {method:'GET',url:url('policy').replace('httpbin.org','other.example')},
  {method:'GET',url:url('policy').replace('qx953-p1-12345678','other')},
  {method:'GET',url:base+'/dashboard?url=https://other.example'}
])test('unrelated or unvalidated requests remain inert: '+request.method+' '+request.url,async()=>{
  assert.deepEqual((await run(request)).result,{});
});
test('calibration uses only a fixed fetch with reject and never forwards browser credentials',async()=>{
  const {result,calls}=await run({method:'GET',url:base+'/calibration',
    headers:{Cookie:'COOKIE_SECRET',Authorization:'AUTH_SECRET'}},undefined,async()=>{throw Error('PRIVATE_ERROR');});
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].opts,{policy:'reject',redirection:false,'auto-cookie':false});
  assert.equal(calls[0].url,'https://httpbin.org/anything/kelee-qx-policy-probe-calibration');
  const report=JSON.parse(result.body);
  assert.equal(report.verdict,'fetch-reject-promise-rejected');
  assert.ok(!JSON.stringify({result,calls}).match(/COOKIE_SECRET|AUTH_SECRET|PRIVATE_ERROR/));
});
test('a calibration HTTP response remains an observation, not proof that reject works',async()=>{
  const {result}=await run({method:'GET',url:base+'/calibration'},undefined,
    async()=>({statusCode:503,body:'SECRET'}));
  const report=JSON.parse(result.body);
  assert.equal(report.verdict,'fetch-reject-response-observed');
  assert.equal(report.observedStatus,503);
  assert.equal(report.provesFullEquivalence,false);
  assert.ok(!result.body.includes('SECRET'));
});
test('one dashboard contains a serial browser test and no global policy mutation',async()=>{
  const {result}=await run({method:'GET',url:base+'/dashboard'});
  assert.match(result.headers['Content-Type'],/text\/html/);
  assert.ok(result.body.includes('开始测试'));
  assert.ok(result.body.includes('opts-policy'));
  assert.ok(!result.body.includes('set_policy_state'));
  assert.ok(!result.body.includes('set_running_mode'));
  assert.match(result.body,/fetch\(/);
  const match=result.body.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(match);
  assert.doesNotThrow(()=>new vm.Script(match[1]));
});
test('the dashboard actually runs five native requests serially between controls',async()=>{
  const {result}=await run({method:'GET',url:base+'/dashboard'});
  const source=result.body.match(/<script>([\s\S]*)<\/script>/)[1];
  const elements={report:{value:''},start:{disabled:false},copy:{}},calls=[];
  let active=0,maxActive=0;
  const context={document:{getElementById:id=>elements[id]},navigator:{},
    AbortController,setTimeout,clearTimeout,Date,
    fetch:async requestURL=>{
      calls.push(requestURL);maxActive=Math.max(maxActive,++active);
      await new Promise(resolve=>setImmediate(resolve));active--;
      return {status:200,json:async()=>({probe:'kelee-qx-native-policy-v1',provesFullEquivalence:false})};
    }};
  vm.runInNewContext(source,context);
  await elements.start.onclick();
  assert.equal(maxActive,1);
  assert.equal(calls[0],base+'/calibration');
  assert.deepEqual(calls.slice(1).map(u=>new URL(u).searchParams.get('mode')),
    ['control','policy','control','opts-policy','control']);
  const report=JSON.parse(elements.report.value);
  assert.equal(report.finished,true);
  assert.equal(report.results.length,5);
  assert.equal(report.provesFullEquivalence,false);
  assert.equal(elements.start.disabled,false);
});
test('browser network failures stay explicit and cannot be mistaken for policy success',async()=>{
  const {result}=await run({method:'GET',url:base+'/dashboard'});
  const source=result.body.match(/<script>([\s\S]*)<\/script>/)[1];
  const elements={report:{value:''},start:{},copy:{}};
  vm.runInNewContext(source,{document:{getElementById:id=>elements[id]},navigator:{},
    AbortController,setTimeout,clearTimeout,Date,fetch:async()=>{throw Error('NETWORK_SECRET');}});
  await elements.start.onclick();
  const report=JSON.parse(elements.report.value);
  assert.equal(report.finished,true);
  assert.ok(report.results.every(r=>r.report.outcome==='request-failed-or-no-report'));
  assert.ok(!elements.report.value.includes('NETWORK_SECRET'));
});
test('the opt-in snippet matches only the dashboard, calibration and fixed native cases',()=>{
  const snippet=path.join(__dirname,'..','probes','policy-probe.snippet');
  assert.ok(fs.existsSync(snippet),'standalone snippet is missing');
  const body=fs.readFileSync(snippet,'utf8'),rules=body.split('\n').filter(line=>line.includes(' url '));
  assert.equal(rules.length,3);
  for(const u of [base+'/dashboard',base+'/calibration',url('control'),url('policy'),url('opts-policy')])
    assert.ok(rules.some(rule=>new RegExp(rule.split(' url ')[0]).test(u)),u);
  assert.ok(!rules.some(rule=>new RegExp(rule.split(' url ')[0]).test(url('policy')+'&extra=1')));
  assert.ok(!/^\[/m.test(body));
});
