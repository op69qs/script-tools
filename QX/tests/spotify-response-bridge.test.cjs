const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const api=require('../kelee-qx.js');
// Supply a freshly downloaded upstream script; do not vendor third-party code.
const source=process.env.KELEE_SPOTIFY_SOURCE?fs.readFileSync(process.env.KELEE_SPOTIFY_SOURCE,'utf8'):null;
const varint=value=>{const out=[];do{const v=value&127;value>>>=7;out.push(v|(value?128:0));}while(value);return Buffer.from(out);};
const field=(id,data)=>Buffer.concat([varint(id*8+2),varint(data.length),data]);
const text=(id,value)=>field(id,Buffer.from(value));
const bool=(id,value)=>Buffer.concat([varint(id*8),varint(value?1:0)]);
function assigned(scope,name,type,value) {
  return Buffer.concat([field(1,Buffer.concat([text(1,scope),text(2,name)])),
    field(type,type===3?bool(1,value):text(1,value))]);
}
const configuration=Buffer.concat([
  field(3,assigned('ios-system-your-plan-sidedrawer','is_row_enabled',3,true)),
  field(3,assigned('ios-feature-navigation','tab_configuration',5,'Create')),
  field(3,assigned('ios-feature-share','is_useractivity_sharing_enabled',3,true))
]);
const account=field(1,Buffer.concat([text(1,'ads'),field(2,bool(2,true))]));
const customization=field(1,Buffer.concat([field(1,field(1,configuration)),field(3,account)]));
const bootstrap=field(2,field(1,field(1,customization)));
function execute(code,context) {
  let value,done=false;
  vm.runInNewContext(code,{...context,console:{log(){}},$done:result=>{if(!done){done=true;value=result||{};}}},{timeout:1500});
  assert.ok(done);return value;
}
for(const [path,input] of [['/user-customization-service/v1/customize',customization],['/bootstrap/v1/bootstrap',bootstrap]])
  for(const tab of [false,true])for(const useractivity of [false,true])
    test('real upstream response byte equivalence: '+path+' tab='+tab+' useractivity='+useractivity,
      {skip:!source && 'set KELEE_SPOTIFY_SOURCE to the freshly downloaded original script'},()=>{
        const argument={tab,useractivity},request={url:'https://spclient.wg.spotify.com'+path};
        const native=execute(source,{$request:request,$response:{status:200,body:new Uint8Array(input)},$argument:argument});
        assert.ok(native.body && native.body.byteLength,'fixture must exercise a valid rewritten response');
        assert.ok(!Buffer.from(native.body).equals(input),'fixture must exercise the real modification path');
        const qx=execute(api.wrapLoonResponseScript(source,{binary:true,argument}),
          {$request:request,$response:{statusCode:200,bodyBytes:Uint8Array.from(input).buffer}});
        assert.deepEqual(Buffer.from(qx.bodyBytes),Buffer.from(native.body));
      });
