const { ethers } = require("hardhat");

async function main() {
  console.log("Deploying LendingPool to Kite AI Testnet...");

  // Get the deployer account
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  // Official USDT address on Kite Testnet
  const USDT_ADDRESS = "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63";
  
  console.log("Using USDT at:", USDT_ADDRESS);

  // Deploy LendingPool
  console.log("Deploying LendingPool...");
  const LendingPool = await ethers.getContractFactory("LendingPool");
  const lendingPool = await LendingPool.deploy(USDT_ADDRESS);
  await lendingPool.deployed();
  console.log("LendingPool deployed to:", lendingPool.address);

  console.log("\nDeployment Summary:");
  console.log("==================");
  console.log("USDT Address:", USDT_ADDRESS);
  console.log("LendingPool Address:", lendingPool.address);
  console.log("Deployer Address:", deployer.address);
  
  // Save addresses to a file for easy access
  const fs = require("fs");
  const addresses = {
    usdt: USDT_ADDRESS,
    lendingPool: lendingPool.address,
    deployer: deployer.address,
    network: "kite-testnet"
  };
  
  fs.writeFileSync("deployed-addresses.json", JSON.stringify(addresses, null, 2));
  console.log("\nAddresses saved to deployed-addresses.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
