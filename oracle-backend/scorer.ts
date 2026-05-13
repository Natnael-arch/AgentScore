import { ethers } from "ethers";
import * as dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const RPC_URL = process.env.KITE_RPC_URL || "https://rpc-testnet.gokite.ai/";
const provider = new ethers.JsonRpcProvider(RPC_URL);

interface PassportHistory {
  totalPayments:     number;
  successfulPayments: number;
  uniquePayees:      string[];
  firstPaymentAt:    number;  // unix timestamp
  totalAmountSpent:  bigint;
  sessions: {
    id: string;
    maxPerTx: bigint;
    totalSpent: bigint;
    respected: boolean; // never exceeded limit
  }[];
}

async function getPassportHistory(
  agentAddress: string,
  passportToken: string
): Promise<PassportHistory | null> {
  try {
    const response = await fetch(
      `https://passport.prod.gokite.ai/v1/agents/${agentAddress}/history`,
      {
        headers: {
          "Authorization": `Bearer ${passportToken}`,
          "Content-Type": "application/json"
        }
      }
    );

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// Factor 1 — Payment success rate
function scorePaymentSuccess(history: PassportHistory): number {
  if (history.totalPayments === 0) return 0;
  const rate = history.successfulPayments / history.totalPayments;
  return Math.round(rate * 137); // max 137 pts (25% weight)
}

// Factor 2 — Transaction volume
function scoreVolume(history: PassportHistory): number {
  return Math.min(history.totalPayments, 50) * 2.2;
}

// Factor 3 — Service diversity
function scoreDiversity(history: PassportHistory): number {
  const unique = new Set(history.uniquePayees).size;
  return Math.min(unique, 10) * 8.2; // max 82 pts
}

// Factor 4 — Account age
function scoreAge(history: PassportHistory): number {
  const now = Math.floor(Date.now() / 1000);
  const ageSeconds = now - history.firstPaymentAt;
  const ageDays = ageSeconds / 86400;
  return Math.min(ageDays, 30) * 1.83; // max 55 pts
}

// Factor 5 — Session discipline
function scoreSessionDiscipline(history: PassportHistory): number {
  if (history.sessions.length === 0) return 0;
  const respected = history.sessions.filter(s => s.respected).length;
  const rate = respected / history.sessions.length;
  return Math.round(rate * 27); // max 27 pts
}

/**
 * Result from the scoring engine
 */
export interface ScoreResult {
  score: number;
  paymentRate: number;
  diversity: number;
  txCount: number;
  agentAgeDays: number;
  factors?: {
    repayment: number;
    payment: number;
    diversity: number;
    age: number;
    trading: number;
    discipline: number;
  };
  sources?: {
    passport: boolean;
    chainScan: boolean;
  };
  breakdown?: {
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
    console.warn("[SCORER] Repayment history check failed:", error);
    return 0;
  }
}

async function scoreTradingPerformance(
  agentAddress: string,
  provider: ethers.JsonRpcProvider
): Promise<number> {
  try {
    const TRADE_VAULT = "0x30980D5Efd3489B65D3dc0E65b61C01B357a8DBa";
    const abi = [
      "event PositionOpened(uint256 indexed id, address indexed agent, string asset, uint8 side, uint256 entryPrice, uint256 size)",
      "event PositionClosed(uint256 indexed id, uint8 status, uint256 exitPrice, int256 pnl)"
    ];

    const vault = new ethers.Contract(TRADE_VAULT, abi, provider);
    const latestBlock = await provider.getBlockNumber();
    const fromBlock   = Math.max(0, latestBlock - 50000);

    // Get all positions opened by this agent
    const openFilter = vault.filters.PositionOpened(null, agentAddress);
    const openEvents = await vault.queryFilter(openFilter, fromBlock);

    if (openEvents.length === 0) return 0;

    // Get all closed positions
    const closeFilter = vault.filters.PositionClosed();
    const closeEvents = await vault.queryFilter(closeFilter, fromBlock);

    // Match closes to this agent's opens
    const agentIds = new Set(openEvents.map(e => (e as any).args.id.toString()));
    const closes   = closeEvents.filter(e =>
      agentIds.has((e as any).args.id.toString())
    );

    const profitable = closes.filter(e =>
      (e as any).args.status === 2n // CLOSED_PROFIT = 2 in our contract
    ).length;

    let points = 0;
    points += Math.min(openEvents.length, 5) * 5;  // up to 25pts for activity
    points += Math.min(profitable, 3) * 10;         // up to 30pts for profit

    return Math.min(55, points); // max 55 pts (10% weight)

  } catch (err: any) {
    console.warn("[SCORER] Trading performance unavailable:", err.message);
    return 0;
  }
}

/**
 * Legacy block scanner fallback
 */
export async function computeScoreLegacy(agentAddress: string): Promise<ScoreResult> {
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
  const tradingPoints   = await scoreTradingPerformance(agentAddress, provider);
  
  // Rescale weights to make room for repayment (35% = 192.5 max points)
  const p_paymentRate = paymentRate * 1.375;               // 25% weight, max 137.5
  const p_txVolume = Math.min(txCount, 50) * 1.1;          // 10% weight, max 55
  const p_age = Math.min(agentAgeDays, 30) * 1.833;        // 10% weight, max 55
  const p_diversity = Math.min(diversity, 10) * 8.25;      // 15% weight, max 82.5
  const p_sessions = Math.min(successCount, 10) * 2.75;    // 5% weight, max 27.5

  const totalPoints = repaymentPoints + p_paymentRate + p_txVolume + p_age + p_diversity + p_sessions + tradingPoints;
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
      repayment: Math.round(repaymentPoints),
      trading: Math.round(tradingPoints)
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

/**
 * Computes an agent's credit score using Passport history as primary
 */
export async function computeScore(
  agentAddress: string,
  passportToken: string = process.env.PASSPORT_USER_JWT || ""
): Promise<ScoreResult> {

  // PRIMARY: Passport history (fast, complete, verified)
  const passportHistory = await getPassportHistory(
    agentAddress, passportToken
  );

  // FALLBACK: blockchain scan if Passport unavailable
  if (!passportHistory) {
    console.warn("Passport history unavailable — falling back to chain scan");
    return computeScoreLegacy(agentAddress);
  }

  // SUPPLEMENTARY: on-chain data Passport doesn't have
  const repaymentPoints = await scoreRepaymentHistory(agentAddress, provider);
  const tradingPoints   = await scoreTradingPerformance(agentAddress, provider);

  // COMPUTE
  const paymentPoints   = scorePaymentSuccess(passportHistory);
  const volumePoints    = scoreVolume(passportHistory);
  const diversityPoints = scoreDiversity(passportHistory);
  const agePoints       = scoreAge(passportHistory);
  const disciplinePoints = scoreSessionDiscipline(passportHistory);

  const finalScore = Math.min(850, Math.max(300,
    300 +
    repaymentPoints   +  // 35% — loan repayment (from chain)
    paymentPoints     +  // 25% — payment success (from Passport)
    diversityPoints   +  // 15% — service diversity (from Passport)
    agePoints         +  // 10% — account age (from Passport)
    tradingPoints     +  // 10% — trading performance (from chain)
    disciplinePoints     //  5% — session discipline (from Passport)
  ));

  const paymentRate = passportHistory.totalPayments > 0 
    ? Math.round((passportHistory.successfulPayments / passportHistory.totalPayments) * 100) 
    : 0;
  const uniquePayeesCount = new Set(passportHistory.uniquePayees).size;
  const now = Math.floor(Date.now() / 1000);
  const ageDays = Math.floor((now - passportHistory.firstPaymentAt) / 86400);

  return {
    score: Math.round(finalScore),
    paymentRate,
    diversity: uniquePayeesCount,
    txCount: passportHistory.totalPayments,
    agentAgeDays: ageDays,
    factors: {
      repayment:   Math.round(repaymentPoints),
      payment:     Math.round(paymentPoints),
      diversity:   Math.round(diversityPoints),
      age:         Math.round(agePoints),
      trading:     Math.round(tradingPoints),
      discipline:  Math.round(disciplinePoints)
    },
    sources: {
      passport: true,
      chainScan: false  // no longer needed as primary source
    }
  };
}
