import express        from "express";
import { WebSocketServer, WebSocket } from "ws";
import { ethers }     from "ethers";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv    from "dotenv";
import { getAgentScore, AgentScoreData, refreshScoreViaPassport, scoreToMaxLoan, scoreToGrade, KitePassportMCPClient } from "./scorer";
import { getVaultContract, getVaultStats, getOpenPositionDetails, openPositionWithAA, PositionData, VaultStats } from "./vault";
import { GokiteAASDK } from "gokite-aa-sdk";
dotenv.config();

// ── Providers and wallets ─────────────────────────────────────
const provider  = new ethers.JsonRpcProvider(
  process.env.KITE_RPC_URL || "https://rpc-testnet.gokite.ai/"
);
const wallet    = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY!, provider);
const genAI     = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

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

const pyusd = new ethers.Contract(PYUSD, PYUSD_ABI, wallet);
const vault = process.env.TRADE_VAULT_ADDRESS
  ? getVaultContract(process.env.TRADE_VAULT_ADDRESS, wallet)
  : null;

// ── Agent state (broadcast to dashboard) ─────────────────────
interface AgentState {
  agentAddress:    string;
  vaultAddress:    string;
  loopCount:       number;
  lastLoopAt:      string;
  scoreData:       AgentScoreData | null;
  marketPrices:    Record<string, { price: number; change4m: number; change12m: number; rsi: number; trend: string }>;
  lastSignal:      { asset: string; side: string; reason: string } | null;
  openPositions:   PositionData[];
  vaultStats:      VaultStats | null;
  recentTxs:       { hash: string; type: string; timestamp: string }[];
  status:          "RUNNING" | "WAITING" | "ERROR";
  error:           string | null;
  passport:        { verified: boolean; address: string | null; sessionBudgetRemaining: string | null } | null;
}

let state: AgentState = {
  agentAddress:  wallet.address,
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
  passport:      { verified: false, address: null, sessionBudgetRemaining: null }
};

// ── WebSocket server — broadcasts state to dashboard ──────────
const WS_PORT = Number(process.env.WS_PORT) || 4001;
const wss     = new WebSocketServer({ port: WS_PORT });
const clients = new Set<WebSocket>();

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: "state", data: state }));
  ws.on("close", () => clients.delete(ws));
  ws.on("error", () => clients.delete(ws));
});

function broadcast(update: Partial<AgentState>) {
  state = { ...state, ...update };
  const msg = JSON.stringify({ type: "state", data: state });
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

// ── Gemini trade signal (candle-based) ────────────────────────
async function getTradeSignal(
  asset: string,
  analysis: MarketAnalysis
): Promise<{ side: "LONG" | "SKIP"; reason: string }> {
  if (!process.env.GEMINI_API_KEY) {
    return { side: "SKIP", reason: "No Gemini key — set GEMINI_API_KEY" };
  }

  // Format recent candles for the prompt
  const candleTable = analysis.recentCandles.map(c =>
    `  ${new Date(c.time).toISOString().slice(11,19)} | O:${c.open.toFixed(2)} H:${c.high.toFixed(2)} L:${c.low.toFixed(2)} C:${c.close.toFixed(2)}`
  ).join("\n");

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `You are an autonomous trading agent on Kite AI blockchain.
You make decisions on 4-minute candles. Here is the current market data:

Asset: ${asset}
Current Price: $${analysis.price.toFixed(2)}
Last candle change: ${analysis.change4m.toFixed(3)}%
3-candle change (12min): ${analysis.change12m.toFixed(3)}%
RSI(14): ${analysis.rsi.toFixed(1)}
Short-term trend: ${analysis.trend}

Recent candles (time | OHLC):
${candleTable}

Rules:
- Capital at risk: $10 PYUSD per trade
- Stop loss: 3% | Take profit: 5%
- Go LONG if: RSI < 65 AND (3-candle change > 0.15% OR trend is UP with momentum)
- SKIP if: RSI > 70 (overbought) OR trend is DOWN OR momentum is flat/weak
- Be decisive — a mild uptrend with consistent green candles IS tradeable

Return ONLY valid JSON: {"side":"LONG" or "SKIP","reason":"max 15 words"}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const startIndex = text.indexOf('{');
    const endIndex = text.lastIndexOf('}');
    if (startIndex !== -1 && endIndex !== -1) {
      const clean = text.substring(startIndex, endIndex + 1);
      return JSON.parse(clean);
    }
    throw new Error("No JSON found in response");
  } catch (e: any) {
    console.error(`Gemini Error: ${e.message}`);
    return { side: "SKIP", reason: "Gemini error — skipping" };
  }
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

  const txHash = await openPositionWithAA(
    vaultAddr, wallet, asset, priceInt, sizeWei
  );

  console.log(`[OPEN] LONG ${asset} @ $${price} | tx: ${txHash}`);
  console.log(`       https://testnet.kitescan.ai/tx/${txHash}`);
  addTx(txHash, `OPEN LONG ${asset} @ $${price.toFixed(2)}`);
}

// ── Check and close positions ─────────────────────────────────
async function managePositions(
  prices: Record<string, MarketAnalysis>
): Promise<void> {
  if (!vault) return;
  const positions = await getOpenPositionDetails(vault);

  for (const pos of positions) {
    const currentPrice = prices[pos.asset]?.price ?? 0;
    if (!currentPrice) continue;

    const priceDiff  = (currentPrice - pos.entryPrice) / pos.entryPrice;
    const ageMinutes = (Date.now() / 1000 - pos.openedAt) / 60;
    const shouldClose =
      priceDiff >=  0.05 ||  // take profit
      priceDiff <= -0.03 ||  // stop loss
      ageMinutes >= 30;       // timeout

    if (!shouldClose) continue;

    const exitPriceInt = Math.round(currentPrice * 100);
    const pnlWei       = ethers.parseEther(
      (pos.sizeUSDC * priceDiff).toFixed(6)
    );
    const fakeTxBytes  = ethers.zeroPadBytes(
      ethers.toUtf8Bytes(`close-${pos.id}-${Date.now()}`), 32
    );

    const tx = await vault.closePosition(pos.id, exitPriceInt, pnlWei, fakeTxBytes);
    await tx.wait();

    const pnlDisplay = (pos.sizeUSDC * priceDiff).toFixed(4);
    const label      = priceDiff >= 0 ? `+${pnlDisplay}` : pnlDisplay;
    console.log(`[CLOSE] Position ${pos.id} | P&L: ${label} PYUSD | tx: ${tx.hash}`);
    addTx(tx.hash, `CLOSE ${pos.asset} P&L: ${label} PYUSD`);

    // Route profit through X402Processor (30% pool / 70% agent)
    if (priceDiff > 0 && process.env.X402_PROCESSOR_ADDRESS) {
      await settlePnl(pnlWei);
    } else if (priceDiff <= 0) {
      console.log(`[REPAY] Position closed at loss — no repayment this cycle`);
    }
  }
}

// ── Settle profit through X402Processor ───────────────────────
async function settlePnl(amount: bigint): Promise<void> {
  if (!process.env.X402_PROCESSOR_ADDRESS || amount <= 0n) return;
  try {
    const x402 = new ethers.Contract(
      process.env.X402_PROCESSOR_ADDRESS, X402_ABI, wallet
    );

    // Check allowance before approving — never double-approve
    const allowance = await pyusd.allowance(
      wallet.address,
      process.env.X402_PROCESSOR_ADDRESS
    );
    if (allowance < amount) {
      const approveTx = await pyusd.approve(
        process.env.X402_PROCESSOR_ADDRESS,
        ethers.MaxUint256
      );
      await approveTx.wait();
      console.log(`[REPAY] ✅ PYUSD approved for X402Processor`);
    }

    // Send full profit — contract splits 30% pool / 70% agent
    const tx = await x402.splitPayment(
      PYUSD,           // token
      wallet.address,  // targetAgent
      amount           // full profit amount
    );
    await tx.wait();

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
  state.loopCount++;
  broadcast({ status: "RUNNING", error: null, loopCount: state.loopCount });

  try {
    // 1. Fetch market prices
    const prices = await getMarketData();
    broadcast({ marketPrices: prices });
    const eth = prices.ETH;
    console.log(`\n── Loop #${state.loopCount} | ETH $${eth.price.toFixed(2)} | 4m: ${eth.change4m.toFixed(3)}% | 12m: ${eth.change12m.toFixed(3)}% | RSI: ${eth.rsi.toFixed(1)} | ${eth.trend}`);

    // 2. Manage existing positions
    await managePositions(prices);

    // 3. Refresh vault stats and open positions
    if (vault) {
      const [stats, positions] = await Promise.all([
        getVaultStats(vault),
        getOpenPositionDetails(vault)
      ]);
      broadcast({ vaultStats: stats, openPositions: positions });
    }

    // 4. Open new trade if no open positions
    if (state.openPositions.length === 0) {
      // TEST MODE — forces immediate LONG, bypasses Gemini
      const TEST_FORCE_TRADE = process.env.TEST_FORCE_TRADE === 'true';

      const { side, reason } = TEST_FORCE_TRADE
        ? { side: 'LONG' as const, reason: 'Test mode — forced trade to verify full loop' }
        : await getTradeSignal("ETH", prices.ETH);
      
      broadcast({ lastSignal: { asset: "ETH", side, reason } });
      console.log(`[SIGNAL] ETH: ${side} — ${reason}`);

      if (side === "LONG") {
        await openPosition("ETH", prices.ETH.price);
        const positions = vault ? await getOpenPositionDetails(vault) : [];
        broadcast({ openPositions: positions });
      }
    }

    // 5. Refresh agent score every 5 loops
    if (state.loopCount % 5 === 0) {
      const result = await refreshScoreViaPassport(wallet.address);
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

  // Try MCP for live session budget
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
  } catch (e: any) {
    console.log(`[PASSPORT] MCP unavailable, using static address: ${e.message}`);
  }

  // Initial score fetch
  const scoreData = await getAgentScore(wallet.address);
  broadcast({ scoreData });

  // Run immediately then every 3 minutes
  await tradingLoop();
  setInterval(tradingLoop, 4 * 60 * 1000); // 4-minute candle interval
}

start().catch(console.error);
