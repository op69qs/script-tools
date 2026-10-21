/* Native control reference; no proxy FETCH, request replay, or global policy mutation. */
(function () {
  'use strict';
  function sha256(text) {
    var k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    var h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var bytes = [], i, j;
    for (i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) > 127) throw new Error('ASCII input required');
      bytes.push(text.charCodeAt(i));
    }
    var length = bytes.length * 8; bytes.push(128);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : length >>> (i * 8) & 255);
    function rotate(x,n) { return x >>> n | x << (32-n); }
    for (i = 0; i < bytes.length; i += 64) {
      var w = [];
      for (j = 0; j < 16; j++) w[j] = bytes[i+j*4]<<24 | bytes[i+j*4+1]<<16 | bytes[i+j*4+2]<<8 | bytes[i+j*4+3];
      for (; j < 64; j++) {
        var x = w[j-15], y = w[j-2];
        w[j] = (w[j-16] + (rotate(x,7)^rotate(x,18)^x>>>3) + w[j-7] + (rotate(y,17)^rotate(y,19)^y>>>10)) | 0;
      }
      var a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],z=h[7];
      for (j = 0; j < 64; j++) {
        var t1 = (z + (rotate(e,6)^rotate(e,11)^rotate(e,25)) + (e&f^~e&g) + k[j] + w[j]) | 0;
        var t2 = ((rotate(a,2)^rotate(a,13)^rotate(a,22)) + (a&b^a&c^b&c)) | 0;
        z=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
      }
      var state=[a,b,c,d,e,f,g,z];
      for (j = 0; j < 8; j++) h[j]=(h[j]+state[j])|0;
    }
    return h.map(function (x) { return ('00000000'+(x>>>0).toString(16)).slice(-8); }).join('');
  }
  if(typeof module!=='undefined' && module.exports){module.exports={sha256:sha256};return;}
  var request=typeof $request!=='undefined'?$request:{};
  var url=String(request.url||'').replace(/^https:\/\/httpbin\.org:443\//,'https://httpbin.org/')
    .replace(/^http:\/\/httpbin\.org:80\//,'http://httpbin.org/');
  var protocol=(url.match(/^(https?):\/\/httpbin\.org\//)||[])[1];
  if(!protocol){$done({});return;}
  var base=protocol+'://httpbin.org/anything/kelee-qx-direct-probe',prefix='kelee-qx.direct-policy.v5.'+protocol+'.';
  var version=typeof $environment!=='undefined'?String($environment.version||''):'';
  function record(mode,id){return {probe:'kelee-qx-direct-policy-v5',transport:protocol,mode:mode,probeId:id,qxVersion:version,provesFullEquivalence:false};}
  function reply(data,type){return {status:'HTTP/1.1 200 OK',headers:{'Content-Type':type||'application/json; charset=utf-8',
    'Cache-Control':'no-store',Connection:'close'},body:typeof data==='string'?data:JSON.stringify(data,null,2)};}
  function load(id){
    try{
      var raw=$prefs.valueForKey(prefix+id),data=raw?JSON.parse(raw):null;
      return data && data.runId===id && data.transport===protocol && data.expiresAt>Date.now()?data:null;
    }catch(_){return null;}
  }
  function live(id,token){return !!token && $prefs.valueForKey(prefix+id+'.pending')===token;}
  function save(id,data){
    if(!live(id,data.token))return false;
    if($prefs.setValueForKey(JSON.stringify(data),prefix+id)===false)return false;
    if(!live(id,data.token)){
      var written=load(id);
      if(written && written.token===data.token)$prefs.removeValueForKey(prefix+id);
      return false;
    }
    return true;
  }
  function origin(response,expected){
    try{
      var echo=JSON.parse(String(response.body||'')),value=echo.origin;
      if(Number(response.statusCode)!==200 || echo.url!==expected || typeof value!=='string')return '';
      value=value.trim().toLowerCase();
      return value && value.length<=160 && /^[0-9a-f:.,\s]+$/.test(value)?value:'';
    }catch(_){return '';}
  }
  function bounded(work,ms,fallback){
    return new Promise(function(resolve){
      var finished=false,timer=setTimeout(function(){finish(fallback);},ms);
      function finish(value){if(finished)return;finished=true;if(typeof clearTimeout==='function')clearTimeout(timer);resolve(value);}
      work.then(finish,function(){finish(fallback);});
    });
  }
  function runningMode(){
    if(typeof $configuration==='undefined' || typeof $configuration.sendMessage!=='function')return Promise.resolve('unavailable');
    return bounded(Promise.resolve().then(function(){return $configuration.sendMessage({action:'get_running_mode'});}).then(function(result){
      var mode=typeof result.ret==='string'?result.ret:result.ret && result.ret.running_mode;
      return /^(?:filter|all_direct|all_proxy)$/.test(mode)?mode:'unknown';
    }),1500,'unavailable');
  }
  function directReference(){
    var target=protocol+'://httpbin.org/anything/kelee-qx-direct-probe-reference';
    return bounded(Promise.resolve().then(function(){
      return $task.fetch({url:target,method:'GET',headers:{Accept:'application/json','Cache-Control':'no-cache'},
        opts:{policy:'direct',redirection:false,'auto-cookie':false}});
    }).then(function(response){return {status:Number(response.statusCode||0),origin:origin(response,target)};}),4000,{status:0,origin:''});
  }
  function browserDashboard(protocol){
    var base=protocol+'://httpbin.org/anything/kelee-qx-direct-probe';
    var output=document.getElementById('report'),start=document.getElementById('start');
    async function read(url){
      var controller=new AbortController(),timer=setTimeout(function(){controller.abort();},20000);
      try{
        var response=await fetch(url,{cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal});
        var data=await response.json();
        return data && data.probe==='kelee-qx-direct-policy-v5' && data.transport===protocol?data:{verdict:'no-probe-report'};
      }catch(_){return {verdict:'request-failed-or-no-report'};}
      finally{clearTimeout(timer);}
    }
    start.onclick=async function(){
      start.disabled=true;
      var id='qx953-d2-'+Date.now()+'-'+('00000000'+Math.floor(Math.random()*100000000)).slice(-8);
      var result={probe:'kelee-qx-direct-policy-browser-v5',transport:protocol,provesFullEquivalence:false,results:[],
        assessment:{'policy-direct':'inconclusive','opts-direct':'inconclusive'}};
      function show(){output.value=JSON.stringify(result,null,2);}show();
      try{
        result.calibration=await read(base+'/calibration?id='+id);show();
        if(result.calibration.directReferenceAvailable!==true || result.calibration.runningMode!=='filter'){
          result.stopReason='direct-reference-unavailable-or-mode-not-filter';return;
        }
        var modes=['control','policy-direct','control','opts-direct','control'];
        for(var i=0;i<modes.length;i++){
          var mode=modes[i],report=await read(base+'/request?mode='+mode+'&id='+id+'-'+i);
          result.results.push({test:mode,report:report});show();
          if(i===0 && (report.referencesDistinct!==true || report.verdict!=='alternative-reference-matched')){
            result.stopReason=report.verdict==='direct-reference-matched'?'native-reference-not-distinct':'native-reference-unavailable';return;
          }
        }
        result.verification=await read(base+'/verify?id='+id);
        var stable=result.verification.directReferenceStable===true && result.verification.runningMode==='filter';
        var referenceId=result.results[0].report.nativeReferenceId;
        var sameReference=!!referenceId && result.verification.nativeReferenceId===referenceId &&
          result.results.every(function(item){return item.report.nativeReferenceId===referenceId;});
        var controls=result.results.filter(function(item){return item.test==='control';});
        var nativeStable=sameReference && controls.length===3 && controls.every(function(item){return item.report.verdict==='alternative-reference-matched';});
        ['policy-direct','opts-direct'].forEach(function(mode){
          var tested=result.results.filter(function(item){return item.test===mode;})[0];
          if(stable && nativeStable)result.assessment[mode]=tested.report.verdict==='direct-reference-matched'
            ?'direct-egress-observed-between-native-controls':tested.report.verdict==='alternative-reference-matched'
              ?'direct-not-observed-with-this-payload':'inconclusive';
        });
      }finally{
        await read(base+'/cleanup?id='+id);result.finished=true;show();start.disabled=false;
      }
    };
    document.getElementById('copy').onclick=async function(){try{await navigator.clipboard.writeText(output.value);}catch(_){output.focus();output.select();}};
  }
  if(String(request.method||'').toUpperCase()!=='GET'){$done({});return;}
  if(url===base+'/dashboard'){
    var html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<title>QX DIRECT 原请求对照</title><style>body{font:17px -apple-system,sans-serif;margin:24px;line-height:1.5}'+
      'button{font:inherit;padding:12px;margin:0 8px 12px 0}textarea{width:100%;min-height:65vh;box-sizing:border-box;font:13px monospace}</style>'+
      '<h2>QX DIRECT 原请求对照</h2><p>先将测试域名 httpbin.org 的临时本地分流设为可用代理，然后点开始。'+
      '这次用浏览器原请求建立对照；相同出口会在第一条原生请求后停止，不能据此判断是否直连。测试后删除临时分流。</p>'+
      '<p>当前协议：'+protocol.toUpperCase()+'。HTTPDNS 需要 HTTP 证据；若打开 HTTP 地址后这里显示 HTTPS，说明页面被升级，不能据此判断 HTTP 行为。</p>'+
      '<button id="start">开始测试</button><button id="copy">复制结果</button><textarea id="report" readonly></textarea>'+
      '<script>('+browserDashboard.toString()+')('+JSON.stringify(protocol)+');</script></html>';
    $done(reply(html,'text/html; charset=utf-8'));return;
  }
  var operation=url.match(/^https?:\/\/httpbin\.org\/anything\/kelee-qx-direct-probe\/(calibration|verify|cleanup)\?id=(qx953-d2-[0-9]{13}-[0-9]{8})$/);
  if(operation){
    var op=operation[1],id=operation[2],report=record(op,id);
    if(typeof $prefs==='undefined'){$done(reply(report));return;}
    if(op==='cleanup'){
      $prefs.removeValueForKey(prefix+id+'.pending');$prefs.removeValueForKey(prefix+id);
      report.verdict='reference-cleared';$done(reply(report));return;
    }
    if(typeof $task==='undefined' || typeof $task.fetch!=='function'){
      report.directReferenceAvailable=false;report.verdict='reference-api-unavailable';$done(reply(report));return;
    }
    var old=load(id),token=String(Date.now())+'-'+String(Math.random());
    if(op==='calibration' && $prefs.setValueForKey(token,prefix+id+'.pending')===false){
      report.directReferenceAvailable=false;report.verdict='reference-storage-unavailable';$done(reply(report));return;
    }
    Promise.all([directReference(),runningMode()]).then(function(values){
      var direct=values[0],mode=values[1];
      report.runningMode=mode;report.directFetchStatus=direct.status;
      report.directReferenceAvailable=false;report.referencesDistinct=false;report.verdict='reference-unavailable';
      if(op==='calibration'){
        if(!live(id,token)){report.verdict='reference-cancelled';$done(reply(report));return;}
        if(direct.origin && mode==='filter'){
          var salt='';for(var i=0;i<8;i++)salt+=('00000000'+Math.floor(Math.random()*4294967296).toString(16)).slice(-8);
          var data={runId:id,transport:protocol,expiresAt:Date.now()+120000,token:token,salt:salt,runningMode:mode,directHash:sha256(salt+'|'+direct.origin)};
          if(save(id,data)){report.directReferenceAvailable=true;report.verdict='awaiting-native-reference';}
        }
      }else if(old && direct.origin && live(id,old.token)){
        report.directReferenceAvailable=true;
        report.directReferenceStable=sha256(old.salt+'|'+direct.origin)===old.directHash;
        report.referencesDistinct=!!old.alternativeHash && old.alternativeHash!==old.directHash;
        report.nativeReferenceId=old.nativeReferenceId||null;
        report.verdict='direct-reference-rechecked';
      }
      $done(reply(report));
    },function(){report.directReferenceAvailable=false;report.verdict='reference-unavailable';$done(reply(report));});
    return;
  }
  var selected=url.match(/^https?:\/\/httpbin\.org\/anything\/kelee-qx-direct-probe\/request\?mode=(control|policy-direct|opts-direct)&id=(qx953-d2-[0-9]{13}-[0-9]{8})-([0-4])$/);
  if(!selected){$done({});return;}
  var mode=selected[1],id=selected[2],ordinal=selected[3],marker=id+'-'+ordinal;
  if(typeof $response==='undefined'){
    var payload={headers:{Accept:'application/json','Cache-Control':'no-cache',Connection:'close','X-Kelee-QX-Direct-Probe':marker}};
    if(mode==='policy-direct')payload.policy='direct';else if(mode==='opts-direct')payload.opts={policy:'direct'};
    $done(payload);return;
  }
  var report=record(mode,marker),data=load(id),echo={},headerMarker='';
  try{echo=JSON.parse(String($response.body||''));}catch(_){}
  if(!echo || typeof echo!=='object' || Array.isArray(echo))echo={};
  Object.keys(echo.headers||{}).forEach(function(name){if(name.toLowerCase()==='x-kelee-qx-direct-probe')headerMarker=echo.headers[name];});
  report.observedStatus=Number($response.statusCode||0);report.sourceEcho=echo.url===url;report.requestMarkerEcho=headerMarker===marker;
  report.referenceAvailable=!!data;report.referencesDistinct=false;report.matchesDirectReference=false;
  report.matchesAlternativeReference=false;report.verdict='inconclusive';
  var observed=origin($response,url);
  if(data && observed && report.sourceEcho && report.requestMarkerEcho && live(id,data.token)){
    var digest=sha256(data.salt+'|'+observed);
    if(mode==='control' && ordinal==='0' && !data.alternativeHash){
      data.alternativeHash=digest;data.nativeReferenceId='nr-'+String(Date.now())+'-'+String(Math.random()).slice(2);
      if(!save(id,data))data=null;
    }
    if(data){
      report.nativeReferenceId=data.nativeReferenceId||null;
      report.referencesDistinct=!!data.alternativeHash && data.alternativeHash!==data.directHash;
      report.matchesDirectReference=digest===data.directHash;
      report.matchesAlternativeReference=!!data.alternativeHash && digest===data.alternativeHash;
      report.verdict=report.matchesDirectReference?'direct-reference-matched':
        report.matchesAlternativeReference?'alternative-reference-matched':'inconclusive';
    }
  }
  $done({headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',Connection:'close'},body:JSON.stringify(report,null,2)});
})();
