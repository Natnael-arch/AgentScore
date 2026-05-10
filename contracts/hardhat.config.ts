import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const config: HardhatUserConfig = {
  solidity: "0.8.20",
  networks: {
    kite_testnet: {
      url: "https://rpc-testnet.gokite.ai/",
      chainId: 2368,
      accounts: process.env.ORACLE_PRIVATE_KEY ? [process.env.ORACLE_PRIVATE_KEY] : []
    },
    kite_testnet_agent: {
      url: "https://rpc-testnet.gokite.ai/",
      chainId: 2368,
      accounts: process.env.AGENT_PRIVATE_KEY ? [process.env.AGENT_PRIVATE_KEY] : []
    }
  }
};

export default config;
