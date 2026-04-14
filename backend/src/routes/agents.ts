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

agentsRouter.post("/:address/sync-score", async (req, res) => {
  try {
    const { address } = req.params;
    const { score } = req.body;
    const apiKey = req.header("x-api-key");

    const { config } = await import("../config.js");
    const { ethers } = await import("ethers");
    const fs = await import("fs");
    const path = await import("path");
    const AgentRegistryABI = await import("../../../frontend/contracts/artifacts/contracts/AgentRegistry.sol/AgentRegistry.json", {
      assert: { type: "json" }
    });

    if (apiKey !== config.systemApiKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (typeof score !== "number" || score < 300 || score > 850) {
      return res.status(400).json({ error: "Score must be a number between 300 and 850" });
    }

    // PUSH TO BLOCKCHAIN
    console.log(`🔗 Signaling score update on-chain for ${address} -> ${score}...`);
    
    const provider = new ethers.JsonRpcProvider(config.kiteRpcUrl);
    const wallet = new ethers.Wallet(config.poolPrivateKey as string, provider);
    
    const addressPath = path.resolve(process.cwd(), "../frontend/contracts/deployed-addresses.json");
    if (!fs.existsSync(addressPath)) {
      throw new Error("deployed-addresses.json not found. Deploy contracts first.");
    }
    const addresses = JSON.parse(fs.readFileSync(addressPath, "utf8"));
    
    const agentRegistry = new ethers.Contract(addresses.agentRegistry, AgentRegistryABI.default.abi, wallet);
    
    // Check if agent is registered on-chain
    const onChainAgent = await agentRegistry.getAgent(address);
    if (!onChainAgent.registered) {
      console.log(`📡 Agent ${address} not registered on-chain. Registering now...`);
      
      // Get metadata from Supabase to push to blockchain
      const { data: dbAgent } = await supabase.from("agents").select("*").eq("address", address).single();
      
      const regTx = await agentRegistry.adminRegister(
        address,
        dbAgent?.name || "Unknown Agent",
        dbAgent?.agent_type || "General Purpose",
        dbAgent?.model_hash || "0x00"
      );
      await regTx.wait();
      console.log(`✓ Agent registered on-chain: ${regTx.hash}`);
    }

    const tx = await agentRegistry.updateScore(address, score);
    console.log(`✓ On-chain score update transaction sent: ${tx.hash}`);
    await tx.wait();

    res.json({ 
      message: "Score sync transaction sent to blockchain", 
      txHash: tx.hash,
      score 
    });
  } catch (err: any) {
    console.error("POST /agents/:address/sync-score error:", err);
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});


