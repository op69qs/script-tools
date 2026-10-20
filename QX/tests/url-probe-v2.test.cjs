const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test'),assert=require('node:assert/strict');
const origin='https://httpbin.org/anything/kelee-qx-url-target-probe';
const source=mode=>origin+'?mode='+mode+'&id=qx953-v2-'+(mode==='cross-host-header'?'host':'cross');
const target=mode=>'https://www.cloudflare.com/cdn-cgi/trace?kelee_qx_probe='+mode+'&id=qx953-v2-'+(mode==='cross-host-header'?'host':'cross');
function run(file,request,response) {
  const calls=[],logs=[],context={$request:request,$environment:{version:'iOS 27.0.1 v1.9.0-build953'},
    $done:value=>calls.push(value),console:{log:value=>logs.push(value)}};
  if(response)context.$response=response;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','probes',file),'utf8'),context,{timeout:1000});
  assert.equal(calls.length,1);
  return {result:JSON.parse(JSON.stringify(calls[0]||{})),logs};
}
test('v2 native URL-only case preserves a separate fixed ID',()=>{
  const {result}=run('url-target-request-v2.js',{method:'GET',url:source('cross-host')});
  assert.deepEqual(result,{url:target('cross-host')});
});
test('v2 Host comparison replaces all host variants and omits credentials',()=>{
  const request={method:'GET',url:source('cross-host-header'),
    headers:{Host:'old',hOsT:'old2',':authority':'old3',Cookie:'COOKIE_SECRET',authorization:'AUTH_SECRET',
      'Proxy-Authorization':'PROXY_SECRET',Accept:'text/plain'}};
  const {result,logs}=run('url-target-request-v2.js',request);
  assert.deepEqual(result,{url:target('cross-host-header'),headers:{Accept:'text/plain',Host:'www.cloudflare.com'}});
  assert.ok(!JSON.stringify({result,logs}).match(/COOKIE_SECRET|AUTH_SECRET|PROXY_SECRET/));
  assert.equal(request.headers.Host,'old');
});
for(const kind of ['source','partial','target'])
  test('v2 response recognizes only a fixed '+kind+' URL',()=>{
    const url=kind==='source'?source('cross-host'):kind==='target'?target('cross-host'):target('cross-host').replace('www.cloudflare.com','httpbin.org');
    const {result,logs}=run('url-target-response-v2.js',{method:'GET',url},
      {statusCode:404,body:'<h1>Not Found</h1><p>The requested URL was not found on the server.</p> SECRET ip=1.2.3.4'});
    const report=JSON.parse(result.body);
    assert.equal(report.observedURLKind,kind);
    assert.equal(report.observedStatus,404);
    assert.equal(report.evidence.notFoundTemplateObserved,true);
    assert.equal(report.verdict,'inconclusive');
    assert.equal(report.provesFullEquivalence,false);
    assert.ok(!JSON.stringify({result,logs}).match(/SECRET|1\.2\.3\.4/));
  });
test('v2 target signature stays candidate evidence with either mode',()=>{
  for(const mode of ['cross-host','cross-host-header']){
    const {result}=run('url-target-response-v2.js',{method:'GET',url:source(mode)},
      {statusCode:200,body:'h=www.cloudflare.com\nip=1.2.3.4\ntls=TLSv1.3\nvisit_scheme=https\n'});
    const report=JSON.parse(result.body);
    assert.equal(report.verdict,'target-service-signature-observed');
    assert.equal(report.mode,mode);
    assert.equal(report.provesFullEquivalence,false);
    assert.ok(!result.body.includes('1.2.3.4'));
  }
});
test('v2 controls still work with new IDs',()=>{
  const control=origin+'?mode=control&id=qx953-v2-control';
  assert.deepEqual(run('url-target-request-v2.js',{method:'GET',url:control}).result,{});
  const same=origin+'?mode=same-origin&id=qx953-v2-same';
  const proposed=run('url-target-request-v2.js',{method:'GET',url:same}).result.url;
  const {result}=run('url-target-response-v2.js',{method:'GET',url:proposed},
    {statusCode:200,body:JSON.stringify({url:proposed})});
  assert.equal(JSON.parse(result.body).verdict,'same-origin-path-observed');
});
test('v2 request and response leave old, mismatched or arbitrary inputs inert',()=>{
  for(const request of [
    {method:'POST',url:source('cross-host-header')},
    {method:'GET',url:source('cross-host')+'&url=https://other.example'},
    {method:'GET',url:origin+'?mode=cross-host&id=qx953-cross'},
    {method:'GET',url:origin+'?mode=cross-host&id=qx953-v2-host'},
    {method:'GET',url:target('cross-host').replace('www.cloudflare.com','other.example')}
  ])for(const file of ['url-target-request-v2.js','url-target-response-v2.js'])
    assert.deepEqual(run(file,request,{statusCode:200,body:'secret'}).result,{});
});
test('v2 snippet catches partial paths and references fresh script file URLs',()=>{
  const snippet=fs.readFileSync(path.join(__dirname,'..','probes','url-target.snippet'),'utf8');
  for(const mode of ['cross-host','cross-host-header'])
    for(const url of [source(mode),target(mode),target(mode).replace('www.cloudflare.com','httpbin.org')])
      assert.ok(snippet.split('\n').filter(line=>line.includes(' url script-response-body ')).some(line=>
        new RegExp(line.split(' url ')[0]).test(url)),'missing response observation: '+url);
  assert.match(snippet,/url-target-request-v2\.js/);
  assert.match(snippet,/url-target-response-v2\.js/);
});
