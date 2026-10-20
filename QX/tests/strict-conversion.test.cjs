const {test}=require('node:test');
const assert=require('node:assert/strict');
const api=require('../kelee-qx.js');
const target='https://kelee.one/Tool/Loon/Lpx/Strict.lpx';
const local='http://127.0.0.1:9999/kelee-qx/resource?url='+encodeURIComponent(target);
const fetchBody=body=>async()=>({statusCode:200,headers:{},body});
const direct='AND, ((URL-REGEX, ^http:\\/\\/119\\.29\\.29\\.90\\/d\\?), (USER-AGENT, %E5%98%80%E5%97%92%E5%87%BA%E8%A1%8C*)), DIRECT';
test('a DIRECT exception cannot be lost while a broader reject is delivered',async()=>{
  const body='#!name=HTTPDNS\n[Rule]\n'+direct+'\nURL-REGEX, ^http:\\/\\/.*\\/d\\?, REJECT';
  const response=await api.backendResponse({url:local},fetchBody(body));
  assert.match(response.status,/422/);
  assert.equal(response.headers['X-Kelee-QX-Conversion'],'rejected');
  assert.match(response.body,/"pendingLogical":\s*1/);
  assert.match(response.body,/第 3 行/);
  assert.ok(!response.body.includes(' url reject'));
});
test('one pending rule atomically rejects a resource with otherwise valid actions',async()=>{
  const body='[Rule]\nDOMAIN, ads.example.com, REJECT\n'+direct+
    '\n[Rewrite]\nrequest if ${url} ~= /^https:\\/\\/example\\.com\\/ads/ then reject_dict(200)';
  const response=await api.backendResponse({url:local},fetchBody(body));
  assert.match(response.status,/422/);
  assert.ok(!response.body.includes(' url reject-dict'));
});
test('a fully converted domain intersection still returns a parser-ready resource',async()=>{
  const response=await api.backendResponse({url:local},fetchBody('[Rule]\nAND, ((DOMAIN-KEYWORD, ads), (DOMAIN-SUFFIX, example.com)), REJECT'));
  assert.match(response.status,/200/);
  assert.equal(response.headers['X-Kelee-QX-Conversion'],'ready-for-parser');
  assert.match(response.body,/host-wildcard,/);
});
test('TF leading notes cannot hide a pending logical rule',async()=>{
  const response=await api.backendResponse({url:local},fetchBody('[Rule]\n{# preserve DIRECT #} '+direct));
  assert.match(response.status,/422/);
  assert.match(response.body,/"pendingLogical":\s*1/);
  assert.ok(response.body.includes('{# preserve DIRECT #}'));
});
test('TF leading notes survive every branch of a converted intersection',()=>{
  const body='[Rule]\n{# complete intersection #} AND, ((DOMAIN-KEYWORD, ads), (DOMAIN-KEYWORD, normal)), REJECT';
  const output=api.prepareResourceContent(body,target);
  const rules=output.split('\n').filter(line=>line.includes('host-wildcard,'));
  assert.ok(rules.length>=2);
  assert.ok(rules.every(line=>line.startsWith('{# complete intersection #} host-wildcard,')));
});
test('TF leading notes survive conditional rewrite normalization',()=>{
  const output=api.prepareResourceContent('[Rewrite]\n{# reject ads #} request if ${url} ~= /^https:\\/\\/example\\.com/ then reject(404)',target);
  assert.match(output,/^\{# reject ads #\} .* url reject$/m);
  assert.ok(!output.includes('request if'));
});
test('a noted failing DSL rule reports its complete original line and line number',()=>{
  const rule='{# original note #} request if ${url} ~= /example/ then unknown()';
  assert.throws(()=>api.prepareResourceContent('[Rewrite]\n'+rule,target),
    error=>error.keleeLine===2 && error.keleeRule===rule);
});
test('an unclosed TF note is rejected instead of hiding a rule',async()=>{
  const response=await api.backendResponse({url:local},fetchBody('[Rule]\n{# incomplete AND, ((DOMAIN, a), (DOMAIN, b)), REJECT'));
  assert.match(response.status,/422/);
});
test('note-like text inside a block comment is not interpreted',()=>{
  const input='[Rule]\n/*\n{# incomplete\nAND, ((DOMAIN, a), (PROTOCOL, QUIC)), REJECT\n*/';
  assert.equal(api.prepareResourceContent(input,target),input);
});
for(const option of ['binary-body-mode=true','argument=[{tab},{useractivity}]','timeout=3','requires-body=2','enabled=false'])
  test('legacy execution options cannot be silently discarded: '+option,async()=>{
    const rule='http-response ^https://example.com/api script-path=https://kelee.one/Resource/JavaScript/Example/test.js, requires-body=true, '+option;
    const response=await api.backendResponse({url:local},fetchBody('[Script]\n'+rule));
    assert.match(response.status,/422/);
    assert.equal(response.headers['X-Kelee-QX-Stage'],'resource-conversion');
    assert.ok(!response.body.includes(' url script-response'));
  });
test('legacy safe options retain the request/response body phase and a quoted tag',()=>{
  const input='[Script]\nhttp-response ^https://example.com/api script-path=https://kelee.one/Resource/JavaScript/Example/test.js, requires-body=true, tag="a,b"';
  assert.match(api.prepareResourceContent(input,target),/ url script-response-body /);
});
test('legacy option failures report the original dependency URL and original note',()=>{
  const rule='{# source #} http-response ^https://example.com/api script-path=https://kelee.one/Resource/JavaScript/Example/test.js, binary-body-mode=true';
  assert.throws(()=>api.prepareResourceContent('[Script]\n'+rule,target),
    error=>error.keleeLine===2 && error.keleeRule===rule);
});
for(const rule of [
  'Spotify = type=http-response, pattern=^https://example.com/api, requires-body=true, binary-body-mode=true, script-path=https://kelee.one/Resource/JavaScript/Example/test.js',
  'type=http-request, pattern=^https://example.com/api, argument=secret, script-path=https://kelee.one/Resource/JavaScript/Example/test.js',
  'http-response ^https://example.com/api requires-body=true, binary-body-mode=true, script-path=https://kelee.one/Resource/JavaScript/Example/test.js',
  'http-request ^https://example.com/api timeout=3, script-path=https://kelee.one/Resource/JavaScript/Example/test.js'
]) test('unparsed legacy declaration cannot pass execution options to a lossy parser: '+rule.split(' ')[0],async()=>{
  const response=await api.backendResponse({url:local},fetchBody('[Script]\n{# original #} '+rule));
  assert.match(response.status,/422/);
  assert.match(response.body,/第 2 行/);
  assert.equal(response.headers['X-Kelee-QX-Conversion'],'rejected');
  assert.ok(!response.body.includes(' url script-'));
});
test('legacy declarations inside block comments remain inert',()=>{
  const input='[Script]\n/*\nhttp-response ^https://example.com script-path=https://kelee.one/Resource/JavaScript/Example/test.js, binary-body-mode=true\n*/';
  assert.equal(api.prepareResourceContent(input,target),input);
});
