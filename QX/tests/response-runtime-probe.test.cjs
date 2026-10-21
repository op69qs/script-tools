const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../probes/response-runtime-v1.js'),'utf8');
function run({locked=false,url='https://httpbin.org/anything/kelee-qx-response-runtime-probe',method='GET'}={}) {
  const calls=[],response={statusCode:200,bodyBytes:Uint8Array.from([1,2]).buffer};
  const done=r=>calls.push(r),context={$request:{url,method},$done:done,$environment:{version:'QX TF953'},$response:response};
  if(locked)Object.defineProperty(context,'$response',{value:response,writable:false});
  vm.runInNewContext(source,context,{timeout:1000});
  return {calls,context,done,response};
}
test('native runtime probe observes writable globals and restores all host bindings',()=>{
  const {calls,context,done,response}=run();
  assert.equal(calls.length,1);
  const report=JSON.parse(calls[0].body);
  assert.equal(report.verdict,'response-runtime-capabilities-observed');
  assert.equal(report.provesFullEquivalence,false);
  assert.equal(context.$done,done);assert.equal(context.$response,response);
  assert.equal(Object.hasOwn(context,'$argument'),false);
  assert.ok(!calls[0].body.includes('bodyBytes'));
});
test('immutable globals yield a report without running a replacement request',()=>{
  const {calls,context,done}=run({locked:true});
  assert.equal(calls.length,1);
  assert.equal(JSON.parse(calls[0].body).verdict,'host-binding-replacement-failed');
  assert.equal(context.$done,done);
});
test('lexical-only host bindings still deliver a diagnostic and leave no global properties',()=>{
  const calls=[],context=vm.createContext({capture:r=>calls.push(r),input:{
    statusCode:200,bodyBytes:new ArrayBuffer(1)},$request:{method:'GET',
    url:'https://httpbin.org/anything/kelee-qx-response-runtime-probe'}});
  vm.runInContext('let $done=capture;let $response=input;let $argument="original";',context);
  vm.runInContext(source,context,{timeout:1000});
  assert.equal(calls.length,1);
  const report=JSON.parse(calls[0].body);
  assert.equal(report.globalDoneExposed,false);assert.equal(report.globalResponseExposed,false);
  assert.equal(report.lexicalBindingsUpdated,false);
  assert.equal(report.verdict,'host-bindings-not-replaceable');
  for(const name of ['$done','$response','$argument'])assert.equal(Object.hasOwn(context,name),false);
  assert.equal(vm.runInContext('$argument',context),'original');
});
test('the probe remains inert outside its exact GET endpoint',()=>{
  for(const options of [{method:'POST'},{url:'https://example.com/anything/kelee-qx-response-runtime-probe'},
    {url:'https://httpbin.org/anything/kelee-qx-response-runtime-probe?extra=1'}])
    assert.deepEqual(JSON.parse(JSON.stringify(run(options).calls)),[{}]);
});
