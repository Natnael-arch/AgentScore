import { supabase } from "../config.js";

const DEMO_AGENTS = [
  {
    address: "0xA1c3E2B7D9F4a6C8b0E5d3F2A1B7C9D8E5F2A1B8",
    name: "Alice",
    agent_type: "DeFi Autonomous Trader",
    model_hash: "0x7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c",
    identity_status: "Verified",
    score: 810,
    transaction_volume: 2000,
    total_payments: 134,
    failed_payments: 2,
    registered_at: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    address: "0xB0b7F4E2C1A3D5B8E6F9C2A1D4E7B3F5A8C1D3E1",
    name: "Bob",
    agent_type: "General Purpose Bot",
    model_hash: "0x1d4e9f0a2b3c4d5e6f7a8b9c0d1e2f3a",
    identity_status: "Pending",
    score: 350,
    transaction_volume: 0,
    total_payments: 0,
    failed_payments: 0,
    registered_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    address: "0xC4a2B8D5E1F3A7C9D6E2B4F8A1C5D9E3F7A2B5F0",
    name: "Charlie",
    agent_type: "Data Oracle Agent",
    model_hash: "0x9c2b4e7d1f3a5c8b0d2e6f9a3b7c1d5e",
    identity_status: "Unverified",
    score: 420,
    transaction_volume: 150,
    total_payments: 33,
    failed_payments: 19,
    registered_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

async function seed() {
  console.log("Seeding KiteCredit database...\n");

  for (const agent of DEMO_AGENTS) {
    const { data: existing } = await supabase
      .from("agents")
      .select("address")
      .eq("address", agent.address)
      .single();

    if (existing) {
      console.log(`  ⏭  ${agent.name} already exists, updating...`);
      await supabase.from("agents").update(agent).eq("address", agent.address);
    } else {
      const { error } = await supabase.from("agents").insert(agent);
      if (error) {
        console.error(`  ✗  Failed to seed ${agent.name}:`, error.message);
      } else {
        console.log(`  ✓  Seeded ${agent.name} (score: ${agent.score})`);
      }
    }
  }

  const { data: pool } = await supabase.from("lending_pool").select("*").single();
  if (!pool) {
    await supabase.from("lending_pool").insert({
      total_deposited: 125000,
      total_borrowed: 45000,
      total_repaid: 32000,
      total_interest_earned: 3200,
    });
    console.log("  ✓  Seeded lending pool stats");
  } else {
    await supabase
      .from("lending_pool")
      .update({
        total_deposited: 125000,
        total_borrowed: 45000,
        total_repaid: 32000,
        total_interest_earned: 3200,
      })
      .eq("id", pool.id);
    console.log("  ✓  Updated lending pool stats");
  }

  const alice = DEMO_AGENTS[0];
  const sampleTxs = [
    { from_address: alice.address, to_address: "0xServiceA", amount: 15, service_name: "GPT-4 API", status: "success" },
    { from_address: alice.address, to_address: "0xServiceB", amount: 8.5, service_name: "Weather Oracle", status: "success" },
    { from_address: alice.address, to_address: "0xServiceC", amount: 22, service_name: "Document Summarizer", status: "success" },
    { from_address: alice.address, to_address: "0xServiceD", amount: 5, service_name: "Image Generation", status: "success" },
    { from_address: alice.address, to_address: "0xServiceE", amount: 12, service_name: "Code Audit Service", status: "failed" },
  ];

  for (const tx of sampleTxs) {
    await supabase.from("transactions").insert(tx);
  }
  console.log("  ✓  Seeded sample transactions for Alice");

  console.log("\n✅ Seed complete!");
  console.log("\n  Demo agent addresses:");
  for (const agent of DEMO_AGENTS) {
    console.log(`    ${agent.name}: ${agent.address}`);
  }
}

seed().catch(console.error);
