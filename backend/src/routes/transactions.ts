import { Router } from "express";
import { supabase } from "../config.js";
import { calculateRepaymentSplit } from "../services/loanEngine.js";
import { requireAgentSignature } from "../middleware/auth.js";

export const transactionsRouter = Router();

transactionsRouter.post("/", requireAgentSignature("from_address"), async (req, res) => {
  try {
    const { from_address, to_address, amount, service_name, status } = req.body;

    if (!from_address || !to_address || !amount || amount <= 0) {
      return res.status(400).json({ error: "from_address, to_address, and positive amount are required" });
    }

    const txStatus = status || "success";
    let repaymentPortion = 0;
    let agentPortion = amount;

    const { data: activeLoan } = await supabase
      .from("loans")
      .select("*")
      .eq("borrower_address", from_address)
      .eq("status", "active")
      .single();

    if (activeLoan && txStatus === "success") {
      const split = calculateRepaymentSplit(amount, parseFloat(activeLoan.repayment_split as string));
      const remaining = parseFloat(activeLoan.total_owed as string) - parseFloat(activeLoan.total_repaid as string);

      repaymentPortion = Math.min(split.repaymentPortion, remaining);
      agentPortion = amount - repaymentPortion;

      if (repaymentPortion > 0) {
        const newTotalRepaid = parseFloat(activeLoan.total_repaid as string) + repaymentPortion;

        await supabase
          .from("loan_repayments")
          .insert({
            loan_id: activeLoan.id,
            amount: repaymentPortion,
            source: "x402_split",
          });

        const loanUpdate: Record<string, unknown> = { total_repaid: newTotalRepaid };

        if (newTotalRepaid >= parseFloat(activeLoan.total_owed as string)) {
          loanUpdate.status = "repaid";
          loanUpdate.repaid_at = new Date().toISOString();
        }

        await supabase
          .from("loans")
          .update(loanUpdate)
          .eq("id", activeLoan.id);

        const { data: pool } = await supabase.from("lending_pool").select("*").single();
        if (pool) {
          await supabase
            .from("lending_pool")
            .update({
              total_repaid: parseFloat(pool.total_repaid) + repaymentPortion,
              total_interest_earned:
                parseFloat(pool.total_interest_earned) +
                repaymentPortion * (parseFloat(activeLoan.interest_rate as string) / 100),
            })
            .eq("id", pool.id);
        }
      }
    }

    const { data: tx, error } = await supabase
      .from("transactions")
      .insert({
        from_address,
        to_address,
        amount,
        service_name: service_name || "Unknown Service",
        status: txStatus,
        repayment_portion: repaymentPortion,
        agent_portion: agentPortion,
      })
      .select()
      .single();

    if (error) {
      console.error("Transaction insert error:", error);
      return res.status(500).json({ error: "Failed to record transaction" });
    }

    if (txStatus === "success") {
      const { data: agent } = await supabase
        .from("agents")
        .select("transaction_volume, total_payments, score")
        .eq("address", from_address)
        .single();

      if (agent) {
        // Fallback scoring: For every $50 traded, add 10 points. Minimum 10 points. Maximum 850 score.
        let newScore = agent.score + Math.max(10, Math.floor(amount / 50) * 10);
        if (newScore > 850) newScore = 850;

        await supabase
          .from("agents")
          .update({
            transaction_volume: parseFloat(agent.transaction_volume) + amount,
            total_payments: agent.total_payments + 1,
            score: newScore,
          })
          .eq("address", from_address);
      }
    } else if (txStatus === "failed") {
      const { data: agent } = await supabase
        .from("agents")
        .select("total_payments, failed_payments")
        .eq("address", from_address)
        .single();

      if (agent) {
        await supabase
          .from("agents")
          .update({
            total_payments: agent.total_payments + 1,
            failed_payments: agent.failed_payments + 1,
          })
          .eq("address", from_address);
      }
    }

    res.status(201).json({
      transaction: tx,
      repayment: repaymentPortion > 0
        ? {
            loanId: activeLoan!.id,
            repaymentPortion,
            agentPortion,
            loanFullyRepaid:
              parseFloat(activeLoan!.total_repaid as string) + repaymentPortion >=
              parseFloat(activeLoan!.total_owed as string),
          }
        : null,
    });
  } catch (err) {
    console.error("POST /transactions error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

transactionsRouter.get("/recent", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("transactions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      return res.status(500).json({ error: "Failed to fetch transactions" });
    }

    res.json(data || []);
  } catch (err) {
    console.error("GET /transactions/recent error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
