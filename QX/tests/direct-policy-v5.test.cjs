const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=path.join(__dirname,'../probes/direct-policy-v5.js');
const base='https://httpbin.org/anything/kelee-qx-direct-probe',id='qx953-d2-1792542000000-12345678';
const key='kelee-qx.direct-policy.v5.https.'+id;
test('historical v5 still serves its fixed HTTP and HTTPS dashboards',()=>{
  for(const origin of ['http://httpbin.org','http://httpbin.org:80','https://httpbin.org','https://httpbin.org:443']){
    let result;vm.runInNewContext(source(),{$request:{method:'GET',url:origin+'/anything/kelee-qx-direct-probe/dashboard'},
      $done:value=>result=value});
    assert.ok(result.body.includes('kelee-qx-direct-policy-browser-v5'));
  }
});
function source(){assert.ok(fs.existsSync(file),'native-reference probe v5 has not been implemented');return fs.readFileSync(file,'utf8');}
function harness({prefs=new Map(),mode='filter',fetcher}={}) {
  const calls=[];
  async function run(url,{response,method='GET',headers}={}) {
    let finish;
    const completed=new Promise(resolve=>{finish=resolve;});
    const done=[],context={$request:{url,method,headers},$environment:{version:'QX TF953'},setTimeout,clearTimeout,
      $done:r=>{done.push(r);finish();},$prefs:{valueForKey:k=>prefs.get(k),
        setValueForKey:(v,k)=>{prefs.set(k,v);return true;},removeValueForKey:k=>prefs.delete(k)},
      $configuration:{sendMessage:async m=>{assert.equal(m.action,'get_running_mode');return {ret:mode};}},
      $task:{fetch:async request=>{
        calls.push(request);
        if(fetcher)return fetcher(request);
        return {statusCode:200,body:JSON.stringify({url:request.url,origin:'192.0.2.1'})};
      }}};
    if(response)context.$response=response;
    vm.runInNewContext(source(),context,{timeout:1000});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('probe did not finish')),1000);
      completed.then(()=>{clearTimeout(timer);resolve();});
    });
    assert.equal(done.length,1);
    return {payload:done[0],report:done[0].body?JSON.parse(done[0].body):null};
  }
  const operation=op=>run(base+'/'+op+'?id='+id);
  const native=async(ordinal,origin='198.51.100.2',extra={})=>{
    const name=['control','policy-direct','control','opts-direct','control'][ordinal];
    const marker=id+'-'+ordinal,url=base+'/request?mode='+name+'&id='+marker;
    const response={statusCode:200,body:JSON.stringify({url,origin,headers:{'X-Kelee-QX-Direct-Probe':marker},...extra.echo}),...extra.response};
    return run(url,{response});
  };
  return {run,operation,native,calls,prefs};
}

test('v5 only FETCHes an explicit DIRECT reference and waits for the native control',async()=>{
  const h=harness(),{report}=await h.operation('calibration');
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].opts.policy,'direct');
  assert.equal(report.directReferenceAvailable,true);assert.equal(report.referencesDistinct,false);
  assert.equal(report.verdict,'awaiting-native-reference');
  assert.ok(!JSON.stringify(report).includes('192.0.2.1'));
});

test('validated control-0 establishes a distinct reference; subsequent controls cannot replace it',async()=>{
  const h=harness();await h.operation('calibration');
  const initial=await h.native(0);
  assert.equal(initial.report.verdict,'alternative-reference-matched');
  assert.equal(initial.report.referencesDistinct,true);
  const stored=h.prefs.get(key);
  assert.equal((await h.native(0,'203.0.113.3')).report.verdict,'inconclusive');
  assert.equal((await h.native(2,'203.0.113.3')).report.verdict,'inconclusive');
  assert.equal(h.prefs.get(key),stored);
  assert.equal((await h.native(1,'192.0.2.1')).report.verdict,'direct-reference-matched');
  const verify=await h.operation('verify');
  assert.equal(verify.report.directReferenceStable,true);
  assert.ok(!JSON.stringify(initial.report).match(/198\.51|Hash|salt|token/));
});

test('a matching marker, exact service echo, status 200 and control-0 are all required to initialize',async()=>{
  for(const [ordinal,extra] of [[0,{echo:{headers:{}}}],[0,{echo:{url:base+'/other'}}],
    [0,{response:{statusCode:404}}],[2,{}],[1,{}]]) {
    const h=harness();await h.operation('calibration');
    await h.native(ordinal,'198.51.100.2',extra);
    assert.equal(JSON.parse(h.prefs.get(key)).alternativeHash,undefined);
  }
});

test('non-object service JSON always finishes inconclusively without initializing a baseline',async()=>{
  for(const body of ['null','[]','"text"','17','not json']){
    const h=harness();await h.operation('calibration');
    const {report}=await h.native(0,'198.51.100.2',{response:{body}});
    assert.equal(report.verdict,'inconclusive');
    assert.equal(JSON.parse(h.prefs.get(key)).alternativeHash,undefined);
  }
});

test('HTTP and HTTPS use independent references and fixed protocol-matched FETCH requests',async()=>{
  const h=harness();await h.operation('calibration');
  const httpBase=base.replace('https:','http:');
  const initial=await h.run(httpBase+'/calibration?id='+id);
  assert.equal(initial.report.transport,'http');
  assert.ok(h.calls[1].url.startsWith('http://httpbin.org/'));
  assert.equal(h.calls[1].opts.redirection,false);
  const storedHTTP=JSON.parse(h.prefs.get('kelee-qx.direct-policy.v5.http.'+id));
  assert.equal(storedHTTP.transport,'http');
  await h.run(httpBase+'/cleanup?id='+id);
  assert.ok(h.prefs.has(key));
  const marker=id+'-0',url=httpBase+'/request?mode=control&id='+marker;
  const late=await h.run(url,{response:{statusCode:200,body:JSON.stringify({url,origin:'198.51.100.2',
    headers:{'X-Kelee-QX-Direct-Probe':marker}})}});
  assert.equal(late.report.referenceAvailable,false);
  assert.equal(JSON.parse(h.prefs.get(key)).alternativeHash,undefined);
});

test('upgraded URL echoes and redirects cannot establish an HTTP reference',async()=>{
  for(const response of [{statusCode:200,body:JSON.stringify({url:base+'-reference',origin:'192.0.2.1'})},
    {statusCode:302,body:'redirect'}]) {
    const h=harness({fetcher:async()=>response});
    const initial=await h.run(base.replace('https:','http:')+'/calibration?id='+id);
    assert.equal(initial.report.directReferenceAvailable,false);
  }
});

test('cleanup prevents late native response writes and late calibration writes',async()=>{
  const h=harness();await h.operation('calibration');await h.operation('cleanup');await h.native(0);
  assert.equal(h.prefs.size,0);
  let resolve;
  const late=harness({fetcher:request=>new Promise(r=>{resolve=()=>r({statusCode:200,
    body:JSON.stringify({url:request.url,origin:'192.0.2.1'})});})});
  const pending=late.operation('calibration');
  await new Promise(r=>setImmediate(r));
  await late.operation('cleanup');resolve();
  assert.equal((await pending).report.verdict,'reference-cancelled');
  assert.equal(late.prefs.size,0);
});

test('request payloads test each spelling on the original operation without policy changes in controls',async()=>{
  const h=harness();
  for(const mode of ['control','policy-direct','opts-direct']) {
    const {payload}=await h.run(base+'/request?mode='+mode+'&id='+id+'-1');
    assert.equal(payload.policy,mode==='policy-direct'?'direct':undefined);
    assert.equal(payload.opts&&payload.opts.policy,mode==='opts-direct'?'direct':undefined);
    assert.ok(payload.headers['X-Kelee-QX-Direct-Probe']);
  }
  assert.equal(h.calls.length,0);
});

test('request hooks preserve original headers and replace only diagnostic fields without duplicates or mutation',async()=>{
  const original=Object.freeze({Host:'httpbin.org','uSeR-aGeNt':'fixture-agent/1.0',Accept:'text/html',
    Cookie:'fixture-cookie',Authorization:'fixture-auth','X-Other':'keep',
    'cache-control':'old-cache',CONNECTION:'keep-alive','x-kelee-qx-direct-probe':'stale-marker'});
  const snapshot=JSON.stringify(original),h=harness();
  for(const transport of ['http','https'])for(const mode of ['control','policy-direct','opts-direct']){
    const {payload}=await h.run(base.replace('https:',transport+':')+'/request?mode='+mode+'&id='+id+'-1',{headers:original});
    for(const name of ['Host','uSeR-aGeNt','Accept','Cookie','Authorization','X-Other'])
      assert.equal(payload.headers[name],original[name],name+' must be preserved');
    assert.notEqual(payload.headers,original);
    for(const [name,value] of [['Cache-Control','no-cache'],['Connection','close'],['X-Kelee-QX-Direct-Probe',id+'-1']]){
      const matching=Object.keys(payload.headers).filter(key=>key.toLowerCase()===name.toLowerCase());
      assert.equal(matching.length,1,name+' must have one spelling');assert.equal(payload.headers[matching[0]],value);
    }
    assert.equal(JSON.stringify(original),snapshot);
  }
  assert.equal(h.calls.length,0);
});

async function dashboard({same=false,changed=false,changedReference=false,unstableDirect=false,transport='https'}={}) {
  let html;
  vm.runInNewContext(source(),{$request:{method:'GET',url:base.replace('https:',transport+':')+'/dashboard'},$done:r=>html=r.body});
  const code=html.match(/<script>([\s\S]*)<\/script>/)[1];
  const elements={start:{},copy:{},report:{value:''}},calls=[];
  vm.runInNewContext(code,{document:{getElementById:k=>elements[k]},navigator:{},AbortController,setTimeout,clearTimeout,
    fetch:async url=>{
      calls.push(url);
      let verdict=url.includes('mode=control')?'alternative-reference-matched':'direct-reference-matched';
      if(same && url.includes('mode=control'))verdict='direct-reference-matched';
      if(changed && url.endsWith('-2'))verdict='inconclusive';
    const report={probe:'kelee-qx-direct-policy-v5',transport,directReferenceAvailable:true,
        referencesDistinct:!same,directReferenceStable:!unstableDirect,runningMode:'filter',verdict,
        nativeReferenceId:changedReference && url.endsWith('-2')?'reference-B':'reference-A'};
      return {json:async()=>report};
    }});
  await elements.start.onclick();
  return {report:JSON.parse(elements.report.value),calls};
}

test('the browser measures one native control even when there is no alternate FETCH reference',async()=>{
  const {report,calls}=await dashboard({same:true});
  assert.equal(report.results.length,1);assert.equal(report.stopReason,'native-reference-not-distinct');
  assert.equal(report.finished,true);assert.ok(calls.at(-1).includes('/cleanup?'));
  assert.equal(report.assessment['policy-direct'],'inconclusive');
});

test('an HTTP dashboard runs only HTTP operations and labels the measured transport',async()=>{
  const {report,calls}=await dashboard({transport:'http'});
  assert.equal(report.transport,'http');
  assert.ok(calls.every(url=>url.startsWith('http://httpbin.org/')));
  assert.equal(report.assessment['policy-direct'],'direct-egress-observed-between-native-controls');
});

test('positive assessments require stable DIRECT, three native controls and separate policy outcomes',async()=>{
  const good=await dashboard();
  assert.equal(good.report.results.length,5);
  assert.equal(good.report.assessment['policy-direct'],'direct-egress-observed-between-native-controls');
  assert.equal(good.report.assessment['opts-direct'],'direct-egress-observed-between-native-controls');
  for(const options of [{changed:true},{changedReference:true},{unstableDirect:true}]){
    const changed=await dashboard(options);
    assert.equal(changed.report.assessment['policy-direct'],'inconclusive');
    assert.equal(changed.report.assessment['opts-direct'],'inconclusive');
  }
});
