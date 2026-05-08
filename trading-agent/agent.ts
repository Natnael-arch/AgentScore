import express        from "express";
import { WebSocketServer, WebSocket } from "ws";
import { ethers }     from "ethers";
import Anthropic      from "@anthropic-ai/sdk";
import * as dotenv    from "dotenv";
import { getAgentScore, AgentScoreData, refreshScoreViaPassport, scoreToMaxLoan, scoreToGrade, KitePassportMCPClient } from "./scorer";
import { getVaultContract, getVaultStats, getOpenPositionDetails, PositionData, VaultStats } from "./vault";
dotenv.config();

// ── Providers and wallets ─────────────────────────────────────
const provider  = new ethers.JsonRpcProvider(
  process.env.KITE_RPC_URL || "https://rpc-testnet.gokite.ai/"
);
const wallet    = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY!, provider);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Contract setup ────────────────────────────────────────────
const PYUSD     = process.env.PYUSD_ADDRESS || "0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9";
const PYUSD_ABI = [
  "function approve(address,uint256) external returns (bool)",
  "function balanceOf(address) external view returns (uint256)"
];
const LOAN_ABI  = ["function receiveIncome(uint256) external"];

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
  marketPrices:    Record<string, { price: number; change24h: number }>;
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

// ── Market data ───────────────────────────────────────────────
async function getMarketData() {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price" +
    "?ids=ethereum,bitcoin&vs_currencies=usd&include_24hr_change=true"
  );
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const d = await res.json();
  return {
    ETH: { price: d.ethereum.usd, change24h: d.ethereum.usd_24h_change },
    BTC: { price: d.bitcoin.usd,  change24h: d.bitcoin.usd_24h_change  }
  };
}

// ── Claude trade signal ───────────────────────────────────────
async function getTradeSignal(
  asset: string,
  price: number,
  change24h: number
): Promise<{ side: "LONG" | "SKIP"; reason: string }> {
  const msg = await anthropic.messages.create({
    model:      "claude-haiku-4-5-20251001",
    max_tokens: 100,
    messages: [{
      role:    "user",
      content: `You are an autonomous trading agent on Kite AI blockchain.
Asset: ${asset} | Price: $${price.toFixed(2)} | 24h: ${change24h.toFixed(2)}%
Capital at risk: $10 PYUSD | Stop loss: 3% | Take profit: 5%
Decide: LONG if clear positive momentum, SKIP if unclear.
JSON only: {"side":"LONG"|"SKIP","reason":"max 12 words"}`
    }]
  });

  try {
    const text  = msg.content[0].type === "text" ? msg.content[0].text : "{}";
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch (e: any) {
    return { side: "SKIP", reason: "API Error — skipping" };
  }
}

// ── Open position on TradeVault.sol ──────────────────────────
async function openPosition(
  asset: string,
  price: number
): Promise<void> {
  if (!vault) return;
  const priceInt = Math.round(price * 100);
  const sizeWei  = ethers.parseEther("10"); // $10 per trade

  const tx = await vault.openPosition(asset, 0, priceInt, sizeWei);
  await tx.wait();

  console.log(`[OPEN] LONG ${asset} @ $${price} | tx: ${tx.hash}`);
  addTx(tx.hash, `OPEN LONG ${asset} @ $${price.toFixed(2)}`);
}

// ── Check and close positions ─────────────────────────────────
async function managePositions(
  prices: Record<string, { price: number; change24h: number }>
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

    // Settle profit through loan agreement
    if (priceDiff > 0 && process.env.LOAN_AGREEMENT_ADDRESS) {
      await settlePnl(pnlWei);
    }
  }
}

// ── Settle profit through LoanAgreement ──────────────────────
async function settlePnl(amount: bigint): Promise<void> {
  if (!process.env.LOAN_AGREEMENT_ADDRESS || amount <= 0n) return;
  try {
    const loan = new ethers.Contract(
      process.env.LOAN_AGREEMENT_ADDRESS, LOAN_ABI, wallet
    );
    await (await pyusd.approve(process.env.LOAN_AGREEMENT_ADDRESS, amount)).wait();
    const tx = await loan.receiveIncome(amount);
    await tx.wait();
    console.log(`[REPAY] 30% to pool, 70% to agent | tx: ${tx.hash}`);
    addTx(tx.hash, "REPAY 30% to lending pool");
  } catch (e: any) {
    console.error(`[REPAY] Failed: ${e.message}`);
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
    console.log(`\n── Loop #${state.loopCount} | ETH $${prices.ETH.price.toFixed(2)}`);

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
      const { side, reason } = await getTradeSignal(
        "ETH", prices.ETH.price, prices.ETH.change24h
      );
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
  console.log(`\n🤖 KiteCredit Trading Agent`);
  console.log(`   Wallet:     ${wallet.address}`);
  console.log(`   Vault:      ${process.env.TRADE_VAULT_ADDRESS || "NOT SET"}`);
  console.log(`   HTTP:       http://localhost:${PORT}`);
  console.log(`   WebSocket:  ws://localhost:${WS_PORT}`);
  console.log(`   Explorer:   https://testnet.kitescan.ai/address/${wallet.address}\n`);

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
        sessionBudgetRemaining: res.session_budget
          ? ethers.formatUnits(res.session_budget, 18)
          : null
      }
    });
  } catch (e: any) {
    console.log(`[PASSPORT] MCP unavailable, using static address: ${e.message}`);
  }

  // Initial score fetch
  const scoreData = await getAgentScore(wallet.address);
  broadcast({ scoreData });

  // Run immediately then every 3 minutes
  await tradingLoop();
  setInterval(tradingLoop, 3 * 60 * 1000);
}

start().catch(console.error);
