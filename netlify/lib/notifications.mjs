import * as webpush from 'web-push';
export async function pushKeys(db){
 const publicKey=Netlify.env.get('PIXIE_VAPID_PUBLIC_KEY'),privateKey=Netlify.env.get('PIXIE_VAPID_PRIVATE_KEY');
 if(publicKey&&privateKey)return {publicKey,privateKey};
 const stored=await db.sql`SELECT public_key,private_key FROM pixie_push_config WHERE id=1`;
 if(stored.length)return {publicKey:stored[0].public_key,privateKey:stored[0].private_key};
 const keys=webpush.generateVAPIDKeys();
 await db.sql`INSERT INTO pixie_push_config(id,public_key,private_key) VALUES(1,${keys.publicKey},${keys.privateKey}) ON CONFLICT DO NOTHING`;
 const rows=await db.sql`SELECT public_key,private_key FROM pixie_push_config WHERE id=1`;
 return {publicKey:rows[0].public_key,privateKey:rows[0].private_key};
}
export async function deliver(db,email,key,title,body){
 const {publicKey,privateKey}=await pushKeys(db);
 const subscriptions=await db.sql`SELECT * FROM pixie_push WHERE email=${email}`;
 for(const sub of subscriptions){
  const claimed=await db.sql`INSERT INTO pixie_notice_deliveries(notice_key,endpoint) VALUES(${key},${sub.endpoint}) ON CONFLICT DO NOTHING RETURNING notice_key`;
  if(!claimed.length)continue;
  try{await webpush.sendNotification(sub.subscription,JSON.stringify({title,body,url:'/'}),{vapidDetails:{subject:'https://gopixiedust.netlify.app',publicKey,privateKey},TTL:86400});}
  catch(e){if([404,410].includes(e.statusCode))await db.sql`DELETE FROM pixie_push WHERE endpoint=${sub.endpoint}`;else await db.sql`DELETE FROM pixie_notice_deliveries WHERE notice_key=${key} AND endpoint=${sub.endpoint}`;}
 }
}
export async function sendReminders(db){
 const pending=await db.sql`SELECT * FROM pixie_buyer_links WHERE status='pending'`;
 for(const link of pending)await recordOwnerEvent(db,'line:'+link.id+':'+new Date(link.created_at).getTime(),'line','Buyer baru · GO Pixiedust',link.line_name+' mengajukan koneksi LINE. Buka akun admin untuk verifikasi.');
 const items=await db.sql`SELECT * FROM pixie_items i WHERE active AND buyer_email IS NOT NULL AND payment_due_at<=now() AND coalesce(data->>'payment','') !~* '(done[[:space:]]*fp|^lunas$|^paid$|^fp$)' AND NOT EXISTS(SELECT 1 FROM pixie_payments p WHERE p.item_id=i.id AND p.buyer_email=i.buyer_email AND p.status IN ('pending','approved'))`;
 for(const item of items)await deliver(db,item.buyer_email,'due:'+item.id+':'+new Date(item.payment_due_at).getTime(),'Reminder pembayaran · GO Pixiedust',item.data.name+' · Rp '+Number(item.data.total||item.data.tax||item.data.price||0).toLocaleString('id-ID')+' · Deadline 1 × 24 jam telah lewat.');
}
export async function recordOwnerEvent(db,key,kind,title,body,threadId=null){
 await db.sql`INSERT INTO pixie_owner_events(event_key,kind,title,body,thread_id) VALUES(${key},${kind},${title},${body},${threadId}) ON CONFLICT(event_key) DO NOTHING`;
 try{await deliver(db,'ziziekaye@gmail.com','event:'+key,title,body);}catch{/* The scheduled sender retries persisted events. */}
}
export async function sendOwnerEvents(db){
 const events=await db.sql`SELECT * FROM pixie_owner_events WHERE created_at>now()-interval '7 days' AND read_at IS NULL ORDER BY id DESC LIMIT 100`;
 for(const event of events)await deliver(db,'ziziekaye@gmail.com','event:'+event.event_key,event.title,event.body);
}
