import express from "express";
import cors from "cors";
import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
const PORT = 4000;

app.use(cors());
app.use(express.json());

// Hardware/Contract Config
const RPC_URL = process.env.KITE_RPC_URL || "https://rpc-testnet.gokite.ai/";
const AGENT_KEY = process.env.AGENT_PRIVATE_KEY;
const LOAN_AGREEMENT_ADDRESS = process.env.LOAN_AGREEMENT_ADDRESS;
const SCORE_API_URL = process.env.SCORE_API_URL || "http://localhost:3001";
const PYUSD_ADDRESS = "0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9";

if (!AGENT_KEY) throw new Error("Missing AGENT_PRIVATE_KEY");

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(AGENT_KEY, provider);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({ 
  model: "gemini-2.5-flash",
  systemInstruction: "You are a concise summariser. Return exactly 3 sentences."
});

// ABIs
const ERC20_ABI = ["function approve(address spender, uint256 amount) external returns (bool)"];
const LOAN_ABI = ["function receiveIncome(uint256 incomeAmount) external"];

let requestCounter = 0;

/**
 * Summarize URL using Claude Haiku
 */
async function summariseUrl(url: string): Promise<string> {
  console.log(`\n🌐 Fetching URL: ${url}`);
  const response = await fetch(url);
  const html = await response.text();
  
  const cleanText = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 3000);

  console.log("  🤖 Requesting summary from Gemini...");
  const msg = await model.generateContent(`Summarise this:\n\n${cleanText}`);

  return msg.response.text();
}

/**
 * Route income to the LoanAgreement
 */
async function routeIncomeToLoan(amountWei: string) {
  if (!LOAN_AGREEMENT_ADDRESS) {
    console.warn("  ⚠️ No LOAN_AGREEMENT_ADDRESS set, skipping repayment logic.");
    return null;
  }

  console.log(`  💰 Routing ${amountWei} income through LoanAgreement...`);
  const pyusd = new ethers.Contract(PYUSD_ADDRESS, ERC20_ABI, wallet);
  const loan = new ethers.Contract(LOAN_AGREEMENT_ADDRESS, LOAN_ABI, wallet);

  console.log("    - Approving PYUSD...");
  const appTx = await pyusd.approve(LOAN_AGREEMENT_ADDRESS, amountWei);
  await appTx.wait();

  console.log("    - Calling receiveIncome...");
  const recTx = await loan.receiveIncome(amountWei);
  await recTx.wait();

  return recTx.hash;
}

/**
 * Trigger scoring of self via the Score API
 */
async function payForOwnScore() {
  console.log("\n📈 Triggering self-score update...");
  const agentAddr = wallet.address;
  const url = `${SCORE_API_URL}/score/${agentAddr}`;

  // Initial call to get the 402 requirements
  let res = await fetch(url);
  if (res.status === 402) {
    const data = await res.json();
    const requirements = data.accepts[0];
    
    console.log(`  💸 System requires ${requirements.maxAmountRequired} PYUSD. Paying...`);
    
    // In a real AA setup, we'd sign a meta-tx or use the gasless API.
    // For this hackathon demo, we simulate the x402 header.
    // The header is a base64 encoded JSON of the payment details.
    const paymentBody = {
      payee: requirements.payTo,
      amount: requirements.maxAmountRequired,
      asset: requirements.asset,
      txHash: "0x" + "0".repeat(64) // Placeholder for demo, typically includes actual tx proof
    };
    const header = Buffer.from(JSON.stringify(paymentBody)).toString('base64');

    // Retry with header
    const retryRes = await fetch(url, {
      headers: { "x-payment": header }
    });
    const result = await retryRes.json();
    console.log(`  ✅ Score updated: ${result.score}. Tx: ${result.txHash}`);
  }
}

/**
 * MAIN ENDPOINT: POST /summarise
 */
app.post("/summarise", async (req, res) => {
  const { url } = req.body;
  const paymentHeader = req.headers["x-payment"];

  if (!paymentHeader) {
    // 0.05 PYUSD for summary
    return res.status(402).json({
      "accepts": [{
        "scheme": "gokite-aa",
        "network": "kite-testnet",
        "maxAmountRequired": "50000000000000000",
        "resource": "/summarise",
        "description": "Premium URL Summary Service",
        "mimeType": "application/json",
        "payTo": wallet.address,
        "asset": PYUSD_ADDRESS,
        "merchantName": "AgentSummariser",
      }],
      "x402Version": 1
    });
  }

  try {
    requestCounter++;
    
    // 1. Process Service
    const summary = await summariseUrl(url);

    // 2. Automations (Every 5th request)
    if (requestCounter % 5 === 0) {
      await payForOwnScore().catch(e => console.error("Self-scoring failed:", e.message));
    }

    // 3. Repayment logic
    const repaymentTx = await routeIncomeToLoan("50000000000000000");

    res.json({
      summary,
      repaymentTx,
      explorerUrl: repaymentTx ? `https://testnet.kitescan.ai/tx/${repaymentTx}` : null
    });

  } catch (error: any) {
    console.error("Agent error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🤖 Autonomous Agent service listening on port ${PORT}`);
  console.log(`Agent Wallet: ${wallet.address}`);
});
