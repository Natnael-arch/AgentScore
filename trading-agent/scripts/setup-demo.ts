import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const KITE_RPC     = "https://rpc-testnet.gokite.ai";
const PYUSD        = "0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9";
const LENDING_POOL = "0x16c110a07640831b98EF82dFFa3D2eBF8c8067dE";

const WALLETS = {
  agent:    "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
  passport: "0x162b595597E9106FD04509AE9487b3ba02454B6a",
};

const PYUSD_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

const POOL_ABI = [
  "function deposit(uint256 amount) external",
  "function totalDeposited() view returns (uint256)"
];

async function main() {
  const provider = new ethers.JsonRpcProvider(KITE_RPC);
  const oracleSigner = new ethers.Wallet(process.env.ORACLE_PRIVATE_KEY!, provider);
  const pyusd = new ethers.Contract(PYUSD, PYUSD_ABI, oracleSigner);

  // Print current balances
  console.log("\n📊 CURRENT BALANCES:");
  for (const [name, addr] of Object.entries(WALLETS)) {
    const bal = await pyusd.balanceOf(addr);
    console.log(`  ${name}: ${ethers.formatUnits(bal, 18)} PYUSD`);
  }
  const poolBal = await pyusd.balanceOf(LENDING_POOL);
  console.log(`  LendingPool TVL: ${ethers.formatUnits(poolBal, 18)} PYUSD`);

  // Fund agent wallet — 2 PYUSD for trading
  console.log("\n💸 Funding agent wallet...");
  const agentTx = await pyusd.transfer(
    WALLETS.agent, ethers.parseUnits("2", 18)
  );
  await agentTx.wait();
  console.log(`✅ Agent: https://testnet.kitescan.ai/tx/${agentTx.hash}`);

  // Fund passport wallet — 1 PYUSD for oracle payments
  console.log("\n💸 Funding passport wallet...");
  const passportTx = await pyusd.transfer(
    WALLETS.passport, ethers.parseUnits("1", 18)
  );
  await passportTx.wait();
  console.log(`✅ Passport: https://testnet.kitescan.ai/tx/${passportTx.hash}`);

  // Deposit 5 PYUSD into LendingPool as demo lender
  console.log("\n🏦 Depositing into LendingPool...");
  const approveTx = await pyusd.approve(
    LENDING_POOL, ethers.parseUnits("5", 18)
  );
  await approveTx.wait();

  const pool = new ethers.Contract(LENDING_POOL, POOL_ABI, oracleSigner);
  const depositTx = await pool.deposit(ethers.parseUnits("5", 18));
  await depositTx.wait();
  console.log(`✅ Pool funded: https://testnet.kitescan.ai/tx/${depositTx.hash}`);

  // Final balances
  console.log("\n📊 FINAL BALANCES:");
  for (const [name, addr] of Object.entries(WALLETS)) {
    const bal = await pyusd.balanceOf(addr);
    console.log(`  ${name}: ${ethers.formatUnits(bal, 18)} PYUSD`);
  }
  const finalPool = await pyusd.balanceOf(LENDING_POOL);
  console.log(`  LendingPool TVL: ${ethers.formatUnits(finalPool, 18)} PYUSD`);
  console.log("\n✅ Demo environment ready!");
}

main().catch(console.error);
