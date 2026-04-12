import express from "express";
import cors from "cors";
import * as dotenv from "dotenv";
import { computeScore } from "./scorer.js";
import { attestOnChain } from "./attester.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const ORACLE_WALLET = process.env.ORACLE_WALLET_ADDRESS;
const PYUSD_ADDRESS = "0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9";
const MIN_AMOUNT = "10000000000000000"; // 0.01 PYUSD (18 decimals)

/**
 * x402 Payment Header Verification
 */
function verifyPaymentHeader(header: string, expectedPayee: string, minAmount: string) {
  try {
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString());
    
    if (decoded.payee.toLowerCase() !== expectedPayee.toLowerCase()) {
      throw new Error("Invalid payee address in payment header");
    }

    if (BigInt(decoded.amount) < BigInt(minAmount)) {
      throw new Error(`Insufficient payment amount. Required: ${minAmount}`);
    }

    return true;
  } catch (err: any) {
    throw new Error(`Payment verification failed: ${err.message}`);
  }
}

/**
 * Gated Score Endpoint (x402)
 */
app.get("/score/:addr", async (req, res) => {
  const { addr } = req.params;
  const paymentHeader = req.headers["x-payment"] as string;

  if (!paymentHeader) {
    // Return 402 Required Payment
    return res.status(402).json({
      "accepts": [{
        "scheme": "gokite-aa",
        "network": "kite-testnet",
        "maxAmountRequired": MIN_AMOUNT,
        "resource": `/score/${addr}`,
        "description": "AgentScore credit lookup — 0.01 PYUSD",
        "mimeType": "application/json",
        "payTo": ORACLE_WALLET,
        "asset": PYUSD_ADDRESS,
        "merchantName": "AgentScore Oracle",
        "outputSchema": {
          "input": { "discoverable": true, "method": "GET", "type": "http" },
          "output": {
            "properties": {
              "score": { "type": "number", "description": "Credit score 300-850" },
              "paymentRate": { "type": "number" },
              "diversity": { "type": "number" },
              "txHash": { "type": "string" }
            }
          }
        }
      }],
      "x402Version": 1
    });
  }

  try {
    if (!ORACLE_WALLET) throw new Error("Server missing ORACLE_WALLET_ADDRESS");
    
    // 1. Verify payment
    verifyPaymentHeader(paymentHeader, ORACLE_WALLET, MIN_AMOUNT);

    // 2. Compute score
    const scoreData = await computeScore(addr);

    // 3. Attest on-chain
    const txHash = await attestOnChain(addr, scoreData);

    // 4. Return results
    res.json({
      ...scoreData,
      txHash,
      explorerUrl: `https://testnet.kitescan.ai/tx/${txHash}`
    });

  } catch (error: any) {
    console.error("Error processing score request:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * RAW Score Endpoint (No gate) - For UI display
 */
app.get("/score/:addr/raw", async (req, res) => {
  const { addr } = req.params;
  try {
    const scoreData = await computeScore(addr);
    res.json(scoreData);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 AgentScore API listening on port ${PORT}`);
  console.log(`Oracle Wallet: ${ORACLE_WALLET}`);
});
