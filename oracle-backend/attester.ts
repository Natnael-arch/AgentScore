import { ethers } from "ethers";
import * as dotenv from "dotenv";
import { ScoreResult } from "./scorer.js";

dotenv.config();

/**
 * Attests the computed score to the AgentScoreAttestation contract on-chain
 */
export async function attestOnChain(agentAddr: string, data: ScoreResult): Promise<string> {
  const oracleKey = process.env.ORACLE_PRIVATE_KEY;
  const contractAddr = process.env.SCORE_CONTRACT_ADDRESS;
  const rpcUrl = process.env.KITE_RPC_URL || "https://rpc-testnet.gokite.ai/";

  if (!oracleKey) throw new Error("Missing environment variable: ORACLE_PRIVATE_KEY");
  if (!contractAddr) throw new Error("Missing environment variable: SCORE_CONTRACT_ADDRESS");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(oracleKey, provider);

  const abi = [
    "function attest(address agent, uint16 score, uint8 paymentRate, uint8 diversity, uint32 txCount, uint16 agentAgeDays) external"
  ];

  const contract = new ethers.Contract(contractAddr, abi, wallet);

  console.log(`\n✍️ Attesting score ${data.score} for ${agentAddr}...`);

  try {
    const tx = await contract.attest(
      agentAddr,
      data.score,
      data.paymentRate,
      data.diversity,
      data.txCount,
      data.agentAgeDays
    );

    console.log(`  🚀 Tx sent: ${tx.hash}`);
    await tx.wait();
    console.log(`  ✅ Transaction confirmed!`);

    return tx.hash;
  } catch (error: any) {
    console.error("  ❌ Attestation failed:", error.message);
    throw new Error(`Failed to attest score on-chain: ${error.message}`);
  }
}
