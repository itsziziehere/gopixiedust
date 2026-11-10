import { getDatabase } from '@netlify/database';
import { refreshSpreadsheet } from '../lib/sheet-sync.mjs';
export default async () => { await refreshSpreadsheet(getDatabase()); };
export const config = { schedule: '*/5 * * * *' };
