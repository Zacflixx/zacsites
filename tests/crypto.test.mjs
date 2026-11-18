import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
import {derive,seal,open,validate,bytes,base64} from '../assets/crypto.mjs';
const password='a test passphrase only';
const data={version:1,entries:[{id:'test',title:'Private <script> text',group:'Personal',username:'demo',password:'SECRET-DEMO-ONLY',url:'https://example.com',notes:'Unicode 🔐\nA grouped note'}]};
test('encrypted round trip, fresh nonce, no plaintext in envelope, wrong passphrase and tamper rejection',async()=>{
 const salt=crypto.getRandomValues(new Uint8Array(16)),key=await derive(password,salt),a=await seal(data,key,salt),b=await seal(data,key,salt);
 assert.notEqual(a.iv,b.iv);assert.notEqual(a.ciphertext,b.ciphertext);assert(!JSON.stringify(a).includes('SECRET-DEMO-ONLY'));assert.deepEqual((await open(a,password)).data,data);
 await assert.rejects(open(a,'incorrect master passphrase'));
 const changed=bytes(a.ciphertext);changed[0]^=1;await assert.rejects(open({...a,ciphertext:base64(changed)},password));
 assert.throws(()=>validate({...a,iterations:1}));assert.throws(()=>validate({...a,iv:base64(new Uint8Array(8))}));
});
