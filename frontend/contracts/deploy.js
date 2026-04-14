const { ethers } = require("hardhat");

async function main() {
  console.log("Starting Blockchain-First Architecture Deployment...");

  // Get the deployer account
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  let usdtAddress = "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63"; // Official USDT address on Kite Testnet
  let usdcAddress = ""; // We can deploy a mock if not found

  // Check if we are on a local network
  const network = await ethers.provider.getNetwork();
  console.log("Connected to network:", network.name, network.chainId);

  if (network.chainId === 31337) {
    console.log("Local network detected. Deploying mock tokens...");
    const MockToken = await ethers.getContractFactory("USDT");
    
    const usdt = await MockToken.deploy();
    await usdt.deployed();
    usdtAddress = usdt.address;
    console.log("Mock USDT deployed to:", usdtAddress);

    const usdc = await MockToken.deploy();
    await usdc.deployed();
    usdcAddress = usdc.address;
    console.log("Mock USDC deployed to:", usdcAddress);
  }

  // 1. Deploy AgentRegistry
  console.log("Deploying AgentRegistry...");
  const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
  const agentRegistry = await AgentRegistry.deploy();
  await agentRegistry.deployed();
  console.log("AgentRegistry deployed to:", agentRegistry.address);

  // 2. Deploy LendingPool
  console.log("Deploying LendingPool...");
  const LendingPool = await ethers.getContractFactory("LendingPool");
  const lendingPool = await LendingPool.deploy(usdtAddress, agentRegistry.address);
  await lendingPool.deployed();
  console.log("LendingPool deployed to:", lendingPool.address);

  // 3. Deploy X402Processor
  console.log("Deploying X402Processor...");
  const X402Processor = await ethers.getContractFactory("X402Processor");
  const x402Processor = await X402Processor.deploy(lendingPool.address);
  await x402Processor.deployed();
  console.log("X402Processor deployed to:", x402Processor.address);

  // 4. Configure Inter-contract settings
  console.log("Configuring contracts...");
  await lendingPool.setX402Processor(x402Processor.address);
  console.log("✓ X402Processor set in LendingPool");

  // Auth the deployer as a scorer for testing purposes
  await agentRegistry.authorizeScorer(deployer.address, true);
  console.log("✓ Deployer authorized as scorer in AgentRegistry");

  console.log("\nDeployment Summary:");
  console.log("==================");
  console.log("AgentRegistry:", agentRegistry.address);
  console.log("LendingPool:", lendingPool.address);
  console.log("X402Processor:", x402Processor.address);
  console.log("USDT Address:", usdtAddress);
  console.log("USDC Address:", usdcAddress);
  
  // Save addresses to a file for easy access
  const fs = require("fs");
  const addresses = {
    agentRegistry: agentRegistry.address,
    lendingPool: lendingPool.address,
    x402Processor: x402Processor.address,
    usdt: usdtAddress,
    usdc: usdcAddress,
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

