import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {parseWorkbook,normalizeLine,refreshSpreadsheet,syncSpreadsheet} from '../netlify/lib/sheet-sync.mjs';
async function workbook(){
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('KR GO1');
 sheet.getCell('B3').value='BATCH 1';
 for(const [col,value] of Object.entries({B5:1,C5:'PC',D5:'Group',E5:'Buyer',F5:2,G5:100,H5:0,I5:{formula:'F5*G5',result:200},J5:new Date('2026-05-01T00:00:00Z'),L5:'Done FP',M5:'QRIS'}))sheet.getCell(col).value=value;
 book.addWorksheet('TAGIHAN TAX');book.addWorksheet('EDIT TAX').getCell('C5').value='ignore';
 return book;
}
test('spreadsheet parser reads formulas, dates and batches and excludes templates',async()=>{
 const book=await workbook(),rows=await parseWorkbook(await book.xlsx.writeBuffer());
 assert.equal(rows.length,1);assert.equal(rows[0].data.total,'200');assert.equal(rows[0].data.paymentDate,'2026-05-01');assert.equal(rows[0].data.batch,'BATCH 1');assert.equal(normalizeLine('  Nama   LINE '),'nama line');
 const key=rows[0].key;book.getWorksheet('KR GO1').spliceRows(5,0,[]);const moved=await parseWorkbook(await book.xlsx.writeBuffer());assert.equal(moved[0].key,key);
});
test('invalid workbook is rejected instead of clearing previous records',async()=>{
 const book=new ExcelJS.Workbook();book.addWorksheet('Unrelated');const buffer=await book.xlsx.writeBuffer();await assert.rejects(()=>parseWorkbook(buffer),/Format spreadsheet/);
});
test('sync failure retains previous snapshot and exposes an honest error',async()=>{
 const calls=[];await refreshSpreadsheet({sql:async(parts)=>{calls.push(parts.join(''));if(calls.length===1)throw new Error('offline');return [];}});
 assert.equal(calls.length,2);assert.match(calls[1],/UPDATE pixie_sheet_sync/);assert.doesNotMatch(calls.join(''),/DELETE|UPDATE pixie_items/);
});
test('fresh database snapshot avoids downloading again',async()=>{
 await syncSpreadsheet({sql:async()=>[{synced_at:new Date()}],pool:{connect:()=>{throw new Error('should not connect');}}});
});

test('sync preserves an approved transfer, links new items and archives missing rows atomically',async()=>{
 const book=await workbook(),buffer=await book.xlsx.writeBuffer(),parsed=await parseWorkbook(buffer),queries=[];
 const savedFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(buffer);
 const client={release(){},async query(q,args){
  queries.push({q,args});
  if(q==='SELECT synced_at FROM pixie_sheet_sync WHERE id=1')return {rows:[{synced_at:null}]};
  if(q==='SELECT * FROM pixie_items FOR UPDATE')return {rows:[{id:7,sync_key:parsed[0].key,source_buyer:'Buyer',buyer_email:'recipient@example.com',data:{...parsed[0].data,buyer:'Recipient'}}]};
  if(q.includes('SELECT * FROM pixie_buyer_links'))return {rows:[]};return {rows:[]};
 }};
 try{
  await syncSpreadsheet({sql:async()=>[{synced_at:null}],pool:{connect:async()=>client}});
  const update=queries.find(x=>x.q.includes('jsonb_to_recordset')&&x.q.startsWith('UPDATE'));
  const row=JSON.parse(update.args[0])[0];assert.equal(row.id,7);assert.equal(row.buyer_email,'recipient@example.com');assert.equal(row.data.buyer,'Recipient');assert.equal(row.source_buyer,'Buyer');
  assert.ok(queries.some(x=>x.q.includes('SET active=false')));assert.equal(queries.at(-1).q,'COMMIT');
 }finally{globalThis.fetch=savedFetch;}
});
