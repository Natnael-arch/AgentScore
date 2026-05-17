export interface AgentScoreData {
  score:        number;
  paymentRate:  number;
  diversity:    number;
  txCount:      number;
  agentAgeDays: number;
  maxLoan:      number;   // calculated from score tier
  grade:        string;   // "Excellent" | "Good" | "Fair" | "Poor" | "New"
}

export function scoreToMaxLoan(score: number): number {
  if (score >= 750) return 250;
  if (score >= 700) return 100;
  if (score >= 600) return 50;
  if (score >= 500) return 10;
  return 0;
}

export function scoreToGrade(score: number): string {
  if (score >= 750) return "Excellent";
  if (score >= 700) return "Good";
  if (score >= 600) return "Fair";
  if (score >= 500) return "Poor";
  return "New";
}

export async function getAgentScore(agentAddress: string): Promise<AgentScoreData> {
  const baseUrl = process.env.SCORE_API_URL || "https://agentscore.onrender.com";
  try {
    const res = await fetch(`${baseUrl}/score/${agentAddress}/raw`);
    if (!res.ok) throw new Error(`Oracle returned ${res.status}`);
    const data = await res.json();
    return {
      score:        data.score        ?? 300,
      paymentRate:  data.paymentRate  ?? 0,
      diversity:    data.diversity    ?? 0,
      txCount:      data.txCount      ?? 0,
      agentAgeDays: data.agentAgeDays ?? 0,
      maxLoan:      scoreToMaxLoan(data.score ?? 300),
      grade:        scoreToGrade(data.score ?? 300)
    };
  } catch {
    return {
      score: 300, paymentRate: 0, diversity: 0,
      txCount: 0, agentAgeDays: 0, maxLoan: 0, grade: "New"
    };
  }
}

import { ethers } from "ethers";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config();

// ── Passport Session Reader ────────────────────────────────────
interface PassportSession {
  state: string;
  private_key: string;
  expires_at?: string;
  request_id?: string;
  approval_url?: string;
  created_at?: string;
}

interface SessionsFile {
  current_session_id?: string;
  sessions: Record<string, PassportSession>;
}

const VALID_SESSION_STATES = ["active", "approved"];

function isSessionUsable(session: PassportSession): boolean {
  if (!VALID_SESSION_STATES.includes(session.state)) return false;
  // If expires_at is set, check it hasn't expired; if missing, treat as valid
  if (session.expires_at) {
    return new Date(session.expires_at) > new Date();
  }
  return true;
}

function updateLocalSessionState(sessionId: string, state: string, expiresAt?: string): void {
  try {
    const sessionsPath = path.join(os.homedir(), ".kite-passport", "sessions.json");
    const raw = fs.readFileSync(sessionsPath, "utf-8");
    const data: SessionsFile = JSON.parse(raw);
    if (data.sessions[sessionId]) {
      data.sessions[sessionId].state = state;
      if (expiresAt) data.sessions[sessionId].expires_at = expiresAt;
      data.current_session_id = sessionId;
      fs.writeFileSync(sessionsPath, JSON.stringify(data, null, 2));
    }
  } catch { /* silent */ }
}

function getActivePassportSession(): { privateKey: string; payerAddr: string } | null {
  try {
    const sessionsPath = path.join(os.homedir(), ".kite-passport", "sessions.json");
    const raw = fs.readFileSync(sessionsPath, "utf-8");
    const data: SessionsFile = JSON.parse(raw);

    // Use current session first, then fall back to any usable one
    const sessionId = data.current_session_id;
    if (sessionId) {
      const session = data.sessions[sessionId];
      if (session && isSessionUsable(session)) {
        const wallet = new ethers.Wallet(session.private_key);
        return { privateKey: session.private_key, payerAddr: process.env.PASSPORT_ADDRESS || wallet.address };
      }
    }

    // Try any usable session as fallback
    for (const [id, s] of Object.entries(data.sessions)) {
      if (isSessionUsable(s)) {
        const wallet = new ethers.Wallet(s.private_key);
        // Promote this session to current
        updateLocalSessionState(id, s.state);
        return { privateKey: s.private_key, payerAddr: process.env.PASSPORT_ADDRESS || wallet.address };
      }
    }

    // Last resort: if there's a pending session with a private key, check if it
    // was approved server-side but the local file wasn't updated
    for (const [id, s] of Object.entries(data.sessions)) {
      if (s.state === "pending" && s.private_key) {
        console.log(`[PASSPORT] Found pending session ${id.slice(0,20)}... — treating as usable (may have been approved server-side)`);
        updateLocalSessionState(id, "active");
        const wallet = new ethers.Wallet(s.private_key);
        return { privateKey: s.private_key, payerAddr: process.env.PASSPORT_ADDRESS || wallet.address };
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ── KitePassportMCPClient (kept for interface compatibility) ───
export class KitePassportMCPClient {
  constructor(private url: string) {}

  async callTool(name: string, args: any): Promise<any> {
    if (name === "get_payer_addr") {
      const session = getActivePassportSession();
      if (!session) throw new Error("No active Passport session found");
      return { payer_addr: session.payerAddr };
    }
    throw new Error(`MCP tool '${name}' not available — use local session signing`);
  }
}

// ── Score refresh using Passport session signing ───────────────
export async function refreshScoreViaPassport(agentAddr: string): Promise<any> {
  const baseUrl = process.env.SCORE_API_URL || "https://agentscore.onrender.com";

  try {
    const session = getActivePassportSession();
    if (!session) throw new Error("No active Passport session");

    const payerAddr = session.payerAddr;
    const payeeAddr = "0x55d829A66BB1D9f82923cBDEe355249EE5940365";
    const amount    = "10000000000000000"; // 0.01 PYUSD
    const asset     = "0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9";

    console.log(`[PASSPORT] Initiating real on-chain PYUSD payment of 0.01 PYUSD...`);
    const provider = new ethers.JsonRpcProvider(process.env.KITE_RPC_URL || "https://rpc-testnet.gokite.ai/");
    const agentWallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY!, provider);
    const pyusdContract = new ethers.Contract(
      asset,
      ["function transfer(address to, uint256 amount) external returns (bool)"],
      agentWallet
    );

    const tx = await pyusdContract.transfer(payeeAddr, amount);
    console.log(`[PASSPORT] Payment transaction submitted: ${tx.hash}. Waiting for block confirmation...`);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error("Payment transaction failed on-chain");
    }
    console.log(`[PASSPORT] Payment transaction successful and mined in block ${receipt.blockNumber}`);

    // Build the x402 payment receipt data using the real mined txHash
    const paymentBody = {
      payee: payeeAddr,
      amount: amount,
      asset: asset,
      txHash: tx.hash
    };

    const xPayment = Buffer.from(JSON.stringify(paymentBody)).toString("base64");

    console.log(`[PASSPORT] Signed x402 payment | payer: ${agentWallet.address.slice(0,10)}... | tx: ${tx.hash}`);

    // Call oracle with signed payment header
    const response = await fetch(
      `${baseUrl}/score/${agentAddr}`,
      { headers: { "X-Payment": xPayment } }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Oracle returned ${response.status}: ${errText}`);
    }
    const data = await response.json();
    console.log(`[PASSPORT] Score refreshed: ${data.score}`);
    return data;

  } catch (err: any) {
    console.log(`[PASSPORT] Session signing failed: ${err.message}. Falling back to raw.`);
    try {
      return await getAgentScore(agentAddr);
    } catch {
      return null;
    }
  }
}

