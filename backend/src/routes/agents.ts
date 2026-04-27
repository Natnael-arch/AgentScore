import { Router } from "express";
import { supabase } from "../config.js";

export const agentsRouter = Router();

agentsRouter.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("agents")
      .select("address, name, score, agent_type")
      .order("registered_at", { ascending: false });

    if (error) {
      return res.status(500).json({ error: "Failed to fetch agents" });
    }
    res.json(data || []);
  } catch (err) {
    console.error("GET /agents error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

agentsRouter.get("/:address", async (req, res) => {
  try {
    const { address } = req.params;

    const { data, error } = await supabase
      .from("agents")
      .select("*")
      .eq("address", address)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Agent not found" });
    }

    const accountAgeDays = Math.floor(
      (Date.now() - new Date(data.registered_at).getTime()) / (1000 * 60 * 60 * 24)
    );

    const reliability =
      data.total_payments > 0
        ? Math.round(((data.total_payments - data.failed_payments) / data.total_payments) * 1000) / 10
        : 0;

    res.json({
      name: data.name,
      address: data.address,
      score: data.score,
      transactionVolume: parseFloat(data.transaction_volume),
      accountAgeDays,
      x402Reliability: reliability,
      failedPayments: data.failed_payments,
      totalPayments: data.total_payments,
      passport: {
        agentType: data.agent_type,
        modelHash: data.model_hash || "0x0000...0000",
        kiteIdentityStatus: data.identity_status,
        registeredOn: "Kite AI Testnet",
      },
    });
  } catch (err) {
    console.error("GET /agents/:address error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

agentsRouter.post("/", async (req, res) => {
  try {
    const { address, name, agent_type, model_hash } = req.body;

    if (!address) {
      return res.status(400).json({ error: "address is required" });
    }

    const { data: existing } = await supabase
      .from("agents")
      .select("address")
      .eq("address", address)
      .single();

    if (existing) {
      return res.status(409).json({ error: "Agent already registered" });
    }

    const { data, error } = await supabase
      .from("agents")
      .insert({
        address,
        name: name || "Unknown Agent",
        agent_type: agent_type || "General Purpose",
        model_hash: model_hash || null,
      })
      .select()
      .single();

    if (error) {
      console.error("Insert error:", error);
      return res.status(500).json({ error: "Failed to register agent" });
    }

    res.status(201).json(data);
  } catch (err) {
    console.error("POST /agents error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

agentsRouter.get("/:address/transactions", async (req, res) => {
  try {
    const { address } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    const { data, error } = await supabase
      .from("transactions")
      .select("*")
      .eq("from_address", address)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return res.status(500).json({ error: "Failed to fetch transactions" });
    }

    res.json(data || []);
  } catch (err) {
    console.error("GET /agents/:address/transactions error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

agentsRouter.post("/sync-score", async (req, res) => {
  const { agentAddress } = req.body;

  if (!agentAddress) {
    return res.status(400).json({ error: "agentAddress required" });
  }

  try {
    // Read the real score from Nate's oracle (which reads AgentScoreAttestation.sol)
    const oracleUrl = process.env.ORACLE_API_URL || "https://agentscore.onrender.com";
    
    // Use native https to bypass Node 18 Fetch DNS issues
    const https = await import("https");
    const scoreData: any = await new Promise((resolve, reject) => {
      https.get(`${oracleUrl}/score/${agentAddress}/raw`, (res) => {
        let body = "";
        res.on("data", (chunk) => body += chunk);
        res.on("end", () => {
          if (res.statusCode !== 200) reject(new Error(`Oracle returned ${res.statusCode}`));
          else resolve(JSON.parse(body));
        });
      }).on("error", reject);
    });

    // Update Supabase cache with the real on-chain score
    const { error } = await supabase
      .from("agents")
      .upsert({
        address:        agentAddress.toLowerCase(),
        score:          scoreData.score,
        payment_rate:   scoreData.paymentRate,
        diversity:      scoreData.diversity,
        tx_count:       scoreData.txCount,
        age_days:       scoreData.agentAgeDays,
        last_synced_at: new Date().toISOString()
      }, { onConflict: "address" }).catch((e: any) => ({ error: e }));

    if (error) console.error("Supabase offline, skipping write");

    res.json({
      success:    true,
      address:    agentAddress,
      score:      scoreData.score,
      source:     "AgentScoreAttestation on Kite chain",
      contract:   "0xF04B3a11db07d206F61Bf08645169793cbD442C3",
      explorerUrl: `https://testnet.kitescan.ai/address/0xF04B3a11db07d206F61Bf08645169793cbD442C3`
    });

  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
