import { Router } from "express";
import { supabase } from "../config.js";
import { ethers } from "ethers";

export const loansRouter = Router();

const LENDING_POOL_ABI = [
  "function borrow(uint256 amount) external",
  "function borrowers(address) external view returns (uint256 borrowedAmount, uint256 lastBorrowTime, uint256 collateralAmount, bool isCollateralLocked, uint256 interestRateBps, uint256 accruedInterest, uint256 lastInterestUpdate)",
  "function getScore(address) external view returns (uint16 score, uint32 timestamp)"
];

function assessEligibility(score: number) {
  if (score < 500) {
    return { eligible: false, maxLoan: 0, interestRate: 0, repaymentSplit: 30, message: "Score too low" };
  }
  let maxLoan = 0;
  let interestRate = 20.0;
  if (score >= 800) { maxLoan = 500; interestRate = 5.0; }
  else if (score >= 700) { maxLoan = 200; interestRate = 10.0; }
  else if (score >= 600) { maxLoan = 50; interestRate = 15.0; }
  else { maxLoan = 10; interestRate = 20.0; }
  return { eligible: true, maxLoan, interestRate, repaymentSplit: 30 };
}

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

loansRouter.post("/borrow", async (req, res) => {
  try {
    const { agentAddress, amount } = req.body;

    if (!agentAddress || !amount) {
      return res.status(400).json({
        error: "agentAddress and amount are required"
      });
    }

    const provider = new ethers.JsonRpcProvider(
      process.env.KITE_RPC_URL!
    );

    // Use agent's own private key to sign the borrow tx
    // Agent must sign their own borrow — cannot be done on their behalf
    // Frontend passes signed tx or we use a server signer for demo
    const signer = new ethers.Wallet(
      process.env.AGENT_PRIVATE_KEY!,
      provider
    );

    const lendingPool = new ethers.Contract(
      process.env.LENDING_POOL_ADDRESS!,
      LENDING_POOL_ABI,
      signer
    );

    // Check existing loan
    const borrower = await lendingPool.borrowers(agentAddress);
    if (borrower.borrowedAmount > 0n) {
      return res.status(400).json({
        error: "Agent already has an active loan",
        borrowed: ethers.formatUnits(borrower.borrowedAmount, 18)
      });
    }

    // Execute borrow on-chain
    const amountWei = ethers.parseUnits(amount.toString(), 18);
    const tx = await lendingPool.borrow(amountWei);
    await tx.wait();

    // Update Supabase cache
    await supabase
      .from("loans")
      .upsert({
        agent_address:  agentAddress,
        borrowed_amount: amount,
        tx_hash:        tx.hash,
        status:         "active",
        created_at:     new Date().toISOString()
      });

    return res.json({
      success:    true,
      txHash:     tx.hash,
      explorerUrl: `https://testnet.kitescan.ai/tx/${tx.hash}`,
      borrowed:   amount,
      message:    `Successfully borrowed ${amount} PYUSD from LendingPool`
    });

  } catch (err: any) {
    console.error("[BORROW] Failed:", err.message);
    return res.status(500).json({
      error:   "Borrow failed",
      details: err.message
    });
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
