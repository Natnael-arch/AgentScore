import { Router } from "express";
import { supabase } from "../config.js";

export const poolRouter = Router();

poolRouter.get("/", async (_req, res) => {
  try {
    const { data: pool } = await supabase.from("lending_pool").select("*").single();

    if (!pool) {
      return res.json({
        tvl: 0,
        totalBorrowed: 0,
        totalRepaid: 0,
        totalInterestEarned: 0,
        defaultRate: 0,
        averageApy: 8.2,
        activeLoans: 0,
      });
    }

    const { count: activeLoans } = await supabase
      .from("loans")
      .select("*", { count: "exact", head: true })
      .eq("status", "active");

    const { count: totalLoans } = await supabase
      .from("loans")
      .select("*", { count: "exact", head: true });

    const { count: defaultedLoans } = await supabase
      .from("loans")
      .select("*", { count: "exact", head: true })
      .eq("status", "defaulted");

    const defaultRate = totalLoans && totalLoans > 0
      ? Math.round(((defaultedLoans || 0) / totalLoans) * 1000) / 10
      : 0;

    const tvl = parseFloat(pool.total_deposited);
    const totalInterest = parseFloat(pool.total_interest_earned);
    const averageApy = tvl > 0 ? Math.round((totalInterest / tvl) * 100 * 10) / 10 : 8.2;

    res.json({
      tvl,
      totalBorrowed: parseFloat(pool.total_borrowed),
      totalRepaid: parseFloat(pool.total_repaid),
      totalInterestEarned: totalInterest,
      defaultRate,
      averageApy: Math.max(averageApy, 0),
      activeLoans: activeLoans || 0,
    });
  } catch (err) {
    console.error("GET /pool error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
