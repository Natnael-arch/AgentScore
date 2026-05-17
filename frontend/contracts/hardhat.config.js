require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    kiteTestnet: {
      url: "https://rpc-testnet.gokite.ai", // Kite AI Testnet RPC
      chainId: 2368,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      timeout: 60000, // 60 seconds
    },
    localhost: {
      url: "http://127.0.0.1:8545",
    },
  },
  etherscan: {
    apiKey: {
      kiteTestnet: "your-api-key", // You might not need this for testnet
    },
    customChains: [
      {
        network: "kiteTestnet",
        chainId: 2368,
        urls: {
          apiURL: "https://testnet.kitescan.ai/api",
          browserURL: "https://testnet.kitescan.ai",
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
