import { supabase } from "../config.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function setupDb() {
  console.log("Setting up KiteCredit database tables...\n");

  // Test connection first
  const { error: testError } = await supabase.from("agents").select("count").limit(1);
  
  if (testError && testError.code === "42P01") {
    console.log("Tables don't exist yet. Please run the schema.sql manually:\n");
    console.log("1. Go to https://supabase.com/dashboard");
    console.log("2. Open your project → SQL Editor → New Query");
    console.log("3. Paste the contents of backend/supabase/schema.sql");
    console.log("4. Click 'Run'\n");
    
    const schemaPath = path.resolve(__dirname, "../../supabase/schema.sql");
    console.log(`Schema file: ${schemaPath}`);
    process.exit(1);
  } else if (testError) {
    console.error("Connection error:", testError.message);
    process.exit(1);
  }

  console.log("✓ Connected to Supabase successfully!");
  console.log("✓ Tables exist. Ready to seed data.\n");
}

setupDb().catch(console.error);
