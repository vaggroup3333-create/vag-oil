import {paidDraftForm} from './paid-stock-draft';

// Keep the latest rejected legacy form separately from the working ledger.
// It can be reviewed without asking the user to reload and lose their fields.
export async function capturePaidStockSaveRecovery(db:any,owner:string,action:any,serverRevision:number){
 if(action.type!=='paid_stock_draft_save'||!Array.isArray(action.rows)||action.rows.length>300)return false;
 const payload=JSON.stringify({type:'paid_stock_draft_save',id:action.id,revision:action.revision,...paidDraftForm(action),...(action.base?{base:paidDraftForm(action.base)}:{})});
 if(payload.length>512000)return false;
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload));
 const fingerprint=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
 await db.prepare('CREATE TABLE IF NOT EXISTS pos_paid_stock_save_recovery (owner TEXT NOT NULL,draft_id TEXT NOT NULL,fingerprint TEXT NOT NULL,payload TEXT NOT NULL,server_revision INTEGER NOT NULL,captured_at TEXT NOT NULL,resolved_at TEXT,PRIMARY KEY(owner,draft_id))').bind().run();
 await db.prepare('INSERT INTO pos_paid_stock_save_recovery (owner,draft_id,fingerprint,payload,server_revision,captured_at,resolved_at) VALUES (?,?,?,?,?,?,NULL) ON CONFLICT(owner,draft_id) DO UPDATE SET fingerprint=excluded.fingerprint,payload=excluded.payload,server_revision=excluded.server_revision,captured_at=excluded.captured_at,resolved_at=NULL').bind(owner,action.id,fingerprint,payload,serverRevision,new Date().toISOString()).run();
 return true;
}
