import {derive,seal,open,validate,deriveAuth,makeSyncConfig,decryptWithKey,base64} from './crypto.mjs';
const $=id=>document.getElementById(id),API='/.netlify/functions/vault',LEGACY='isaac-encrypted-vault-v1';
let key=null,salt=null,data=null,snapshot=null,editing=null,pendingImport=null,busy=false,generation=0,lastActive=Date.now(),authToken=null,etag=null,remoteConfig=null,checking=false;
const say=message=>$('notice').textContent=message;
async function api({method='GET',envelope=null,revision=null,token=authToken,config=false,conditional=false}={}){
 const headers={};if(token)headers.Authorization='Bearer '+token;
 if(envelope){headers['Content-Type']='application/json';if(revision)headers['If-Match']=revision;else headers['If-None-Match']='*'}
 if(conditional&&revision)headers['If-None-Match']=revision;
 let response;try{response=await fetch(API+(config?'?action=config':''),{method,headers,credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(20000),...(envelope?{body:JSON.stringify(envelope)}:{})})}catch{throw Error('Cannot reach vault sync. Check your connection; changes have not been saved.')}
 if(response.status===304)return{unchanged:true};
 let result;try{result=await response.json()}catch{throw Error('Vault sync is not deployed yet. Deploy this GitHub version on Netlify, then retry.')}
 if(!response.ok){const error=Error(result.error||(response.status===429?'Too many requests. Wait a minute and try again.':'Sync failed.'));error.status=response.status;throw error}return result;
}
function gate(){
 $('confirm-wrap').hidden=remoteConfig?.configured!==false;
 $('setup-hint').hidden=remoteConfig?.configured!==false;
 $('master').autocomplete=remoteConfig?.configured?'current-password':'new-password';
 $('master').minLength=remoteConfig?.configured?1:12;
 $('gate-title').textContent=!remoteConfig?'Connecting your vault…':remoteConfig.configured?'Open your synced vault.':'One-time sync setup.';
 $('gate-help').textContent=!remoteConfig?'Checking the secure connection. Your apps remain freely accessible.':remoteConfig.configured?'One passphrase. The same encrypted vault, on every browser.':'Choose your vault passphrase (12+ characters). Use your existing vault passphrase if you already saved entries.';
 $('unlock').textContent=remoteConfig?.configured?'Unlock & sync →':'Generate Netlify setting →';$('unlock').disabled=!remoteConfig;
}
async function loadConfig(){try{remoteConfig=await api({config:true,token:null});$('gate-error').textContent='';if(remoteConfig.configured)$('setup-result').hidden=true}catch(e){remoteConfig=null;$('gate-error').textContent=e.message}gate()}
function lock(message='Vault locked.'){
 generation++;key=null;salt=null;data=null;snapshot=null;editing=null;pendingImport=null;authToken=null;etag=null;
 $('entries').replaceChildren();$('group-list').replaceChildren();$('groups').replaceChildren(new Option('All groups',''));$('search').value='';$('entry-form').reset();$('unlock-form').reset();$('restore-form').reset();$('password').type='password';$('toggle-entry').textContent='Show';$('entry-dialog').close();$('restore-dialog').close();$('workspace').hidden=true;$('gate').hidden=false;say(message);gate();
}
function activate(result,raw,revision,token){key=result.key;salt=result.salt;data=result.data;snapshot=raw;etag=revision;authToken=token;lastActive=Date.now();$('unlock-form').reset();$('gate-error').textContent='';$('gate').hidden=true;$('workspace').hidden=false;$('save-state').textContent='Synced · Encrypted before upload · Locks when you leave this tab.';render()}
async function transact(task,target){if(busy)return;busy=true;const ticket=generation;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await task(ticket)}catch(e){if(ticket===generation)$(target).textContent=e.message||'Something went wrong.'}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);if(!$('gate').hidden)gate()}}
$('unlock-form').onsubmit=e=>{e.preventDefault();transact(async ticket=>{
 if(!remoteConfig)throw Error('Retry the connection first.');const password=$('master').value;
 if(!remoteConfig.configured){
  if(password.length<12)throw Error('Use at least 12 characters.');if(password!==$('confirm-master').value)throw Error('Passphrases do not match.');
  const setting=await makeSyncConfig(password);if(ticket!==generation||document.hidden)return;
  $('sync-setting').value=setting;$('setup-result').hidden=false;$('unlock-form').reset();say('Copy the generated setting to Netlify, redeploy, then check the connection.');return;
 }
 const token=await deriveAuth(password,remoteConfig.authSalt);if(ticket!==generation||document.hidden)return;
 const cloud=await api({token});if(ticket!==generation||document.hidden)return;
 let result,raw,revision=cloud.etag;
 if(cloud.envelope){try{result=await open(cloud.envelope,password)}catch{throw Error('Could not decrypt the vault. Use the original vault passphrase.')}raw=JSON.stringify(cloud.envelope)}
 else{
  let legacy;try{legacy=localStorage.getItem(LEGACY)}catch{}
  if(legacy){try{result=await open(JSON.parse(legacy),password)}catch{throw Error('An older local vault uses a different passphrase. Configure sync with its original passphrase to migrate it safely.')}}
  else{const newSalt=crypto.getRandomValues(new Uint8Array(16));result={key:await derive(password,newSalt),salt:newSalt,data:{version:1,entries:[]}}}
  const envelope=await seal(result.data,result.key,result.salt);if(ticket!==generation||document.hidden)return;
  if(JSON.stringify(envelope).length>1950000)throw Error('This vault exceeds the 2 MB sync limit.');
  const created=await api({method:'PUT',envelope,token});revision=created.etag;raw=JSON.stringify(envelope);
 }
 if(ticket!==generation||document.hidden)return;activate(result,raw,revision,token);say('Vault unlocked and synced.');
},'gate-error')};
async function persist(next,ticket){
 if(!key||!authToken)return false;
 const envelope=await seal(next,key,salt),encrypted=JSON.stringify(envelope);
 if(encrypted.length>1950000)throw Error('Vault is full. Remove unused entries before saving (2 MB sync limit).');
 if(ticket!==generation||!key)return false;
 $('save-state').textContent='Saving encrypted changes…';
 let saved;try{saved=await api({method:'PUT',envelope,revision:etag})}catch(e){if(ticket===generation)$('save-state').textContent='Not saved · '+e.message;throw e}
 if(ticket!==generation||!key)return false;etag=saved.etag;snapshot=encrypted;data=next;$('save-state').textContent='Synced across browsers · '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});return true;
}
async function refresh(manual=false){
 if(!key||busy||checking||document.hidden||$('entry-dialog').open||$('restore-dialog').open)return;
 checking=true;const ticket=generation;
 try{const cloud=await api({revision:etag,conditional:true});if(ticket!==generation||busy||!key)return;if(cloud.unchanged){if(manual)say('Your vault is up to date.');return}if(!cloud.envelope){lock('The cloud vault is missing. Unlock again to reconnect.');return}if(cloud.envelope.salt!==base64(salt)){lock('Vault encryption changed. Unlock again with its current passphrase.');return}const latest=await decryptWithKey(cloud.envelope,key);if(ticket!==generation||busy||!key)return;data=latest;etag=cloud.etag;snapshot=JSON.stringify(cloud.envelope);render();$('save-state').textContent='Synced · Latest changes loaded from another browser.';if(manual)say('Latest vault loaded.')}
 catch(e){if(ticket===generation){if(e.status===401)lock('Sync credentials changed. Reload and unlock again.');else $('save-state').textContent='Sync paused · '+e.message}}
 finally{checking=false}
}
function button(label,handler){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=handler;return b}
async function copy(text){try{await navigator.clipboard.writeText(text);say('Copied. Your clipboard keeps this until it is replaced.')}catch{say('Clipboard unavailable. Reveal the value to select and copy it.')}}
function render(){if(!data)return;const currentGroup=$('groups').value;const groups=[...new Set(data.entries.map(e=>e.group).filter(Boolean))].sort();$('groups').replaceChildren(new Option('All groups',''),...groups.map(g=>new Option(g,g)));$('groups').value=groups.includes(currentGroup)?currentGroup:'';$('group-list').replaceChildren(...groups.map(g=>new Option(g,g)));const q=$('search').value.toLowerCase().trim();const filtered=data.entries.filter(e=>(!$('groups').value||e.group===$('groups').value)&&[e.title,e.group,e.username,e.notes].join(' ').toLowerCase().includes(q));$('entries').replaceChildren();for(const entry of filtered){const card=document.createElement('article');card.className='entry';const tag=document.createElement('span');tag.className='tag';tag.textContent=entry.group||'Ungrouped';const title=document.createElement('h3');title.textContent=entry.title;card.append(tag,title);if(entry.username){const u=document.createElement('p');u.textContent=entry.username;card.append(u)}const actions=document.createElement('div');actions.className='entry-actions';if(entry.password){const secret=document.createElement('div');secret.className='secret';secret.textContent='••••••••••••';let showing=false;const reveal=button('Show password',()=>{showing=!showing;secret.textContent=showing?entry.password:'••••••••••••';reveal.textContent=showing?'Hide password':'Show password';reveal.setAttribute('aria-pressed',String(showing))});reveal.setAttribute('aria-pressed','false');actions.append(reveal,button('Copy password',()=>copy(entry.password)));card.append(secret)}if(entry.notes){const note=document.createElement('p');note.className='notes';note.textContent=entry.notes;card.append(note);actions.append(button('Copy text',()=>copy(entry.notes)))}if(entry.username)actions.append(button('Copy username',()=>copy(entry.username)));if(entry.url){try{const url=new URL(entry.url);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password){const a=document.createElement('a');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Website ↗';actions.append(a)}}catch{}}actions.append(button('Edit',()=>edit(entry.id)),button('Delete',()=>{if(confirm('Delete “'+entry.title+'”? Export a backup first if you may need it later.'))transact(async ticket=>{const next={version:1,entries:data.entries.filter(e=>e.id!==entry.id)};if(await persist(next,ticket)){render();say('Entry deleted.')}},'notice')}));card.append(actions);$('entries').append(card)}if(!filtered.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=data.entries.length?'No matching entries.':'A clear space. Add your first password or private note.';$('entries').append(empty)}}
function edit(id=null){if(!key||busy)return;editing=id;const entry=id?data.entries.find(e=>e.id===id):null;$('entry-form').reset();for(const f of ['title','group','username','password','url','notes'])$(f).value=entry?.[f]||'';$('password').type='password';$('toggle-entry').textContent='Show';$('entry-heading').textContent=entry?'Edit your entry.':'A new entry.';$('entry-error').textContent='';$('entry-dialog').showModal();$('title').focus()}
$('entry-form').onsubmit=e=>{e.preventDefault();transact(async ticket=>{if(!key)return;const entry={id:editing||crypto.randomUUID()};for(const f of ['title','group','username','password','url','notes'])entry[f]=['password','notes'].includes(f)?$(f).value:$(f).value.trim();if(!entry.title)throw Error('Add a title.');if(!entry.password&&!entry.notes)throw Error('Add a password or some private text.');if(entry.url){let u;try{u=new URL(entry.url)}catch{throw Error('Website links must start with https:// or http://.')}if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('Use a valid HTTP or HTTPS website link.')}const next={version:1,entries:editing?data.entries.map(x=>x.id===editing?entry:x):[entry,...data.entries]};if(await persist(next,ticket)){$('entry-form').reset();$('entry-dialog').close();render();say('Entry saved encrypted.')}},'entry-error')};
$('add').onclick=()=>edit();$('lock').onclick=()=>lock();$('close-entry').onclick=$('cancel-entry').onclick=()=>{$('entry-form').reset();$('entry-dialog').close()};$('entry-dialog').addEventListener('close',()=>{$('entry-form').reset();editing=null});$('toggle-entry').onclick=()=>{const visible=$('password').type==='password';$('password').type=visible?'text':'password';$('toggle-entry').textContent=visible?'Hide':'Show'};$('search').oninput=render;$('groups').onchange=render;

$('backup').onclick=()=>{try{if(!key||!snapshot)return;const blob=new Blob([snapshot],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='isaac-vault-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);say('Optional encrypted backup downloaded. Your vault already syncs automatically.')}catch{say('Could not export your backup.')}};
$('import-open').onclick=()=>{if(key)$('import-file').click()};
$('import-file').onchange=async()=>{const file=$('import-file').files[0];$('import-file').value='';if(!file||!key)return;const ticket=generation;try{if(file.size>5000000)throw Error('Backup is too large (maximum 5 MB).');const envelope=validate(JSON.parse(await file.text()));if(ticket!==generation||!key)return;pendingImport=envelope;$('restore-form').reset();$('restore-error').textContent='';$('restore-dialog').showModal()}catch(e){say(e.message||'Invalid backup file.')}};
$('cancel-restore').onclick=()=>{$('restore-dialog').close()};$('restore-dialog').addEventListener('close',()=>{pendingImport=null;$('restore-form').reset()});
$('restore-form').onsubmit=e=>{e.preventDefault();transact(async ticket=>{if(!pendingImport||!key)return;let result;try{result=await open(pendingImport,$('restore-password').value)}catch{throw Error('Could not decrypt this backup. Check its passphrase and file.')}if(ticket!==generation||document.hidden)return;if(!confirm('Replace the synced vault contents with this backup on all browsers?'))return;if(await persist(result.data,ticket)){$('restore-dialog').close();render();say('Backup restored and synced. Your current vault passphrase stays the same.')}},'restore-error')};
$('sync-now').onclick=()=>refresh(true);$('retry-connection').onclick=()=>loadConfig();$('copy-setting').onclick=()=>copy($('sync-setting').value);
for(const event of ['pointerdown','keydown','input','scroll'])document.addEventListener(event,()=>{if(key)lastActive=Date.now()},{passive:true});
setInterval(()=>{if(key&&Date.now()-lastActive>=300000)lock('Locked after 5 minutes of inactivity.')},1000);
setInterval(()=>refresh(),30000);
document.addEventListener('visibilitychange',()=>{if(document.hidden)lock('Vault locked. Your next unlock will load the latest synced copy.')});window.addEventListener('pagehide',()=>lock('Vault locked.'));
if(!window.isSecureContext||!crypto.subtle){$('unlock').disabled=true;$('gate-error').textContent='Use HTTPS (your Netlify address) or localhost to enable encryption.'}else{gate();loadConfig()}
