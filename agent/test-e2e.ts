import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const RPC_URL = process.env.KITE_RPC_URL || "https://rpc-testnet.gokite.ai/";
const AGENT_KEY = process.env.AGENT_PRIVATE_KEY!;
const PYUSD_ADDRESS = "0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9";
const AGENT_WALLET = process.env.AGENT_WALLET_ADDRESS || "0xC201B98d96d09f2B15Cb7fe8E8c40Da6D664B15c";

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)"
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(AGENT_KEY, provider);
  const pyusd = new ethers.Contract(PYUSD_ADDRESS, ERC20_ABI, wallet);

  console.log("=== End-to-End Flow Test ===\n");
  console.log(`Agent Wallet: ${wallet.address}`);

  // Step 1: Check PYUSD balance
  const balance = await pyusd.balanceOf(wallet.address);
  console.log(`PYUSD Balance: ${ethers.formatEther(balance)} PYUSD`);

  if (balance === 0n) {
    console.error("❌ No PYUSD balance. Cannot run E2E test.");
    return;
  }

  // Step 2: Send a real PYUSD transfer to self (simulates a user paying the agent)
  const paymentAmount = ethers.parseEther("0.05"); // 0.05 PYUSD
  console.log(`\n📤 Sending 0.05 PYUSD to self (${wallet.address})...`);
  
  const tx = await pyusd.transfer(wallet.address, paymentAmount);
  console.log(`   Tx Hash: ${tx.hash}`);
  console.log("   Waiting for confirmation...");
  const receipt = await tx.wait();
  console.log(`   ✅ Confirmed in block ${receipt!.blockNumber}`);

  // Step 3: Build x-payment header with the real txHash
  const paymentBody = {
    txHash: tx.hash,
    payer: wallet.address,
    payee: AGENT_WALLET,
    amount: paymentAmount.toString(),
    asset: PYUSD_ADDRESS
  };
  const header = Buffer.from(JSON.stringify(paymentBody)).toString("base64");

  // Step 4: Call the agent's /summarise endpoint
  console.log(`\n🤖 Calling POST /summarise with real x-payment header...`);
  const agentRes = await fetch("http://localhost:4000/summarise", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-payment": header
    },
    body: JSON.stringify({ url: "https://example.com" })
  });

  const result = await agentRes.json();
  console.log(`\n📋 Agent Response (HTTP ${agentRes.status}):`);
  console.log(JSON.stringify(result, null, 2));

  // Step 5: Evaluate results
  console.log("\n=== Test Results ===");
  if (agentRes.status === 200 && result.paymentVerified) {
    console.log("✅ Payment Verified On-Chain: YES");
    console.log(`✅ Summary Received: ${result.summary ? "YES" : "NO"}`);
    console.log(`✅ Repayment Tx: ${result.repaymentTx || "N/A (no active loan)"}`);
    console.log(`✅ Pieverse Receipt: ${result.pieverseReceipt || "API unavailable (non-blocking)"}`);
    console.log(`✅ Explorer: ${result.explorerUrl}`);
    console.log("\n🎉 END-TO-END TEST PASSED!");
  } else {
    console.log(`❌ Test FAILED. Status: ${agentRes.status}`);
    console.log(`   Reason: ${result.reason || result.error || "Unknown"}`);
  }
}

main().catch(console.error);
