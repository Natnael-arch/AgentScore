console.log("--- ENTRY POINT REACHED (server.ts) ---");
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

// Diagnostic Endpoints
app.get("/", (req, res) => res.send("AgentScore Backend is LIVE"));
app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

const ORACLE_WALLET = process.env.ORACLE_WALLET_ADDRESS;
const PYUSD_ADDRESS = "0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9";
const MIN_AMOUNT = "10000000000000000"; // 0.01 PYUSD (18 decimals)

/**
 * x402 Payment Header Verification
 */
async function verifyPaymentOnChain(header: string) {
  try {
    const payload = JSON.parse(Buffer.from(header, 'base64').toString());
    const res = await fetch("https://facilitator.pieverse.io/v2/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
      throw new Error(`Facilitator returned ${res.status}`);
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
      x402Version: 1,
      accepts: [{
        scheme:           "gokite-aa",
        network:          "kite-testnet",
        maxAmountRequired: "10000000000000000",
        resource:         `https://agentscore.onrender.com/score/${addr}`,
        description:      "AgentScore Oracle — verifiable on-chain credit score",
        mimeType:         "application/json",
        payTo:            "0x55d829A66BB1D9f82923cBDEe355249EE5940365",
        maxTimeoutSeconds: 300,
        asset:            "0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9",
        extra:            null,
        merchantName:     "KiteCredit AgentScore Oracle",
        outputSchema: {
          input: {
            discoverable: true,
            method:       "GET",
            type:         "http"
          },
          output: {
            type: "object",
            properties: {
              score: {
                type:        "number",
                description: "Credit score 300-850"
              },
              grade: {
                type:        "string",
                description: "New/Poor/Fair/Good/Excellent"
              },
              attestationTx: {
                type:        "string",
                description: "Kite chain attestation tx hash"
              },
              explorerUrl: {
                type:        "string",
                description: "KiteScan explorer link"
              }
            },
            required: ["score", "attestationTx"]
          }
        }
      }]
    });
  }

  try {
    if (!ORACLE_WALLET) throw new Error("Server missing ORACLE_WALLET_ADDRESS");
    
    // 1. Verify payment
    try {
      await verifyPaymentOnChain(paymentHeader);
    } catch (paymentErr: any) {
      return res.status(402).json({ error: paymentErr.message });
    }

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

console.log("--- ATTEMPTING TO LISTEN ---");
app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`🚀 AgentScore API listening on port ${PORT}`);
  console.log(`Oracle Wallet: ${ORACLE_WALLET}`);
});

export default app;
