// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title USDT
 * @dev Simple ERC20 token for testing the KiteCredit protocol.
 * Standard USDT has 6 decimals.
 */
contract USDT is ERC20, Ownable {
    uint8 private _decimals;

    constructor() ERC20("Tether USD", "USDT") {
        _decimals = 6;
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }

    /**
     * @dev Function to mint new tokens. Only the owner can mint.
     * Useful for simulating a faucet on testnets.
     */
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    /**
     * @dev Overriding decimals to 6 to match standard USDT.
     */
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }
}
