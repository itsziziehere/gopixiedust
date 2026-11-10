let featureData={faq:[],merch:[],payments:[],deadlines:[]};
window.recapMode='recap';
const originalSwitchTab=switchTab;
switchTab=function(tab){
 if(tab==='tax'||tab==='recap'){
  const source=$('tab-'+(tab==='tax'?'recap':'tax')),target=$('tab-'+tab);
  while(source.firstChild)target.appendChild(source.firstChild);
  window.recapMode=tab;recapPage=1;
  const heading=target.querySelector('h2');if(heading)heading.textContent=tab==='tax'?'Tagihan Tax':'Rekapan Jajanan';
  $('sheet-filter').value='';$('category-filter').value='';
  renderBuyerRecapTable();
 }
 originalSwitchTab(tab);
};
async function community(action='data',body){
 const response=await fetch('/.netlify/functions/community?action='+encodeURIComponent(action),body===undefined?{}:{method:'POST',headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body instanceof FormData?body:JSON.stringify(body)});
 const result=await response.json();if(!response.ok)throw new Error(result.error||'Permintaan belum berhasil.');return result;
}
async function refreshFeatures(){
 try{
  featureData=await community();
  $('notification-controls').classList.toggle('hidden',!session.user);
  $('custom-faq').innerHTML=featureData.faq.map(f=>`<details class="glass-card p-5 rounded-2xl"><summary class="font-bold cursor-pointer">${escapeHTML(f.question)}</summary><p class="mt-3 whitespace-pre-wrap">${escapeHTML(f.answer)}</p>${session.owner?`<div class="flex gap-4 mt-3"><button class="underline text-xs" onclick="editFaq(${f.id})">Edit</button><button class="underline text-xs" onclick="mutateFeature('delete-faq',${f.id},this)">Hapus</button></div>`:''}</details>`).join('');
  $('merch-list').innerHTML=featureData.merch.map(m=>`<article class="glass-card p-4 rounded-2xl space-y-3"><img class="merch-photo" loading="lazy" src="/.netlify/functions/community?action=merch-image&key=${encodeURIComponent(m.image_key)}" alt="${escapeHTML(m.name)} · PIXIEDUST GO"><h3 class="text-lg font-extrabold">${escapeHTML(m.name)}</h3><p class="text-xs">Harga bersih INA</p><strong class="text-xl">${escapeHTML(fmt(m.price))}</strong><a class="pixie-button block text-center" target="_blank" rel="noopener noreferrer" href="https://line.me/R/ti/p/@pixiedust_go?text=${encodeURIComponent('Halo admin, mau tanya merch '+m.name+' ('+fmt(m.price)+' bersih INA).')}">Hubungi admin di LINE ↗</a>${session.owner?`<button class="text-xs underline" onclick="mutateFeature('delete-merch',${m.id},this)">Tandai habis / hapus dari katalog</button>`:''}</article>`).join('')||'<div class="glass-card p-6 rounded-2xl"><h3 class="font-bold">Wishlist baru sedang disiapkan</h3><p class="mt-2">Merch available dari admin segera hadir di sini.</p></div>';
  renderPaymentReview();renderBuyerRecapTable();
 }catch(e){notify('Fitur tambahan belum dapat dimuat: '+e.message);}
}
function invoicePaid(i){return /done\s*fp|^lunas$|^paid$|^fp$/i.test(i.payment||'');}
function paymentCell(i){
 const due=featureData.deadlines.find(d=>String(d.id)===String(i.id))?.payment_due_at;
 const payments=featureData.payments.filter(p=>String(p.item_id)===String(i.id)&&(!i.buyerEmail||p.buyer_email===i.buyerEmail));
 const last=payments[0],settled=invoicePaid(i)||last?.status==='approved',awaiting=last?.status==='pending';
 let html='';
 if(!settled){
  html+=`<div class="invoice-reminder ${due&&new Date(due)<new Date()&&!awaiting?'invoice-overdue':''}"><strong>${escapeHTML(i.name)}</strong><div>${escapeHTML(fmt(i.total||i.tax||i.price))}</div><p>${awaiting?'Bukti menunggu verifikasi admin':due?'Deadline 1 × 24 jam: '+escapeHTML(new Date(due).toLocaleString('id-ID'))+(new Date(due)<new Date()?' · Sudah lewat tenggat':''):'Deadline belum ditetapkan admin'}</p></div>`;
  if(i.canTransfer)html+=`<button class="pixie-button" onclick="openProof(${i.id})">${last?'Upload bukti baru':'Upload bukti pembayaran'}</button>`;
 }
 for(const p of payments.slice(0,3))html+=`<div class="text-xs"><a class="underline" href="/.netlify/functions/community?action=proof&id=${p.id}" target="_blank" rel="noopener noreferrer">Bukti pembayaran ↗</a> · ${{pending:'Menunggu admin',approved:'Disetujui',rejected:'Ditolak · upload ulang'}[p.status]}<div>${p.sheet_synced?'Tercatat di spreadsheet':'Menunggu pencatatan spreadsheet'}</div></div>`;
 if(session.owner&&!settled)html+=`<button class="text-xs underline" onclick="mutateFeature('deadline',${i.id},this)">${due?'Perbarui':'Mulai'} deadline 24 jam</button>`;
 return html;
}
function renderPaymentReview(){
 let panel=$('payment-review');if(!panel){panel=document.createElement('div');panel.id='payment-review';panel.className='glass-card p-5 rounded-2xl space-y-3';$('line-card').after(panel);}
 panel.classList.toggle('hidden',!session.owner);
 if(!session.owner){panel.innerHTML='';return;}
 panel.innerHTML='<h3 class="font-extrabold">Verifikasi bukti pembayaran</h3><p class="text-xs">'+(featureData.sheetsReady?'Pencatatan otomatis ke sheet BUKTI PAYMENT aktif.':'Koneksi tulis Google Sheets belum selesai. Bukti tetap tersimpan aman dan menunggu sinkronisasi.')+'</p><button class="pixie-button" onclick="syncProofs(this)">Sinkronkan bukti ke spreadsheet</button><div class="proof-list">'+(featureData.payments.filter(p=>p.status==='pending').map(p=>`<article class="invoice-reminder"><strong>${escapeHTML(p.item_name)}</strong><p>${escapeHTML(p.buyer_email)} · ${escapeHTML(new Date(p.created_at).toLocaleString('id-ID'))}</p><a class="underline" href="/.netlify/functions/community?action=proof&id=${p.id}" target="_blank" rel="noopener noreferrer">Periksa bukti ↗</a><div class="flex gap-3 mt-2"><button class="pixie-button" onclick="reviewPayment(${p.id},'approved',this)">Setujui</button><button class="pixie-button" onclick="reviewPayment(${p.id},'rejected',this)">Tolak</button></div></article>`).join('')||'<p class="text-xs">Belum ada bukti yang menunggu verifikasi.</p>')+'</div>';
}
async function submitFeature(event,action,body){
 event.preventDefault();const button=event.submitter,status=event.target.querySelector('.form-status');button.disabled=true;status.textContent='Menyimpan…';
 try{await community(action,body);event.target.reset();await refreshFeatures();status.textContent='Tersimpan.';return true;}catch(e){status.textContent=e.message;return false;}finally{button.disabled=false;}
}
function uploadMerch(e){return submitFeature(e,'merch',new FormData(e.target));}
function saveFaq(e){return submitFeature(e,'faq',Object.fromEntries(new FormData(e.target)));}
function editFaq(id){const f=featureData.faq.find(f=>f.id===id),form=$('custom-faq').previousElementSibling;for(const key of ['id','question','answer'])form.elements[key].value=f[key];form.scrollIntoView({behavior:'smooth'});}
async function mutateFeature(action,id,button){button.disabled=true;try{await community(action,{id});await refreshFeatures();}catch(e){notify(e.message);}finally{button.disabled=false;}}
async function reviewPayment(id,status,button){button.disabled=true;try{await community('review-payment',{id,status});await refreshFeatures();}catch(e){notify(e.message);}finally{button.disabled=false;}}
async function syncProofs(button){button.disabled=true;try{await community('sync-payments',{});await refreshFeatures();notify('Bukti tercatat di spreadsheet.');}catch(e){notify(e.message);}finally{button.disabled=false;}}
function openProof(id){const i=recapItems.find(i=>i.id===id);$('proof-item').textContent=i.name+' · '+fmt(i.total||i.tax||i.price);const form=$('proof-dialog').querySelector('form');form.reset();form.elements.itemId.value=id;form.querySelector('.form-status').textContent='';$('proof-dialog').showModal();}
async function uploadProof(e){if(await submitFeature(e,'payment',new FormData(e.target)))$('proof-dialog').close();}
async function enablePush(button){
 button.disabled=true;
 try{
  if(!session.user)throw new Error('Masuk akun terlebih dahulu.');
  if(!('serviceWorker'in navigator)||!('PushManager'in window))throw new Error('Browser ini belum mendukung notifikasi. Di iPhone/iPad, buka dari aplikasi yang ditambahkan ke Home Screen.');
  if(!featureData.pushKey)throw new Error('Notifikasi sedang disiapkan admin.');
  if(await Notification.requestPermission()!=='granted')throw new Error('Izinkan notifikasi melalui pengaturan browser untuk mengaktifkan reminder.');
  const registration=await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;
  const raw=atob(featureData.pushKey.replace(/-/g,'+').replace(/_/g,'/'));
  const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(raw,c=>c.charCodeAt(0))});
  await community('subscribe',{subscription:subscription.toJSON()});$('push-status').textContent='Notifikasi aktif di perangkat ini. Reminder otomatis dikirim setelah tenggat; admin menerima pemberitahuan pengajuan LINE.';
 }catch(e){$('push-status').textContent=e.message;}finally{button.disabled=false;}
}
async function disablePush(button){
 button.disabled=true;
 try{const registration=await navigator.serviceWorker?.getRegistration('/sw.js'),sub=await registration?.pushManager.getSubscription();if(sub){await community('unsubscribe',{endpoint:sub.endpoint});await sub.unsubscribe();}$('push-status').textContent='Notifikasi dinonaktifkan di perangkat ini.';}catch(e){$('push-status').textContent=e.message;}finally{button.disabled=false;}
}
// Detach a device before logout so a shared phone does not retain account notifications.
const originalAuthenticate=authenticate;
authenticate=async function(event,action){if(action==='logout'){try{const reg=await navigator.serviceWorker?.getRegistration('/sw.js'),sub=await reg?.pushManager.getSubscription();if(sub){await community('unsubscribe',{endpoint:sub.endpoint});await sub.unsubscribe();}}catch{notify('Notifikasi belum dapat dilepas. Coba keluar akun kembali.');return;}}return originalAuthenticate(event,action);};
window.addEventListener('load',()=>{try{if(!localStorage.getItem('pixiedust-welcome')){$('welcome-dialog').showModal();localStorage.setItem('pixiedust-welcome','seen');}}catch{$('welcome-dialog').showModal();}});
