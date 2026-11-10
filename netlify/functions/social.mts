import { getUser, verifyRequestOrigin } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { getStore } from '@netlify/blobs';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { recordOwnerEvent } from '../lib/notifications.mjs';
const clean=(value,max=2000)=>typeof value==='string'?value.trim().slice(0,max):'';
const hash=value=>createHash('sha256').update(value).digest('hex');
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
const json=(data,status=200,extra={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...extra}});
export default async (req: Request, context) => {
 try{
 const url=new URL(req.url),action=url.searchParams.get('action')||'reviews';
 if(!['GET','POST'].includes(req.method))fail('Metode tidak didukung.',405);
 if(req.method==='POST')verifyRequestOrigin(req);
 const db=getDatabase(),user=await getUser(),owner=user?.email?.toLowerCase()==='ziziekaye@gmail.com';
 if(req.method==='GET'&&action==='review-image'){
  const key=url.searchParams.get('key');if(!/^[a-f0-9-]+\.webp$/.test(key||''))fail('Tidak ditemukan.',404);
  const visible=await db.sql`SELECT id FROM pixie_reviews WHERE image_key=${key} AND visible`;
  if(!visible.length)fail('Tidak ditemukan.',404);
  const image=await getStore('pixiedust-reviews').get(key,{type:'arrayBuffer'});
  return new Response(image,{status:image?200:404,headers:{'Content-Type':'image/webp','X-Content-Type-Options':'nosniff','Cache-Control':'public,max-age=60'}});
 }
 if(req.method==='GET'&&action==='reviews'){
  const reviews=await db.sql`SELECT id,display_name,caption,image_key,owner_rating,admin_rating,shipping_rating,packing_rating,information_rating,created_at FROM pixie_reviews WHERE visible ORDER BY id DESC LIMIT 100`;
  return json({reviews});
 }
 if(action==='arrival'){
  if(req.method!=='POST'||!user)fail('Masuk akun terlebih dahulu.',401);
  if(!owner)await recordOwnerEvent(db,'login:'+user.id+':'+Math.floor(Date.now()/300000),'login','Buyer masuk akun',user.email+' masuk ke GO Pixiedust.');
  return json({ok:true});
 }
 if(action==='review'){
  if(req.method!=='POST'||!user)fail('Masuk akun untuk memberikan testimoni.',401);
  const form=await req.formData(),caption=clean(form.get('caption')),displayName=clean(form.get('displayName'),80)||'Buyer Pixiedust';
  const ratings=['owner','admin','shipping','packing','information'].map(k=>Number(form.get(k)));
  if(ratings.some(v=>!Number.isInteger(v)||v<1||v>5))fail('Lengkapi kelima penilaian, dari kurang baik hingga sangat baik.');
  const recent=await db.sql`SELECT id FROM pixie_reviews WHERE user_id=${user.id} AND created_at>now()-interval '1 minute' LIMIT 1`;
  if(recent.length)fail('Tunggu satu menit sebelum mengirim testimoni lagi.',429);
  const file=form.get('photo');let imageKey=null;
  if(!caption&&(!(file instanceof File)||!file.size))fail('Tambahkan cerita atau foto testimoni.');
  if(file instanceof File&&file.size){
   if(file.size>4*1024*1024)fail('Foto maksimal 4 MB.');
   let image;try{image=await sharp(Buffer.from(await file.arrayBuffer()),{limitInputPixels:25000000}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).toBuffer();}catch{fail('Foto tidak valid.');}
   const {width,height}=await sharp(image).metadata(),size=Math.max(12,Math.round(width/24));
   const svg=Buffer.from(`<svg width="${width}" height="${height}"><rect y="${height-size*2}" width="${width}" height="${size*2}" fill="#49305b" fill-opacity=".75"/><text x="${size/2}" y="${height-size/2}" font-family="sans-serif" font-size="${size}" fill="white">GO PIXIEDUST</text></svg>`);
   imageKey=randomUUID()+'.webp';await getStore('pixiedust-reviews').set(imageKey,await sharp(image).composite([{input:svg}]).webp({quality:86}).toBuffer());
  }
  const rows=await db.sql`INSERT INTO pixie_reviews(user_id,display_name,caption,image_key,owner_rating,admin_rating,shipping_rating,packing_rating,information_rating) VALUES(${user.id},${displayName},${caption},${imageKey},${ratings[0]},${ratings[1]},${ratings[2]},${ratings[3]},${ratings[4]}) RETURNING id`;
  try{await recordOwnerEvent(db,'review:'+rows[0].id,'review','Testimoni dan rating baru',displayName+' membagikan pengalaman dan penilaian untuk GO Pixiedust.');}catch{/* The published review remains saved. */}
  return json({ok:true});
 }
 if(action==='hide-review'){
  if(req.method!=='POST'||!owner)fail('Hanya owner yang dapat mengelola testimoni.',403);
  const b=await req.json();await db.sql`UPDATE pixie_reviews SET visible=false WHERE id=${b.id}`;return json({ok:true});
 }
 if(['events','read-event'].includes(action)){
  if(!owner)fail('Hanya owner yang dapat membuka notifikasi.',403);
  if(action==='events'&&req.method==='GET')return json({events:await db.sql`SELECT id,kind,title,body,thread_id,created_at,read_at FROM pixie_owner_events ORDER BY id DESC LIMIT 100`});
  if(action==='read-event'&&req.method==='POST'){const b=await req.json();await db.sql`UPDATE pixie_owner_events SET read_at=now() WHERE id=${b.id}`;return json({ok:true});}
  fail('Metode tidak didukung.',405);
 }
 if(action==='inbox'){
  if(!owner)fail('Hanya owner yang dapat membuka kotak chat.',403);
  const threads=await db.sql`SELECT t.id,t.updated_at,(SELECT body FROM pixie_chat_messages m WHERE m.thread_id=t.id ORDER BY m.id DESC LIMIT 1) AS last_message,(SELECT sender FROM pixie_chat_messages m WHERE m.thread_id=t.id ORDER BY m.id DESC LIMIT 1) AS last_sender FROM pixie_chat_threads t ORDER BY t.updated_at DESC LIMIT 100`;
  return json({threads});
 }
 if(!['chat','send'].includes(action))fail('Tidak ditemukan.',404);
 const cookie=req.headers.get('cookie')?.match(/(?:^|;\s*)pixie_chat=([a-f0-9-]{36})(?:;|$)/)?.[1];
 let thread;
 if(owner){
  const id=url.searchParams.get('thread');if(!/^\d+$/.test(id||''))fail('Pilih percakapan terlebih dahulu.');
  thread=(await db.sql`SELECT id FROM pixie_chat_threads WHERE id=${id}`)[0];
 }else if(cookie)thread=(await db.sql`SELECT id FROM pixie_chat_threads WHERE session_hash=${hash(cookie)}`)[0];
 if(action==='chat'&&req.method==='GET'){
  if(!thread)return json({thread:null,messages:[]});
  const messages=await db.sql`SELECT id,sender,body,created_at FROM (SELECT id,sender,body,created_at FROM pixie_chat_messages WHERE thread_id=${thread.id} ORDER BY id DESC LIMIT 100) recent ORDER BY id`;
  return json({thread:thread.id,messages});
 }
 if(action!=='send'||req.method!=='POST')fail('Metode tidak didukung.',405);
 const b=await req.json(),body=clean(b.body);if(!body||b.website)fail('Masukkan pesan, maksimal 2.000 karakter.');
 let sessionCookie;
 if(!thread){
  if(owner)fail('Percakapan tidak ditemukan.',404);
  const origin=hash(context?.ip||'unknown');
  const recent=await db.sql`SELECT id FROM pixie_chat_threads WHERE origin_hash=${origin} AND created_at>now()-interval '1 hour' LIMIT 6`;
  if(recent.length>=5)fail('Terlalu banyak percakapan baru. Coba lagi nanti.',429);
  const session=randomUUID();
  thread=(await db.sql`INSERT INTO pixie_chat_threads(session_hash,origin_hash) VALUES(${hash(session)},${origin}) RETURNING id`)[0];
  sessionCookie='pixie_chat='+session+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000';
 }
 const sender=owner?'owner':'buyer';
 const recent=await db.sql`SELECT id FROM pixie_chat_messages WHERE thread_id=${thread.id} AND sender=${sender} AND created_at>now()-interval '3 seconds' LIMIT 1`;
 if(recent.length)fail('Tunggu sebentar sebelum mengirim pesan berikutnya.',429);
 const message=(await db.sql`INSERT INTO pixie_chat_messages(thread_id,sender,body) VALUES(${thread.id},${sender},${body}) RETURNING id`)[0];
 await db.sql`UPDATE pixie_chat_threads SET updated_at=now() WHERE id=${thread.id}`;
 if(!owner){try{await recordOwnerEvent(db,'chat:'+message.id,'chat','Pesan baru dari buyer','Ada pertanyaan di chat anonim #'+thread.id+'. Buka kotak chat untuk membalas.',thread.id);}catch{/* Message and browser session remain saved. */}}
 return json({ok:true,thread:thread.id},200,sessionCookie?{'Set-Cookie':sessionCookie}:{});
 }catch(e){return json({error:e.status?e.message:'Belum dapat memproses permintaan. Coba lagi.'},e.status||500);}
};
