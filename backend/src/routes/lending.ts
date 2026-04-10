import { Router } from "express";
import { supabase } from "../config.js";
import { requireAgentSignature } from "../middleware/auth.js";

export const lendingRouter = Router();

lendingRouter.post("/deposit", requireAgentSignature("lender_address"), async (req, res) => {
  try {
    const { lender_address, amount } = req.body;

    if (!lender_address || !amount || amount <= 0) {
      return res.status(400).json({ error: "lender_address and positive amount are required" });
    }

    const { data: existing } = await supabase
      .from("lender_positions")
      .select("*")
      .eq("lender_address", lender_address)
      .single();

    if (existing) {
      const newAmount = parseFloat(existing.deposited_amount) + amount;
      const { data, error } = await supabase
        .from("lender_positions")
        .update({ deposited_amount: newAmount })
        .eq("lender_address", lender_address)
        .select()
        .single();

      if (error) {
        return res.status(500).json({ error: "Failed to update deposit" });
      }

      await updatePoolDeposit(amount);
      return res.json(data);
    }

    const { data, error } = await supabase
      .from("lender_positions")
      .insert({ lender_address, deposited_amount: amount })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: "Failed to create deposit" });
    }

    await updatePoolDeposit(amount);
    res.status(201).json(data);
  } catch (err) {
    console.error("POST /lending/deposit error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

lendingRouter.post("/withdraw", requireAgentSignature("lender_address"), async (req, res) => {
  try {
    const { lender_address, amount } = req.body;

    if (!lender_address || !amount || amount <= 0) {
      return res.status(400).json({ error: "lender_address and positive amount are required" });
    }

    const { data: position } = await supabase
      .from("lender_positions")
      .select("*")
      .eq("lender_address", lender_address)
      .single();

    if (!position) {
      return res.status(404).json({ error: "No deposit found for this address" });
    }

    const currentBalance = parseFloat(position.deposited_amount) + parseFloat(position.earned_interest);

    if (amount > currentBalance) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    const newDeposited = Math.max(0, parseFloat(position.deposited_amount) - amount);

    const { data, error } = await supabase
      .from("lender_positions")
      .update({ deposited_amount: newDeposited })
      .eq("lender_address", lender_address)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: "Failed to process withdrawal" });
    }

    await updatePoolDeposit(-amount);
    res.json(data);
  } catch (err) {
    console.error("POST /lending/withdraw error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

lendingRouter.get("/:address", async (req, res) => {
  try {
    const { address } = req.params;

    const { data } = await supabase
      .from("lender_positions")
      .select("*")
      .eq("lender_address", address)
      .single();

    if (!data) {
      return res.json({
        lender_address: address,
        deposited_amount: 0,
        earned_interest: 0,
      });
    }

    res.json(data);
  } catch (err) {
    console.error("GET /lending/:address error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function updatePoolDeposit(delta: number) {
  const { data: pool } = await supabase.from("lending_pool").select("*").single();
  if (pool) {
    await supabase
      .from("lending_pool")
      .update({ total_deposited: Math.max(0, parseFloat(pool.total_deposited) + delta) })
      .eq("id", pool.id);
  }
}
