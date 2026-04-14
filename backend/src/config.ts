import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "3001"),
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  kiteRpcUrl: process.env.KITE_RPC_URL || "https://rpc-testnet.gokite.ai",
  kiteChainId: parseInt(process.env.KITE_CHAIN_ID || "2368"),
  systemApiKey: process.env.SYSTEM_API_KEY || "dev-secret-key-1234",
  poolPrivateKey: process.env.POOL_PRIVATE_KEY || "",
};

if (!config.supabaseUrl || !config.supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

export const supabase = createClient(config.supabaseUrl, config.supabaseKey);
