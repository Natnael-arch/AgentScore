import express from "express";
import cors from "cors";
import * as dotenv from "dotenv";
import { ethers } from "ethers";
import OpenAI from "openai";

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

const gaiaClient = new OpenAI({
  baseURL: process.env.GAIA_BASE_URL || "https://qwen72b.gaia.domains/v1",
  apiKey:  process.env.GAIA_API_KEY || "dummy",
  timeout: 15000,
  maxRetries: 2
});

// ABIs
const LOAN_READ_ABI = [
  "function repay(address borrower, uint256 amount) external",
  "function getBorrowerPosition(address borrower) external view returns (uint256 borrowedAmount, uint256 collateralAmount)"
];

const ERC20_ABI = ["function approve(address spender, uint256 amount) external returns (bool)"];
let requestCounter = 0;

/**
 * Summarize URL using Gaia
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

  console.log("  🤖 Requesting summary from Gaia...");
  
  const result = await gaiaClient.chat.completions.create({
    model: process.env.GAIA_MODEL || "qwen72b",
    messages: [
      { role: "system", content: "You are a concise summariser. Return exactly 3 sentences." },
      { role: "user", content: `Summarise this:\n\n${cleanText}` }
    ]
  });

  return result.choices[0].message.content || "";
}

/**
 * Route income to the LoanAgreement (only if there's outstanding debt)
 */
async function routeIncomeToLoan(amountWei: string) {
  if (!LOAN_AGREEMENT_ADDRESS) {
    console.warn("  ⚠️ No LOAN_AGREEMENT_ADDRESS set, skipping repayment logic.");
    return null;
  }

  try {
    const pyusd = new ethers.Contract(PYUSD_ADDRESS, ERC20_ABI, wallet);
    const loan = new ethers.Contract(LOAN_AGREEMENT_ADDRESS, LOAN_READ_ABI, wallet);

    // Check if agent has any outstanding debt
    const [borrowedAmount] = await loan.getBorrowerPosition(wallet.address);
    if (borrowedAmount === 0n) {
      console.log("  ℹ️ No outstanding loan. Skipping repayment.");
      return null;
    }

    // Cap repayment to the actual debt remaining
    const repayAmount = BigInt(amountWei) > borrowedAmount ? borrowedAmount : BigInt(amountWei);
    console.log(`  💰 Repaying ${ethers.formatEther(repayAmount)} PYUSD (debt: ${ethers.formatEther(borrowedAmount)})...`);

    console.log("    - Approving PYUSD...");
    const appTx = await pyusd.approve(LOAN_AGREEMENT_ADDRESS, repayAmount);
    await appTx.wait();

    console.log("    - Calling repay...");
    const recTx = await loan.repay(wallet.address, repayAmount);
    await recTx.wait();

    return recTx.hash;
  } catch (e: any) {
    console.warn(`  ⚠️ Repayment failed (non-blocking): ${e.message}`);
    return null;
  }
}

/**
 * Trigger scoring of self via the Score API
 */
export async function payForOwnScore() {
  console.log("\n📈 Triggering self-score update...");
  const agentAddr = wallet.address;
  const url = `${SCORE_API_URL}/score/${agentAddr}`;

  // Initial call to get the 402 requirements
  let res = await fetch(url);
  if (res.status === 402) {
    const data = await res.json();
    const requirements = data.accepts[0];
    
    const payeeAddr = requirements.payTo;
    const amount    = requirements.maxAmountRequired;
    const asset     = requirements.asset;

    console.log(`  💸 Initiating real on-chain PYUSD payment of 0.01 PYUSD...`);
    const pyusdContract = new ethers.Contract(
      asset,
      ["function transfer(address to, uint256 amount) external returns (bool)"],
      wallet
    );

    const tx = await pyusdContract.transfer(payeeAddr, amount);
    console.log(`  💸 Payment transaction submitted: ${tx.hash}. Waiting for block confirmation...`);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error("Payment transaction failed on-chain");
    }
    console.log(`  💸 Payment transaction successful and mined in block ${receipt.blockNumber}`);

    const paymentBody = {
      payer: wallet.address,
      payee: payeeAddr,
      amount: amount,
      asset: asset,
      txHash: tx.hash
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

interface PaymentDetails {
  txHash:  string;
  payer:   string;
  payee:   string;
  amount:  string;
  asset:   string;
}

async function verifyPaymentOnChain(xPaymentHeader: string): Promise<PaymentDetails> {
  // Step 1: Decode base64 header
  let paymentDetails: PaymentDetails;
  try {
    const decoded = Buffer.from(xPaymentHeader, "base64").toString("utf-8");
    paymentDetails = JSON.parse(decoded);
  } catch {
    throw new Error("Invalid x-payment header: cannot decode base64 JSON");
  }

  // Step 2: Validate required fields exist
  if (!paymentDetails.txHash) {
    throw new Error("Invalid x-payment header: missing txHash");
  }
  if (!paymentDetails.payer) {
    throw new Error("Invalid x-payment header: missing payer");
  }
  if (!paymentDetails.payee) {
    throw new Error("Invalid x-payment header: missing payee");
  }

  // Step 3: Fetch transaction receipt from Kite chain
  let receipt: ethers.TransactionReceipt | null = null;
  try {
    receipt = await provider.getTransactionReceipt(paymentDetails.txHash);
  } catch (e: any) {
    throw new Error(`Failed to fetch tx receipt from Kite chain: ${e.message}`);
  }

  // Step 4: Confirm transaction exists and succeeded
  if (!receipt) {
    throw new Error(`Transaction ${paymentDetails.txHash} not found on Kite chain — may not be mined yet`);
  }
  if (receipt.status !== 1) {
    throw new Error(`Transaction ${paymentDetails.txHash} failed on-chain (status: ${receipt.status})`);
  }

  // Step 5 & 6: Decode logs to cryptographically verify payment
  const expectedPayee = (process.env.AGENT_WALLET_ADDRESS || "0xC201B98d96d09f2B15Cb7fe8E8c40Da6D664B15c").toLowerCase();
  const minAmount = BigInt(process.env.MIN_PAYMENT_AMOUNT || "50000000000000000"); // 0.05 PYUSD
  const targetAsset = paymentDetails.asset.toLowerCase();

  const erc20Abi = ["event Transfer(address indexed from, address indexed to, uint256 value)"];
  const x402Abi = ["event PaymentSplit(address indexed from, address indexed to, address indexed token, uint256 totalAmount, uint256 agentPortion, uint256 poolPortion)"];
  
  const erc20Iface = new ethers.Interface(erc20Abi);
  const x402Iface = new ethers.Interface(x402Abi);

  let verified = false;

  for (const log of receipt.logs) {
    // Check for standard ERC20 Transfer
    try {
      if (log.address.toLowerCase() === targetAsset) {
        const parsed = erc20Iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed && parsed.name === "Transfer") {
          const to = parsed.args.to.toLowerCase();
          const value = BigInt(parsed.args.value);
          if (to === expectedPayee && value >= minAmount) {
            verified = true;
            break;
          }
        }
      }
    } catch (e) { /* not a matching event */ }

    // Check for X402 PaymentSplit
    try {
      const parsed = x402Iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed && parsed.name === "PaymentSplit") {
        const to = parsed.args.to.toLowerCase();
        const token = parsed.args.token.toLowerCase();
        const totalAmount = BigInt(parsed.args.totalAmount);
        
        if (to === expectedPayee && token === targetAsset && totalAmount >= minAmount) {
          verified = true;
          break;
        }
      }
    } catch (e) { /* not a matching event */ }
  }

  if (!verified) {
    throw new Error(
      `No valid Transfer or PaymentSplit event found meeting the minimum payment of ${minAmount.toString()} to ${expectedPayee}. Header may be spoofed.`
    );
  }

  console.log(`[x402] Payment verified on-chain: tx ${paymentDetails.txHash}`);
  console.log(`[x402] Payer: ${paymentDetails.payer} | Amount: ${ethers.formatEther(paymentDetails.amount)} PYUSD`);

  return paymentDetails;
}

/**
 * MAIN ENDPOINT: POST /summarise
 */
app.post("/summarise", async (req, res) => {
  const payment = req.headers["x-payment"] as string;

  // Step 1: No header at all → return 402 with payment terms
  if (!payment) {
    return res.status(402).json({
      accepts: [{
        scheme:            "gokite-aa",
        network:           "kite-testnet",
        maxAmountRequired: "50000000000000000",
        resource:          "/summarise",
        description:       "Trading signal — 0.05 PYUSD",
        payTo:             process.env.AGENT_WALLET_ADDRESS,
        asset:             "0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9",
        merchantName:      "KiteCredit Trading Agent"
      }],
      x402Version: 1
    });
  }

  // Step 2: Header present → verify on-chain BEFORE doing any work
  try {
    const paymentDetails = await verifyPaymentOnChain(payment);

    // Step 3: Payment confirmed → do the actual task
    const { url } = req.body;
    requestCounter++;
    const summary = await summariseUrl(url);

    // Automations (Every 5th request)
    if (requestCounter % 5 === 0) {
      await payForOwnScore().catch(e => console.error("Self-scoring failed:", e.message));
    }

    // Repayment logic
    const repaymentTx = await routeIncomeToLoan("50000000000000000");

    // Pieverse On-Chain Receipt Integration
    let pieverseReceipt = null;
    try {
      console.log(`[Pieverse] Requesting on-chain receipt for settlement...`);
      const receiptData = {
        txHash: paymentDetails.txHash,
        payer: paymentDetails.payer,
        payee: paymentDetails.payee,
        amount: paymentDetails.amount,
        asset: paymentDetails.asset,
        service: "KiteCredit Trading Signal",
        timestamp: new Date().toISOString()
      };
      
      const pieverseRes = await fetch("https://facilitator.pieverse.io/v2/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(receiptData)
      });
      
      if (pieverseRes.ok) {
        const pieverseData = await pieverseRes.json();
        pieverseReceipt = pieverseData.receiptId || pieverseData.id || "generated";
        console.log(`[Pieverse] ✅ Receipt generated: ${pieverseReceipt}`);
      } else {
        console.warn(`[Pieverse] ⚠️ Facilitator returned ${pieverseRes.status}`);
      }
    } catch (e: any) {
      console.warn(`[Pieverse] ⚠️ Failed to reach Facilitator API: ${e.message}`);
    }

    res.json({
      summary,
      repaymentTx,
      paymentVerified: true,
      paidBy:          paymentDetails.payer,
      txHash:          paymentDetails.txHash,
      explorerUrl:     `https://testnet.kitescan.ai/tx/${paymentDetails.txHash}`,
      pieverseReceipt
    });

  } catch (e: any) {
    // Payment verification failed → reject with 402
    console.error(`[x402] Verification failed: ${e.message}`);
    return res.status(402).json({
      error:   "Payment verification failed",
      reason:  e.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`🤖 Autonomous Agent service listening on port ${PORT}`);
  console.log(`Agent Wallet: ${wallet.address}`);
});
