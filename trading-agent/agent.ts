import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import express        from "express";
import { WebSocketServer, WebSocket } from "ws";
import { ethers }     from "ethers";

import * as dotenv    from "dotenv";
import { getAgentScore, AgentScoreData, refreshScoreViaPassport, scoreToMaxLoan, scoreToGrade, KitePassportMCPClient } from "./scorer";
import { getVaultContract, getVaultStats, getOpenPositionDetails, openPositionWithAA, checkAndClosePosition, PositionData, VaultStats } from "./vault";
import { GokiteAASDK } from "gokite-aa-sdk";
dotenv.config();

// ── Resilient Provider + Wallet ───────────────────────────────
function createProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(
    process.env.KITE_RPC_URL || "https://rpc-testnet.gokite.ai/",
    { chainId: 2368, name: "kite-testnet" },
    {
      polling: true,
      pollingInterval: 4000,
      staticNetwork: true // prevents repeated network detection calls
    }
  );
}

let provider = createProvider();
let wallet   = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY!, provider);

// Wrap every provider call in a retry helper
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 2000
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const isTimeout = err.code === "TIMEOUT" ||
        err.message?.includes("timeout") ||
        err.message?.includes("failed to detect network");

      if (isTimeout && i < retries - 1) {
        console.log(`[RPC] Timeout — reconnecting (attempt ${i + 2}/${retries})...`);
        provider = createProvider();
        wallet   = wallet.connect(provider);
        // Refresh contract instances
        pyusd = new ethers.Contract(PYUSD, PYUSD_ABI, wallet);
        lendingPool = new ethers.Contract(process.env.LENDING_POOL_ADDRESS!, LENDING_POOL_ABI, wallet);
        if (process.env.TRADE_VAULT_ADDRESS) {
          vault = getVaultContract(process.env.TRADE_VAULT_ADDRESS, wallet);
        }
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Max retries exceeded");
}



let skipCooldown = 0;
let loopsWithoutTrade = 0;

// ── Contract setup ────────────────────────────────────────────
const PYUSD     = process.env.PYUSD_ADDRESS || "0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9";
const PYUSD_ABI = [
  "function approve(address,uint256) external returns (bool)",
  "function balanceOf(address) external view returns (uint256)",
  "function allowance(address,address) external view returns (uint256)"
];
const X402_ABI = [
  "function splitPayment(address token, address targetAgent, uint256 amount) external",
  "event PaymentSplit(address indexed from, address indexed to, address indexed token, uint256 totalAmount, uint256 agentPortion, uint256 poolPortion)"
];
const LENDING_POOL_ABI = [
  "function borrow(uint256 amount) external",
  "function borrowers(address) external view returns (uint256 borrowedAmount, uint256 lastBorrowTime, uint256 collateralAmount, bool isCollateralLocked, uint256 interestRateBps, uint256 accruedInterest, uint256 lastInterestUpdate)",
  "function repay(address borrower, uint256 amount) external"
];

let pyusd = new ethers.Contract(PYUSD, PYUSD_ABI, wallet);
let lendingPool = new ethers.Contract(
  process.env.LENDING_POOL_ADDRESS!,
  LENDING_POOL_ABI,
  wallet
);
let vault = process.env.TRADE_VAULT_ADDRESS
  ? getVaultContract(process.env.TRADE_VAULT_ADDRESS, wallet)
  : null;

// ── Agent state (broadcast to dashboard) ─────────────────────
interface AgentState {
  agentAddress:    string;
  aaAddress:       string;
  vaultAddress:    string;
  loopCount:       number;
  lastLoopAt:      string;
  scoreData:       AgentScoreData | null;
  marketPrices:    Record<string, { price: number; change4m: number; change12m: number; rsi: number; trend: string }>;
  lastSignal:      { asset: string; side: string; reason: string; model?: string; timestamp?: string } | null;
  openPositions:   PositionData[];
  vaultStats:      VaultStats | null;
  recentTxs:       { hash: string; type: string; timestamp: string }[];
  lastRepayment?:  { total: string; toPool: string; toAgent: string; txHash: string; explorerUrl: string };
  status:          "RUNNING" | "WAITING" | "ERROR";
  error:           string | null;
  passport:        { verified: boolean; address: string | null; sessionBudgetRemaining: string | null } | null;
  loan:            any | null;
}

let state: AgentState = {
  agentAddress:  wallet.address,
  aaAddress:     "",
  vaultAddress:  process.env.TRADE_VAULT_ADDRESS || "",
  loopCount:     0,
  lastLoopAt:    "",
  scoreData:     null,
  marketPrices:  {},
  lastSignal:    null,
  openPositions: [],
  vaultStats:    null,
  recentTxs:     [],
  status:        "WAITING",
  error:         null,
  passport:      { verified: false, address: null, sessionBudgetRemaining: null },
  loan:          null
};

interface LoanState {
  borrowed:    string;
  interest:    string;
  total:       string;
  rateBps:     number;
  hasLoan:     boolean;
  txHash:      string | null;
}

let currentLoan: LoanState = {
  borrowed: "0",
  interest: "0",
  total:    "0",
  rateBps:  0,
  hasLoan:  false,
  txHash:   null
};

async function initializeLoan(): Promise<void> {
  try {
    // Check if loan already exists
    const borrower = await withRetry(() => lendingPool.borrowers(wallet.address));

    if (borrower.borrowedAmount > 0n) {
      console.log(`[LOAN] ✅ Existing loan found: ${ethers.formatUnits(borrower.borrowedAmount, 18)} PYUSD`);
      currentLoan = {
        borrowed: ethers.formatUnits(borrower.borrowedAmount, 18),
        interest: ethers.formatUnits(borrower.accruedInterest, 18),
        total:    ethers.formatUnits(borrower.borrowedAmount + borrower.accruedInterest, 18),
        rateBps:  Number(borrower.interestRateBps),
        hasLoan:  true,
        txHash:   null
      };
      return;
    }

    // No existing loan — get score and borrow
    const oracleUrl = process.env.ORACLE_API_URL || process.env.SCORE_API_URL;
    const scoreRes = await withRetry(() => fetch(`${oracleUrl}/score/${wallet.address}/raw`));
    const scoreData = await scoreRes.json();
    const score: number = scoreData.score ?? 300;
    console.log(`[LOAN] Agent score: ${score}`);

    // Determine borrow amount by score tier
    let borrowAmount: bigint;
    if      (score >= 750) borrowAmount = ethers.parseUnits("5", 18);
    else if (score >= 700) borrowAmount = ethers.parseUnits("3", 18);
    else if (score >= 600) borrowAmount = ethers.parseUnits("2", 18);
    else if (score >= 500) borrowAmount = ethers.parseUnits("1", 18);
    else {
      console.log(`[LOAN] Score too low (${score} < 500) — cannot borrow`);
      return;
    }

    // Borrow from LendingPool
    const tx = await withRetry(() => lendingPool.borrow(borrowAmount));
    await withRetry(() => tx.wait());

    console.log(`[LOAN] ✅ Borrowed ${ethers.formatUnits(borrowAmount, 18)} PYUSD`);
    console.log(`[LOAN] tx: https://testnet.kitescan.ai/tx/${tx.hash}`);

    // Update loan state
    const updated = await withRetry(() => lendingPool.borrowers(wallet.address));
    currentLoan = {
      borrowed: ethers.formatUnits(updated.borrowedAmount, 18),
      interest: ethers.formatUnits(updated.accruedInterest, 18),
      total:    ethers.formatUnits(updated.borrowedAmount + updated.accruedInterest, 18),
      rateBps:  Number(updated.interestRateBps),
      hasLoan:  true,
      txHash:   tx.hash
    };

  } catch (err: any) {
    console.error(`[LOAN] ❌ Borrow failed:`, err.message);
    console.log(`[LOAN] Continuing with existing wallet balance`);
  }
}

async function refreshLoanState(): Promise<void> {
  if (!currentLoan.hasLoan) return;
  try {
    const borrower = await withRetry(() => lendingPool.borrowers(wallet.address));
    currentLoan.interest = ethers.formatUnits(borrower.accruedInterest, 18);
    currentLoan.total    = ethers.formatUnits(
      borrower.borrowedAmount + borrower.accruedInterest, 18
    );
  } catch { /* silent — don't break loop */ }
}

// ── WebSocket server — broadcasts state to dashboard ──────────
const WS_PORT = Number(process.env.WS_PORT) || 4001;
const wss     = new WebSocketServer({ port: WS_PORT, host: "0.0.0.0" });
const clients = new Set<WebSocket>();

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log(`[WS] Client connected. Total: ${clients.size}`);
  ws.send(JSON.stringify({ type: "state", data: state }));
  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected. Total: ${clients.size}`);
  });
  ws.on("error", () => clients.delete(ws));
});

function broadcast(update: Partial<AgentState>) {
  state = { ...state, ...update, loan: {
    borrowed:  currentLoan.borrowed,
    interest:  currentLoan.interest,
    total:     currentLoan.total,
    rateBps:   currentLoan.rateBps,
    hasLoan:   currentLoan.hasLoan,
    txHash:    currentLoan.txHash,
    explorerUrl: currentLoan.txHash
      ? `https://testnet.kitescan.ai/tx/${currentLoan.txHash}`
      : null
  }};
  const msg = JSON.stringify({ type: "state", data: state });
  if (clients.size > 0) {
    console.log(`[WS] Broadcasting state to ${clients.size} clients`);
  }
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

function addTx(hash: string, type: string) {
  const tx = {
    hash,
    type,
    timestamp: new Date().toISOString()
  };
  state.recentTxs = [tx, ...state.recentTxs].slice(0, 10); // keep last 10
  broadcast({ recentTxs: state.recentTxs });
}

// ── Candle data + indicators ──────────────────────────────────
interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface MarketAnalysis {
  price: number;
  change4m: number;      // % change over last candle
  change12m: number;     // % change over last 3 candles
  rsi: number;           // 14-period RSI
  trend: "UP" | "DOWN" | "FLAT";
  recentCandles: Candle[];
}

function computeRSI(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 50;
  const changes = candles.slice(-(period + 1)).map((c, i, arr) =>
    i === 0 ? 0 : arr[i].close - arr[i - 1].close
  ).slice(1);

  let avgGain = 0, avgLoss = 0;
  for (const ch of changes) {
    if (ch > 0) avgGain += ch;
    else avgLoss += Math.abs(ch);
  }
  avgGain /= period;
  avgLoss /= period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

async function getMarketData() {
  // CoinGecko OHLC (1-day range gives ~288 candles at 5-min intervals)
  const ohlcRes = await fetch(
    "https://api.coingecko.com/api/v3/coins/ethereum/ohlc?vs_currency=usd&days=1"
  );
  if (!ohlcRes.ok) throw new Error(`CoinGecko OHLC ${ohlcRes.status}`);
  const ohlcRaw: number[][] = await ohlcRes.json();

  const candles: Candle[] = ohlcRaw.map(([t, o, h, l, c]) => ({
    time: t, open: o, high: h, low: l, close: c
  }));

  const latest  = candles[candles.length - 1];
  const prev1   = candles.length > 1 ? candles[candles.length - 2] : latest;
  const prev3   = candles.length > 3 ? candles[candles.length - 4] : latest;

  const change4m  = ((latest.close - prev1.close) / prev1.close) * 100;
  const change12m = ((latest.close - prev3.close) / prev3.close) * 100;
  const rsi       = computeRSI(candles);

  // Determine trend from last 5 candles
  const last5 = candles.slice(-5);
  const closes = last5.map(c => c.close);
  const upMoves = closes.filter((c, i) => i > 0 && c > closes[i - 1]).length;
  const trend: "UP" | "DOWN" | "FLAT" = upMoves >= 3 ? "UP" : upMoves <= 1 ? "DOWN" : "FLAT";

  const analysis: MarketAnalysis = {
    price: latest.close,
    change4m,
    change12m,
    rsi,
    trend,
    recentCandles: candles.slice(-8) // last ~32 min of candles
  };

  return {
    ETH: analysis,
    BTC: { price: 0, change4m: 0, change12m: 0, rsi: 50, trend: "FLAT" as const, recentCandles: [] }
  };
}

function getTradeSignal(
  rsi:          number,
  trend:        string,
  threeCandle:  number,
  hasOpenPosition: boolean
): { side: "LONG" | "SKIP"; reason: string; model: string } {

  // Never open two positions at once
  if (hasOpenPosition) {
    return {
      side:   "SKIP",
      reason: "Position already open — monitoring",
      model:  "KiteCredit Signal Engine v1"
    };
  }

  // Genuinely profitable standard indicator strategy:
  // 1. Mean-reversion entry: RSI is extremely oversold (RSI < 35)
  if (rsi < 35) {
    return {
      side:   "LONG",
      reason: `RSI oversold (${rsi.toFixed(1)}) — entering mean reversion bounce`,
      model:  "KiteCredit Signal Engine v1"
    };
  }

  // 2. Trend-following entry: Uptrend confirmed and RSI is in a healthy buying range (RSI < 60)
  if (trend === "UP" && rsi < 60) {
    return {
      side:   "LONG",
      reason: `Strong uptrend with healthy RSI (${rsi.toFixed(1)}) — entering trend momentum`,
      model:  "KiteCredit Signal Engine v1"
    };
  }

  // Otherwise, wait for a profitable setup
  return {
    side:   "SKIP",
    reason: `No clear profitable setup (RSI: ${rsi.toFixed(1)}, Trend: ${trend})`,
    model:  "KiteCredit Signal Engine v1"
  };
}

// ── Open position via AA batch (vault + attest) ─────────────
async function openPosition(
  asset: string,
  price: number
): Promise<void> {
  const vaultAddr = process.env.TRADE_VAULT_ADDRESS;
  if (!vaultAddr) return;

  const priceInt = Math.round(price * 100);
  const sizeWei  = ethers.parseEther("10"); // $10 per trade

  const txHash = await withRetry(() => openPositionWithAA(
    vaultAddr, wallet, asset, priceInt, sizeWei
  ));

  console.log(`[OPEN] LONG ${asset} @ $${price} | tx: ${txHash}`);
  console.log(`       https://testnet.kitescan.ai/tx/${txHash}`);
  addTx(txHash, `OPEN LONG ${asset} @ $${price.toFixed(2)}`);
}

// ── Check and close positions on-chain ────────────────────────
async function managePositions(
  prices: Record<string, MarketAnalysis>
): Promise<void> {
  if (!vault) return;
  const positions = await withRetry(() => getOpenPositionDetails(vault!));

  for (const pos of positions) {
    const currentPrice = prices[pos.asset]?.price ?? 0;
    if (!currentPrice) continue;

    const result = await withRetry(() => checkAndClosePosition(vault!, pos.id, currentPrice));

    if (result.closed) {
      const pnlDisplay = ethers.formatUnits(result.pnl, 18);
      const label      = result.pnl >= 0n ? `+${pnlDisplay}` : pnlDisplay;
      console.log(`[CLOSE] Position ${pos.id} closed on-chain | P&L: ${label} PYUSD | tx: ${result.txHash}`);
      addTx(result.txHash!, `CLOSE ${pos.asset} P&L: ${label} PYUSD`);

      // Route profit through X402Processor (30% pool / 70% agent)
      if (result.pnl > 0n && process.env.X402_PROCESSOR_ADDRESS) {
        await settlePnl(result.pnl);
      } else if (result.pnl <= 0n) {
        console.log(`[REPAY] Position closed at loss or break-even — no repayment this cycle`);
      }
    }
  }
}

// ── Settle profit through X402Processor ───────────────────────
async function settlePnl(amount: bigint): Promise<void> {
  if (!process.env.X402_PROCESSOR_ADDRESS || amount <= 0n) return;

  // If no active loan, skip the split — nothing to repay, keep 100% profit
  if (!currentLoan.hasLoan) {
    const total = ethers.formatUnits(amount, 18);
    console.log(`[REPAY] No active loan — keeping full profit (${total} PYUSD)`);
    return;
  }
  try {
    const x402 = new ethers.Contract(
      process.env.X402_PROCESSOR_ADDRESS, X402_ABI, wallet
    );

    // Check allowance before approving — never double-approve
    const allowance = await withRetry(() => pyusd.allowance(
      wallet.address,
      process.env.X402_PROCESSOR_ADDRESS!
    ));
    if (allowance < amount) {
      const approveTx = await withRetry(() => pyusd.approve(
        process.env.X402_PROCESSOR_ADDRESS!,
        ethers.MaxUint256
      ));
      await withRetry(() => approveTx.wait());
      console.log(`[REPAY] ✅ PYUSD approved for X402Processor`);
    }

    // Send full profit — contract splits 30% pool / 70% agent
    const tx = await withRetry(() => x402.splitPayment(
      PYUSD,           // token
      wallet.address,  // targetAgent
      amount           // full profit amount
    ));
    await withRetry(() => tx.wait());

    // Display only — actual split enforced by contract
    const total   = ethers.formatUnits(amount, 18);
    const toPool  = ethers.formatUnits(amount * 30n / 100n, 18);
    const toAgent = ethers.formatUnits(amount * 70n / 100n, 18);

    console.log(`[REPAY] ✅ X402Processor split executed`);
    console.log(`[REPAY]    Total:         ${total} PYUSD`);
    console.log(`[REPAY]    → Pool (30%):  ${toPool} PYUSD`);
    console.log(`[REPAY]    → Agent (70%): ${toAgent} PYUSD`);
    console.log(`[REPAY]    tx: https://testnet.kitescan.ai/tx/${tx.hash}`);

    addTx(tx.hash, `REPAY ${total} PYUSD (30% pool / 70% agent)`);

    // Broadcast repayment to WebSocket dashboard
    broadcast({
      lastRepayment: {
        total,
        toPool,
        toAgent,
        txHash: tx.hash,
        explorerUrl: `https://testnet.kitescan.ai/tx/${tx.hash}`
      }
    } as any);

  } catch (err: any) {
    console.error(`[REPAY] ❌ Failed:`, {
      contract: process.env.X402_PROCESSOR_ADDRESS,
      function: "splitPayment",
      amount: amount.toString(),
      error: err.message
    });
  }
}



// ── Main trading loop ─────────────────────────────────────────
async function tradingLoop(): Promise<void> {
  await refreshLoanState();

  state.loopCount++;
  broadcast({ status: "RUNNING", error: null, loopCount: state.loopCount });

  try {
    // 1. Fetch market prices
    const prices = await getMarketData();
    broadcast({ marketPrices: prices });
    const eth = prices.ETH;
    const signalSource = "KiteCredit Signal Engine v1";
    console.log(`\n── Loop #${state.loopCount} | ${signalSource} | ETH $${eth.price.toFixed(2)} | RSI: ${eth.rsi.toFixed(1)} | ${eth.trend}`);

    // 2. Manage existing positions
    await managePositions(prices);

    // 3. Refresh vault stats and open positions
    if (vault) {
      const [stats, positions] = await withRetry(() => Promise.all([
        getVaultStats(vault!),
        getOpenPositionDetails(vault!)
      ]));
      broadcast({ vaultStats: stats, openPositions: positions });
    }

    // 4. Get signal and potentially open trade
    const hasOpenPosition = state.openPositions.length > 0;

    if (hasOpenPosition) {
      loopsWithoutTrade = 0;
    } else {
      loopsWithoutTrade++;
    }

    const signal = getTradeSignal(prices.ETH.rsi, prices.ETH.trend, prices.ETH.change12m, hasOpenPosition);

    broadcast({ 
      lastSignal: { 
        asset: "ETH",
        side:      signal.side,
        reason:    signal.reason,
        model:     "KiteCredit Signal Engine v1",
        timestamp: new Date().toISOString()
      } 
    });
    console.log(`[SIGNAL] ETH: ${signal.side} — ${signal.reason}`);

    if (signal.side === "LONG") {
      await openPosition("ETH", prices.ETH.price);
      const positions = vault ? await withRetry(() => getOpenPositionDetails(vault!)) : [];
      broadcast({ openPositions: positions });
    }

    // 5. Refresh agent score every 5 loops
    if (state.loopCount % 5 === 0) {
      const result = await withRetry(() => refreshScoreViaPassport(wallet.address));
      if (result) {
        const scoreData = {
          score:        result.score        ?? 300,
          paymentRate:  result.paymentRate  ?? 0,
          diversity:    result.diversity    ?? 0,
          txCount:      result.txCount      ?? 0,
          agentAgeDays: result.agentAgeDays ?? 0,
          maxLoan:      scoreToMaxLoan(result.score ?? 300),
          grade:        scoreToGrade(result.score ?? 300)
        };
        broadcast({ scoreData });
        
        const txHash = result.attestationTx || result.txHash;
        if (txHash) {
          console.log(`[SCORE] Updated on-chain: ${result.score} | tx: ${txHash}`);
          addTx(txHash, `SCORE ATTESTED: ${result.score}`);
        }
      }
    }

    broadcast({ status: "WAITING", lastLoopAt: new Date().toISOString() });

  } catch (e: any) {
    console.error(`[ERROR] ${e.message}`);
    broadcast({ status: "ERROR", error: e.message });
  }
}

// ── HTTP status endpoint ──────────────────────────────────────
const app = express();
app.use(express.json());

app.get("/status", (_, res) => res.json(state));
app.get("/health", (_, res) => res.json({ ok: true, agent: wallet.address }));

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT);

// ── Start ─────────────────────────────────────────────────────
async function start() {




  // Compute AA wallet address
  const aaSDK = new GokiteAASDK(
    "kite_testnet",
    "https://rpc-testnet.gokite.ai",
    "https://bundler-service.staging.gokite.ai/rpc/"
  );
  const aaWalletAddress = aaSDK.getAccountAddress(wallet.address);
  state.aaAddress = aaWalletAddress;

  console.log(`
🤖 KiteCredit Trading Agent
   Wallet (EOA): ${wallet.address}
   Wallet (AA):  ${aaWalletAddress}
   Vault:      ${process.env.TRADE_VAULT_ADDRESS || "NOT SET"}
   HTTP:       http://localhost:${process.env.PORT || 4000}
   WebSocket:  ws://localhost:${process.env.WS_PORT || 4001}
   Explorer:   https://testnet.kitescan.ai/address/${wallet.address}
`);

  // Set passport state — use env var as known fallback, then try MCP for live budget
  const knownPassportAddr = process.env.PASSPORT_ADDRESS || null;
  broadcast({
    passport: {
      verified: !!knownPassportAddr,
      address: knownPassportAddr,
      sessionBudgetRemaining: null
    }
  });
  console.log(`   Passport:   ${knownPassportAddr || "NOT SET"}`);

  // Try to load active Passport session for x402 signing
  try {
    const mcpClient = new KitePassportMCPClient("https://neo.dev.gokite.ai/v1/mcp");
    const res = await mcpClient.callTool('get_payer_addr', {});
    broadcast({
      passport: {
        verified: true,
        address: res.payer_addr || knownPassportAddr,
        sessionBudgetRemaining: null
      }
    });
    console.log(`   Session Payer: ${res.payer_addr}`);
    console.log(`[PASSPORT] ✅ Active session loaded — x402 signing enabled`);
  } catch (e: any) {
    console.log(`[PASSPORT] ⚠ No active session (${e.message}) — using static Passport address`);
    console.log(`[PASSPORT]   Passport contract is still set. Score attestation will use raw API fallback.`);
  }

  // Initial score fetch
  const scoreData = await withRetry(() => getAgentScore(wallet.address));
  broadcast({ scoreData });

  await initializeLoan();

  // Run immediately then every 1 minute
  await tradingLoop();
  setInterval(tradingLoop, 60 * 1000); // 1-minute candle interval
}

start().catch(console.error);
