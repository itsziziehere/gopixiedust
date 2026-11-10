import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';
const source=readFileSync('netlify/functions/community.mts','utf8').replace(/^import .*;\n/gm,'').replace('export default async (req: Request) =>','globalThis.handler=async req =>');
function harness(user,results=[]){
 const calls=[],files=[],events=[];
 const context={Response,URL,File,Buffer,crypto,sharp,Netlify:{env:{get:()=>null}},syncPayments:async()=>false,recordOwnerEvent:async(...args)=>events.push(args.slice(1)),pushKeys:async()=>({publicKey:'public-only',privateKey:'must-never-leak'}),getUser:async()=>user,getDatabase:()=>({sql:async(parts,...values)=>{calls.push({sql:parts.join('?'),values});return results.shift()||[];}}),getStore:()=>({set:async(...args)=>files.push(args)}),verifyRequestOrigin:req=>{if(req.headers.get('origin')!==new URL(req.url).origin)throw Object.assign(new Error('Origin mismatch'),{status:403});}};
 vm.runInNewContext(source,context);return {handler:context.handler,calls,files,events};
}
function request(action,body,origin='https://pixie.test'){return new Request('https://pixie.test/?action='+action,{method:'POST',headers:{origin,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:JSON.stringify(body)});}
test('only owner can publish FAQ, merch and review payments',async()=>{
 for(const action of ['faq','merch','review-payment','deadline','delete-merch','sync-payments']){
  const h=harness({id:'buyer',email:'buyer@example.com'});assert.equal((await h.handler(request(action,{}))).status,403);assert.equal(h.calls.length,0);
 }
});
test('new feature mutations reject cross-origin requests',async()=>{const h=harness({email:'ziziekaye@gmail.com'});assert.equal((await h.handler(request('faq',{question:'Q',answer:'A'},'https://other.test'))).status,403);assert.equal(h.calls.length,0);});
test('payment upload enforces ownership before storing any file',async()=>{
 const h=harness({id:'buyer',email:'buyer@example.com'}),form=new FormData();form.set('itemId','1');form.set('proof',new Blob(['%PDF-test'],{type:'application/pdf'}),'proof.pdf');
 assert.equal((await h.handler(request('payment',form))).status,403);assert.equal(h.files.length,0);assert.match(h.calls[0].sql,/buyer_email=.*EXISTS/);
});
test('valid PDF proof persists privately and queues spreadsheet write',async()=>{
 const h=harness({id:'buyer',email:'buyer@example.com'},[[{id:1}],[{id:50}]]),form=new FormData();form.set('itemId','1');form.set('proof',new Blob(['%PDF-1.7\n'],{type:'application/pdf'}),'proof.pdf');
 assert.equal((await h.handler(request('payment',form))).status,200);assert.equal(h.files.length,1);assert.match(h.files[0][0],/\.pdf$/);assert.match(h.calls[1].sql,/INSERT INTO pixie_payments/);assert.ok(h.calls[1].values.includes('buyer@example.com'));assert.equal(h.events[0][0],'payment:50');
});
test('other buyers cannot download private proof',async()=>{const h=harness({email:'other@example.com'},[[{id:1,buyer_email:'buyer@example.com'}]]);assert.equal((await h.handler(new Request('https://pixie.test/?action=proof&id=1'))).status,403);});
test('owner merch upload stores a watermarked image',async()=>{
 const h=harness({email:'ziziekaye@gmail.com'}),form=new FormData();form.set('name','PC available');form.set('price','65000');form.set('photo',new Blob([await sharp({create:{width:400,height:500,channels:3,background:'#aaa'}}).png().toBuffer()],{type:'image/png'}),'photo.png');
 assert.equal((await h.handler(request('merch',form))).status,200);assert.equal(h.files.length,1);assert.equal((await sharp(h.files[0][1]).metadata()).format,'webp');assert.ok((await sharp(h.files[0][1]).raw().toBuffer()).some(v=>v<150));assert.match(h.calls[0].sql,/INSERT INTO pixie_merch/);
});
const html=readFileSync('public/index.html','utf8');
async function page(){
 const dom=new JSDOM(html,{url:'https://pixie.test',runScripts:'outside-only'}),w=dom.window;
 w.tailwind={};w.scrollTo=()=>{};w.HTMLDialogElement.prototype.showModal=function(){};
 const base={user:{id:'buyer',email:'buyer@example.com'},owner:false,links:[{status:'approved',line_name:'Buyer'}],transfers:[],testimonials:[],items:[{id:1,name:'PC Jajanan',sheet:'CH',batch:'B1',canTransfer:true,payment:'Done DP'},{id:2,name:'PC Tax',sheet:'TAGIHAN TAX',batch:'T1',canTransfer:true}]};
 const features={faq:[],merch:[],payments:[],deadlines:[]};
 w.fetch=async url=>({ok:true,json:async()=>String(url).includes('community')?features:base});
 for(const s of w.document.querySelectorAll('script:not([src])'))vm.runInContext(s.textContent,dom.getInternalVMContext());
 for(const path of ['public/app.js','public/features.js'])vm.runInContext(readFileSync(path,'utf8'),dom.getInternalVMContext());
 await w.onload();w.onload=null;return dom;
}
test('jajanan and tax have exclusive rows and retain payment controls across tab changes',async()=>{
 const dom=await page(),w=dom.window,d=w.document;
 assert.match(d.querySelector('#recap-table-body').textContent,/PC Jajanan/);assert.doesNotMatch(d.querySelector('#recap-table-body').textContent,/PC Tax/);assert.match(d.querySelector('#recap-table-body').textContent,/Upload bukti/);
 w.switchTab('tax');assert.ok(d.querySelector('#tab-tax #recap-table-body'));assert.match(d.querySelector('#recap-table-body').textContent,/PC Tax/);assert.doesNotMatch(d.querySelector('#recap-table-body').textContent,/PC Jajanan/);
 w.switchTab('tax');w.switchTab('recap');assert.ok(d.querySelector('#tab-recap #recap-table-body'));assert.equal(d.querySelectorAll('#recap-table-body').length,1);assert.equal(d.querySelectorAll('.nav-btn').length,7);dom.window.close();
});
test('photocard has fixed country tax without weight and postcards show a full price range',async()=>{
 const dom=await page(),w=dom.window,d=w.document;
 for(const [country,expected] of [['KR','Rp 6.000'],['CN','Rp 7.000'],['JP','Rp 6.000'],['TH','Rp 6.000']]){w.selectCalcCountry(country);assert.equal(d.querySelector('#out-tax-est').innerText,expected);assert.ok(d.querySelector('#calc-weight-gram').parentElement.classList.contains('hidden'));}
 d.querySelector('#calc-merch-type').value='POSTCARD';w.runFullCalculation();assert.equal(d.querySelector('#out-tax-est').innerText,'Rp 8.000–Rp 9.000');assert.match(d.querySelector('#out-grand-total').innerText,/ – /);
 d.querySelector('#calc-merch-type').value='ALBUM';w.runFullCalculation();assert.ok(!d.querySelector('#calc-weight-gram').parentElement.classList.contains('hidden'));dom.window.close();
});

test('public catalog response exposes only the public push key and no buyer records',async()=>{
 const h=harness(null,[[],[]]);const r=await h.handler(new Request('https://pixie.test/?action=data'));assert.equal(r.status,200);const body=await r.text();assert.ok(!body.includes('must-never-leak'));const data=JSON.parse(body);assert.equal(data.pushKey,'public-only');assert.deepEqual(data.payments,[]);assert.deepEqual(data.deadlines,[]);
});
test('missing Google configuration leaves receipts queued without attempting external writes',async()=>{
 const previous=globalThis.Netlify;globalThis.Netlify={env:{get:()=>undefined}};
 try{
  const {syncPayments}=await import('../netlify/lib/payment-sheets.mjs');
  assert.equal(await syncPayments({sql:()=>{throw new Error('Must not mark receipts synced');}}),false);
 }finally{if(previous===undefined)delete globalThis.Netlify;else globalThis.Netlify=previous;}
});
