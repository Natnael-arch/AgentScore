import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "3002"),
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  kiteRpcUrl: process.env.KITE_RPC_URL || "https://rpc-testnet.gokite.ai",
  kiteChainId: parseInt(process.env.KITE_CHAIN_ID || "2368"),
  systemApiKey: process.env.SYSTEM_API_KEY || "dev-secret-key-1234",
  poolPrivateKey: process.env.POOL_PRIVATE_KEY || "",
};

// Local DB Mock Implementation for Offline resilience
class LocalSupabaseQuery {
  private table: string;
  private filters: Array<(row: any) => boolean> = [];
  private orderCol?: string;
  private orderAscending: boolean = true;
  private limitCount?: number;
  private isSingle: boolean = false;
  private countMode?: string;
  
  private action?: "insert" | "update" | "upsert" | "delete";
  private actionData: any;
  private upsertOptions?: { onConflict?: string };

  constructor(table: string) {
    this.table = table;
  }

  private getFilePath() {
    return path.resolve(process.cwd(), "db.json");
  }

  private readData(): Record<string, any[]> {
    const file = this.getFilePath();
    if (!fs.existsSync(file)) {
      const defaultDb = {
        agents: [],
        lender_positions: [],
        lending_pool: [{ id: "main", total_deposited: "1000", total_borrowed: "320", total_repaid: "200", total_interest_earned: "15" }],
        loans: [],
        transactions: [],
        loan_repayments: []
      };
      fs.writeFileSync(file, JSON.stringify(defaultDb, null, 2), "utf8");
      return defaultDb;
    }
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  }

  private writeData(data: Record<string, any[]>) {
    fs.writeFileSync(this.getFilePath(), JSON.stringify(data, null, 2), "utf8");
  }

  select(fields: string = "*", options?: { count?: string; head?: boolean }) {
    if (options?.count) {
      this.countMode = options.count;
    }
    return this;
  }

  eq(col: string, val: any) {
    this.filters.push((row) => {
      const rowVal = row[col];
      if (typeof rowVal === "string" && typeof val === "string") {
        return rowVal.toLowerCase() === val.toLowerCase();
      }
      return rowVal == val;
    });
    return this;
  }

  order(col: string, options?: { ascending?: boolean }) {
    this.orderCol = col;
    this.orderAscending = options?.ascending !== false;
    return this;
  }

  limit(n: number) {
    this.limitCount = n;
    return this;
  }

  single() {
    this.isSingle = true;
    return this;
  }

  insert(data: any) {
    this.action = "insert";
    this.actionData = data;
    return this;
  }

  update(data: any) {
    this.action = "update";
    this.actionData = data;
    return this;
  }

  upsert(data: any, options?: { onConflict?: string }) {
    this.action = "upsert";
    this.actionData = data;
    this.upsertOptions = options;
    return this;
  }

  delete() {
    this.action = "delete";
    return this;
  }

  async then(resolve: any, reject?: any) {
    try {
      const db = this.readData();
      if (!db[this.table]) db[this.table] = [];

      let resultData: any = null;

      if (this.action === "insert") {
        const rows = Array.isArray(this.actionData) ? this.actionData : [this.actionData];
        const processedRows = rows.map((row) => {
          const newRow = {
            id: row.id || Math.random().toString(36).substring(2, 9),
            created_at: new Date().toISOString(),
            ...row,
          };
          db[this.table].push(newRow);
          return newRow;
        });
        this.writeData(db);
        resultData = this.isSingle || !Array.isArray(this.actionData) ? processedRows[0] : processedRows;
      } 
      else if (this.action === "update") {
        const updatedRows: any[] = [];
        db[this.table] = db[this.table].map((row) => {
          const match = this.filters.every((f) => f(row));
          if (match) {
            const newRow = { ...row, ...this.actionData };
            updatedRows.push(newRow);
            return newRow;
          }
          return row;
        });
        this.writeData(db);
        resultData = this.isSingle ? updatedRows[0] : updatedRows;
      }
      else if (this.action === "upsert") {
        const rows = Array.isArray(this.actionData) ? this.actionData : [this.actionData];
        const conflictCol = this.upsertOptions?.onConflict || "address";
        const upsertedRows: any[] = [];

        rows.forEach((row) => {
          const idx = db[this.table].findIndex((r) => {
            const rVal = r[conflictCol];
            const rowVal = row[conflictCol];
            if (typeof rVal === "string" && typeof rowVal === "string") {
              return rVal.toLowerCase() === rowVal.toLowerCase();
            }
            return rVal == rowVal;
          });

          if (idx !== -1) {
            const updated = { ...db[this.table][idx], ...row, updated_at: new Date().toISOString() };
            db[this.table][idx] = updated;
            upsertedRows.push(updated);
          } else {
            const inserted = {
              id: row.id || Math.random().toString(36).substring(2, 9),
              created_at: new Date().toISOString(),
              ...row,
            };
            db[this.table].push(inserted);
            upsertedRows.push(inserted);
          }
        });
        this.writeData(db);
        resultData = Array.isArray(this.actionData) ? upsertedRows : upsertedRows[0];
      }
      else if (this.action === "delete") {
        db[this.table] = db[this.table].filter((row) => !this.filters.every((f) => f(row)));
        this.writeData(db);
        resultData = null;
      }
      else {
        // Read action (select)
        let rows = db[this.table];

        if (this.filters.length > 0) {
          rows = rows.filter((row) => this.filters.every((f) => f(row)));
        }

        if (this.orderCol) {
          rows.sort((a, b) => {
            const aVal = a[this.orderCol!];
            const bVal = b[this.orderCol!];
            if (aVal < bVal) return this.orderAscending ? -1 : 1;
            if (aVal > bVal) return this.orderAscending ? 1 : -1;
            return 0;
          });
        }

        if (this.limitCount !== undefined) {
          rows = rows.slice(0, this.limitCount);
        }

        const count = rows.length;
        resultData = rows;
        if (this.isSingle) {
          resultData = rows.length > 0 ? rows[0] : null;
        }

        return resolve({
          data: resultData,
          error: null,
          count: this.countMode ? count : null,
        });
      }

      return resolve({
        data: resultData,
        error: null,
      });
    } catch (err: any) {
      if (reject) reject(err);
      else return { data: null, error: err };
    }
  }
}

class LocalSupabase {
  from(table: string) {
    return new LocalSupabaseQuery(table);
  }
}

let client: any;
const isOffline = config.supabaseUrl.includes("ydzvybbwjkvglmtegtlw.supabase.co");

if (isOffline) {
  console.log("⚠️ Supabase host is offline/unreachable. Falling back to local db.json database!");
  client = new LocalSupabase();
} else {
  try {
    client = createClient(config.supabaseUrl, config.supabaseKey);
  } catch (e) {
    console.log("⚠️ Error creating Supabase client. Falling back to local db.json database!");
    client = new LocalSupabase();
  }
}

export const supabase = client;
