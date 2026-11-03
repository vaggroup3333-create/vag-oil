import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const ledgers=sqliteTable('ledgers',{id:text('id').primaryKey(),data:text('data').notNull(),version:integer('version').notNull().default(0)});
