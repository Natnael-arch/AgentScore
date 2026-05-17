import { ethers } from "ethers";
import { config, supabase } from "../config.js";
import AgentScoreAttestationABI from "../../../contracts/artifacts/contracts/AgentScoreAttestation.sol/AgentScoreAttestation.json" with { type: "json" };
import X402ProcessorABI from "../../../frontend/contracts/artifacts/contracts/X402Processor.sol/X402Processor.json" with { type: "json" };
import LendingPoolABI from "../../../frontend/contracts/artifacts/contracts/LendingPool.sol/LendingPool.json" with { type: "json" };
import fs from "fs";
import path from "path";

export async function startIndexer() {
  console.log("🚀 Starting Resilient Blockchain Indexer (Polling Mode)...");

  const provider = new ethers.JsonRpcProvider(config.kiteRpcUrl);
  
  // Load addresses
  const addressPath = path.resolve(process.cwd(), "../frontend/contracts/deployed-addresses.json");
  if (!fs.existsSync(addressPath)) {
    console.warn("⚠️ No deployed-addresses.json found. Indexer will wait.");
    return;
  }

  const addresses = JSON.parse(fs.readFileSync(addressPath, "utf8"));

  const agentScoreAttestation = new ethers.Contract(addresses.agentScoreAttestation, AgentScoreAttestationABI.abi, provider);
  const x402Processor = new ethers.Contract(addresses.x402Processor, X402ProcessorABI.abi, provider);
  const lendingPool = new ethers.Contract(addresses.lendingPool, LendingPoolABI.abi, provider);

  // Track the last block we processed to avoid duplicates
  let lastProcessedBlock = await provider.getBlockNumber();
  console.log(`📡 Starting scan from block ${lastProcessedBlock}...`);

  // Polling loop
  setInterval(async () => {
    try {
      const currentBlock = await provider.getBlockNumber();
      // Keep a 1-block safety buffer behind the latest block to avoid RPC coalescing/unaccepted block errors
      const safeLatestBlock = currentBlock > 0 ? currentBlock - 1 : currentBlock;
      if (safeLatestBlock <= lastProcessedBlock) return;

      const fromBlock = lastProcessedBlock + 1;
      const toBlock = safeLatestBlock;

      // 1. Scan for ScoreAttested (Replaces Registration and ScoreUpdated)
      const scoreLogs = await agentScoreAttestation.queryFilter("ScoreAttested", fromBlock, toBlock);
      for (const log of scoreLogs) {
        const [agentAddress, newScore, timestamp] = (log as any).args;
        console.log(`🔗 Indexer: ScoreAttested [${agentAddress}] -> ${newScore}`);
        
        // Upsert agent to ensure they exist and update score
        await supabase.from("agents").upsert({
          address: agentAddress,
          score: Number(newScore),
          name: "Autonomous Agent",
          identity_status: "Verified",
          updated_at: new Date(Number(timestamp) * 1000).toISOString()
        });
      }

      // 3. Scan for Borrowed (LendingPool)
      const borrowLogs = await lendingPool.queryFilter("Borrowed", fromBlock, toBlock);
      for (const log of borrowLogs) {
        const [borrowerAddress, amount] = (log as any).args;
        const amountUi = parseFloat(ethers.formatUnits(amount, 18));
        console.log(`🔗 Indexer: Borrowed [${borrowerAddress}] -> ${amountUi} PYUSD`);
        
        // Record in Supabase
        const interestRate = 5.0; // Matching contract
        const totalOwed = amountUi * (1 + interestRate / 100);
        
        await supabase.from("loans").insert({
          borrower_address: borrowerAddress,
          amount: amountUi,
          interest_rate: interestRate,
          total_owed: totalOwed,
          total_repaid: 0,
          status: "active",
          tx_hash: log.transactionHash
        });
        
        // Update global pool stats
        const { data: pool } = await supabase.from("lending_pool").select("*").single();
        if (pool) {
          await supabase.from("lending_pool").update({
            total_borrowed: parseFloat(pool.total_borrowed) + amountUi
          }).eq("id", pool.id);
        }
      }

      // 4. Scan for PaymentSplit (Already exists as Step 3)
      const payLogs = await x402Processor.queryFilter("PaymentSplit", fromBlock, toBlock);
      for (const log of payLogs) {
        const [from, to, token, totalAmount, agentPortion, poolPortion] = (log as any).args;
        console.log(`🔗 Indexer: PaymentSplit [${from} -> ${to}] Total: ${ethers.formatUnits(totalAmount, 18)}`);
        
        await supabase.from("transactions").insert({
          from_address: from,
          to_address: to,
          amount: parseFloat(ethers.formatUnits(totalAmount, 18)),
          repayment_portion: parseFloat(ethers.formatUnits(poolPortion, 18)),
          agent_portion: parseFloat(ethers.formatUnits(agentPortion, 18)),
          tx_hash: log.transactionHash,
          status: "success",
          service_name: "x402 On-Chain Split"
        });

        // Handle loan repayment
        const { data: activeLoan } = await supabase
          .from("loans")
          .select("id, total_repaid, total_owed")
          .eq("borrower_address", to)
          .eq("status", "active")
          .single();

        if (activeLoan) {
          const repaymentAmount = parseFloat(ethers.formatUnits(poolPortion, 18));
          const newTotalRepaid = parseFloat(activeLoan.total_repaid) + repaymentAmount;
          
          await supabase.from("loan_repayments").insert({
            loan_id: activeLoan.id,
            amount: repaymentAmount,
            source: "x402_onchain_split",
            tx_hash: log.transactionHash
          });

          const updateData: any = { total_repaid: newTotalRepaid };
          if (newTotalRepaid >= parseFloat(activeLoan.total_owed)) {
            updateData.status = "repaid";
            updateData.repaid_at = new Date().toISOString();
          }

          await supabase.from("loans").update(updateData).eq("id", activeLoan.id);

          // Trigger asynchronous score sync to immediately reflect the repayment
          fetch(`http://localhost:${config.port}/api/agents/sync-score`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentAddress: to })
          }).catch(e => console.error("Failed to trigger sync-score:", e));
        }
      }

      lastProcessedBlock = toBlock;
    } catch (err) {
      console.error("Indexer Polling Error:", err);
    }
  }, 5000); // Poll every 5 seconds
}

