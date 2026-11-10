import { getUser, verifyRequestOrigin } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { getStore } from '@netlify/blobs';
import sharp from 'sharp';
import { syncPayments } from '../lib/payment-sheets.mjs';
import { pushKeys, recordOwnerEvent } from '../lib/notifications.mjs';
const clean=(v,max=1500)=>typeof v==='string'?v.trim().slice(0,max):'';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export default async (req: Request) => {
 try{
 const url=new URL(req.url),action=url.searchParams.get('action')||'data',db=getDatabase();
 if(req.method==='GET'&&action==='merch-image'){
  const key=url.searchParams.get('key');if(!/^[a-f0-9-]+\.webp$/.test(key||''))fail('Tidak ditemukan',404);
  const image=await getStore('pixiedust-merch').get(key,{type:'arrayBuffer'});
  return new Response(image,{status:image?200:404,headers:{'Content-Type':'image/webp','Cache-Control':'public,max-age=31536000,immutable','X-Content-Type-Options':'nosniff'}});
 }
 if(!['GET','POST'].includes(req.method))fail('Metode tidak didukung',405);
 if(req.method==='POST')verifyRequestOrigin(req);
 const user=await getUser(),owner=user?.email?.toLowerCase()==='ziziekaye@gmail.com',email=user?.email?.toLowerCase();
 if(req.method==='GET'&&action==='data'){
  const faq=await db.sql`SELECT * FROM pixie_faq ORDER BY id`,merch=await db.sql`SELECT * FROM pixie_merch WHERE available ORDER BY id DESC`;
  const payments=owner?await db.sql`SELECT p.*,i.data->>'name' AS item_name FROM pixie_payments p JOIN pixie_items i ON i.id=p.item_id ORDER BY p.id DESC`:user?await db.sql`SELECT * FROM pixie_payments WHERE buyer_email=${email} ORDER BY id DESC`:[];
  const deadlines=owner?await db.sql`SELECT id,payment_due_at FROM pixie_items WHERE active`:user?await db.sql`SELECT id,payment_due_at FROM pixie_items WHERE active AND buyer_email=${email}`:[];
  return Response.json({faq,merch,payments,deadlines,pushKey:(await pushKeys(db)).publicKey,sheetsReady:!!Netlify.env.get('PIXIE_GOOGLE_SERVICE_ACCOUNT')},{headers:{'Cache-Control':'no-store'}});
 }
 if(!user)fail('Silakan masuk akun.',401);
 if(req.method==='GET'&&action==='proof'){
  const rows=await db.sql`SELECT * FROM pixie_payments WHERE id=${url.searchParams.get('id')}`;
  const payment=rows[0];if(!payment||(!owner&&payment.buyer_email!==email))fail('Akses ditolak',403);
  const file=await getStore('pixiedust-payments').get(payment.file_key,{type:'arrayBuffer'});
  return new Response(file,{status:file?200:404,headers:{'Content-Type':payment.mime,'Cache-Control':'private,no-store','Content-Disposition':'attachment; filename="payment-'+payment.id+(payment.mime==='application/pdf'?'.pdf':'.webp')+'"','X-Content-Type-Options':'nosniff'}});
 }
 if(req.method!=='POST')fail('Tidak ditemukan',404);
 if(action==='subscribe'){
  const b=await req.json(),sub=b.subscription;
  if(!sub||typeof sub.endpoint!=='string'||sub.endpoint.length>2000||!sub.keys?.p256dh||!sub.keys?.auth)fail('Subscription tidak valid.');
  const endpoint=new URL(sub.endpoint);
  if(endpoint.protocol!=='https:'||!(/(^|\.)fcm\.googleapis\.com$|(^|\.)push\.services\.mozilla\.com$|(^|\.)notify\.windows\.com$|(^|\.)push\.apple\.com$/.test(endpoint.hostname)))fail('Layanan push tidak didukung.');
  await db.sql`INSERT INTO pixie_push(endpoint,user_id,email,subscription) VALUES(${sub.endpoint},${user.id},${email},${JSON.stringify(sub)}::jsonb) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,email=excluded.email,subscription=excluded.subscription`;
  return Response.json({ok:true});
 }
 if(action==='unsubscribe'){
  const b=await req.json();await db.sql`DELETE FROM pixie_push WHERE endpoint=${clean(b.endpoint,2000)} AND user_id=${user.id}`;return Response.json({ok:true});
 }
 if(action==='payment'){
  const form=await req.formData(),id=Number(form.get('itemId')),file=form.get('proof');
  const rows=await db.sql`SELECT id FROM pixie_items WHERE active AND id=${id} AND buyer_email=${email} AND EXISTS(SELECT 1 FROM pixie_buyer_links WHERE user_id=${user.id} AND status='approved')`;
  if(!rows.length)fail('Item belum terhubung dengan akunmu.',403);
  if(!(file instanceof File)||file.size===0||file.size>4*1024*1024)fail('Pilih gambar atau PDF maksimal 4 MB.');
  let bytes=Buffer.from(await file.arrayBuffer()),mime='image/webp',extension='.webp';
  if(file.type==='application/pdf'&&bytes.subarray(0,5).toString()==='%PDF-'){mime='application/pdf';extension='.pdf';}
  else{try{bytes=await sharp(bytes,{limitInputPixels:25000000}).rotate().resize({width:1800,height:1800,fit:'inside',withoutEnlargement:true}).webp({quality:90}).toBuffer();}catch{fail('Bukti harus berupa gambar valid atau PDF.');}}
  const key=crypto.randomUUID()+extension;
  await getStore('pixiedust-payments').set(key,bytes);
  const receipt=await db.sql`INSERT INTO pixie_payments(item_id,buyer_email,file_key,mime) VALUES(${id},${email},${key},${mime}) RETURNING id`;
  try{await recordOwnerEvent(db,'payment:'+receipt[0].id,'payment','Bukti pembayaran baru',email+' mengirim bukti pembayaran batch merch / tagihan tax. Periksa di rekapan.');}catch{/* Receipt remains saved. */}
  try{await syncPayments(db);}catch{/* Stored safely; scheduled retry. */}
  return Response.json({ok:true});
 }
 if(!owner)fail('Hanya admin yang dapat mengubah data.',403);
 if(action==='merch'){
  const form=await req.formData(),name=clean(form.get('name'),150),price=Number(form.get('price')),file=form.get('photo');
  if(!name||!Number.isSafeInteger(price)||price<0||!(file instanceof File)||!file.size||file.size>4*1024*1024)fail('Lengkapi nama, harga INA, dan foto maksimal 4 MB.');
  let image;try{image=await sharp(Buffer.from(await file.arrayBuffer()),{limitInputPixels:25000000}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).toBuffer();}catch{fail('Foto tidak valid.');}
  const {width,height}=await sharp(image).metadata();let marks='';
  const size=Math.max(12,Math.round(width/24));
  for(let y=30;y<height+60;y+=size*5)for(let x=-size*4;x<width;x+=size*13)marks+=`<text x="${x}" y="${y}" transform="rotate(-25 ${x} ${y})">PIXIEDUST GO</text>`;
  const svg=Buffer.from(`<svg width="${width}" height="${height}"><g font-family="sans-serif" font-size="${size}" font-weight="bold" fill="white" fill-opacity="0.65" stroke="#4b365b" stroke-width="0.5">${marks}</g></svg>`);
  const output=await sharp(image).composite([{input:svg}]).webp({quality:87}).toBuffer(),key=crypto.randomUUID()+'.webp';
  await getStore('pixiedust-merch').set(key,output);await db.sql`INSERT INTO pixie_merch(name,price,image_key) VALUES(${name},${price},${key})`;
  return Response.json({ok:true});
 }
 const b=await req.json();
 if(action==='faq'){
  const question=clean(b.question,300),answer=clean(b.answer,3000);if(!question||!answer)fail('Isi pertanyaan dan jawaban.');
  if(b.id)await db.sql`UPDATE pixie_faq SET question=${question},answer=${answer} WHERE id=${b.id}`;
  else await db.sql`INSERT INTO pixie_faq(question,answer) VALUES(${question},${answer})`;
 }else if(action==='delete-faq')await db.sql`DELETE FROM pixie_faq WHERE id=${b.id}`;
 else if(action==='delete-merch')await db.sql`UPDATE pixie_merch SET available=false WHERE id=${b.id}`;
 else if(action==='deadline')await db.sql`UPDATE pixie_items SET payment_due_at=now()+interval '24 hours' WHERE id=${b.id} AND active`;
 else if(action==='review-payment'){
  if(!['approved','rejected'].includes(b.status))fail('Status tidak valid.');
  await db.sql`UPDATE pixie_payments SET status=${b.status},sheet_synced=false WHERE id=${b.id}`;
 }else if(action==='sync-payments'){try{if(!await syncPayments(db))fail('Akses Google Sheets belum dihubungkan.',409);}catch(e){fail('Belum dapat menulis spreadsheet. Periksa akses Editor dan koneksi Google.',409);}}
 else fail('Tidak ditemukan',404);
 return Response.json({ok:true});
 }catch(e){return Response.json({error:e.status?e.message:'Permintaan belum berhasil. Coba lagi.'},{status:e.status||500});}
};
