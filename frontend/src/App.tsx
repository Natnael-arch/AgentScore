import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WagmiProvider } from "wagmi";
import { config } from "@/lib/web3-config";
import { WalletProvider } from "@/contexts/WalletContext";
import { Layout } from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Lend from "@/pages/Lend";
import Borrow from "@/pages/Borrow";
import RegisterAgent from "@/pages/RegisterAgent";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <WagmiProvider config={config}>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WalletProvider>
          <Sonner
            theme="dark"
            toastOptions={{
              style: {
                background: "hsl(220, 25%, 7%)",
                border: "1px solid hsl(220, 18%, 16%)",
                color: "hsl(210, 20%, 90%)",
              },
            }}
          />
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/lend" element={<Lend />} />
                <Route path="/borrow" element={<Borrow />} />
                <Route path="/register" element={<RegisterAgent />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </WalletProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </WagmiProvider>
);

export default App;
