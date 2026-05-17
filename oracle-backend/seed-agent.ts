import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const provider = new ethers.JsonRpcProvider("https://rpc-testnet.gokite.ai");
  const wallet = new ethers.Wallet(process.env.ORACLE_PRIVATE_KEY!, provider);

  const contract = new ethers.Contract(
    "0xF04B3a11db07d206F61Bf08645169793cbD442C3",
    ["function attest(address agent, uint16 score, uint8 paymentRate, uint8 diversity, uint32 txCount, uint16 agentAgeDays) external"],
    wallet
  );

  console.log("Attesting score for trading agent...");

  const tx = await contract.attest(
    "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
    724,  // score — qualifies for $3 PYUSD loan
    92,   // paymentRate
    8,    // diversity
    45,   // txCount
    28    // agentAgeDays
  );

  await tx.wait();
  console.log("✅ Score attested:", tx.hash);
  console.log("Explorer:", `https://testnet.kitescan.ai/tx/${tx.hash}`);
}

main().catch(console.error);
