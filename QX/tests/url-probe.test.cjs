const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test'),assert=require('node:assert/strict');
const origin='https://httpbin.org/anything/kelee-qx-url-target-probe';
function run(file,request,response) {
  const script=path.join(__dirname,'..','probes',file);
  assert.ok(fs.existsSync(script),'the opt-in probe must exist');
  const calls=[],logs=[],context={$request:request,$environment:{version:'Quantumult X 1.9.0 build 953'},
    $done:value=>calls.push(value),console:{log:value=>logs.push(value)}};
  if(response)context.$response=response;
  vm.runInNewContext(fs.readFileSync(script,'utf8'),context,{timeout:1000});
  assert.equal(calls.length,1);
  return {result:JSON.parse(JSON.stringify(calls[0]||{})),logs};
}
test('control keeps its request unchanged and records the fixed probe ID',()=>{
  const {result,logs}=run('url-target-request.js',{method:'GET',url:origin+'?mode=control&id=qx953-control'});
  assert.deepEqual(result,{});
  assert.ok(logs.some(line=>line.includes('qx953-control') && line.includes('953')));
});
test('same-origin test returns only a fixed native URL proposal',()=>{
  const {result}=run('url-target-request.js',{method:'GET',url:origin+'?mode=same-origin&id=qx953-same'});
  assert.deepEqual(result,{url:'https://httpbin.org/anything/kelee-qx-url-target-result?kelee_qx_probe=same-origin&id=qx953-same'});
});
test('cross-host test returns only the fixed target with no fetch compensation',()=>{
  const {result}=run('url-target-request.js',{method:'GET',url:origin+'?mode=cross-host&id=qx953-cross'});
  assert.deepEqual(result,{url:'https://www.cloudflare.com/cdn-cgi/trace?kelee_qx_probe=cross-host&id=qx953-cross'});
});
for(const request of [
  {method:'POST',url:origin+'?mode=cross-host&id=qx953-cross'},
  {method:'GET',url:origin+'?mode=cross-host&id=qx953-cross&url=https://other.example'},
  {method:'GET',url:'https://httpbin.org/anything/not-this-probe'},
  {method:'GET',url:origin+'?mode=invalid&id=qx953-cross'}
])test('probe leaves other requests inert: '+request.method+' '+request.url,()=>{
  assert.deepEqual(run('url-target-request.js',request).result,{});
});
test('cross-host response reports only selected evidence and keeps a shared probe ID',()=>{
  const {result,logs}=run('url-target-response.js',
    {method:'GET',url:origin+'?mode=cross-host&id=qx953-cross',headers:{Cookie:'COOKIE_SECRET'}},
    {statusCode:200,headers:{Authorization:'AUTH_SECRET'},body:'h=www.cloudflare.com\nip=1.2.3.4\ntls=TLSv1.3\nvisit_scheme=https\n'});
  const report=JSON.parse(result.body);
  assert.equal(report.verdict,'target-service-signature-observed');
  assert.equal(report.probeId,'qx953-cross');
  assert.equal(report.provesFullEquivalence,false);
  assert.ok(!JSON.stringify({result,logs}).match(/COOKIE_SECRET|AUTH_SECRET|1\.2\.3\.4/));
});
test('response also recognizes the rewritten target URL',()=>{
  const {result}=run('url-target-response.js',
    {method:'GET',url:'https://www.cloudflare.com/cdn-cgi/trace?kelee_qx_probe=cross-host&id=qx953-cross'},
    {statusCode:200,body:'h=www.cloudflare.com\ntls=TLSv1.3\nvisit_scheme=https\n'});
  assert.equal(JSON.parse(result.body).probeId,'qx953-cross');
});
test('an unchanged source URL is evidence only of the original endpoint response',()=>{
  const url=origin+'?mode=cross-host&id=qx953-cross';
  const {result}=run('url-target-response.js',{method:'GET',url},
    {statusCode:200,body:JSON.stringify({url,headers:{Cookie:'SECRET'}})});
  assert.equal(JSON.parse(result.body).verdict,'original-endpoint-observed');
  assert.ok(!result.body.includes('SECRET'));
});
test('redirects and unrelated responses remain inconclusive',()=>{
  for(const statusCode of [302,403,500]){
    const {result}=run('url-target-response.js',{method:'GET',url:origin+'?mode=cross-host&id=qx953-cross'},
      {statusCode,body:'h=www.cloudflare.com\ntls=TLSv1.3\nvisit_scheme=https\n'});
    assert.equal(JSON.parse(result.body).verdict,'inconclusive');
  }
});
