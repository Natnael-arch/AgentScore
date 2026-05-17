import React, { createContext, useContext, ReactNode, useMemo } from 'react';
import { useAccount, useConnect, useDisconnect, useSignMessage, useSwitchChain } from 'wagmi';
import { kiteTestnet } from '@/lib/web3-config';

interface WalletContextType {
  account: string | null;
  isConnected: boolean;
  connect: (connector?: any) => Promise<void>;
  connectors: readonly any[];
  signAuthMessage: (payload: any) => Promise<{ signature: string, timestamp: string }>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { address, chainId } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChain } = useSwitchChain();

  const connect = async (connector?: any) => {
    try {
      if (connector) {
        await connectAsync({ connector });
      } else {
        // Check if MetaMask is installed
        if (typeof window !== 'undefined' && !(window as any).ethereum) {
          throw new Error('MetaMask is not installed. Please install MetaMask to continue.');
        }

        // Prioritize MetaMask connectors
        const defaultConnector =
          connectors.find((c) => c.id === 'metaMask') ??
          connectors.find((c) => c.id === 'injected') ??
          connectors[0];

        if (defaultConnector) {
          await connectAsync({ connector: defaultConnector });
          
          // Switch to Kite testnet if not already on it
          if (chainId !== kiteTestnet.id) {
            try {
              await switchChain({ chainId: kiteTestnet.id });
            } catch (switchError: any) {
              // If switching fails, try to add the network
              if (switchError.code === 4902) {
                try {
                  await (window as any).ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                      chainId: `0x${kiteTestnet.id.toString(16)}`,
                      chainName: kiteTestnet.name,
                      nativeCurrency: kiteTestnet.nativeCurrency,
                      rpcUrls: ['https://rpc-testnet.gokite.ai'],
                      blockExplorerUrls: [kiteTestnet.blockExplorers.default.url],
                    }],
                  });
                } catch (addError) {
                  console.error('Failed to add network:', addError);
                  throw new Error('Please add Kite AI Testnet to your wallet manually.');
                }
              } else {
                console.error('Failed to switch network:', switchError);
                throw new Error('Please switch to Kite AI Testnet manually.');
              }
            }
          }
        } else {
          throw new Error('No wallet connector available. Install MetaMask.');
        }
      }
    } catch (err: any) {
      console.error("Failed to connect wallet", err);
      
      // Provide user-friendly error messages
      if (err.code === 4001) {
        throw new Error('Connection rejected by user. Please try again.');
      } else if (err.code === -32002) {
        throw new Error('MetaMask is already open. Please check your MetaMask extension.');
      } else if (err.message?.includes('MetaMask is not installed')) {
        throw err;
      } else {
        throw new Error('Failed to connect wallet. Please try again.');
      }
    }
  };

  const signAuthMessage = async (payload: any) => {
    const timestamp = Date.now().toString();
    const message = JSON.stringify(payload) + timestamp;
    const signature = await signMessageAsync({ message, account: address! });
    return { signature, timestamp };
  };

  const value = useMemo(() => ({
    account: address || null,
    isConnected: !!address,
    connect,
    connectors,
    disconnect,
    signAuthMessage
  }), [address, connectors, connectAsync, disconnect, signMessageAsync]);

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
