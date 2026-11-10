import { getUser, login, logout, signup, getSettings, requestPasswordRecovery, verifyRequestOrigin } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { getStore } from '@netlify/blobs';
import sharp from 'sharp';
import { normalizeLine, refreshSpreadsheet } from '../lib/sheet-sync.mjs';
import { deliver, recordOwnerEvent } from '../lib/notifications.mjs';
const ownerEmail = () => 'ziziekaye@gmail.com';
const email = value => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const text = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0,max) : '';
const json = (value,status=200) => Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
export default async req => {
 try {
  const url=new URL(req.url), action=url.searchParams.get('action') || 'data';
  if(req.method==='GET' && action==='image') {
   const key=url.searchParams.get('key'); if(!/^[a-f0-9-]+\.webp$/.test(key||'')) return new Response(null,{status:404});
   const image=await getStore({name:'pixiedust-testimonials',consistency:'strong'}).get(key,{type:'arrayBuffer'});
   return new Response(image,{status:image?200:404,headers:{'Content-Type':'image/webp','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'}});
  }
  if(req.method==='GET' && action==='settings') return json(await getSettings());
  if(req.method!=='GET') {if(req.method!=='POST')fail('Metode tidak didukung',405);verifyRequestOrigin(req);}
  if(req.method==='POST' && ['login','signup','logout','recover'].includes(action)) {
   const b=await req.json();
   if(action==='logout'){await logout();return json({ok:true});}
   if(action==='login' && typeof b.email==='string' && b.email.trim().toLowerCase()==='zeazee')b.email=ownerEmail();
   if(!email(b.email))fail('Email tidak valid');
   if(action==='recover'){await requestPasswordRecovery(b.email.trim());return json({ok:true});}
   if(typeof b.password!=='string' || b.password.length<8 || b.password.length>200)fail('Password minimal 8 karakter');
   if(action==='signup'){await signup(b.email.trim(),b.password);return json({ok:true,message:'Periksa email untuk konfirmasi akun.'});}
   await login(b.email.trim(),b.password);return json({ok:true});
  }
  const user=await getUser(), owner=user?.email?.toLowerCase()===ownerEmail();
  const db=getDatabase();
  if(req.method==='GET'){
   if(action!=='data')fail('Tidak ditemukan',404);
   if(user)await refreshSpreadsheet(db);
   const sync=(await db.sql`SELECT synced_at,error FROM pixie_sheet_sync WHERE id=1`)[0];
   const links=owner?await db.sql`SELECT * FROM pixie_buyer_links ORDER BY created_at DESC`:user?await db.sql`SELECT * FROM pixie_buyer_links WHERE user_id=${user.id}`:[];
   const approved=links.some(l=>l.status==='approved');
   const items=owner?await db.sql`SELECT id,data,version FROM pixie_items WHERE active ORDER BY id`:user&&approved?await db.sql`SELECT id,data,version FROM pixie_items WHERE active AND buyer_email=${user.email.toLowerCase()} ORDER BY id`:[];
   const mine=user?await db.sql`SELECT id,buyer_email FROM pixie_items WHERE buyer_email=${user.email.toLowerCase()}`:[];
   const transfers=owner?await db.sql`SELECT t.*, i.data->>'name' AS item_name FROM pixie_transfers t JOIN pixie_items i ON i.id=t.item_id ORDER BY t.id DESC`:user?await db.sql`SELECT t.*,i.data->>'name' AS item_name FROM pixie_transfers t JOIN pixie_items i ON i.id=t.item_id WHERE requester_id=${user.id} ORDER BY t.id DESC`:[];
   const testimonials=await db.sql`SELECT * FROM pixie_testimonials ORDER BY id DESC`;
   const ownerItems=owner?await db.sql`SELECT id,buyer_email FROM pixie_items`:[];
   return json({links,sync,user:user?{email:user.email,id:user.id}:null,owner,items:items.map(i=>({...i,...i.data,data:undefined,buyerEmail:owner?ownerItems.find(x=>x.id===i.id)?.buyer_email:undefined,canTransfer:mine.some(x=>x.id===i.id)})),transfers,testimonials});
  }
  if(!user)fail('Silakan login terlebih dahulu.',401);
  if(action==='sync'){
   if(!owner)fail('Hanya Zeazee yang dapat menyegarkan spreadsheet.',403);
   await refreshSpreadsheet(db,true);return json({ok:true});
  }
  if(action==='link-line'){
   const b=await req.json(),name=text(b.lineName,100),normalized=normalizeLine(name);
   if(!name)fail('Masukkan nama LINE yang tercatat pada spreadsheet.');
   const rows=await db.sql`INSERT INTO pixie_buyer_links(user_id,email,line_name,normalized_name) VALUES(${user.id},${user.email.toLowerCase()},${name},${normalized}) ON CONFLICT(user_id) DO UPDATE SET line_name=excluded.line_name,normalized_name=excluded.normalized_name,email=excluded.email,status='pending',created_at=now(),decided_at=NULL WHERE pixie_buyer_links.status='rejected' RETURNING id,created_at`;
   if(!rows.length)fail('Nama LINE sudah diajukan atau disetujui. Hubungi Zeazee untuk perubahan.',409);
   try{await recordOwnerEvent(db,'line:'+rows[0].id+':'+new Date(rows[0].created_at).getTime(),'line','Buyer baru · GO Pixiedust',name+' mengajukan koneksi LINE. Buka akun admin untuk verifikasi.');}catch{/* LINE request remains saved. */}
   return json({ok:true});
  }
  if(action==='verify-line'){
   if(!owner)fail('Hanya Zeazee yang dapat memverifikasi nama LINE.',403);
   const b=await req.json();if(!['approved','rejected'].includes(b.status))fail('Keputusan tidak valid.');
   const client=await db.pool.connect();
   try{
    await client.query('BEGIN');
    const {rows}=await client.query("UPDATE pixie_buyer_links SET status=$1,decided_at=now() WHERE id=$2 AND status='pending' RETURNING *",[b.status,b.id]);
    if(!rows.length)fail('Pengajuan sudah diproses.',409);
    const link=rows[0];
    if(b.status==='approved'){
     const conflict=await client.query("SELECT id FROM pixie_items WHERE active AND lower(regexp_replace(trim(data->>'buyer'),'\\s+',' ','g'))=$1 AND buyer_email IS NOT NULL AND buyer_email<>$2",[link.normalized_name,link.email]);
     if(conflict.rows.length)fail('Ada item dengan email buyer lain. Periksa identitas buyer terlebih dahulu.',409);
     await client.query("UPDATE pixie_items SET buyer_email=$1,version=version+1 WHERE active AND lower(regexp_replace(trim(data->>'buyer'),'\\s+',' ','g'))=$2",[link.email,link.normalized_name]);
    }
    await client.query('COMMIT');
   }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
   return json({ok:true});
  }
  if(action==='testimonial'){
   if(!owner)fail('Hanya owner Zeazee yang dapat mengunggah testimoni.',403);
   const form=await req.formData(), file=form.get('photo'), author=text(form.get('author'),100),caption=text(form.get('caption'),1500),source=form.get('source');
   if(!author||!caption||!['Shopee','LINE'].includes(source)||!file?.arrayBuffer)fail('Lengkapi sumber, nama buyer, cerita, dan foto.');
   if(file.size>4*1024*1024)fail('Ukuran foto maksimal 4 MB.');
   let image;
   try { image=await sharp(Buffer.from(await file.arrayBuffer()),{limitInputPixels:25000000}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).toBuffer(); } catch {fail('Foto harus berupa gambar yang valid.');}
   const {width,height}=await sharp(image).metadata();
   let marks='';
   for(let y=60;y<height+120;y+=180)for(let x=-100;x<width+150;x+=350) marks+=`<text x="${x}" y="${y}" transform="rotate(-23 ${x} ${y})">GO PIXIEDUST</text>`;
   const svg=Buffer.from(`<svg width="${width}" height="${height}"><g font-family="sans-serif" font-size="28" font-weight="bold" fill="white" fill-opacity="0.45" stroke="#342348" stroke-width="0.7">${marks}</g><rect y="${height-50}" width="${width}" height="50" fill="#342348" fill-opacity="0.8"/><text x="20" y="${height-18}" font-family="sans-serif" font-size="21" font-weight="bold" fill="white">GO PIXIEDUST</text></svg>`);
   const output=await sharp(image).composite([{input:svg}]).webp({quality:85}).toBuffer(),key=crypto.randomUUID()+'.webp';
   await getStore('pixiedust-testimonials').set(key,output);
   await db.sql`INSERT INTO pixie_testimonials(author,source,caption,image_key) VALUES (${author},${source},${caption},${key})`;
   return json({ok:true});
  }
  const b=await req.json();
  if(action==='transfer'){
   if(!email(b.toEmail)||!text(b.toName,100))fail('Lengkapi nama dan email buyer penerima.');
   if(b.toEmail.trim().toLowerCase()===user.email.toLowerCase())fail('Buyer penerima harus berbeda.');
   const rows=await db.sql`INSERT INTO pixie_transfers(item_id,requester_id,from_email,to_email,to_name) SELECT id,${user.id},buyer_email,${b.toEmail.trim().toLowerCase()},${text(b.toName,100)} FROM pixie_items WHERE active AND id=${b.id} AND buyer_email=${user.email.toLowerCase()} RETURNING id`;
   if(!rows.length)fail('Item belum terhubung dengan email akunmu. Hubungi Zeazee.',403);
   return json({ok:true});
  }
  if(!owner)fail('Hanya owner Zeazee yang dapat mengubah data.',403);
  if(action==='edit')fail('Perbarui rekapan di spreadsheet sumber agar perubahan tetap tersinkron.',409);
  if(action==='decide'){
   if(!['approved','rejected'].includes(b.status))fail('Keputusan tidak valid');
   const client=await db.pool.connect();
   try{
    await client.query('BEGIN');
    const {rows}=await client.query("SELECT * FROM pixie_transfers WHERE id=$1 AND status='pending' FOR UPDATE",[b.id]);
    if(!rows.length)fail('Pengajuan sudah diproses.',409);
    const t=rows[0];
    if(b.status==='approved'){
     const result=await client.query("UPDATE pixie_items SET buyer_email=$1,data=jsonb_set(data,'{buyer}',to_jsonb($2::text)),version=version+1 WHERE active AND id=$3 AND buyer_email=$4",[t.to_email,t.to_name,t.item_id,t.from_email]);
     if(!result.rowCount)fail('Buyer item sudah berubah. Tolak pengajuan ini.',409);
    }
    await client.query('UPDATE pixie_transfers SET status=$1,decided_at=now() WHERE id=$2',[b.status,b.id]);
    await client.query('COMMIT');
   }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
   return json({ok:true});
  }
  if(action==='delete-testimonial'){const rows=await db.sql`DELETE FROM pixie_testimonials WHERE id=${b.id} RETURNING image_key`;if(rows[0])await getStore('pixiedust-testimonials').delete(rows[0].image_key);return json({ok:true});}
  fail('Tidak ditemukan',404);
 } catch(e){return json({error:e.code==='23505'?'Pengajuan bentrok dengan data yang sudah ada. Periksa nama LINE atau operslot yang masih menunggu.':e.status?e.message:'Permintaan gagal. Coba lagi atau periksa login dan koneksi.'},e.status|| (e.code==='23505'?409:500));}
};
