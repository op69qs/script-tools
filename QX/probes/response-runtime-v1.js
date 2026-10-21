/* Read-only network probe: no new request, policy change, or persistent storage. */
(function (global, readBindings) {
  'use strict';
  var nativeDone=typeof $done==='function'?$done:global.$done;
  var originalResponse=typeof $response==='undefined'?global.$response:$response;
  if(typeof nativeDone!=='function')return;
  if(typeof $request==='undefined' || $request.method!=='GET' ||
      !/^https:\/\/httpbin\.org(?::443)?\/anything\/kelee-qx-response-runtime-probe$/.test(String($request.url||''))) {
    nativeDone({});return;
  }
  var report={probe:'kelee-qx-response-runtime-v1',provesFullEquivalence:false,
    qxVersion:typeof $environment!=='undefined'?String($environment.version||''):'',
    responseBindingWritable:false,doneBindingWritable:false,argumentBindingWritable:false,
    lexicalBindingsUpdated:false,binaryInputAvailable:false,statusMapped:false,verdict:'inconclusive'};
  var names=['$response','$argument','$done'],saved=names.map(function(name){return Object.getOwnPropertyDescriptor(global,name);});
  report.globalResponseExposed=global.$response===originalResponse;
  report.globalDoneExposed=global.$done===nativeDone;
  var response={},argument={flag:false},done=function(){};
  try {
    Object.keys(originalResponse||{}).forEach(function(key){response[key]=originalResponse[key];});
    response.status=Number(response.statusCode);
    var kind=Object.prototype.toString.call(response.bodyBytes);
    report.binaryInputAvailable=kind==='[object ArrayBuffer]' || kind==='[object Uint8Array]';
    if(saved.some(function(descriptor){return descriptor && !Object.prototype.hasOwnProperty.call(descriptor,'value');}))
      throw new Error('Accessor host binding');
    global.$response=response;global.$argument=argument;global.$done=done;
    report.responseBindingWritable=global.$response===response;
    report.doneBindingWritable=global.$done===done;
    report.argumentBindingWritable=global.$argument===argument;
    var seen=readBindings();
    report.lexicalBindingsUpdated=seen[0]===response && seen[1]===done && seen[2]===argument;
    report.statusMapped=seen[0].status===200;
    report.verdict='host-bindings-not-replaceable';
    if(report.responseBindingWritable && report.doneBindingWritable && report.argumentBindingWritable &&
       report.lexicalBindingsUpdated && report.binaryInputAvailable && report.statusMapped)
      report.verdict='response-runtime-capabilities-observed';
  } catch(_) {report.verdict='host-binding-replacement-failed';}
  // The probe leaves the host objects as it found them; the captured callback
  // delivers only capabilities, never response bytes, headers, or client IPs.
  names.forEach(function(name,index){try{
    if(saved[index])Object.defineProperty(global,name,saved[index]);else delete global[name];
  }catch(_){}});
  nativeDone({headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(report,null,2)});
})(this,function(){return [$response,$done,typeof $argument==='undefined'?undefined:$argument];});
