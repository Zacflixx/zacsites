import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeHandler} from '../server/vault-handler.mjs';
import {makeSyncConfig,deriveAuth,derive,seal,open} from '../public/assets/crypto.mjs';
const password='a strong test passphrase';
function memoryStore(){let value=null,revision=0;return{get value(){return value},get revision(){return '"'+revision+'"'},async getWithMetadata(_key,options={}){return value?{data:options.etag===this.revision?null:structuredClone(value),etag:this.revision}:null},async setJSON(_key,next,options){if(options.onlyIfNew&&value)return{modified:false};if(options.onlyIfMatch&&options.onlyIfMatch!==this.revision)return{modified:false};value=structuredClone(next);revision++;return{modified:true,etag:this.revision}}}}
const request=(method='GET',{token,body,headers={},query=''}={})=>new Request('https://example.netlify.app/.netlify/functions/vault'+query,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
test('sync is closed until configured; same passphrase authenticates across independent clients; stale writes are rejected',async()=>{
 const config=await makeSyncConfig(password),saltHex=config.split('.')[1],token=await deriveAuth(password,saltHex),store=memoryStore();let setting='';let accessed=0;
 const handler=makeHandler({getConfig:()=>setting,getStore:()=>{accessed++;return store}});
 assert.deepEqual(await (await handler(request('GET',{query:'?action=config'}))).json(),{configured:false});
 assert.equal((await handler(request('PUT',{token,body:{},headers:{'If-None-Match':'*'}}))).status,503);assert.equal(accessed,0);
 setting=config;
 const pub=await (await handler(request('GET',{query:'?action=config'}))).json();assert.deepEqual(pub,{configured:true,authSalt:saltHex});assert(!JSON.stringify(pub).includes(config.split('.')[2]));
 assert.equal((await handler(request())).status,401);assert.equal(accessed,0);
 assert.equal((await handler(request('GET',{token:'0'.repeat(64)}))).status,401);assert.equal(accessed,0);
 assert.equal((await handler(request('GET',{token,headers:{Origin:'https://other.example'}}))).status,403);
 assert.equal((await handler(request('DELETE',{token}))).status,405);
 const original={version:1,entries:[{id:'1',title:'Email',group:'Personal',username:'test',password:'TEST-SECRET',url:'',notes:'PRIVATE-NOTE'}]},salt=crypto.getRandomValues(new Uint8Array(16)),key=await derive(password,salt),envelope=await seal(original,key,salt);
 const empty=await (await handler(request('GET',{token}))).json();assert.equal(empty.envelope,null);
 assert.equal((await handler(request('PUT',{token,body:envelope}))).status,428);
 assert.equal((await handler(request('PUT',{token,body:{...envelope,iterations:1},headers:{'If-None-Match':'*'}}))).status,400);
 const first=await handler(request('PUT',{token,body:{...envelope,plaintext:'should never be stored'},headers:{'If-None-Match':'*'}}));assert.equal(first.status,200);assert(!store.value.plaintext);const rev=(await first.json()).etag;
 const tokenB=await deriveAuth(password,pub.authSalt);assert.equal(tokenB,token);
 const cloud=await (await handler(request('GET',{token:tokenB}))).json();assert.deepEqual((await open(cloud.envelope,password)).data,original);assert(!JSON.stringify(cloud).includes('PRIVATE-NOTE'));assert(!JSON.stringify(cloud).includes('TEST-SECRET'));
 assert.equal((await handler(request('GET',{token,headers:{'If-None-Match':rev}}))).status,304);
 const changed=await seal({...original,entries:[{...original.entries[0],notes:'NEWER-NOTE'}]},key,salt);
 assert.equal((await handler(request('PUT',{token,body:changed,headers:{'If-Match':rev}}))).status,200);
 assert.equal((await handler(request('PUT',{token:tokenB,body:envelope,headers:{'If-Match':rev}}))).status,409);
 assert.equal((await open(store.value,password)).data.entries[0].notes,'NEWER-NOTE');
 assert.equal((await handler(request('PUT',{token,body:envelope,headers:{'If-None-Match':'*'}}))).status,409);
 assert.equal((await handler(request('PUT',{token,body:'x'.repeat(2000001),headers:{'If-Match':store.revision}}))).status,413);
});
test('storage failures are reported, not presented as successful saves',async()=>{
 const config=await makeSyncConfig(password),token=await deriveAuth(password,config.split('.')[1]);
 const handler=makeHandler({getConfig:()=>config,getStore:()=>{throw Error('Storage unavailable')}});assert.equal((await handler(request('GET',{token}))).status,503);
});

test('malformed Netlify variable explains setup and never grants vault access',async()=>{
 let accessed=false;const handler=makeHandler({getConfig:()=> 'mistakenly-entered-plain-passphrase',getStore:()=>{accessed=true;return memoryStore()}});
 const configResponse=await handler(request('GET',{query:'?action=config'}));assert.equal(configResponse.status,200);
 const info=await configResponse.json();assert.equal(info.configured,false);assert(info.configurationError.includes('generated v1.'));assert(!JSON.stringify(info).includes('mistakenly-entered'));
 assert.equal((await handler(request('GET',{token:'0'.repeat(64)}))).status,503);assert.equal(accessed,false);
});
