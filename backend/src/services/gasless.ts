import { ethers } from "ethers";
import { config } from "../config.js";

// Kite Testnet PYUSD Settings
const PYUSD_ADDRESS = "0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9";
const DOMAIN_NAME = "PYUSD";
const DOMAIN_VERSION = "1";

const GASLESS_API = "https://gasless.gokite.ai/testnet";

const TransferWithAuthorizationType = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

export async function executeGaslessTransfer(toAddress: string, amountUi: number) {
  if (!config.poolPrivateKey) {
    console.warn("⚠️ No POOL_PRIVATE_KEY defined in env. Skipping actual on-chain payout.");
    return { txHash: "mock_tx_hash_" + Date.now().toString(16) };
  }

  try {
    const provider = new ethers.JsonRpcProvider(config.kiteRpcUrl);
    const wallet = new ethers.Wallet(config.poolPrivateKey, provider);

    const amountInWei = ethers.parseUnits(amountUi.toString(), 18).toString();

    // The timestamp must be greater than latest block timestamp
    const latestBlock = await provider.getBlock("latest");
    const validAfter = latestBlock!.timestamp;
    // Current gasless API limitation is validBefore must be within 30 seconds of validAfter
    const validBefore = Math.floor(Date.now() / 1000) + 120; 

    const nonce = ethers.hexlify(ethers.randomBytes(32));

    const domain = {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId: config.kiteChainId,
      verifyingContract: PYUSD_ADDRESS,
    };

    const message = {
      from: wallet.address,
      to: toAddress,
      value: amountInWei,
      validAfter,
      validBefore,
      nonce,
    };

    // Generate EIP-712 Signature
    const signature = await wallet.signTypedData(domain, TransferWithAuthorizationType, message);
    const sigParams = ethers.Signature.from(signature);

    const payload = {
      ...message,
      tokenAddress: PYUSD_ADDRESS,
      v: sigParams.v,
      r: sigParams.r,
      s: sigParams.s,
    };

    console.log(`Sending gasless transfer for ${amountUi} PYUSD to ${toAddress}...`);
    
    const response = await fetch(GASLESS_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const respData = await response.text();
      console.error("Gasless transfer failed:", respData);
      throw new Error(`Gasless API Error: ${response.statusText}`);
    }

    const { txHash } = await response.json();
    console.log("✓ Gasless transfer successful:", txHash);
    
    return { txHash };
  } catch (err) {
    console.error("Error executing gasless transfer:", err);
    throw err;
  }
}
