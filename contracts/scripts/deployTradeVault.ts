import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying TradeVault with owner:", deployer.address);

  const Factory = await ethers.getContractFactory("TradeVault");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("✅ TradeVault deployed to:", address);
  console.log("🔗 Explorer: https://testnet.kitescan.ai/address/" + address);
  console.log("\nAdd this to your trading-agent/.env:");
  console.log(`TRADE_VAULT_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
