import { http, createConfig } from 'wagmi';
import { defineChain } from 'viem';
import { injected, coinbaseWallet, metaMask, walletConnect } from 'wagmi/connectors';

export const kiteTestnet = defineChain({
  id: 2368,
  name: 'Kite AI Testnet',
  nativeCurrency: {
    name: 'KITE',
    symbol: 'KITE',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://rpc-testnet.gokite.ai'],
    },
  },
  blockExplorers: {
    default: {
      name: 'KiteScan',
      url: 'https://testnet.kitescan.ai',
    },
  },
  testnet: true,
});

export const PYUSD_ADDRESS = '0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9' as const;
export const LENDING_POOL_ADDRESS = '0x16c110a07640831b98EF82dFFa3D2eBF8c8067dE' as const;
export const AGENT_REGISTRY_ADDRESS = '0xF04B3a11db07d206F61Bf08645169793cbD442C3' as const;
export const X402_PROCESSOR_ADDRESS = '0x18BE09e6986B61eAa7Cbe4fA21Df1b512DDFc252' as const;

export const config = createConfig({
  chains: [kiteTestnet],
  connectors: [
    walletConnect({
      projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'default-project-id',
      metadata: {
        name: 'KiteCredit',
        description: 'AI Agent Credit Protocol',
        url: typeof window !== 'undefined' ? window.location.origin : 'https://kitecredit.ai',
        icons: ['https://kitecredit.ai/icon.png'],
      },
    }),
    metaMask(),
    injected({
      shimDisconnect: true,
    }),
    coinbaseWallet({
      appName: "KiteCredit",
    }),
  ],
  transports: {
    [kiteTestnet.id]: http(),
  },
});
