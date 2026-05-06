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

export class KitePassportMCPClient {
  constructor(private url: string) {}

  async callTool(name: string, args: any): Promise<any> {
    const rpcPayload = {
      jsonrpc: "2.0",
      method: name,
      params: args,
      id: Date.now()
    };

    let attempt = 0;
    while (attempt < 3) {
      try {
        const res = await fetch(this.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rpcPayload)
        });

        if (!res.ok) throw new Error(`MCP returned ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error.message || "MCP RPC Error");
        return data.result;
      } catch (err: any) {
        attempt++;
        if (attempt >= 3) throw new Error(`MCP Tool ${name} failed: ${err.message}`);
        await new Promise(r => setTimeout(r, 2000)); // 2s backoff
      }
    }
  }
}

export async function refreshScoreViaPassport(agentAddr: string): Promise<any> {
  const mcpClient = new KitePassportMCPClient("https://neo.dev.gokite.ai/v1/mcp");
  const baseUrl = process.env.SCORE_API_URL || "https://agentscore.onrender.com";

  try {
    // Step 1: get payer address from Passport
    const { payer_addr } = await mcpClient.callTool('get_payer_addr', {});

    // Step 2: approve payment (0.01 PYUSD = 10000000000000000 wei)
    const auth = await mcpClient.callTool('approve_payment', {
      payer_addr,
      payee_addr: "0x55d829A66BB1D9f82923cBDEe355249EE5940365",
      amount: "10000000000000000",
      token_type: "PYUSD"
    });

    // Step 3: call oracle with X-Payment header
    const response = await fetch(
      `${baseUrl}/score/${agentAddr}`,
      { headers: { "X-Payment": auth.x_payment } }
    );

    if (!response.ok) throw new Error(`Oracle returned ${response.status}`);
    const data = await response.json();
    return data;
  } catch (err: any) {
    console.log(`[MCP] refreshScoreViaPassport failed: ${err.message}. Falling back to raw.`);
    // Fallback to raw endpoint
    try {
      return await getAgentScore(agentAddr);
    } catch {
      return null;
    }
  }
}
