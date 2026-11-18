import{parseAuthConfig,isAuthorized}from'./vault-handler.mjs';
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function validOrder(order){if(!Array.isArray(order)||order.length<1||order.length>128||new Set(order).size!==order.length||!order.every(n=>Number.isInteger(n)&&n>=0&&n<128))throw Error('Invalid app order.');return order}
export function makeLayoutHandler({getStore,getConfig}){return async request=>{try{
 const url=new URL(request.url),origin=request.headers.get('origin');if(origin&&origin!==url.origin)return reply({error:'Origin not allowed.'},403);
 if(!['GET','POST','PUT'].includes(request.method))return reply({error:'Method not allowed.'},405);
 if(request.method!=='GET'){let settings;try{settings=parseAuthConfig(getConfig())}catch{return reply({error:'The Netlify vault setting is invalid. Complete vault setup first.'},503)}if(!settings)return reply({error:'Complete vault sync setup before syncing app order.'},503);if(!isAuthorized(request,settings))return reply({error:'Check your vault passphrase and try again.'},401)}
 const store=getStore();
 if(request.method==='GET'||request.method==='POST'){const current=await store.getWithMetadata('app-order',{type:'json',consistency:'strong'});return reply({order:current?validOrder(current.data.order):null,revision:current?.etag??null})}
 if(!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Expected JSON.'},415);
 const reader=request.body?.getReader();if(!reader)return reply({error:'Missing app order.'},400);const chunks=[];let bytes=0;while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>4096){await reader.cancel();return reply({error:'Request too large.'},413)}chunks.push(Buffer.from(value))}
 let payload;try{payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));validOrder(payload.order)}catch{return reply({error:'Invalid app order.'},400)}
 if(!Object.hasOwn(payload,'revision')||(payload.revision!==null&&(typeof payload.revision!=='string'||!payload.revision||payload.revision.length>512)))return reply({error:'A valid revision is required.'},428);
 const result=await store.setJSON('app-order',{order:payload.order},payload.revision===null?{onlyIfNew:true}:{onlyIfMatch:payload.revision});
 if(!result.modified)return reply({error:'The order changed on another device. Retry to save your current arrangement.'},409);
 const saved=await store.getWithMetadata('app-order',{type:'json',consistency:'strong'});if(!saved||JSON.stringify(saved.data.order)!==JSON.stringify(payload.order))return reply({error:'Could not confirm the saved order. Please retry.'},409);
 return reply({order:saved.data.order,revision:saved.etag});
 }catch{return reply({error:'App order sync is unavailable. Your arrangement is still saved on this device.'},503)}}}
