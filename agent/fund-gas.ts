import { ethers } from "ethers";

const RPC = "https://rpc-testnet.gokite.ai/";
const POOL_KEY = "2e2b55a75d5f5da56353c8f275b495aec324d49d2ecac7b7c0d52f330e956f2d";
const AGENT_WALLET = "0xC201B98d96d09f2B15Cb7fe8E8c40Da6D664B15c";

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const poolWallet = new ethers.Wallet(POOL_KEY, provider);

  const poolBal = await provider.getBalance(poolWallet.address);
  const agentBal = await provider.getBalance(AGENT_WALLET);
  console.log(`Pool KITE balance:  ${ethers.formatEther(poolBal)}`);
  console.log(`Agent KITE balance: ${ethers.formatEther(agentBal)}`);

  // Send 0.01 KITE for gas
  const amount = ethers.parseEther("0.01");
  console.log(`\n📤 Sending 0.01 KITE to agent for gas...`);
  const tx = await poolWallet.sendTransaction({ to: AGENT_WALLET, value: amount });
  console.log(`   Tx: ${tx.hash}`);
  await tx.wait();

  const newBal = await provider.getBalance(AGENT_WALLET);
  console.log(`   ✅ Agent KITE balance: ${ethers.formatEther(newBal)}`);
}

main().catch(console.error);
