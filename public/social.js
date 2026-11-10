const ratingNames={owner_rating:'Performa owner',admin_rating:'Admin nyelem',shipping_rating:'Status pengiriman',packing_rating:'Packing',information_rating:'Kejelasan informasi'};
const ratingWords=['','Kurang baik','Cukup','Baik','Baik sekali','Sangat baik'];
let buyerReviews=[],ownerEvents=[],chatThreads=[],selectedChat=null,chatOpen=false,socialBusy=false,arrivalUser=null,socialIdentity=null,chatBusy=false,chatSignature='';
async function socialApi(action,body,thread){
 const url='/.netlify/functions/social?action='+encodeURIComponent(action)+(thread?'&thread='+encodeURIComponent(thread):'');
 const res=await fetch(url,body===undefined?{}:{method:'POST',headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body instanceof FormData?body:JSON.stringify(body)});
 const data=await res.json();if(!res.ok)throw new Error(data.error||'Belum dapat memuat data.');return data;
}
function renderBuyerReviews(){
 const cards=items=>items.map(r=>`<article class="glass-card buyer-review"><div class="flex justify-between gap-3"><strong>${escapeHTML(r.display_name)}</strong><span class="review-source">Buyer website</span></div><time class="text-xs opacity-70">${escapeHTML(new Date(r.created_at).toLocaleDateString('id-ID'))}</time>${r.image_key?`<a href="/.netlify/functions/social?action=review-image&key=${encodeURIComponent(r.image_key)}" target="_blank" rel="noopener noreferrer"><img loading="lazy" class="story-photo" src="/.netlify/functions/social?action=review-image&key=${encodeURIComponent(r.image_key)}" alt="Foto testimoni ${escapeHTML(r.display_name)}"><span class="text-xs underline">Lihat foto ↗</span></a>`:''}${r.caption?`<p class="whitespace-pre-wrap text-sm">${escapeHTML(r.caption)}</p>`:''}<dl class="review-ratings">${Object.entries(ratingNames).map(([key,label])=>`<div><dt>${label}</dt><dd><i class="fa-solid fa-star" aria-hidden="true"></i> ${r[key]}/5 <span>${ratingWords[r[key]]}</span></dd></div>`).join('')}</dl>${session.owner?`<button class="text-xs underline" onclick="hideBuyerReview(${r.id},this)">Sembunyikan testimoni</button>`:''}</article>`).join('');
 $('dashboard-buyer-reviews').innerHTML=cards(buyerReviews.slice(0,3));
 $('all-buyer-reviews').innerHTML=cards(buyerReviews)||'<p class="text-sm">Belum ada ulasan dari website. Jadilah buyer pertama yang berbagi cerita.</p>';
 const count=buyerReviews.length;
 $('review-summary').innerHTML=count?`<p class="text-sm font-bold">${count} testimoni website terbaru</p><div class="review-averages">${Object.entries(ratingNames).map(([key,label])=>`<div><strong>${(buyerReviews.reduce((sum,r)=>sum+Number(r[key]),0)/count).toFixed(1)}<small>/5</small></strong><span>${label}</span></div>`).join('')}</div>`:'';
}
function openBuyerReview(){if(!session.user){openLoginModal();notify('Masuk akun untuk membagikan testimoni. Chat admin tetap bisa tanpa login.');return;}$('buyer-review-dialog').showModal();}
async function sendBuyerReview(event){
 event.preventDefault();const form=event.target,button=event.submitter,status=form.querySelector('.form-status'),data=new FormData(form);
 if(!String(data.get('caption')||'').trim()&&!data.get('photo')?.size){status.textContent='Tambahkan cerita atau foto testimoni.';return;}
 button.disabled=true;status.textContent='Menerbitkan testimoni…';
 try{await socialApi('review',data);form.reset();await refreshSocial();status.textContent='Testimoni sudah terbit. Terima kasih sudah berbagi!';}catch(e){status.textContent=e.message;}finally{button.disabled=false;}
}
async function hideBuyerReview(id,button){button.disabled=true;try{await socialApi('hide-review',{id});await refreshSocial();}catch(e){notify(e.message);}finally{button.disabled=false;}}
function renderOwnerEvents(){
 $('chat-launcher').querySelector('span').textContent=session.owner?'Kotak chat buyer':'Chat with admin';
 $('chat-heading').textContent=session.owner?'Kotak chat · Zeazee':'Chat with admin / owner';
 $('owner-activity').classList.toggle('hidden',!session.owner);
 if(!session.owner){$('owner-events').innerHTML='';return;}
 $('owner-events').innerHTML=ownerEvents.map(e=>`<article class="owner-event ${e.read_at?'is-read':''}"><div><span class="event-kind">${escapeHTML({login:'Akun',line:'DN LINE',payment:'Pembayaran',chat:'Chat',review:'Testimoni'}[e.kind]||'Buyer')}</span><strong>${escapeHTML(e.title)}</strong><p>${escapeHTML(e.body)}</p><time>${escapeHTML(new Date(e.created_at).toLocaleString('id-ID'))}</time></div><div class="event-actions">${e.thread_id?`<button class="pixie-button" onclick="openOwnerThread(${e.thread_id})">Balas chat</button>`:''}${!e.read_at?`<button class="text-xs underline" onclick="readOwnerEvent(${e.id},this)">Tandai dibaca</button>`:'<span class="text-xs">Sudah dibaca</span>'}</div></article>`).join('')||'<p class="text-sm">Belum ada aktivitas buyer baru.</p>';
 const waiting=ownerEvents.filter(e=>!e.read_at).length;
 $('chat-badge').textContent=String(waiting);$('chat-badge').classList.toggle('hidden',!waiting);
}
async function readOwnerEvent(id,button){button.disabled=true;try{await socialApi('read-event',{id});await refreshSocial();}catch(e){notify(e.message);}finally{button.disabled=false;}}
async function refreshSocial(){
 if(socialBusy)return;socialBusy=true;
 const identity=session.user?.id||'guest';
 if(identity!==socialIdentity){socialIdentity=identity;selectedChat=null;chatSignature='';chatThreads=[];ownerEvents=[];$('chat-inbox').innerHTML='';$('chat-messages').innerHTML='';renderOwnerEvents();if(chatOpen)toggleChat(false);}
 try{
  buyerReviews=(await socialApi('reviews')).reviews;renderBuyerReviews();
  if(session.user&&!session.owner&&arrivalUser!==session.user.id){await socialApi('arrival',{});arrivalUser=session.user.id;}
  if(!session.user)arrivalUser=null;
  if(session.owner){ownerEvents=(await socialApi('events')).events;}else ownerEvents=[];
  renderOwnerEvents();
 }catch(e){$('review-summary').textContent='Testimoni website belum dapat dimuat. Coba lagi sebentar.';}finally{socialBusy=false;}
}
const beforeSocialRefresh=refreshFeatures;
refreshFeatures=async function(){await beforeSocialRefresh();await refreshSocial();};
async function toggleChat(force){
 chatOpen=typeof force==='boolean'?force:!chatOpen;
 $('chat-panel').classList.toggle('hidden',!chatOpen);$('chat-launcher').setAttribute('aria-expanded',String(chatOpen));
 if(chatOpen){await refreshChat();$('chat-input').focus();}
}
async function openOwnerThread(id){selectedChat=id;chatSignature='';await toggleChat(true);}
function renderChatInbox(){
 $('chat-inbox').classList.toggle('hidden',!session.owner);
 $('chat-privacy').textContent=session.owner?'Kotak pesan privat dari buyer. Pilih percakapan untuk membalas sebagai owner.':'Boleh tanya tanpa login dan tanpa nama. Balasan admin muncul di sini saat tersedia. Riwayat terhubung ke browser ini.';
 if(!session.owner)return;
 $('chat-inbox').innerHTML=chatThreads.map(t=>`<button class="thread-button ${String(t.id)===String(selectedChat)?'is-selected':''}" onclick="openOwnerThread(${t.id})"><strong>Buyer anonim #${t.id}</strong><span>${t.last_sender==='owner'?'Kamu: ':''}${escapeHTML(t.last_message||'Percakapan baru')}</span></button>`).join('')||'<p class="text-xs p-3">Belum ada percakapan buyer.</p>';
}
async function refreshChat(){
 if(chatBusy||!chatOpen)return;chatBusy=true;
 try{
  if(session.owner){chatThreads=(await socialApi('inbox')).threads;if(!selectedChat&&chatThreads.length)selectedChat=chatThreads[0].id;}
  renderChatInbox();
  if(session.owner&&!selectedChat){$('chat-messages').textContent='Pesan buyer muncul di sini.';$('chat-form').classList.add('hidden');return;}
  $('chat-form').classList.remove('hidden');
  const data=await socialApi('chat',undefined,session.owner?selectedChat:null),signature=JSON.stringify(data.messages);
  if(signature!==chatSignature){chatSignature=signature;const container=$('chat-messages'),atEnd=container.scrollHeight-container.scrollTop-container.clientHeight<60;container.innerHTML=data.messages.map(m=>`<div class="chat-bubble ${m.sender==='owner'?'from-owner':'from-buyer'}"><strong>${m.sender==='owner'?'Zeazee · Owner':'Buyer'}</strong><p>${escapeHTML(m.body)}</p><time>${escapeHTML(new Date(m.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}))}</time></div>`).join('')||'<p class="chat-empty">Ada wishlist yang bikin penasaran?<br>Tulis pertanyaanmu, admin membalas di sini.</p>';if(atEnd)container.scrollTop=container.scrollHeight;}
 }catch(e){$('chat-status').textContent=e.message;}finally{chatBusy=false;}
}
async function sendChat(event){
 event.preventDefault();const button=event.submitter;button.disabled=true;$('chat-status').textContent='Mengirim…';
 try{await socialApi('send',{body:$('chat-input').value,website:event.target.elements.website.value},session.owner?selectedChat:null);$('chat-input').value='';$('chat-status').textContent=session.owner?'Balasan terkirim.':'Pesan terkirim. Balasan muncul di sini saat admin tersedia.';await refreshChat();$('chat-messages').scrollTop=$('chat-messages').scrollHeight;}catch(e){$('chat-status').textContent=e.message;}finally{button.disabled=false;}
}
window.setInterval(()=>{if(!document.hidden&&chatOpen)refreshChat();},5000);
window.setInterval(()=>{if(!document.hidden)refreshSocial();},30000);
