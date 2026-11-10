let session = {user:null,owner:false,transfers:[]}, recapPage=1, editingItem=null, transferItem=null, authSettings=null, authMode='login';
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = value => value===''||value==null?'—':Number.isFinite(Number(value))?'Rp '+Number(value).toLocaleString('id-ID'):String(value);
function notify(message){$('app-message').textContent=message;}
async function api(action='data',body){
 const response=await fetch('/.netlify/functions/pixie?action='+encodeURIComponent(action),body===undefined?{}:{method:'POST',headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body instanceof FormData?body:JSON.stringify(body)});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'Permintaan gagal.');return data;
}
async function refreshData(){
 try{
  const previousUser=session.user?.id;
  session=await api();
  if(previousUser!==session.user?.id){$('my-items-filter').checked=!!session.user&&!session.owner;$('search-recap-input').value='';$('sheet-filter').value='';$('category-filter').value='';$('fulfillment-filter').value='';recapPage=1;}recapItems.splice(0,recapItems.length,...session.items);testimonials.splice(0,testimonials.length,...session.testimonials);
  currentUser=session.user?.email||'Pengunjung';$('current-user-name').textContent=session.owner?'Zeazee · Owner':session.user?'Akun buyer':'Masuk akun';$('user-display-heading').textContent=session.owner?'Zeazee':session.user?'Akun saya':'Pengunjung';
  document.querySelectorAll('.owner-only').forEach(e=>e.classList.toggle('hidden',!session.owner));
  $('auth-tabs').classList.toggle('hidden',!!session.user);$('logout-button').classList.toggle('hidden',!session.user);$('auth-form').classList.toggle('hidden',!!session.user);
  const selected=$('sheet-filter').value;$('sheet-filter').innerHTML='<option value="">Semua sheet</option>'+[...new Set(recapItems.map(i=>i.sheet))].map(s=>`<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join('');$('sheet-filter').value=selected;
  renderBuyerRecapTable();renderUserSummary();renderTestimonials();renderTransfers();renderLineLinks();notify('');if(window.refreshFeatures)await refreshFeatures();
 }catch(e){recapItems.splice(0);$('recap-count').textContent='';$('recap-pagination').innerHTML='';notify('Rekapan belum dapat dimuat: '+e.message);$('recap-table-body').innerHTML='<tr><td colspan="8" class="p-5">Data belum tersedia. <button class="underline" onclick="refreshData()">Coba lagi</button></td></tr>';}
}
function renderBuyerRecapTable(){
 if(!session.owner&&(!session.user||!session.links?.some(l=>l.status==='approved'))){$('recap-table-body').innerHTML='<tr><td colspan="8" class="p-5">'+(!session.user?'Masuk atau daftar akun untuk melihat jajananmu.':'Drop DN LINE dan tunggu verifikasi Zeazee untuk membuka rekapan pribadimu.')+'</td></tr>';$('recap-count').textContent='';$('recap-pagination').innerHTML='';return;}
 const query=$('search-recap-input').value.toLowerCase(),sheet=$('sheet-filter').value,mine=$('my-items-filter').checked;
 const items=recapItems.filter(i=>(itemCategory(i)==='tax')===(window.recapMode==='tax')&&(!sheet||i.sheet===sheet)&&(!mine||i.canTransfer)&&(!$('category-filter').value||itemCategory(i)===$('category-filter').value)&&(!$('fulfillment-filter').value||itemFulfillment(i)===$('fulfillment-filter').value)&&[i.name,i.buyer,i.batch,i.group].some(v=>String(v||'').toLowerCase().includes(query)));
 const pages=Math.max(1,Math.ceil(items.length/40));recapPage=Math.min(pages,Math.max(1,recapPage));
 $('recap-count').textContent=items.length+' item';
 $('recap-table-body').innerHTML=items.slice((recapPage-1)*40,recapPage*40).map(i=>{
  const pending=session.transfers.some(t=>t.item_id===i.id&&t.status==='pending');
  return `<tr class="hover:bg-purple-100/30"><td class="p-3.5"><strong>${escapeHTML(i.name)}</strong><div class="text-xs opacity-70">${escapeHTML(i.group)}</div></td><td class="p-3.5">${escapeHTML(i.buyer)}</td><td class="p-3.5"><div>${escapeHTML(i.sheet)}</div><strong>${escapeHTML(i.batch)}</strong></td><td class="p-3.5">Qty ${escapeHTML(i.qty||'—')}<div>${escapeHTML(fmt(i.price))}</div><strong>Total ${escapeHTML(fmt(i.total))}</strong></td><td class="p-3.5">DP ${escapeHTML(fmt(i.dp))}<div>Tax ${escapeHTML(fmt(i.tax))}</div></td><td class="p-3.5"><strong>${escapeHTML(i.payment||'Belum dicatat')}</strong><div>${escapeHTML(i.paymentDate||'—')}</div><div>${escapeHTML(i.method)}</div></td><td class="p-3.5">${escapeHTML(i.notes||'—')}<div>${escapeHTML(i.status)}</div><strong>${escapeHTML({checkout:'Sudah checkout',admin:'Nimbun di rumah admin',unknown:'Belum ada keterangan checkout / penyimpanan'}[itemFulfillment(i)])}</strong></td><td class="p-3.5 space-y-2">${session.owner?'<a class="underline" href="https://bit.ly/RekapanPixiedustGO" target="_blank" rel="noopener noreferrer">Edit di spreadsheet ↗</a>':''}${window.paymentCell?paymentCell(i):''}${i.canTransfer&&!pending&&itemCategory(i)!=='tax'?`<button class="pixie-button" onclick="openTransfer(${i.id})">Operslot</button>`:''}${pending?'<span class="text-xs">Menunggu Zeazee</span>':''}${!session.owner&&!i.canTransfer&&!pending?'—':''}</td></tr>`;
 }).join('')||'<tr><td colspan="8" class="p-5">Tidak ada item yang sesuai.</td></tr>';
 $('recap-pagination').innerHTML=`<button onclick="recapPage--;renderBuyerRecapTable()" ${recapPage===1?'disabled':''}>← Sebelumnya</button><span>${recapPage} / ${pages}</span><button onclick="recapPage++;renderBuyerRecapTable()" ${recapPage===pages?'disabled':''}>Berikutnya →</button>`;
}
function renderUserSummary(){
 const items=recapItems.filter(i=>i.canTransfer);
 $('dashboard-user-summary').innerHTML=[['Item terhubung',session.user?items.length+' item':'Login untuk melihat item'],['Operslot menunggu',session.transfers.filter(t=>t.status==='pending').length+' pengajuan'],['Pengelola rekapan','Zeazee · Owner']].map(([label,value])=>`<div class="glass-card p-4 rounded-2xl"><p class="text-xs opacity-70">${label}</p><strong class="block text-lg mt-2">${escapeHTML(value)}</strong></div>`).join('')+`<button class="pixie-button" onclick="switchTab('recap')">${session.user?'Lihat jajanan saya / hubungkan LINE':'Masuk untuk menghubungkan jajanan'} ↗</button>`;
}
function testimonialImage(t){
 return /^\/assets\/testimonials\/buyer-\d+\.webp$/.test(t.image_key) ? t.image_key : '/.netlify/functions/pixie?action=image&key='+encodeURIComponent(t.image_key);
}
function renderTestimonials(){
 const cards=items=>items.map(t=>`<article class="glass-card p-4 rounded-2xl space-y-3"><div class="flex justify-between gap-3"><strong>${escapeHTML(t.author)}</strong><span class="text-xs">${escapeHTML(t.source)}</span></div><a href="${escapeHTML(testimonialImage(t))}" target="_blank" rel="noopener noreferrer" class="story-image-link" aria-label="Buka foto testimoni ${escapeHTML(t.source)} ukuran penuh"><img loading="lazy" class="story-photo" src="${escapeHTML(testimonialImage(t))}" alt="Testimoni ${escapeHTML(t.source)} dari ${escapeHTML(t.author)} — GO PIXIEDUST"><span class="text-xs underline">Buka foto ukuran penuh ↗</span></a><p class="text-sm whitespace-pre-wrap">${escapeHTML(t.caption)}</p>${session.owner?`<button class="text-xs underline" onclick="deleteTestimonial(${t.id})">Hapus testimoni</button>`:''}</article>`).join('');
 const empty='<div class="glass-card p-6 rounded-2xl text-sm"><strong>Cerita buyer segera hadir ♡</strong><p class="mt-2">Cek Testimoni dari buyer lain</p></div>';
 $('testimonial-list-container').innerHTML=cards(testimonials)||empty;$('dashboard-testimonials').innerHTML=cards(testimonials.slice(0,3))||empty;
}
function renderTransfers(){
 $('transfer-list').innerHTML=session.transfers.map(t=>`<div class="glass-card p-4 rounded-xl"><strong>${escapeHTML(t.item_name)}</strong><p class="text-xs mt-1">Penerima: ${escapeHTML(t.to_name)} · ${escapeHTML(t.to_email)}</p><p class="text-xs mt-1">${{pending:'Menunggu konfirmasi Zeazee',approved:'Disetujui · buyer telah diganti',rejected:'Ditolak · buyer tetap'}[t.status]}</p>${session.owner&&t.status==='pending'?`<div class="flex gap-3 mt-3"><button class="pixie-button" onclick="decideTransfer(${t.id},'approved',this)">Setujui</button><button class="text-xs underline" onclick="decideTransfer(${t.id},'rejected',this)">Tolak</button></div>`:''}</div>`).join('')||'<p class="text-xs opacity-70">Belum ada pengajuan operslot.</p>';
}
const fieldLabels={name:'Nama barang',buyer:'Nama LINE buyer',group:'Grup',qty:'Qty',price:'Harga',dp:'DP',total:'Total',tax:'Tax',paymentDate:'Tanggal payment',payment:'Status pembayaran',method:'Metode pembayaran',notes:'Keterangan',batch:'Batch',sheet:'Sheet',status:'Status logistik',kosStatus:'Status kos admin'};
function editItem(id){
 if(!session.owner)return;editingItem=recapItems.find(i=>i.id===id);
 $('edit-fields').innerHTML=Object.entries(fieldLabels).map(([key,label])=>`<label class="block text-xs">${label}<input name="${key}" maxlength="500" value="${escapeHTML(editingItem[key])}" class="pixie-input" ${['name','buyer'].includes(key)?'required':''}></label>`).join('')+`<label class="block text-xs sm:col-span-2">Email akun buyer (opsional sampai dicocokkan)<input name="buyerEmail" type="email" class="pixie-input" value="${escapeHTML(editingItem.buyerEmail||'')}"></label>`;
 $('edit-dialog').showModal();
}
async function saveItem(event){event.preventDefault();const button=event.submitter;button.disabled=true;try{const data=Object.fromEntries(new FormData(event.target));await api('edit',{id:editingItem.id,version:editingItem.version,buyerEmail:data.buyerEmail,data});$('edit-dialog').close();await refreshData();notify('Perubahan rekapan tersimpan.');}catch(e){alert(e.message);}finally{button.disabled=false;}}
function openTransfer(id){transferItem=recapItems.find(i=>i.id===id);$('transfer-item').textContent=transferItem.name+' · '+transferItem.batch;$('transfer-name').value='';$('transfer-email').value='';$('transfer-dialog').showModal();}
async function submitTransfer(event){event.preventDefault();event.submitter.disabled=true;try{await api('transfer',{id:transferItem.id,toName:$('transfer-name').value,toEmail:$('transfer-email').value});$('transfer-dialog').close();await refreshData();notify('Pengajuan terkirim. Menunggu konfirmasi Zeazee.');}catch(e){alert(e.message);}finally{event.submitter.disabled=false;}}
async function decideTransfer(id,status,button){button.disabled=true;try{await api('decide',{id,status});await refreshData();notify(status==='approved'?'Operslot disetujui; buyer item telah diperbarui.':'Operslot ditolak.');}catch(e){alert(e.message);}finally{button.disabled=false;}}
function previewPhoto(input){const file=input.files[0];if(!file)return;if(file.size>4*1024*1024){input.value='';$('upload-message').textContent='Ukuran foto maksimal 4 MB.';return;}const image=$('photo-preview');if(image.dataset.url)URL.revokeObjectURL(image.dataset.url);image.dataset.url=URL.createObjectURL(file);image.src=image.dataset.url;image.classList.remove('hidden');}
async function uploadTestimonial(event){event.preventDefault();const button=event.submitter;button.disabled=true;$('upload-message').textContent='Memberi watermark dan mengunggah foto…';try{await api('testimonial',new FormData(event.target));event.target.reset();$('photo-preview').classList.add('hidden');await refreshData();$('upload-message').textContent='Testimoni terbit dengan watermark GO PIXIEDUST.';}catch(e){$('upload-message').textContent=e.message;}finally{button.disabled=false;}}
async function deleteTestimonial(id){if(!confirm('Hapus testimoni ini dari dashboard dan galeri?'))return;try{await api('delete-testimonial',{id});await refreshData();}catch(e){alert(e.message);}}
function setAuthMode(mode){
 if(mode==='signup' && authSettings?.disableSignup){$('auth-message').textContent='Pendaftaran akun sedang ditutup.';return;}
 authMode=mode;
 $('auth-email').type=mode==='signup'?'email':'text';
 $('auth-email').autocomplete=mode==='signup'?'email':'username';
 $('auth-email-label').textContent=mode==='signup'?'Email':'Email atau nama owner';
 $('auth-password').autocomplete=mode==='signup'?'new-password':'current-password';
 $('auth-password-confirm-label').classList.toggle('hidden',mode!=='signup');
 $('auth-password-confirm').required=mode==='signup';
 $('auth-password-confirm').value='';
 for(const id of ['auth-password','auth-password-confirm']){const input=$(id);if(input.type==='text')togglePassword(id,input.parentElement.querySelector('button'));}
 $('auth-password-confirm').setCustomValidity('');
 $('auth-submit').textContent=mode==='signup'?'Daftar dan kirim konfirmasi':'Masuk';
 $('auth-help').textContent=mode==='signup'?'Buat akun dengan email aktif dan password pilihanmu (minimal 8 karakter). Konfirmasi dikirim ke email tersebut.':'Masuk menggunakan email dan password akunmu. Khusus owner, gunakan nama Zeazee sebagai pengganti email.';
 $('login-tab').setAttribute('aria-pressed',String(mode==='login'));
 $('signup-button').setAttribute('aria-pressed',String(mode==='signup'));
 $('auth-message').textContent='';
}
async function confirmAccount(event){
 event.preventDefault();const button=event.submitter;button.disabled=true;$('auth-message').textContent='Memverifikasi email…';
 try{const identity=await identityModule();await identity.confirmEmail($('confirmation-token').value.trim());$('confirmation-token').value='';$('confirmation-form').classList.add('hidden');await refreshData();closeLoginModal();switchTab('recap');notify('Email terkonfirmasi. Kamu berhasil masuk.');}
 catch(e){$('auth-message').textContent='Konfirmasi gagal. Periksa token atau buka tautan konfirmasi di email.';}
 finally{button.disabled=false;}
}
async function openLoginModal(){
 $('login-modal').classList.remove('hidden');$('auth-message').textContent=session.user?'Login sebagai '+session.user.email:'';
 try{authSettings=await api('settings');$('signup-button').disabled=!!authSettings.disableSignup;if(authSettings.disableSignup){setAuthMode('login');$('auth-help').textContent='Pendaftaran akun sedang ditutup. Akun yang sudah terdaftar tetap bisa masuk.';}$('auth-providers').innerHTML=Object.entries(authSettings.providers||{}).filter(([name,enabled])=>enabled&&['google','github','gitlab','bitbucket'].includes(name)).map(([name])=>`<button type="button" class="pixie-button w-full" onclick="providerLogin('${name}')">Masuk dengan ${name}</button>`).join('');}catch(e){$('auth-message').textContent=e.message;}
}
function closeLoginModal(){$('login-modal').classList.add('hidden');}
async function authenticate(event,action){
 event.preventDefault();
 if(action==='signup' || action==='login'){
  $('auth-password-confirm').setCustomValidity(action==='signup'&&$('auth-password').value!==$('auth-password-confirm').value?'Password belum sama.':'');
  if(!$('auth-form').reportValidity())return;
 }else if(action==='recover'){
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test($('auth-email').value.trim())){$('auth-message').textContent='Masukkan alamat email akun untuk pemulihan password.';return;}
 }
 const button=event.submitter||event.currentTarget;button.disabled=true;$('auth-message').textContent='Memproses…';
 try{
  const result=await api(action,{email:$('auth-email').value,password:$('auth-password').value});$('auth-password').value='';
  if(['login','logout'].includes(action)){closeLoginModal();await refreshData();if(action==='login')switchTab('recap');}else {
   $('auth-message').textContent=result.message||'Periksa email untuk melanjutkan pemulihan akun.';
   if(action==='signup'){$('auth-password-confirm').value='';$('confirmation-form').classList.remove('hidden');}
  }
 }catch(e){$('auth-message').textContent=e.message;}finally{button.disabled=false;}
}
const identityModule=()=>import('/vendor/netlify-identity.mjs');
async function providerLogin(name){try{const identity=await identityModule();identity.oauthLogin(name);}catch(e){$('auth-message').textContent='Login provider gagal dimuat. Coba lagi.';}}
// Calculator rates stay a personal calculation; only owner can open rate controls.
const originalToggleRates=toggleAdminRatePanel;
toggleAdminRatePanel=function(){if(session.owner)originalToggleRates();else{notify('Pengaturan rate tersedia untuk owner Zeazee.');}};
window.onload=async function(){
 selectCalcCountry('KR');initTNCAndFAQ();
 $('theme-toggle').setAttribute('aria-pressed', document.documentElement.classList.contains('dark'));
 $('theme-icon').className=document.documentElement.classList.contains('dark')?'fa-solid fa-moon text-pixie-200':'fa-solid fa-sun text-amber-500';
 try{
  if(/(?:confirmation_token|invite_token|recovery_token|access_token|email_change_token)=/.test(location.hash)){
   const identity=await identityModule();const result=await identity.handleAuthCallback();if(result?.type==='confirmation'&&result.user)notify('Email terkonfirmasi. Kamu berhasil masuk.');
   if(result?.type==='invite'&&result.token){const password=prompt('Buat password akun (minimal 8 karakter)');if(password&&password.length>=8)await identity.acceptInvite(result.token,password);else throw new Error('Buka kembali tautan undangan untuk membuat password.');}
   else if(result?.type==='recovery'){$('reset-dialog').showModal();}
  }
 }catch(e){await openLoginModal();$('auth-message').textContent='Konfirmasi akun gagal. Tautan mungkin kedaluwarsa atau sudah digunakan. Coba masuk jika email sudah terkonfirmasi.';}
 await refreshData();
 if(session.user&&!session.owner)switchTab('recap');
 window.setInterval(()=>{if(!document.hidden)refreshData();},300000);
};

function renderLineLinks(){
 const links=session.links||[],link=links[0];
 $('floating-line').classList.toggle('hidden',!session.user);
 $('floating-line-label').textContent=session.owner?'Cari DN LINE ♡':link?link.line_name+' · '+({approved:'Terhubung',pending:'Menunggu',rejected:'Ajukan ulang'}[link.status]||''):'Drop DN LINE ♡';
 $('line-link-panel').innerHTML=!session.user?'<button class="pixie-button" onclick="openLoginModal()">Masuk / daftar akun</button>':session.owner?'<label class="block text-xs">Cari nama / DN LINE buyer<input id="owner-line-search" class="pixie-input" placeholder="Contoh: zeazee" oninput="filterOwnerLine(this.value)"></label><p class="text-xs">Verifikasi pengajuan buyer di bawah. Periksa nama LINE dan email sebelum menyetujui.</p>':link&&link.status!=='rejected'?`<p class="text-sm"><strong>${escapeHTML(link.line_name)}</strong> · ${link.status==='approved'?'Terverifikasi oleh Zeazee ♡':'Menunggu verifikasi Zeazee'}</p><p class="text-xs">${link.status==='approved'?'Item dengan nama LINE ini otomatis terhubung, termasuk jajanan baru di spreadsheet.':'Rekapan tetap terkunci sampai nama LINE diverifikasi Zeazee.'}</p>`:`${link?'<p class="text-xs">Pengajuan ditolak. Periksa nama LINE atau hubungi Zeazee, lalu ajukan kembali.</p>':''}<form onsubmit="submitLine(event)" class="space-y-2"><label class="block text-xs">Nama LINE di spreadsheet<input id="line-name" required maxlength="100" class="pixie-input" autocomplete="off" placeholder="Nama LINE kamu"></label><button class="pixie-button" type="submit">Kirim untuk verifikasi Zeazee</button></form>`;
 $('line-review-panel').innerHTML='<h3 class="font-extrabold">Verifikasi nama LINE · Zeazee</h3>'+ (links.filter(l=>l.status==='pending').map(l=>`<div class="glass-card rounded-xl p-4"><strong>${escapeHTML(l.line_name)}</strong><p class="text-xs">${escapeHTML(l.email)}</p><div class="flex gap-3 mt-3"><button class="pixie-button" onclick="verifyLine(${l.id},'approved',this)">Setujui</button><button class="pixie-button" onclick="verifyLine(${l.id},'rejected',this)">Tolak</button></div></div>`).join('')||'<p class="text-xs">Tidak ada pengajuan menunggu.</p>');
 const state=session.sync;
 $('sheet-sync-status').textContent=(state?.synced_at?'Terakhir diperbarui: '+new Date(state.synced_at).toLocaleString('id-ID'):'Menunggu sinkronisasi pertama dari spreadsheet.')+(state?.error?' '+state.error:'');
}
async function submitLine(event){event.preventDefault();const button=event.submitter;button.disabled=true;try{await api('link-line',{lineName:$('line-name').value});await refreshData();$('line-message').textContent='Nama LINE terkirim. Menunggu verifikasi Zeazee.';}catch(e){$('line-message').textContent=e.message;}finally{button.disabled=false;}}
async function verifyLine(id,status,button){button.disabled=true;try{await api('verify-line',{id,status});await refreshData();notify('Pengajuan nama LINE '+(status==='approved'?'disetujui.':'ditolak.'));}catch(e){notify(e.message);}finally{button.disabled=false;}}
async function syncNow(button){button.disabled=true;try{await api('sync',{});await refreshData();}catch(e){notify(e.message);}finally{button.disabled=false;}}

function togglePassword(id,button){
 const input=$(id),show=input.type==='password';input.type=show?'text':'password';button.setAttribute('aria-pressed',String(show));button.setAttribute('aria-label',show?'Sembunyikan password':'Tampilkan password');button.querySelector('i').className=show?'fa-solid fa-eye-slash':'fa-solid fa-eye';
}
async function resetPassword(event){
 event.preventDefault();const input=$('reset-confirm');input.setCustomValidity(input.value!==$('reset-password').value?'Password belum sama.':'');if(!$('reset-form').reportValidity())return;
 const button=event.submitter;button.disabled=true;
 try{const identity=await identityModule();await identity.updateUser({password:$('reset-password').value});$('reset-form').reset();$('reset-dialog').close();await refreshData();notify('Password berhasil diganti.');}catch{$('reset-message').textContent='Password belum berhasil diganti. Coba lagi atau minta tautan pemulihan baru melalui Lupa password.';}finally{button.disabled=false;}
}
function openLinePanel(){switchTab('recap');$('line-card').scrollIntoView({behavior:'smooth',block:'center'});($('line-name')||$('owner-line-search'))?.focus({preventScroll:true});}
function filterOwnerLine(value){$('search-recap-input').value=value;recapPage=1;renderBuyerRecapTable();}
function itemCategory(item){
 const sheet=String(item.sheet||'').toUpperCase();
 if(/TAX/.test(sheet))return 'tax';if(/PO\s*CH/.test(sheet))return 'po';
 if(/CH|CHINA/.test(sheet))return 'china';if(/KR|KOREA/.test(sheet))return 'korea';if(/JP|JAPAN|JEPANG/.test(sheet))return 'jepang';if(/TH|THAI/.test(sheet))return 'thailand';if(/INA|INDO/.test(sheet))return 'ina';return '';
}
function itemFulfillment(item){
 const value=[item.status,item.kosStatus,item.notes].filter(Boolean).join(' ').toLowerCase();
 if(/nimbun|rumah admin|kos admin|di admin/.test(value))return 'admin';
 if(/belum\s*(?:co\b|checkout|check out)/.test(value))return 'unknown';
 if(/sudah\s*(?:co\b|checkout|check out)|checked out|checkout|check out|dikirim|terkirim|resi/.test(value))return 'checkout';return 'unknown';
}
