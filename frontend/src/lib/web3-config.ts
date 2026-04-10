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

export const USDT_ADDRESS = '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63' as const;
export const LENDING_POOL_ADDRESS = '0x5373AC30Af87e74e8A0a17101890920B7057E033' as const;

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
