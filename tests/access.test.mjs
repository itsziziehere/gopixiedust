import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import sharp from 'sharp';
const source=readFileSync('netlify/functions/pixie.mts','utf8').replace(/^import .*;\n/gm,'').replace('export default async req =>','globalThis.handler = async req =>');
function harness(user, sqlResults=[],queryResults=[]){
 const writes=[],queries=[],storeWrites=[],events=[],logins=[];
 const sql=async(parts,...values)=>{writes.push({sql:parts.join('?'),values});return sqlResults.shift()||[];};
 const context={Response,URL,crypto,Buffer,sharp,login:async(...args)=>logins.push(args),normalizeLine:value=>String(value||'').trim().toLowerCase().replace(/\s+/g,' '),refreshSpreadsheet:async()=>{},recordOwnerEvent:async(...args)=>events.push(args.slice(1)),getUser:async()=>user,getSettings:async()=>({}),getDatabase:()=>({sql,pool:{connect:async()=>({query:async(q,args)=>{queries.push({q,args});return queryResults.shift()||{rows:[],rowCount:0};},release(){}})}}),getStore:()=>({set:async(...args)=>storeWrites.push(args)}),verifyRequestOrigin:req=>{if(req.headers.get('origin')!==new URL(req.url).origin)throw Object.assign(new Error('Origin mismatch'),{status:403});}};
 vm.runInNewContext(source,context);
 return {handler:context.handler,writes,queries,storeWrites,events,logins};
}
function request(action,body,origin='https://pixie.test'){return new Request('https://pixie.test/.netlify/functions/pixie?action='+action,{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});}
test('anonymous cannot edit a recap',async()=>{const h=harness(null);const res=await h.handler(request('edit',{}));assert.equal(res.status,401);assert.equal(h.writes.length,0);});
test('buyer cannot impersonate owner through submitted fields',async()=>{const h=harness({id:'buyer',email:'buyer@example.com'});const res=await h.handler(request('edit',{owner:true,email:'ziziekaye@gmail.com'}));assert.equal(res.status,403);assert.equal(h.writes.length,0);});
test('buyer cannot approve or publish testimonials',async()=>{for(const action of ['decide','testimonial']){const h=harness({id:'buyer',email:'buyer@example.com'});const res=await h.handler(request(action,{id:1,status:'approved'}));assert.equal(res.status,403);assert.equal(h.writes.length,0);assert.equal(h.storeWrites.length,0);}});
test('cross-origin mutation is rejected even for owner',async()=>{const h=harness({id:'owner',email:'ziziekaye@gmail.com'});const res=await h.handler(request('decide',{id:1,status:'approved'},'https://other.test'));assert.equal(res.status,403);assert.equal(h.queries.length,0);});
test('transfer request is bound to authenticated email and does not change buyer',async()=>{const h=harness({id:'buyer-id',email:'buyer@example.com'},[[{id:99}]]);const res=await h.handler(request('transfer',{id:5,toEmail:'next@example.com',toName:'next',fromEmail:'fake@example.com'}));assert.equal(res.status,200);assert.equal(h.writes.length,1);assert.match(h.writes[0].sql,/INSERT INTO pixie_transfers/);assert.match(h.writes[0].sql,/AND buyer_email=/);assert.ok(h.writes[0].values.includes('buyer@example.com'));assert.ok(!h.writes[0].values.includes('fake@example.com'));assert.doesNotMatch(h.writes[0].sql,/UPDATE pixie_items/);});
test('unlinked buyer cannot submit transfer',async()=>{const h=harness({id:'buyer',email:'buyer@example.com'},[[]]);assert.equal((await h.handler(request('transfer',{id:5,toEmail:'next@example.com',toName:'next'}))).status,403);});
test('owner approval locks request and changes buyer in one transaction',async()=>{const h=harness({id:'owner',email:'ziziekaye@gmail.com'},[],[{},{rows:[{id:3,item_id:5,from_email:'first@example.com',to_email:'next@example.com',to_name:'next'}]},{rowCount:1},{},{}]);const res=await h.handler(request('decide',{id:3,status:'approved'}));assert.equal(res.status,200);assert.equal(h.queries[0].q,'BEGIN');assert.match(h.queries[1].q,/FOR UPDATE/);assert.match(h.queries[2].q,/UPDATE pixie_items/);assert.match(h.queries[3].q,/UPDATE pixie_transfers/);assert.equal(h.queries[4].q,'COMMIT');});
test('stale approval rolls back without marking approved',async()=>{const h=harness({id:'owner',email:'ziziekaye@gmail.com'},[],[{},{rows:[{id:3,item_id:5}]},{rowCount:0},{}]);const res=await h.handler(request('decide',{id:3,status:'approved'}));assert.equal(res.status,409);assert.equal(h.queries.at(-1).q,'ROLLBACK');assert.ok(!h.queries.some(x=>/UPDATE pixie_transfers/.test(x.q)));});
test('owner rejection never changes item ownership',async()=>{const h=harness({id:'owner',email:'ziziekaye@gmail.com'},[],[{},{rows:[{id:3,item_id:5}]},{},{}]);assert.equal((await h.handler(request('decide',{id:3,status:'rejected'}))).status,200);assert.ok(!h.queries.some(x=>/UPDATE pixie_items/.test(x.q)));});

test('owner upload stores a watermarked WebP, never the original image',async()=>{
 const h=harness({id:'owner',email:'ziziekaye@gmail.com'});
 const original=await sharp({create:{width:600,height:700,channels:3,background:'#cccccc'}}).png().toBuffer();
 const form=new FormData();form.set('author','Buyer');form.set('source','Shopee');form.set('caption','Packing aman');form.set('photo',new Blob([original],{type:'image/png'}),'review.png');
 const req=new Request('https://pixie.test/.netlify/functions/pixie?action=testimonial',{method:'POST',headers:{origin:'https://pixie.test'},body:form});
 const response=await h.handler(req);assert.equal(response.status,200);assert.equal(h.storeWrites.length,1);
 const [key,output]=h.storeWrites[0];assert.match(key,/\.webp$/);assert.equal((await sharp(output).metadata()).format,'webp');
 const pixels=await sharp(output).raw().toBuffer();assert.ok(pixels.some(v=>v<150),'Watermark introduces visible dark pixels to a plain gray original');
 assert.match(h.writes[0].sql,/INSERT INTO pixie_testimonials/);
});

test('buyer submits a LINE name for owner review without claiming items',async()=>{
 const h=harness({id:'buyer-id',email:'buyer@example.com'},[[{id:1}]]);
 const res=await h.handler(request('link-line',{lineName:'  Nama LINE  ',status:'approved',email:'other@example.com'}));
 assert.equal(res.status,200);assert.equal(h.writes.length,1);assert.match(h.writes[0].sql,/INSERT INTO pixie_buyer_links/);assert.ok(h.writes[0].values.includes('buyer@example.com'));assert.ok(h.writes[0].values.includes('nama line'));assert.equal(h.events[0][1],'line');assert.match(h.events[0][3],/Nama LINE/);assert.doesNotMatch(h.writes[0].sql,/UPDATE pixie_items/);
});
test('anonymous cannot link a LINE name and buyers cannot approve links or force sync',async()=>{
 assert.equal((await harness(null).handler(request('link-line',{lineName:'test'}))).status,401);
 for(const action of ['verify-line','sync'])assert.equal((await harness({id:'buyer',email:'buyer@example.com'}).handler(request(action,{id:1,status:'approved'}))).status,403);
});
test('owner LINE approval attaches items in one transaction',async()=>{
 const h=harness({email:'ziziekaye@gmail.com'},[],[{}, {rows:[{email:'buyer@example.com',normalized_name:'nama line'}]}, {rows:[]},{},{}]);
 assert.equal((await h.handler(request('verify-line',{id:1,status:'approved'}))).status,200);
 assert.equal(h.queries[0].q,'BEGIN');assert.match(h.queries[3].q,/UPDATE pixie_items/);assert.deepEqual(Array.from(h.queries[3].args),['buyer@example.com','nama line']);assert.equal(h.queries[4].q,'COMMIT');
});
test('owner approval rolls back when items already belong to another email',async()=>{
 const h=harness({email:'ziziekaye@gmail.com'},[],[{}, {rows:[{email:'buyer@example.com',normalized_name:'nama line'}]}, {rows:[{id:4}]},{}]);
 assert.equal((await h.handler(request('verify-line',{id:1,status:'approved'}))).status,409);assert.equal(h.queries.at(-1).q,'ROLLBACK');assert.ok(!h.queries.some(x=>/UPDATE pixie_items/.test(x.q)));
});
test('owner cannot write recap changes that would be overwritten by spreadsheet',async()=>{const h=harness({email:'ziziekaye@gmail.com'});assert.equal((await h.handler(request('edit',{id:1}))).status,409);assert.equal(h.writes.length,0);});

test('public data never queries or returns recap items',async()=>{
 const h=harness(null,[[],[]]);const res=await h.handler(new Request('https://pixie.test/?action=data'));assert.equal(res.status,200);assert.deepEqual((await res.json()).items,[]);assert.ok(!h.writes.some(w=>/FROM pixie_items/.test(w.sql)));
});
test('unverified LINE cannot read items, verified buyer query is scoped to own email',async()=>{
 for(const status of ['pending','rejected','approved']){const h=harness({id:'buyer',email:'buyer@example.com'},[[],[{status}],[],[],[]]);const res=await h.handler(new Request('https://pixie.test/?action=data'));assert.equal(res.status,200);const itemQueries=h.writes.filter(w=>/SELECT id,data,version FROM pixie_items/.test(w.sql));assert.equal(itemQueries.length,status==='approved'?1:0);if(itemQueries.length){assert.match(itemQueries[0].sql,/active AND buyer_email=/);assert.ok(itemQueries[0].values.includes('buyer@example.com'));}}
});

test('Zeazee login alias uses owner email and still requires password authentication',async()=>{
 for(const name of ['Zeazee',' zeAZee ','ziziekaye@gmail.com','buyer@example.com']){
  const h=harness(null),res=await h.handler(request('login',{email:name,password:'test-password'}));
  assert.equal(res.status,200);assert.deepEqual(h.logins,[[name==='buyer@example.com'?name:'ziziekaye@gmail.com','test-password']]);
 }
 for(const body of [{email:'Zeazee'},{email:'another-owner',password:'test-password'}]){
  const h=harness(null);assert.equal((await h.handler(request('login',body))).status,400);assert.equal(h.logins.length,0);
 }
 const h=harness(null);assert.equal((await h.handler(request('signup',{email:'Zeazee',password:'test-password'}))).status,400);
 assert.equal((await h.handler(request('login',{email:'Zeazee',password:'test-password'},'https://other.test'))).status,403);
 assert.equal(h.logins.length,0);
});
