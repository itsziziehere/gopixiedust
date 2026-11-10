import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
export const normalizeLine = value => String(value || '').trim().toLowerCase().replace(/\s+/g,' ');
function cell(row, col) {
 let v=row.getCell(col).value;
 if(v && typeof v==='object' && 'result' in v)v=v.result;
 if(v instanceof Date)return v.toISOString().slice(0,10);
 if(v && typeof v==='object')return v.richText?.map(t=>t.text).join('') || v.text || '';
 return String(v ?? '').trim();
}
export async function parseWorkbook(buffer) {
 const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);
 const rows=[],seen=new Map();
 for(const sheet of book.worksheets){
  if(/^EDIT/i.test(sheet.name)||sheet.name==='BUKTI PAYMENT')continue;
  const tax=sheet.name==='TAGIHAN TAX';let batch='';
  sheet.eachRow((row,n)=>{
   const no=cell(row,2),name=cell(row,3);
   if(/^BATCH/i.test(no)){batch=no;return;}
   if(!/^\d+(\.0+)?$/.test(no)||!name||name==='NAMA BARANG')return;
   const po=sheet.name==='PO CH',buyer=cell(row,tax?6:5);
   const data={name,buyer,group:cell(row,tax?5:4),qty:cell(row,tax?7:6),price:tax?'':cell(row,7),dp:tax?'':cell(row,8),total:cell(row,9),paymentDate:cell(row,10),payment:cell(row,tax?11:po?13:12),method:cell(row,tax?12:po?14:13),notes:cell(row,tax?13:po?12:11),tax:tax?cell(row,8):po?cell(row,11):'',batch:tax?cell(row,4)||batch:batch,sheet:sheet.name,status:cell(row,tax?14:po?15:14),kosStatus:'',img:'📦'};
   const identity=JSON.stringify([sheet.name,batch,no,name]);const count=seen.get(identity)||0;seen.set(identity,count+1);
   rows.push({key:createHash('sha256').update(identity+':'+count).digest('hex'),legacy:sheet.id+':'+n,data});
  });
 }
 if(!rows.length||!book.worksheets.some(s=>s.name==='TAGIHAN TAX'))throw new Error('Format spreadsheet tidak sesuai.');
 return rows;
}
export async function syncSpreadsheet(db, force=false) {
 const state=await db.sql`SELECT * FROM pixie_sheet_sync WHERE id=1`;
 if(!force && state[0]?.synced_at && Date.now()-new Date(state[0].synced_at).getTime()<300000)return;
 const response=await fetch('https://docs.google.com/spreadsheets/d/11YMOHAyackqrbpamWyEIj84DKotjohEb-zCwArgBlEQ/export?format=xlsx',{signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error('Spreadsheet tidak dapat dibaca.');
 const rows=await parseWorkbook(Buffer.from(await response.arrayBuffer()));
 const client=await db.pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT id FROM pixie_sheet_sync WHERE id=1 FOR UPDATE');
  // A second request may have completed the same refresh while we downloaded.
  const {rows:locked}=await client.query('SELECT synced_at FROM pixie_sheet_sync WHERE id=1');
  if(!force&&locked[0]?.synced_at&&Date.now()-new Date(locked[0].synced_at).getTime()<300000){await client.query('COMMIT');return;}
  const {rows:existing}=await client.query('SELECT * FROM pixie_items FOR UPDATE');
  const {rows:links}=await client.query("SELECT * FROM pixie_buyer_links WHERE status='approved'");
  const byKey=new Map(existing.filter(i=>i.sync_key).map(i=>[i.sync_key,i]));
  const legacy=new Map(existing.filter(i=>!i.sync_key).map(i=>[i.source_key,i]));
  const used=new Set();
  const incoming=rows.map(row=>{
   let old=byKey.get(row.key);const candidate=legacy.get(row.legacy);
   if(!old&&candidate&&['name','sheet','batch'].every(k=>candidate.data[k]===row.data[k])&&normalizeLine(candidate.source_buyer)===normalizeLine(row.data.buyer))old=candidate;
   if(old&&used.has(old.id))throw new Error('Baris duplikat.');
   if(old)used.add(old.id);
   const sameBuyer=old&&normalizeLine(old.source_buyer)===normalizeLine(row.data.buyer);
   const buyerEmail=sameBuyer&&old.buyer_email?old.buyer_email:links.find(l=>l.normalized_name===normalizeLine(row.data.buyer))?.email||null;
   const sourceBuyer=row.data.buyer;
   if(sameBuyer&&old.buyer_email)row.data.buyer=old.data.buyer;
   return {id:old?.id||null,sync_key:row.key,source_key:'sync:'+row.key,data:row.data,source_buyer:sourceBuyer,buyer_email:buyerEmail};
  });
  await client.query('UPDATE pixie_items SET active=false WHERE active');
  await client.query(`UPDATE pixie_items i SET data=r.data,source_buyer=r.source_buyer,buyer_email=r.buyer_email,sync_key=r.sync_key,active=true,version=i.version+1 FROM jsonb_to_recordset($1::jsonb) AS r(id bigint,data jsonb,source_buyer text,buyer_email text,sync_key text) WHERE i.id=r.id`,[JSON.stringify(incoming)]);
  await client.query(`INSERT INTO pixie_items(source_key,sync_key,data,source_buyer,buyer_email) SELECT r.source_key,r.sync_key,r.data,r.source_buyer,r.buyer_email FROM jsonb_to_recordset($1::jsonb) AS r(id bigint,source_key text,sync_key text,data jsonb,source_buyer text,buyer_email text) WHERE r.id IS NULL`,[JSON.stringify(incoming)]);
  await client.query('UPDATE pixie_sheet_sync SET synced_at=now(),error=NULL WHERE id=1');
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
export async function refreshSpreadsheet(db,force=false){
 try{await syncSpreadsheet(db,force);}catch{
  await db.sql`UPDATE pixie_sheet_sync SET error='Sinkronisasi belum berhasil. Rekapan terakhir tetap tersedia.' WHERE id=1`;
 }
}
