import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const html=readFileSync('public/index.html','utf8'), app=readFileSync('public/app.js','utf8');
async function page(data){
 const dom=new JSDOM(html,{url:'https://pixie.test',runScripts:'outside-only'}),w=dom.window;
 w.tailwind={};w.scrollTo=()=>{};w.fetch=async()=>({ok:true,json:async()=>data});
 for(const script of w.document.querySelectorAll('script:not([src])'))vm.runInContext(script.textContent,dom.getInternalVMContext());
 vm.runInContext(app,dom.getInternalVMContext());await w.onload();w.onload=null;return dom;
}
const base={user:null,owner:false,items:[],transfers:[],testimonials:[]};
test('visitor sees honest empty testimonials and cannot see owner upload form',async()=>{const dom=await page(base),d=dom.window.document;assert.match(d.getElementById('dashboard-testimonials').textContent,/segera hadir/);assert.ok(d.getElementById('testimonial-form').classList.contains('hidden'));assert.equal(d.getElementById('current-user-name').textContent,'Masuk akun');dom.window.close();});
test('recap escapes spreadsheet content and offers transfer only for linked buyer',async()=>{const dom=await page({...base,user:{email:'buyer@example.com'},links:[{status:'approved',line_name:'test'}],items:[{id:1,name:'<img src=x onerror=alert(1)>',buyer:'test',sheet:'CH 1-100',batch:'BATCH 1',canTransfer:true},{id:2,name:'Other item',buyer:'other',sheet:'CH 1-100',batch:'BATCH 1',canTransfer:false}]}),d=dom.window.document;assert.equal(d.querySelectorAll('#recap-table-body img').length,0);assert.equal(d.querySelectorAll('#recap-table-body button').length,1);assert.match(d.getElementById('recap-table-body').textContent,/<img src=x/);dom.window.close();});
test('owner sees edit controls and real testimonials on dashboard',async()=>{const dom=await page({...base,owner:true,user:{email:'ziziekaye@gmail.com'},items:[{id:1,name:'PC',buyer:'buyer',sheet:'KR',batch:'BATCH 1'}],testimonials:[{id:1,author:'Buyer',source:'LINE',caption:'Paket tiba aman',image_key:'abc.webp'}]}),d=dom.window.document;assert.ok(!d.getElementById('testimonial-form').classList.contains('hidden'));assert.match(d.getElementById('recap-table-body').textContent,/Edit/);assert.match(d.getElementById('dashboard-testimonials').textContent,/Paket tiba aman/);assert.match(d.querySelector('#dashboard-testimonials img').getAttribute('src'),/action=image/);dom.window.close();});
test('supplied buyer image opens at full resolution and owner is not presented as author',async()=>{
 const dom=await page({...base,testimonials:[{id:8,author:'Buyer LINE',source:'LINE',caption:'Foto buyer di LINE',image_key:'/assets/testimonials/buyer-8.webp'}]}),d=dom.window.document;
 const img=d.querySelector('#dashboard-testimonials img');assert.equal(img.getAttribute('src'),'/assets/testimonials/buyer-8.webp');assert.equal(img.closest('a').getAttribute('href'),img.getAttribute('src'));assert.doesNotMatch(d.getElementById('dashboard-testimonials').textContent,/Zeazee/);assert.equal(d.querySelector('.brand-logo').getAttribute('src'),'/assets/pixiedust-logo.webp');dom.window.close();
});
test('theme toggle persists choice and updates accessibility state',async()=>{
 const dom=await page(base),w=dom.window;w.toggleDarkMode();assert.equal(w.document.documentElement.classList.contains('dark'),false);assert.equal(w.localStorage.getItem('pixiedust-theme'),'light');assert.equal(w.document.getElementById('theme-toggle').getAttribute('aria-pressed'),'false');w.toggleDarkMode();assert.equal(w.localStorage.getItem('pixiedust-theme'),'dark');dom.window.close();
});

test('registration validates matching passwords and shows email confirmation after signup',async()=>{
 const dom=await page(base),w=dom.window,d=w.document,calls=[];
 w.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({ok:true,message:'Periksa email untuk konfirmasi akun.'})};};
 w.setAuthMode('signup');
 assert.equal(d.getElementById('auth-password').autocomplete,'new-password');
 assert.equal(d.getElementById('auth-password-confirm').required,true);
 d.getElementById('auth-email').value='buyer@example.com';
 d.getElementById('auth-password').value='buyer-password';
 d.getElementById('auth-password-confirm').value='different-password';
 const event={preventDefault(){},submitter:d.getElementById('auth-submit')};
 await w.authenticate(event,'signup');assert.equal(calls.length,0);
 d.getElementById('auth-password-confirm').value='buyer-password';
 await w.authenticate(event,'signup');assert.equal(calls.length,1);assert.match(calls[0].url,/action=signup/);
 assert.equal(d.getElementById('confirmation-form').classList.contains('hidden'),false);
 assert.equal(d.getElementById('auth-password').value,'');
 w.setAuthMode('login');assert.equal(d.getElementById('auth-password-confirm').required,false);
 assert.match(d.body.textContent,/Go 1 \(Multifandom\)/);dom.window.close();
});
test('closed registration keeps login available and explains why signup is unavailable',async()=>{
 const dom=await page(base),w=dom.window,d=w.document;
 w.fetch=async()=>({ok:true,json:async()=>({disableSignup:true,providers:{}})});
 await w.openLoginModal();assert.equal(d.getElementById('signup-button').disabled,true);
 w.setAuthMode('signup');assert.match(d.getElementById('auth-message').textContent,/ditutup/);
 assert.equal(d.getElementById('auth-submit').textContent,'Masuk');dom.window.close();
});

test('signed-in buyer without a verified LINE cannot see recap even if stale items exist',async()=>{
 const dom=await page({...base,user:{id:'buyer',email:'buyer@example.com'},items:[{id:1,name:'My PC',canTransfer:true},{id:2,name:'Other PC'}]}),d=dom.window.document;
 assert.equal(d.getElementById('my-items-filter').checked,true);assert.doesNotMatch(d.getElementById('recap-table-body').textContent,/My PC/);assert.doesNotMatch(d.getElementById('recap-table-body').textContent,/Other PC/);assert.ok(d.getElementById('line-name'));dom.window.close();
});
test('pending and verified LINE names show appropriate status without another claim form',async()=>{
 for(const status of ['pending','approved']){const dom=await page({...base,user:{id:'buyer',email:'buyer@example.com'},links:[{line_name:'<buyer>',status}]}),d=dom.window.document;assert.equal(d.getElementById('line-name'),null);assert.match(d.getElementById('line-link-panel').textContent,status==='pending'?/Menunggu verifikasi/:/Terverifikasi/);assert.equal(d.querySelectorAll('#line-link-panel buyer').length,0);dom.window.close();}
});

test('eye toggles password visibility with accessible state',async()=>{
 const dom=await page(base),w=dom.window,d=w.document;
 for(const id of ['auth-password','auth-password-confirm','reset-password','reset-confirm']){const input=d.getElementById(id),button=input.parentElement.querySelector('button');w.togglePassword(id,button);assert.equal(input.type,'text');assert.equal(button.getAttribute('aria-pressed'),'true');w.togglePassword(id,button);assert.equal(input.type,'password');}dom.window.close();
});
test('buyer filters category and fulfillment while unknown status stays explicit',async()=>{
 const dom=await page({...base,user:{id:'buyer',email:'buyer@example.com'},links:[{status:'approved',line_name:'buyer'}],items:[{id:1,name:'China PC',sheet:'CH 1-100',status:'Sudah checkout',canTransfer:true},{id:2,name:'Korea PC',sheet:'KR',notes:'Nimbun di rumah admin',canTransfer:true},{id:3,name:'Tax PC',sheet:'TAGIHAN TAX',canTransfer:true}]}),w=dom.window,d=w.document;
 assert.equal(w.itemFulfillment({payment:'Lunas'}),'unknown');
 d.getElementById('category-filter').value='korea';d.getElementById('fulfillment-filter').value='admin';w.renderBuyerRecapTable();assert.match(d.getElementById('recap-table-body').textContent,/Korea PC/);assert.doesNotMatch(d.getElementById('recap-table-body').textContent,/China PC|Tax PC/);assert.equal(d.getElementById('floating-line').classList.contains('hidden'),false);dom.window.close();
});
test('pending LINE and visitors cannot reveal recap by disabling personal filter',async()=>{
 for(const user of [null,{id:'buyer',email:'buyer@example.com'}]){const dom=await page({...base,user,links:[{status:'pending',line_name:'buyer'}],items:[{id:1,name:'Private PC',canTransfer:true}]}),w=dom.window,d=w.document;d.getElementById('my-items-filter').checked=false;w.renderBuyerRecapTable();assert.doesNotMatch(d.getElementById('recap-table-body').textContent,/Private PC/);dom.window.close();}
});

test('login accepts Zeazee while signup and recovery require an email',async()=>{
 const dom=await page(base),w=dom.window,d=w.document,calls=[];
 w.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>base};};
 d.getElementById('auth-email').value='Zeazee';d.getElementById('auth-password').value='test-password';
 const event={preventDefault(){},submitter:d.getElementById('auth-submit')};
 await w.authenticate(event,'login');
 const login=calls.find(c=>c.url.includes('action=login'));assert.ok(login);assert.equal(JSON.parse(login.options.body).email,'Zeazee');
 calls.length=0;await w.authenticate(event,'recover');assert.equal(calls.length,0);assert.match(d.getElementById('auth-message').textContent,/alamat email/);
 w.setAuthMode('signup');assert.equal(d.getElementById('auth-email').type,'email');assert.equal(d.getElementById('auth-email').checkValidity(),false);
 w.setAuthMode('login');assert.equal(d.getElementById('auth-email').type,'text');assert.equal(d.getElementById('auth-email').autocomplete,'username');dom.window.close();
});
