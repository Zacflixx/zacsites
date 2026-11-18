import {createHash,timingSafeEqual} from 'node:crypto';
import {validate} from '../public/assets/crypto.mjs';
const MAX_BYTES=2000000;
const reply=(body,status=200,extra={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...extra}});
function config(value){if(!value)return null;const match=/^v1\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(value.trim());if(!match)throw Error('Invalid server configuration.');return{salt:match[1],hash:match[2]}}
function authorized(request,setting){const token=/^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization')||'')?.[1];if(!token)return false;const hash=createHash('sha256').update(token).digest();return timingSafeEqual(hash,Buffer.from(setting.hash,'hex'))}
function canonical(value){validate(value);return Object.fromEntries(['format','version','algorithm','iterations','salt','iv','ciphertext'].map(k=>[k,value[k]]))}
export function makeHandler({getStore,getConfig}){return async request=>{
 try{
  const url=new URL(request.url),origin=request.headers.get('origin');
  if(origin&&origin!==url.origin)return reply({error:'Origin not allowed.'},403);
  if(!['GET','PUT'].includes(request.method))return reply({error:'Method not allowed.'},405,{Allow:'GET, PUT'});
  let setting;
  try{setting=config(getConfig())}catch{
   const message='ISAAC_VAULT_AUTH must contain the generated v1. setup value, not your passphrase. Generate the value below, replace the Netlify variable, and redeploy.';
   if(request.method==='GET'&&url.searchParams.get('action')==='config')return reply({configured:false,configurationError:message});
   return reply({error:message},503);
  }
  if(request.method==='GET'&&url.searchParams.get('action')==='config')return reply(setting?{configured:true,authSalt:setting.salt}:{configured:false});
  if(!setting)return reply({error:'Complete the one-time sync setup first.'},503);
  if(!authorized(request,setting))return reply({error:'Could not unlock. Check your vault passphrase.'},401);
  // The store is created only after authentication. Keys and passphrases never enter it.
  const store=getStore();
  if(request.method==='GET'){
   const cachedRevision=url.searchParams.get('revision')||request.headers.get('if-none-match');
   if(cachedRevision&&cachedRevision.length>512)return reply({error:'Invalid revision.'},400);
   const entry=await store.getWithMetadata('vault',{type:'json',consistency:'strong',...(cachedRevision?{etag:cachedRevision}:{})});
   if(!entry)return reply({envelope:null,etag:null});
   if(cachedRevision===entry.etag)return reply({unchanged:true,etag:entry.etag});
   return reply({envelope:canonical(entry.data),etag:entry.etag});
  }
  if(!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Expected JSON.'},415);
  if(Number(request.headers.get('content-length'))>MAX_BYTES)return reply({error:'Vault exceeds the 2 MB sync limit.'},413);
  // Bound a streamed body too; do not trust Content-Length.
  const reader=request.body?.getReader();if(!reader)return reply({error:'Missing vault data.'},400);
  const chunks=[];let length=0;
  while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_BYTES){await reader.cancel();return reply({error:'Vault exceeds the 2 MB sync limit.'},413)}chunks.push(Buffer.from(value))}
  let payload;try{payload=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return reply({error:'Invalid encrypted vault.'},400)}
  const hasRevision=payload&&typeof payload==='object'&&Object.hasOwn(payload,'revision');
  // Keep the legacy headers for clients cached during deployment. New clients send revision in JSON.
  const expected=hasRevision?payload.revision:request.headers.get('if-match');
  const isNew=hasRevision?payload.revision===null:request.headers.get('if-none-match')==='*';
  if((!expected&&!isNew)||(expected&&isNew))return reply({error:'A revision is required. Refresh the page to load the latest vault client.'},428);
  if(expected&&(typeof expected!=='string'||expected.length>512||/[\r\n]/.test(expected)))return reply({error:'Invalid revision.'},400);
  let envelope;try{envelope=canonical(hasRevision?payload.envelope:payload)}catch{return reply({error:'Invalid encrypted vault.'},400)}
  const result=await store.setJSON('vault',envelope,isNew?{onlyIfNew:true}:{onlyIfMatch:expected});
  if(!result.modified)return reply({error:'Another browser saved newer changes. Close the editor, sync, and try your edit again.'},409);
  // Confirm a write before reporting success; guards against transport or SDK failures.
  const saved=await store.getWithMetadata('vault',{type:'json',consistency:'strong'});
  if(!saved||saved.data.ciphertext!==envelope.ciphertext)return reply({error:'Could not confirm this save. Sync before trying again.'},409);
  return reply({etag:saved.etag});
 }catch{return reply({error:'Sync is unavailable. Check the connection and Netlify function configuration. No local-only save was made.'},503)}
}}
export {config as parseAuthConfig,authorized as isAuthorized};
