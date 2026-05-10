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
  
  // Re-attach to contract to ensure ABI is populated
  const vault = await ethers.getContractAt("TradeVault", address, deployer);

  // Authorize wallets
  const eoaWallet = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A";
  const aaWallet = "0xB0862849a8AB2415c773020cb1BFECA51a87d0Aa";
  
  console.log(`\nAuthorizing EOA wallet: ${eoaWallet}`);
  let tx = await vault.addAuthorizedCaller(eoaWallet);
  await tx.wait();
  
  console.log(`Authorizing AA wallet: ${aaWallet}`);
  tx = await vault.addAuthorizedCaller(aaWallet);
  await tx.wait();
  
  console.log("✅ Wallets authorized!");
  
  console.log("\nAdd this to your trading-agent/.env:");
  console.log(`TRADE_VAULT_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
