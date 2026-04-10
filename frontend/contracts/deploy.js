const { ethers } = require("hardhat");

async function main() {
  console.log("Deploying LendingPool to Kite AI Testnet...");

  // Get the deployer account
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  let usdtAddress = "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63"; // Official USDT address on Kite Testnet
  
  // Check if we are on a local network or need to deploy mock USDT
  const network = await ethers.provider.getNetwork();
  console.log("Connected to network:", network.name, network.chainId);

  if (network.chainId === 31337 || !usdtAddress) {
    console.log("Local network detected or no USDT address provided. Deploying mock USDT...");
    const USDT = await ethers.getContractFactory("USDT");
    const usdt = await USDT.deploy();
    await usdt.deployed();
    usdtAddress = usdt.address;
    console.log("Mock USDT deployed to:", usdtAddress);
  } else {
    console.log("Using official USDT at:", usdtAddress);
  }

  // Deploy LendingPool
  console.log("Deploying LendingPool...");
  const LendingPool = await ethers.getContractFactory("LendingPool");
  const lendingPool = await LendingPool.deploy(usdtAddress);
  await lendingPool.deployed();
  console.log("LendingPool deployed to:", lendingPool.address);


  console.log("\nDeployment Summary:");
  console.log("==================");
  console.log("USDT Address:", usdtAddress);
  console.log("LendingPool Address:", lendingPool.address);
  console.log("Deployer Address:", deployer.address);
  
  // Save addresses to a file for easy access
  const fs = require("fs");
  const addresses = {
    usdt: usdtAddress,
    lendingPool: lendingPool.address,
    deployer: deployer.address,
    network: network.chainId === 2368 ? "kite-testnet" : "local-hardhat",
    chainId: network.chainId
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
