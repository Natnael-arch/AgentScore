import { Request, Response, NextFunction } from "express";
import { ethers } from "ethers";

export function requireAgentSignature(addressField: string = "borrower_address") {
  return function (req: Request, res: Response, next: NextFunction): void {
    try {
      const signature = req.header("x-agent-signature");
      const timestamp = req.header("x-timestamp");
      const agentAddress = 
        req.body[addressField] || 
        req.body["lender_address"] || 
        req.body["borrower_address"] || 
        req.body["from_address"];

      // If we are missing auth headers, return 401
      if (!signature || !timestamp || !agentAddress) {
        res.status(401).json({ error: "Missing required Authentication headers or address payload" });
        return;
      }

      // Hackathon Bypass: Let the UI still work without forcing users to connect MetaMask/Web3 wallets
      if (signature === "bypass_for_ui_demo") {
        next();
        return;
      }

      // Check timezone expiration (e.g. within 5 minutes) to prevent replay
      const timeDiff = Math.abs(Date.now() - parseInt(timestamp, 10));
      if (timeDiff > 5 * 60 * 1000) {
        res.status(401).json({ error: "Request timestamp expired" });
        return;
      }

      // Recreate the message that should have been signed
      // We assume the payload signed was the stringified request body plus the timestamp
      const messageToSign = JSON.stringify(req.body) + timestamp;

      // Recover the address from the signature
      const recoveredAddress = ethers.verifyMessage(messageToSign, signature);

      // Verify the recovered address matches the agent trying to take the loan/transaction
      if (recoveredAddress.toLowerCase() !== agentAddress.toLowerCase()) {
        res.status(403).json({ error: "Signature verification failed: unauthorized agent" });
        return;
      }

      next();
    } catch (err) {
      console.error("Auth middleware error:", err);
      res.status(403).json({ error: "Invalid signature" });
    }
  };
}
