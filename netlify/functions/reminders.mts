import { getDatabase } from '@netlify/database';
import { sendReminders, sendOwnerEvents } from '../lib/notifications.mjs';
import { syncPayments } from '../lib/payment-sheets.mjs';
export default async () => {
 const db=getDatabase();
 await sendReminders(db);
 await sendOwnerEvents(db);
 try { await syncPayments(db); } catch { /* Keep unsynced receipts queued for the next run. */ }
};
export const config={schedule:'*/5 * * * *'};
