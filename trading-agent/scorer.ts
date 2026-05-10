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

// ── Passport Session Reader ────────────────────────────────────
interface PassportSession {
  state: string;
  private_key: string;
  expires_at: string;
}

interface SessionsFile {
  current_session_id: string;
  sessions: Record<string, PassportSession>;
}

function getActivePassportSession(): { privateKey: string; payerAddr: string } | null {
  try {
    const sessionsPath = path.join(os.homedir(), ".kite-passport", "sessions.json");
    const raw = fs.readFileSync(sessionsPath, "utf-8");
    const data: SessionsFile = JSON.parse(raw);

    // Use current session first, then fall back to any active one
    const sessionId = data.current_session_id;
    const session = data.sessions[sessionId];

    if (session && session.state === "active" && new Date(session.expires_at) > new Date()) {
      const wallet = new ethers.Wallet(session.private_key);
      return { privateKey: session.private_key, payerAddr: wallet.address };
    }

    // Try any active session as fallback
    for (const [, s] of Object.entries(data.sessions)) {
      if (s.state === "active" && new Date(s.expires_at) > new Date()) {
        const wallet = new ethers.Wallet(s.private_key);
        return { privateKey: s.private_key, payerAddr: wallet.address };
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

    // Build and sign the x402 payment authorization
    const sessionWallet = new ethers.Wallet(session.privateKey);
    const messageHash = ethers.solidityPackedKeccak256(
      ["address", "address", "uint256", "address"],
      [payerAddr, payeeAddr, BigInt(amount), asset]
    );
    const signature = await sessionWallet.signMessage(ethers.getBytes(messageHash));

    const authorization = { payer: payerAddr, payee: payeeAddr, amount, asset };
    const xPayment = Buffer.from(JSON.stringify({ authorization, signature, network: "kite-testnet" })).toString("base64");

    console.log(`[PASSPORT] Signed x402 payment | payer: ${payerAddr.slice(0,10)}...`);

    // Call oracle with signed payment header
    const response = await fetch(
      `${baseUrl}/score/${agentAddr}`,
      { headers: { "X-Payment": xPayment } }
    );

    if (!response.ok) throw new Error(`Oracle returned ${response.status}`);
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

