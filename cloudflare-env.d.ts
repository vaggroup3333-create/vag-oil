declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    POS_LOGIN?: string;
    POS_PASSWORD_HASH?: string;
    POS_PASSWORD_SALT?: string;
    POS_LEDGER_OWNER?: string;
    POS_CASHIER_LOGIN?: string;
    POS_CASHIER_PASSWORD_HASH?: string;
    POS_CASHIER_PASSWORD_SALT?: string;
    BUCKET?: R2Bucket;
  }
}
