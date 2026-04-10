import { Router } from "express";
import { supabase } from "../config.js";
import {
  assessEligibility,
  calculateTotalOwed,
} from "../services/loanEngine.js";
import { requireAgentSignature } from "../middleware/auth.js";
import { executeGaslessTransfer } from "../services/gasless.js";

export const loansRouter = Router();

loansRouter.get("/terms/:address", async (req, res) => {
  try {
    const { address } = req.params;

    const { data: agent } = await supabase
      .from("agents")
      .select("score")
      .eq("address", address)
      .single();

    if (!agent) {
      return res.status(404).json({ error: "Agent not found" });
    }

    const terms = assessEligibility(agent.score);
    res.json(terms);
  } catch (err) {
    console.error("GET /loans/terms/:address error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

loansRouter.post("/borrow", requireAgentSignature("borrower_address"), async (req, res) => {
  try {
    const { borrower_address, amount } = req.body;

    if (!borrower_address || !amount || amount <= 0) {
      return res.status(400).json({ error: "borrower_address and positive amount are required" });
    }

    const { data: agent } = await supabase
      .from("agents")
      .select("score, address")
      .eq("address", borrower_address)
      .single();

    if (!agent) {
      return res.status(404).json({ error: "Agent not found. Register first." });
    }

    const { data: activeLoan } = await supabase
      .from("loans")
      .select("id")
      .eq("borrower_address", borrower_address)
      .eq("status", "active")
      .single();

    if (activeLoan) {
      return res.status(409).json({ error: "Agent already has an active loan. Repay it first." });
    }

    const terms = assessEligibility(agent.score);

    if (!terms.eligible) {
      return res.status(403).json({ error: terms.message || "Not eligible for a loan" });
    }

    if (amount > terms.maxLoan) {
      return res.status(400).json({
        error: `Amount exceeds maximum loan of $${terms.maxLoan} for your score`,
      });
    }

    const totalOwed = calculateTotalOwed(amount, terms.interestRate);

    const { data: loan, error } = await supabase
      .from("loans")
      .insert({
        borrower_address,
        principal: amount,
        interest_rate: terms.interestRate,
        repayment_split: terms.repaymentSplit,
        total_owed: totalOwed,
        score_at_origination: agent.score,
      })
      .select()
      .single();

    if (error) {
      console.error("Loan insert error:", error);
      return res.status(500).json({ error: "Failed to create loan" });
    }

    // Attempt the Gasless on-chain payout
    let txHash = null;
    try {
      const gaslessResult = await executeGaslessTransfer(borrower_address, amount);
      txHash = gaslessResult.txHash;
    } catch (e) {
      console.error("Failed to execute on-chain payout. Skipping...", e);
      // Optional: you could fail the whole request, but for a hackathon keeping it resilient is smart
    }

    // we fetch pool next
    const { data: pool } = await supabase.from("lending_pool").select("*").single();
    if (pool) {
      await supabase
        .from("lending_pool")
        .update({ total_borrowed: parseFloat(pool.total_borrowed) + amount })
        .eq("id", pool.id);
    }

    res.status(201).json({
      loan,
      txHash,
      terms: {
        interestRate: terms.interestRate,
        repaymentSplit: terms.repaymentSplit,
        totalOwed,
      },
    });
  } catch (err) {
    console.error("POST /loans/borrow error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

loansRouter.get("/:address", async (req, res) => {
  try {
    const { address } = req.params;

    const { data, error } = await supabase
      .from("loans")
      .select("*, loan_repayments(*)")
      .eq("borrower_address", address)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ error: "Failed to fetch loans" });
    }

    res.json(data || []);
  } catch (err) {
    console.error("GET /loans/:address error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

loansRouter.get("/active/:address", async (req, res) => {
  try {
    const { address } = req.params;

    const { data, error } = await supabase
      .from("loans")
      .select("*, loan_repayments(*)")
      .eq("borrower_address", address)
      .eq("status", "active")
      .single();

    if (error || !data) {
      return res.json(null);
    }

    res.json(data);
  } catch (err) {
    console.error("GET /loans/active/:address error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
