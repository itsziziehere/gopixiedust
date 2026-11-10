import { createSign } from 'node:crypto';
export async function syncPayments(db){
 const raw=Netlify.env.get('PIXIE_GOOGLE_SERVICE_ACCOUNT');
 if(!raw)return false;
 const account=JSON.parse(raw),now=Math.floor(Date.now()/1000);
 const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const unsigned=enc({alg:'RS256',typ:'JWT'})+'.'+enc({iss:account.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
 const signature=createSign('RSA-SHA256').update(unsigned).sign(account.private_key,'base64url');
 const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+signature}),signal:AbortSignal.timeout(10000)});
 if(!tokenResponse.ok)throw new Error('Akses Google belum tersedia.');
 const {access_token}=await tokenResponse.json();
 const base='https://sheets.googleapis.com/v4/spreadsheets/11YMOHAyackqrbpamWyEIj84DKotjohEb-zCwArgBlEQ';
 const headers={Authorization:'Bearer '+access_token,'Content-Type':'application/json'};
 const metadata=await fetch(base+'?fields=sheets.properties.title',{headers,signal:AbortSignal.timeout(10000)});
 if(!metadata.ok)throw new Error('Spreadsheet belum memberikan akses Editor.');
 const info=await metadata.json();
 if(!info.sheets.some(s=>s.properties.title==='BUKTI PAYMENT')){
  const created=await fetch(base+':batchUpdate',{method:'POST',headers,body:JSON.stringify({requests:[{addSheet:{properties:{title:'BUKTI PAYMENT'}}}]}),signal:AbortSignal.timeout(10000)});
  if(!created.ok)throw new Error('Sheet bukti belum berhasil dibuat.');
 }
 const rows=await db.sql`SELECT p.*,i.data FROM pixie_payments p JOIN pixie_items i ON i.id=p.item_id WHERE NOT sheet_synced ORDER BY p.id LIMIT 30`;
 const data=[{range:"'BUKTI PAYMENT'!A1:J1",values:[['ID','Item','Buyer','Email','Batch','Jenis','Harga / Total','Bukti (login diperlukan)','Status','Waktu upload']]}];
 for(const p of rows)data.push({range:`'BUKTI PAYMENT'!A${Number(p.id)+1}:J${Number(p.id)+1}`,values:[[String(p.id),p.data.name,p.data.buyer,p.buyer_email,p.data.batch,p.data.sheet,p.data.total||p.data.tax||p.data.price,'https://gopixiedust.netlify.app/.netlify/functions/community?action=proof&id='+p.id,p.status,new Date(p.created_at).toISOString()]]});
 const saved=await fetch(base+'/values:batchUpdate',{method:'POST',headers,body:JSON.stringify({valueInputOption:'RAW',data}),signal:AbortSignal.timeout(10000)});
 if(!saved.ok)throw new Error('Pencatatan spreadsheet belum berhasil.');
 for(const p of rows)await db.sql`UPDATE pixie_payments SET sheet_synced=true WHERE id=${p.id} AND status=${p.status}`;
 return true;
}
