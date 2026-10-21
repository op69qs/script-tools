const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=path.join(__dirname,'../probes/direct-policy-v6.js');
const base='http://httpbingo.org/anything/kelee-qx-direct-probe',id='qx953-d6-1792559000000-12345678';
const key='kelee-qx.direct-policy.v6.httpbingo.http.'+id;
function source(){assert.ok(fs.existsSync(file),'HTTP httpbingo probe v6 has not been implemented');return fs.readFileSync(file,'utf8');}
test('active DIRECT hooks use only fixed HTTP httpbingo v6 and add no TLS interception host',()=>{
  const snippet=fs.readFileSync(path.join(__dirname,'../probes/policy-probe.snippet'),'utf8');
  const direct=snippet.split(/\r?\n/).map(s=>s.trim()).filter(s=>s.includes('/kelee-qx-direct-probe/')&&s.includes(' url '));
  const rules=direct.filter(s=>s.endsWith('/direct-policy-v6.js'));
  assert.equal(rules.length,3);assert.ok(rules.every(s=>s.endsWith('/direct-policy-v6.js')));
  const legacy=direct.filter(s=>s.endsWith('/direct-policy-v5.js'));
  assert.equal(legacy.length,1);assert.equal(direct.length,rules.length+legacy.length);
  const oldPattern=new RegExp(legacy[0].split(' url ')[0]);
  const oldBase='http://httpbin.org/anything/kelee-qx-direct-probe',oldId=id.replace('qx953-d6-','qx953-d2-');
  assert.ok(oldPattern.test(oldBase+'/cleanup?id='+oldId));
  for(const suffix of ['/calibration?id='+oldId,'/verify?id='+oldId,'/request?mode=control&id='+oldId+'-0'])
    assert.ok(!oldPattern.test(oldBase+suffix));
  assert.ok(!/^hostname\s*=.*httpbingo/m.test(snippet));
  const patterns=rules.map(s=>new RegExp(s.split(' url ')[0]));
  assert.ok(patterns.some(p=>p.test(base+'/dashboard')));
  assert.ok(patterns.some(p=>p.test(base.replace('httpbingo.org','httpbingo.org:80')+'/dashboard')));
  for(const suffix of ['/calibration?id='+id,'/verify?id='+id,'/cleanup?id='+id,
    '/request?mode=control&id='+id+'-0','/request?mode=policy-direct&id='+id+'-1','/request?mode=opts-direct&id='+id+'-3'])
    assert.ok(patterns.some(p=>p.test(base+suffix)));
  for(const suffix of ['/dashboard?extra=1','/cleanup?id=wrong','/request?mode=control&id='+id+'-0&extra=1'])
    assert.ok(!patterns.some(p=>p.test(base+suffix)));
  for(const other of [base.replace('http:','https:'),base.replace('httpbingo.org','httpbin.org'),
    base.replace('httpbingo.org','httpbingo.org:81')])assert.ok(!patterns.some(p=>p.test(other+'/dashboard')));
});
function echo(url,origin,marker){return {statusCode:200,body:JSON.stringify({method:'GET',url,origin,
  headers:{'X-Kelee-Qx-Direct-Probe':[marker]}})};}
function harness({prefs=new Map(),mode='filter',fetcher}={}) {
  const calls=[];
  async function run(url,{response,method='GET',headers={}}={}) {
    let finish;
    const completed=new Promise(resolve=>finish=resolve),done=[];
    const context={$request:{url,method,headers},$environment:{version:'QX TF953'},setTimeout,clearTimeout,
      $done:value=>{done.push(value);finish();},$prefs:{valueForKey:k=>prefs.get(k),
        setValueForKey:(v,k)=>{prefs.set(k,v);return true;},removeValueForKey:k=>prefs.delete(k)},
      $configuration:{sendMessage:async message=>{assert.equal(message.action,'get_running_mode');return {ret:mode};}},
      $task:{fetch:async request=>{
        calls.push(request);if(fetcher)return fetcher(request);
        return echo(request.url,'192.0.2.1',request.headers['X-Kelee-QX-Direct-Probe']);
      }}};
    if(response)context.$response=response;
    vm.runInNewContext(source(),context,{timeout:1000});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('v6 did not complete')),1000);
      completed.then(()=>{clearTimeout(timer);resolve();});
    });
    assert.equal(done.length,1);
    let report=null;try{report=JSON.parse(done[0].body);}catch(_){}
    return {payload:done[0],report};
  }
  const operation=op=>run(base+'/'+op+'?id='+id);
  const native=(ordinal,origin='198.51.100.2',extra={})=>{
    const name=['control','policy-direct','control','opts-direct','control'][ordinal],marker=id+'-'+ordinal;
    const url=base+'/request?mode='+name+'&id='+marker;
    const response=echo(url,origin,marker),body={...JSON.parse(response.body),...extra.echo};
    response.body=JSON.stringify(body);Object.assign(response,extra.response||{});
    return run(url,{response,headers:extra.headers||{}});
  };
  return {run,operation,native,prefs,calls};
}

test('v6 accepts a single Go header value and establishes only its fixed HTTP native reference',async()=>{
  const h=harness(),initial=await h.operation('calibration');
  assert.equal(initial.report.directReferenceAvailable,true);
  assert.equal(initial.report.referenceKind,'service-origin-echo');
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].opts.policy,'direct');
  assert.equal(h.calls[0].opts.redirection,false);
  assert.ok(h.calls[0].url.startsWith(base+'-reference?'));
  assert.ok(h.calls[0].url.includes(id));
  const control=await h.native(0);
  assert.equal(control.report.requestMarkerEcho,true);assert.equal(control.report.methodEcho,true);
  assert.equal(control.report.verdict,'alternative-reference-matched');
  assert.equal(control.report.referencesDistinct,true);
  assert.equal((await h.native(1,'192.0.2.1')).report.verdict,'direct-reference-matched');
  assert.equal((await h.native(3)).report.verdict,'alternative-reference-matched');
  assert.equal((await h.operation('verify')).report.directReferenceStable,true);
  await h.operation('cleanup');assert.equal(h.prefs.size,0);
});

test('sanitized live Go echo fixture is recognized by the production v6 response hook',async()=>{
  const fixturePath=path.join(__dirname,'fixtures/httpbingo-get.json');
  assert.ok(fs.existsSync(fixturePath),'sanitized live Go echo fixture has not been recorded');
  const fixture=JSON.parse(fs.readFileSync(fixturePath,'utf8')),h=harness();
  await h.operation('calibration');
  const result=await h.run(fixture.url,{response:{statusCode:200,body:JSON.stringify(fixture)}});
  assert.equal(result.report.requestMarkerEcho,true);assert.equal(result.report.methodEcho,true);
  assert.equal(result.report.sourceEcho,true);assert.equal(result.report.verdict,'alternative-reference-matched');
  assert.ok(!JSON.stringify(result.report).includes(fixture.origin));
});

test('v6 rejects ambiguous marker arrays, duplicate case keys and malformed service data',async()=>{
  for(const headers of [
    {'X-Kelee-Qx-Direct-Probe':[]},
    {'X-Kelee-Qx-Direct-Probe':[id+'-0',id+'-0']},
    {'X-Kelee-Qx-Direct-Probe':[1]},
    {'X-Kelee-Qx-Direct-Probe':{value:id+'-0'}},
    {'X-Kelee-Qx-Direct-Probe':id+'-0','x-kelee-qx-direct-probe':id+'-0'}
  ]) {
    const h=harness();await h.operation('calibration');
    const result=await h.native(0,'198.51.100.2',{echo:{headers}});
    assert.equal(result.report.verdict,'inconclusive');assert.equal(result.report.requestMarkerEcho,false);
    assert.equal(JSON.parse(h.prefs.get(key)).alternativeHash,undefined);
  }
  for(const extra of [{echo:{method:'POST'}},{echo:{url:base.replace('http:','https:')}},
    {response:{statusCode:302}},{response:{body:'null'}},{echo:{origin:'198.51.100.2, 203.0.113.3'}}]){
    const h=harness();await h.operation('calibration');
    assert.equal((await h.native(0,'198.51.100.2',extra)).report.verdict,'inconclusive');
    assert.equal(JSON.parse(h.prefs.get(key)).alternativeHash,undefined);
  }
  const h=harness();await h.operation('calibration');
  assert.equal((await h.native(0,'198.51.100.2',{echo:{headers:{'X-Kelee-Qx-Direct-Probe':id+'-0'}}})).report.requestMarkerEcho,true);
});

test('client origin headers taint a native observation but platform-added echo headers do not',async()=>{
  for(const name of ['Fly-Client-IP','CF-Connecting-IP','Fastly-Client-IP','True-Client-IP','X-Forwarded-For']) {
    const h=harness();await h.operation('calibration');
    const result=await h.native(0,'198.51.100.2',{headers:{[name]:'203.0.113.99'}});
    assert.equal(result.report.clientOriginHeadersPresent,true);
    assert.equal(result.report.verdict,'client-origin-header-present');
    assert.equal(JSON.parse(h.prefs.get(key)).alternativeHash,undefined);
    const request=await h.run(base+'/request?mode=policy-direct&id='+id+'-1',{headers:{[name]:'203.0.113.99'}});
    assert.deepEqual(JSON.parse(JSON.stringify(request.payload)),{});
  }
  const h=harness();await h.operation('calibration');
  const result=await h.native(0,'198.51.100.2',{echo:{headers:{
    'X-Kelee-Qx-Direct-Probe':[id+'-0'],'Fly-Client-IP':['198.51.100.2']
  }}});
  assert.equal(result.report.clientOriginHeadersPresent,false);
  assert.equal(result.report.verdict,'alternative-reference-matched');
});

test('request hooks preserve Host, UA and other headers and never replay original operations',async()=>{
  const original=Object.freeze({Host:'httpbingo.org','User-Agent':'fixture-agent',Accept:'text/html',Cookie:'fixture-cookie',
    'cache-control':'old',CONNECTION:'keep-alive','x-kelee-qx-direct-probe':'old'});
  const h=harness();
  for(const [ordinal,name] of [[0,'control'],[1,'policy-direct'],[3,'opts-direct']]) {
    const result=await h.run(base+'/request?mode='+name+'&id='+id+'-'+ordinal,{headers:original});
    for(const field of ['Host','User-Agent','Accept','Cookie'])assert.equal(result.payload.headers[field],original[field]);
    assert.notEqual(result.payload.headers,original);
    assert.equal(result.payload.policy,name==='policy-direct'?'direct':undefined);
    assert.equal(result.payload.opts&&result.payload.opts.policy,name==='opts-direct'?'direct':undefined);
    for(const field of ['cache-control','connection','x-kelee-qx-direct-probe'])
      assert.equal(Object.keys(result.payload.headers).filter(k=>k.toLowerCase()===field).length,1);
  }
  assert.equal(original['cache-control'],'old');assert.equal(h.calls.length,0);
});

test('other protocols, authorities, ports, methods, paths and mismatched ordinal modes stay inert',async()=>{
  const selected=base+'/request?mode=control&id='+id+'-0';
  for(const [url,options] of [
    [selected.replace('http:','https:'),{}],[selected.replace('httpbingo.org','httpbin.org'),{}],
    [selected.replace('httpbingo.org','httpbingo.org.evil.invalid'),{}],
    [selected.replace('httpbingo.org','httpbingo.org:81'),{}],[selected,{method:'POST'}],
    [selected+'&extra=1',{}],[selected.replace('mode=control','mode=policy-direct'),{}],
    [base+'/other',{}]
  ]){
    const h=harness(),result=await h.run(url,options);
    assert.deepEqual(JSON.parse(JSON.stringify(result.payload)),{});assert.equal(h.prefs.size,0);assert.equal(h.calls.length,0);
  }
  const h=harness();const result=await h.run(selected.replace('httpbingo.org','httpbingo.org:80'));
  assert.equal(result.payload.headers['X-Kelee-QX-Direct-Probe'],id+'-0');
});

test('an explicit default HTTP port in the service echo matches the accepted request authority',async()=>{
  const h=harness();await h.operation('calibration');
  const url=base.replace('httpbingo.org','httpbingo.org:80')+'/request?mode=control&id='+id+'-0';
  const result=await h.run(url,{response:echo(url,'198.51.100.2',id+'-0')});
  assert.equal(result.report.sourceEcho,true);
  assert.equal(result.report.verdict,'alternative-reference-matched');
});

test('references require the fixed GET URL, exact marker and a single service-origin value',async()=>{
  for(const mutate of [
    body=>({...body,url:body.url.replace('http:','https:')}),
    body=>({...body,method:'POST'}),body=>({...body,headers:{}}),
    body=>({...body,origin:'192.0.2.1, 203.0.113.1'})
  ]) {
    const h=harness({fetcher:request=>{
      const response=echo(request.url,'192.0.2.1',request.headers['X-Kelee-QX-Direct-Probe']);
      response.body=JSON.stringify(mutate(JSON.parse(response.body)));return response;
    }});
    assert.equal((await h.operation('calibration')).report.directReferenceAvailable,false);
    assert.equal(h.prefs.size,0);
  }
  for(const mode of ['all_proxy','all_direct','unknown']){
    const h=harness({mode});const result=await h.operation('calibration');
    assert.equal(result.report.runningMode,mode);assert.equal(result.report.directReferenceAvailable,false);
    assert.equal(h.prefs.size,0);
  }
});

test('references cannot be replaced by later controls and changing DIRECT references fail stability',async()=>{
  let reads=0;
  const h=harness({fetcher:request=>echo(request.url,++reads===1?'192.0.2.1':'192.0.2.2',
    request.headers['X-Kelee-QX-Direct-Probe'])});
  await h.operation('calibration');const initial=await h.native(0);
  const stored=h.prefs.get(key);
  assert.equal((await h.native(0,'203.0.113.9')).report.verdict,'inconclusive');
  assert.equal((await h.native(2,'203.0.113.9')).report.verdict,'inconclusive');
  assert.equal(h.prefs.get(key),stored);
  const verified=await h.operation('verify');
  assert.equal(verified.report.directReferenceStable,false);
  assert.equal(verified.report.nativeReferenceId,initial.report.nativeReferenceId);
});

test('single IPv4 and compressed IPv6 origin echoes are accepted; malformed or ambiguous values are inconclusive',async()=>{
  for(const address of ['198.51.100.2','2001:db8::1','2001:db8:0:0:0:0:0:1']){
    const h=harness();await h.operation('calibration');
    assert.equal((await h.native(0,address)).report.verdict,'alternative-reference-matched');
  }
  for(const address of ['999.51.100.2','0198.51.100.2','192.000.2.1','example.org','2001:::1','1:2:3:4:5:6:7','1::2::3',
    '1:2:3:4:5:6:7:8::','198.51.100.2, 203.0.113.2','']){
    const h=harness();await h.operation('calibration');
    assert.equal((await h.native(0,address)).report.verdict,'inconclusive');
  }
});

test('equivalent IPv6 and mapped IPv4 representations cannot create distinct exit references',async()=>{
  for(const [direct,control] of [
    ['2001:db8::1','2001:db8:0:0:0:0:0:1'],
    ['2001:0DB8:0000:0000:0000:0000:0000:0001','2001:db8::1'],
    ['::','0:0:0:0:0:0:0:0'],
    ['192.0.2.1','::ffff:c000:201'],
    ['0:0:0:0:0:FFFF:C000:0201','192.0.2.1']
  ]) {
    const h=harness({fetcher:request=>echo(request.url,direct,request.headers['X-Kelee-QX-Direct-Probe'])});
    assert.equal((await h.operation('calibration')).report.directReferenceAvailable,true);
    const result=await h.native(0,control);
    assert.equal(result.report.referencesDistinct,false,direct+' and '+control+' identify the same address');
    assert.equal(result.report.verdict,'direct-reference-matched');
    assert.equal((await h.operation('verify')).report.directReferenceStable,true);
  }
});

test('cleanup isolates v6 from historical services and prevents late result resurrection',async()=>{
  const prefs=new Map([['kelee-qx.direct-policy.v5.http.'+id,'historical']]),h=harness({prefs});
  await h.operation('calibration');await h.operation('cleanup');await h.native(0);
  assert.equal(prefs.size,1);assert.equal(prefs.values().next().value,'historical');
  let resolve;
  const late=harness({fetcher:request=>new Promise(r=>resolve=()=>r(echo(request.url,'192.0.2.1',
    request.headers['X-Kelee-QX-Direct-Probe'])))});
  const pending=late.operation('calibration');await new Promise(r=>setImmediate(r));
  await late.operation('cleanup');resolve();
  assert.equal((await pending).report.verdict,'reference-cancelled');assert.equal(late.prefs.size,0);
});

test('reports contain only selected evidence, not origins, headers, salts or stored tokens',async()=>{
  const h=harness();const reports=[(await h.operation('calibration')).report,(await h.native(0)).report,
    (await h.operation('verify')).report];
  for(const report of reports){
    assert.equal(report.provesFullEquivalence,false);
    assert.equal(report.referenceKind,'service-origin-echo');
    assert.ok(!JSON.stringify(report).match(/192\.0\.2\.1|198\.51\.100\.2|fixture-cookie|"salt"|"token"|directHash|alternativeHash/));
  }
});

async function dashboard({same=false,changed=false,changedReference=false,unstableDirect=false,mode='filter',differentMode=false,
  positivePolicy=true,positiveOpts=true}={}) {
  let html;vm.runInNewContext(source(),{$request:{method:'GET',url:base+'/dashboard'},$done:r=>html=r.body});
  const code=html.match(/<script>([\s\S]*)<\/script>/)[1],elements={start:{},copy:{},report:{value:''}},calls=[];
  vm.runInNewContext(code,{document:{getElementById:k=>elements[k]},navigator:{},AbortController,setTimeout,clearTimeout,
    fetch:async url=>{
      calls.push(url);
      let verdict=url.includes('mode=control')?'alternative-reference-matched':'direct-reference-matched';
      if(same&&url.includes('mode=control'))verdict='direct-reference-matched';
      if(changed&&url.endsWith('-2'))verdict='inconclusive';
      if(!positivePolicy&&url.includes('mode=policy-direct'))verdict='alternative-reference-matched';
      if(!positiveOpts&&url.includes('mode=opts-direct'))verdict='alternative-reference-matched';
      return {json:async()=>({probe:'kelee-qx-direct-policy-v6',transport:'http',referenceKind:'service-origin-echo',
        directReferenceAvailable:mode==='filter',referencesDistinct:!same,directReferenceStable:!unstableDirect,
        runningMode:differentMode&&url.includes('/verify?')?'all_proxy':mode,verdict,
        nativeReferenceId:changedReference&&url.endsWith('-2')?'reference-B':'reference-A'})};
    }});
  await elements.start.onclick();return {report:JSON.parse(elements.report.value),calls};
}

test('browser requires distinguishable controls, stable identifiers/references and filter mode for each payload result',async()=>{
  const good=await dashboard();
  assert.equal(good.report.probe,'kelee-qx-direct-policy-browser-v6');
  assert.equal(good.report.results.length,5);assert.equal(good.report.finished,true);
  assert.equal(good.report.assessment['policy-direct'],'direct-egress-observed-between-native-controls');
  assert.equal(good.report.assessment['opts-direct'],'direct-egress-observed-between-native-controls');
  assert.ok(good.calls.every(url=>url.startsWith('http://httpbingo.org/')));
  assert.ok(good.calls.at(-1).includes('/cleanup?'));
  for(const options of [{changed:true},{changedReference:true},{unstableDirect:true},{differentMode:true}]) {
    const bad=await dashboard(options);
    assert.equal(bad.report.assessment['policy-direct'],'inconclusive');
    assert.equal(bad.report.assessment['opts-direct'],'inconclusive');
  }
  const negative=await dashboard({positivePolicy:false});
  assert.equal(negative.report.assessment['policy-direct'],'direct-not-observed-with-this-payload');
  assert.equal(negative.report.assessment['opts-direct'],'direct-egress-observed-between-native-controls');
  for(const options of [{same:true},{mode:'all_proxy'}]){
    const stopped=await dashboard(options);assert.ok(stopped.report.results.length<=1);
    assert.equal(stopped.report.assessment['policy-direct'],'inconclusive');assert.equal(stopped.report.finished,true);
    assert.ok(stopped.calls.at(-1).includes('/cleanup?'));
  }
});
