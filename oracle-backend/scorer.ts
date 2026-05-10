import { ethers } from "ethers";
import * as dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const RPC_URL = process.env.KITE_RPC_URL || "https://rpc-testnet.gokite.ai/";
const provider = new ethers.JsonRpcProvider(RPC_URL);

/**
 * Result from the scoring engine
 */
export interface ScoreResult {
  score: number;
  paymentRate: number;
  diversity: number;
  txCount: number;
  agentAgeDays: number;
  breakdown: {
    paymentRate: number;
    txVolume: number;
    age: number;
    diversity: number;
    sessions: number;
    repayment: number;
  };
}

async function scoreRepaymentHistory(
  agentAddress: string,
  provider: ethers.JsonRpcProvider
): Promise<number> {
  const LENDING_POOL_ADDRESS = process.env.LENDING_POOL_ADDRESS;
  if (!LENDING_POOL_ADDRESS) return 0;
  
  try {
    const abi = [
      "function getRepaymentHistory(address agent) view returns (tuple(uint256 loanId, uint256 amount, bool fullyRepaid, uint256 timestamp)[])"
    ];

    const contract = new ethers.Contract(
      LENDING_POOL_ADDRESS, abi, provider
    );

    const history = await contract.getRepaymentHistory(agentAddress);

    let points = 0;
    let fullRepayments = 0;

    for (const record of history) {
      if (record.fullyRepaid) {
        fullRepayments++;
        points += 40; // fully repaid loan
      } else {
        points += 10; // partial repayment — still positive
      }
    }

    // Cap at 3 full repayments = 120 pts max
    // Bonus for consistent repayer
    if (fullRepayments >= 2) points += 30;
    if (fullRepayments >= 3) points += 42;

    return Math.min(192, points);
  } catch (error) {
    console.error(`    ❌ Error fetching repayment history:`, error);
    return 0;
  }
}

/**
 * Computes an agent's credit score based on Kite chain data
 */
export async function computeScore(agentAddress: string): Promise<ScoreResult> {
  console.log(`\n🔍 Scoring agent: ${agentAddress}`);

  // 1. Get total tx count
  const txCount = await provider.getTransactionCount(agentAddress);
  if (txCount === 0) {
    console.log("  ⚠️ Agent has zero transactions. Base score assigned.");
    return emptyScore();
  }

  // 2. Scan last 1000 blocks stepping by 5
  const latestBlock = await provider.getBlockNumber();
  const scanDepth = 1000;
  const step = 5;
  const startBlock = Math.max(0, latestBlock - scanDepth);

  let successCount = 0;
  let failCount = 0;
  let firstSeenBlock = latestBlock;
  const uniquePayees = new Set<string>();

  console.log(`  Scanning blocks ${latestBlock} to ${startBlock} (step ${step})...`);

  for (let b = latestBlock; b >= startBlock; b -= step) {
    try {
      const block = await provider.getBlock(b, true);
      if (!block) continue;

      for (const tx of block.prefetchedTransactions) {
        // block.prefixedTransactions is (string | TransactionResponse)[] in ethers v6 if prefetched
        // If it's a string (hash), we'd need to fetch, but we passed true to getBlock
        const fullTx = tx as ethers.TransactionResponse;

        if (fullTx.from?.toLowerCase() === agentAddress.toLowerCase()) {
          try {
            const receipt = await provider.getTransactionReceipt(fullTx.hash);
            if (!receipt) continue;

            if (receipt.status === 1) {
              successCount++;
              if (fullTx.to) uniquePayees.add(fullTx.to.toLowerCase());
            } else {
              failCount++;
            }

            if (b < firstSeenBlock) firstSeenBlock = b;

          } catch (receiptError) {
            console.error(`    ❌ Error fetching receipt for ${fullTx.hash}:`, receiptError);
          }
        }
      }
    } catch (blockError) {
      console.error(`    ❌ Error fetching block ${b}:`, blockError);
    }
  }

  // 3. Scan for Repaid events to boost score for debt repayment
  try {
    const addressPath = path.resolve(process.cwd(), "../frontend/contracts/deployed-addresses.json");
    if (fs.existsSync(addressPath)) {
      const addresses = JSON.parse(fs.readFileSync(addressPath, "utf8"));
      if (addresses.lendingPool) {
        const lendingPoolAbi = ["event Repaid(address indexed borrower, uint256 amount)"];
        const lendingPool = new ethers.Contract(addresses.lendingPool, lendingPoolAbi, provider);
        
        console.log(`  Scanning LendingPool for Repaid events...`);
        const repaidLogs = await lendingPool.queryFilter("Repaid", startBlock, latestBlock);
        
        for (const log of repaidLogs) {
          const [borrower] = (log as any).args;
          if (borrower.toLowerCase() === agentAddress.toLowerCase()) {
            successCount += 3; // Heavily weight repayments as successful sessions
            uniquePayees.add(addresses.lendingPool.toLowerCase());
          }
        }
      }
    }
  } catch (e) {
    console.error("    ❌ Error fetching Repaid logs:", e);
  }

  // 5. Derive metrics
  const totalProcessed = successCount + failCount;
  const paymentRate = totalProcessed > 0 ? Math.round((successCount / totalProcessed) * 100) : 0;
  const diversity = uniquePayees.size;
  // 2-second blocks -> 86400 / 2 = 43200 blocks per day
  const agentAgeBlocks = latestBlock - firstSeenBlock;
  const agentAgeDays = Math.floor((agentAgeBlocks * 2) / 86400);

  // 6. Apply weighted formula (base 300, max 850)
  const repaymentPoints = await scoreRepaymentHistory(agentAddress, provider);
  
  // Rescale weights to make room for repayment (35% = 192.5 max points)
  const p_paymentRate = paymentRate * 1.375;               // 25% weight, max 137.5
  const p_txVolume = Math.min(txCount, 50) * 1.1;          // 10% weight, max 55
  const p_age = Math.min(agentAgeDays, 30) * 1.833;        // 10% weight, max 55
  const p_diversity = Math.min(diversity, 10) * 8.25;      // 15% weight, max 82.5
  const p_sessions = Math.min(successCount, 10) * 2.75;    // 5% weight, max 27.5

  const totalPoints = repaymentPoints + p_paymentRate + p_txVolume + p_age + p_diversity + p_sessions;
  const score = Math.min(850, Math.max(300, Math.round(300 + totalPoints)));

  return {
    score,
    paymentRate,
    diversity,
    txCount,
    agentAgeDays,
    breakdown: {
      paymentRate: Math.round(p_paymentRate),
      txVolume: Math.round(p_txVolume),
      age: Math.round(p_age),
      diversity: Math.round(p_diversity),
      sessions: Math.round(p_sessions),
      repayment: Math.round(repaymentPoints)
    }
  };
}

function emptyScore(): ScoreResult {
  return {
    score: 300,
    paymentRate: 0,
    diversity: 0,
    txCount: 0,
    agentAgeDays: 0,
    breakdown: {
      paymentRate: 0,
      txVolume: 0,
      age: 0,
      diversity: 0,
      sessions: 0,
      repayment: 0
    }
  };
}
