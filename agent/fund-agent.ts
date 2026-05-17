import { ethers } from "ethers";

const RPC = "https://rpc-testnet.gokite.ai/";
const PYUSD = "0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9";
const POOL_KEY = "2e2b55a75d5f5da56353c8f275b495aec324d49d2ecac7b7c0d52f330e956f2d";
const AGENT_WALLET = "0xC201B98d96d09f2B15Cb7fe8E8c40Da6D664B15c";

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)"
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const poolWallet = new ethers.Wallet(POOL_KEY, provider);
  const pyusd = new ethers.Contract(PYUSD, ERC20_ABI, poolWallet);

  console.log(`Pool Wallet: ${poolWallet.address}`);
  
  const poolBalance = await pyusd.balanceOf(poolWallet.address);
  console.log(`Pool PYUSD Balance: ${ethers.formatEther(poolBalance)}`);

  const agentBalance = await pyusd.balanceOf(AGENT_WALLET);
  console.log(`Agent PYUSD Balance: ${ethers.formatEther(agentBalance)}`);

  if (poolBalance === 0n) {
    console.log("❌ Pool wallet also has 0 PYUSD. Need to get testnet PYUSD from the Kite faucet.");
    return;
  }

  // Send 1 PYUSD to agent wallet for testing
  const amount = ethers.parseEther("1.0");
  console.log(`\n📤 Sending 1.0 PYUSD to agent wallet...`);
  const tx = await pyusd.transfer(AGENT_WALLET, amount);
  console.log(`   Tx: ${tx.hash}`);
  await tx.wait();
  console.log(`   ✅ Funded! Agent now has PYUSD for testing.`);
  
  const newBalance = await pyusd.balanceOf(AGENT_WALLET);
  console.log(`   New Agent Balance: ${ethers.formatEther(newBalance)} PYUSD`);
}

main().catch(console.error);
