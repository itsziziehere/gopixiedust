import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {JSDOM} from 'jsdom';
const source=readFileSync('netlify/functions/social.mts','utf8').replace(/^import .*;\n/gm,'').replace('export default async (req: Request, context) =>','globalThis.handler=async (req,context) =>');
function harness(user=null,results=[]){
 const queries=[],events=[],files=[];
 const context={Response,URL,File,Buffer,Date,createHash,randomUUID,sharp,getUser:async()=>user,getDatabase:()=>({sql:async(parts,...values)=>{queries.push({sql:parts.join('?'),values});return results.shift()||[];}}),getStore:()=>({set:async(...values)=>files.push(values)}),recordOwnerEvent:async(...values)=>events.push(values.slice(1)),verifyRequestOrigin:req=>{if(req.headers.get('origin')!==new URL(req.url).origin)throw Object.assign(new Error('Origin mismatch'),{status:403});}};
 vm.runInNewContext(source,context);return {handler:context.handler,queries,events,files};
}
function request(action,body,cookie='',suffix=''){
 return new Request('https://pixie.test/?action='+action+suffix,{method:body===undefined?'GET':'POST',headers:{origin:'https://pixie.test',...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...(cookie?{cookie}:{})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
}
function reviewForm(){const f=new FormData();f.set('caption','Packing rapi, infonya jelas.');for(const key of ['owner','admin','shipping','packing','information'])f.set(key,'5');return f;}
test('reviews require login, all five valid ratings, and a photo or story',async()=>{
 assert.equal((await harness().handler(request('review',reviewForm()))).status,401);
 const h=harness({id:'buyer'}),f=reviewForm();f.set('packing','6');assert.equal((await h.handler(request('review',f))).status,400);assert.equal(h.queries.length,0);
 f.set('packing','5');f.set('caption','');assert.equal((await h.handler(request('review',f))).status,400);assert.equal(h.files.length,0);
});
test('text-only buyer review publishes and creates an owner notification',async()=>{
 const h=harness({id:'buyer'},[[],[{id:8}]]),f=reviewForm();f.set('displayName','Nara');assert.equal((await h.handler(request('review',f))).status,200);
 assert.match(h.queries[1].sql,/INSERT INTO pixie_reviews/);assert.ok(h.queries[1].values.includes('buyer'));assert.equal(h.events[0][0],'review:8');assert.equal(h.files.length,0);
});
test('photo-only review stores a processed WebP and is immediately public',async()=>{
 const h=harness({id:'buyer'},[[],[{id:9}]]),f=reviewForm();f.set('caption','');f.set('photo',new Blob([await sharp({create:{width:300,height:400,channels:3,background:'#aaa'}}).png().toBuffer()],{type:'image/png'}),'photo.png');
 assert.equal((await h.handler(request('review',f))).status,200);assert.equal(h.files.length,1);assert.equal((await sharp(h.files[0][1]).metadata()).format,'webp');assert.match(h.queries[1].sql,/INSERT INTO pixie_reviews/);assert.equal(h.events[0][1],'review');
 const publicData=harness(null,[[{id:9,display_name:'Buyer Pixiedust',caption:'',owner_rating:5}]]);const r=await publicData.handler(request('reviews'));assert.equal(r.status,200);assert.equal((await r.json()).reviews[0].id,9);assert.doesNotMatch(publicData.queries[0].sql,/SELECT \*/);
});
test('guest and buyer cannot read owner inbox/events or hide reviews',async()=>{
 for(const user of [null,{id:'buyer',email:'buyer@example.com'}])for(const action of ['inbox','events','hide-review','read-event']){
  const h=harness(user);assert.equal((await h.handler(request(action,action.includes('review')||action==='read-event'?{id:1}:undefined))).status,403);assert.equal(h.queries.length,0);
 }
});
test('anonymous chat sends without a name or login and uses a private HttpOnly session',async()=>{
 const h=harness(null,[[],[{id:17}],[],[{id:42}],[]]);const r=await h.handler(request('send',{body:'Boleh tanya soal batch?'}),{ip:'192.0.2.1'});
 assert.equal(r.status,200);const cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);assert.equal((await r.json()).thread,17);assert.equal(h.events[0][0],'chat:42');assert.equal(h.events[0][4],17);assert.equal(h.queries[3].values[1],'buyer');assert.doesNotMatch(JSON.stringify(h.queries),/192\.0\.2\.1/);
});
test('guest chat lookup ignores a supplied thread ID and scopes reads to the hashed cookie',async()=>{
 const h=harness(null,[[{id:17}],[{id:1,sender:'owner',body:'Halo!'}]]);const cookie='pixie_chat='+randomUUID();const r=await h.handler(request('chat',undefined,cookie,'&thread=999'));
 assert.equal(r.status,200);assert.match(h.queries[0].sql,/session_hash=/);assert.equal(h.queries[1].values[0],17);assert.ok(!JSON.stringify(h.queries).includes('999'));
 const noCookie=harness();assert.deepEqual(await (await noCookie.handler(request('chat',undefined,'','&thread=999'))).json(),{thread:null,messages:[]});assert.equal(noCookie.queries.length,0);
});
test('owner replies are persisted as owner messages in the selected thread',async()=>{
 const h=harness({email:'ziziekaye@gmail.com'},[[{id:17}],[],[{id:43}],[]]);const r=await h.handler(request('send',{body:'Boleh, kak. Mau tanya apa?'},'','&thread=17'));
 assert.equal(r.status,200);assert.match(h.queries[0].sql,/WHERE id=/);assert.equal(h.queries[2].values[1],'owner');assert.equal(h.events.length,0);
});
test('chat rejects cross-origin requests and rate-limits rapid messages',async()=>{
 const h=harness();const r=await h.handler(new Request('https://pixie.test/?action=send',{method:'POST',headers:{origin:'https://evil.test','Content-Type':'application/json'},body:'{"body":"hello"}'}));assert.equal(r.status,403);assert.equal(h.queries.length,0);
 const recent=harness(null,[[{id:17}],[{id:41}]]);assert.equal((await recent.handler(request('send',{body:'Again'},'pixie_chat='+randomUUID()))).status,429);assert.equal(recent.events.length,0);
});
test('authenticated buyer arrival is recorded, guests cannot spoof a login event',async()=>{
 const h=harness({id:'buyer',email:'buyer@example.com'});assert.equal((await h.handler(request('arrival',{email:'spoof@example.com'}))).status,200);assert.match(h.events[0][3],/buyer@example.com/);assert.doesNotMatch(h.events[0][3],/spoof/);assert.equal((await harness().handler(request('arrival',{}))).status,401);
});
async function page(owner=false){
 const html=readFileSync('public/index.html','utf8'),dom=new JSDOM(html,{url:'https://pixie.test',runScripts:'outside-only'}),w=dom.window;
 w.tailwind={};w.scrollTo=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 const data={user:owner?{id:'owner',email:'ziziekaye@gmail.com'}:null,owner,items:[],transfers:[],testimonials:[],links:[]},features={faq:[],merch:[],payments:[],deadlines:[]};
 const review={id:1,display_name:'<img src=x>',caption:'<script>bad()</script>',image_key:null,created_at:new Date().toISOString(),owner_rating:5,admin_rating:4,shipping_rating:3,packing_rating:5,information_rating:4};
 w.fetch=async url=>({ok:true,json:async()=>String(url).includes('social')?{reviews:[review],events:[],threads:[],messages:[]}:String(url).includes('community')?features:data});
 for(const script of w.document.querySelectorAll('script:not([src])'))vm.runInContext(script.textContent,dom.getInternalVMContext());
 for(const file of ['public/app.js','public/features.js','public/social.js'])vm.runInContext(readFileSync(file,'utf8'),dom.getInternalVMContext());
 await w.onload();w.onload=null;return dom;
}
test('buyer reviews render safely on dashboard and gallery with five service ratings',async()=>{
 const dom=await page(),d=dom.window.document;
 assert.equal(d.querySelectorAll('#dashboard-buyer-reviews img').length,0);assert.match(d.querySelector('#dashboard-buyer-reviews').textContent,/<script>/);assert.equal(d.querySelectorAll('#dashboard-buyer-reviews dt').length,5);assert.match(d.querySelector('#all-buyer-reviews').textContent,/Admin nyelem/);assert.equal(d.querySelectorAll('#buyer-review-form select[required]').length,5);assert.equal(d.querySelector('#buyer-review-form').closest('dialog').id,'buyer-review-dialog');
 assert.equal(d.querySelector('#welcome-dialog h2').textContent,'Welcome to GO Pixiedust!');assert.equal(d.querySelector('#welcome-dialog .my-4').textContent,'Safe group orders, smooth deliveries, and happy collection hauls with Pixiedust');assert.match(d.querySelector('#dashboard-testimonials').textContent,/Cek Testimoni dari buyer lain/);assert.ok(d.querySelectorAll('.star-trail svg').length>=10);dom.window.close();
});
test('guest can open floating chat while owner receives a private activity panel',async()=>{
 const guest=await page();await guest.window.toggleChat(true);assert.equal(guest.window.document.querySelector('#chat-panel').classList.contains('hidden'),false);assert.match(guest.window.document.querySelector('#chat-privacy').textContent,/tanpa login dan tanpa nama/);assert.equal(guest.window.document.querySelector('#owner-activity').classList.contains('hidden'),true);guest.window.close();
 const owner=await page(true);assert.equal(owner.window.document.querySelector('#owner-activity').classList.contains('hidden'),false);owner.window.close();
});
