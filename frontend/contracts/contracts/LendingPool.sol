// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IAgentScoreAttestation {
    function getScore(address agent) external view returns (uint16 score, uint32 timestamp);
}

contract LendingPool is Ownable, ReentrancyGuard {
    IERC20 public pyusdToken;
    IAgentScoreAttestation public scoreOracle;
    address public x402Processor;
    
    struct Lender {
        uint256 depositedAmount;
        uint256 lastDepositTime;
        uint256 earnedInterest;
        uint256 yieldClaimed;
    }
    
    struct Borrower {
        uint256 borrowedAmount;
        uint256 lastBorrowTime;
        uint256 collateralAmount;
        bool isCollateralLocked;
        uint256 interestRateBps;
        uint256 accruedInterest;
        uint256 lastInterestUpdate;
    }
    
    mapping(address => Lender) public lenders;
    mapping(address => Borrower) public borrowers;
    
    address[] public lenderList;
    address[] public borrowerList;
    
    uint256 public totalDeposits;
    uint256 public totalBorrowed;
    uint256 public interestRate = 500; // 5% annual interest (500 basis points)
    uint256 public baseCollateralRatio = 150; // 150% base collateral ratio
    
    uint256 public totalInterestAccrued;
    uint256 public totalInterestCollected;
    uint256 public totalYieldPool;
    
    event Deposited(address indexed lender, uint256 amount);
    event Withdrawn(address indexed lender, uint256 amount);
    event Borrowed(address indexed borrower, uint256 amount);
    event Repaid(address indexed borrower, uint256 amount);
    event CollateralAdded(address indexed borrower, uint256 amount);
    event InterestPaid(address indexed lender, uint256 amount);
    event LoanRepayment(
        address indexed agent,
        uint256 amount,
        uint256 loanId,
        bool    fullyRepaid,
        uint256 timestamp
    );
    
    struct RepaymentRecord {
        uint256 loanId;
        uint256 amount;
        bool    fullyRepaid;
        uint256 timestamp;
    }

    mapping(address => RepaymentRecord[]) public repaymentHistory;
    uint256 public nextLoanId = 1;

    function getRepaymentHistory(address agent) 
        external view returns (RepaymentRecord[] memory) {
        return repaymentHistory[agent];
    }
    
    constructor(address _pyusdToken, address _scoreOracle) {
        pyusdToken = IERC20(_pyusdToken);
        scoreOracle = IAgentScoreAttestation(_scoreOracle);
    }

    function setX402Processor(address _processor) external onlyOwner {
        x402Processor = _processor;
    }
    
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        
        // Transfer PYUSD from lender to this contract
        require(pyusdToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        // Update lender state
        if (lenders[msg.sender].depositedAmount == 0) {
            lenderList.push(msg.sender);
        }
        
        // Calculate and add any pending interest
        uint256 pendingInterest = calculatePendingInterest(msg.sender);
        if (pendingInterest > 0) {
            lenders[msg.sender].earnedInterest += pendingInterest;
        }
        
        lenders[msg.sender].depositedAmount += amount;
        lenders[msg.sender].lastDepositTime = block.timestamp;
        totalDeposits += amount;
        
        lenders[msg.sender].yieldClaimed = (totalYieldPool * lenders[msg.sender].depositedAmount) / totalDeposits;
        
        emit Deposited(msg.sender, amount);
    }
    
    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        
        Lender storage lender = lenders[msg.sender];
        uint256 totalAvailable = lender.depositedAmount + lender.earnedInterest;
        require(amount <= totalAvailable, "Insufficient balance");
        
        // Calculate pending interest
        uint256 pendingInterest = calculatePendingInterest(msg.sender);
        uint256 totalEarnedInterest = lender.earnedInterest + pendingInterest;
        
        // Determine withdrawal breakdown
        uint256 withdrawFromDeposit = amount > lender.depositedAmount ? lender.depositedAmount : amount;
        uint256 withdrawFromInterest = amount - withdrawFromDeposit;
        
        // Update state
        lender.depositedAmount -= withdrawFromDeposit;
        lender.earnedInterest = totalEarnedInterest - withdrawFromInterest;
        lender.lastDepositTime = block.timestamp;
        totalDeposits -= withdrawFromDeposit;
        
        if (totalDeposits > 0 && lender.depositedAmount > 0) {
            lender.yieldClaimed = (totalYieldPool * lender.depositedAmount) / totalDeposits;
        } else {
            lender.yieldClaimed = 0;
        }
        
        // Transfer PYUSD to lender
        require(pyusdToken.transfer(msg.sender, amount), "Transfer failed");
        
        emit Withdrawn(msg.sender, amount);
    }
    
    function getInterestRateBps(uint16 score) internal pure returns (uint256) {
        if (score >= 750) return 500;  // 5%
        if (score >= 700) return 1000; // 10%
        if (score >= 600) return 1500; // 15%
        return 2000;                   // 20% for score 500-599
    }

    function accrueInterest(address borrowerAddr) internal {
        Borrower storage b = borrowers[borrowerAddr];
        if (b.borrowedAmount == 0) return;

        uint256 elapsed = block.timestamp - b.lastInterestUpdate;
        uint256 interest = (b.borrowedAmount * b.interestRateBps * elapsed) / (10000 * 365 days);

        b.accruedInterest += interest;
        b.lastInterestUpdate = block.timestamp;
        totalInterestAccrued += interest;
    }

    /**
     * @dev Borrow USDT. 100% Reputation-based (Zero Collateral).
     * Score 800+ => Max 500 USDT
     * Score 700+ => Max 200 USDT
     * Score 600+ => Max 50 USDT
     */
    function borrow(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        
        (uint16 rawScore, uint32 timestamp) = scoreOracle.getScore(msg.sender);
        uint256 score = uint256(rawScore);
        
        require(block.timestamp - timestamp <= 7 days, "Score stale");
        require(score >= 500, "Score too low");
        
        uint256 maxBorrowable = 0;
        if (score >= 800) {
            maxBorrowable = 500 * (10**18); // PYUSD uses 18 decimals
        } else if (score >= 700) {
            maxBorrowable = 200 * (10**18);
        } else if (score >= 600) {
            maxBorrowable = 50 * (10**18);
        } else if (score >= 500) {
            // Give a tiny allowance for score 500-599 as per requested tier logic
            maxBorrowable = 10 * (10**18);
        }
        
        require(maxBorrowable > 0, "Credit score too low to borrow");
        
        Borrower storage borrower = borrowers[msg.sender];
        require(borrower.borrowedAmount + amount <= maxBorrowable, "Exceeds score-based credit limit");
        require(totalDeposits >= totalBorrowed + amount, "Insufficient liquidity in pool");

        if (borrower.borrowedAmount == 0) {
            borrowerList.push(msg.sender);
        }
        
        borrower.interestRateBps = getInterestRateBps(rawScore);
        borrower.lastInterestUpdate = block.timestamp;
        borrower.borrowedAmount += amount;
        borrower.lastBorrowTime = block.timestamp;
        totalBorrowed += amount;
        
        require(pyusdToken.transfer(msg.sender, amount), "Transfer failed");
        
        emit Borrowed(msg.sender, amount);
    }
    
    /**
     * @dev Standard repayment or remote repayment from X402Processor.
     */
    function repay(address _borrower, uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        
        accrueInterest(_borrower);
        Borrower storage b = borrowers[_borrower];
        
        require(amount <= b.borrowedAmount + b.accruedInterest, "Amount exceeds total owed");
        
        uint256 remaining = amount;
        
        // Transfer PYUSD from caller to this contract
        require(pyusdToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        // Pay interest first
        if (b.accruedInterest > 0 && remaining > 0) {
            uint256 interestPayment = remaining >= b.accruedInterest ? b.accruedInterest : remaining;
            
            b.accruedInterest -= interestPayment;
            totalInterestCollected += interestPayment;
            remaining -= interestPayment;
            totalYieldPool += interestPayment;
            
            emit InterestPaid(_borrower, interestPayment);
        }
        
        // Then pay principal
        uint256 principalPayment = 0;
        if (remaining > 0) {
            principalPayment = remaining >= b.borrowedAmount ? b.borrowedAmount : remaining;
            b.borrowedAmount -= principalPayment;
            totalBorrowed -= principalPayment;
        }
        
        if (b.borrowedAmount == 0) {
            b.isCollateralLocked = false;
        }
        
        emit Repaid(_borrower, amount);
        
        bool fullyRepaid = (b.borrowedAmount == 0);
        uint256 loanId = nextLoanId++; // Simple loan ID for now
        
        emit LoanRepayment(
            _borrower,
            principalPayment,
            loanId,
            fullyRepaid,
            block.timestamp
        );
        
        repaymentHistory[_borrower].push(RepaymentRecord({
            loanId: loanId,
            amount: principalPayment,
            fullyRepaid: fullyRepaid,
            timestamp: block.timestamp
        }));
    }
    
    function addCollateral(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        
        require(pyusdToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        Borrower storage borrower = borrowers[msg.sender];
        borrower.collateralAmount += amount;
        
        emit CollateralAdded(msg.sender, amount);
    }
    
    function calculatePendingInterest(address lenderAddr) public view returns (uint256) {
        Lender storage l = lenders[lenderAddr];
        if (l.depositedAmount == 0 || totalDeposits == 0) return 0;
        
        uint256 lenderShare = (totalYieldPool * l.depositedAmount) / totalDeposits;
        
        if (lenderShare > l.yieldClaimed) {
            return lenderShare - l.yieldClaimed;
        }
        return 0;
    }
    
    function getLenderPosition(address lender) external view returns (uint256 depositedAmount, uint256 earnedInterest) {
        uint256 pendingInterest = calculatePendingInterest(lender);
        return (lenders[lender].depositedAmount, lenders[lender].earnedInterest + pendingInterest);
    }
    
    function getBorrowerPosition(address borrower) external view returns (uint256 borrowedAmount, uint256 collateralAmount) {
        return (borrowers[borrower].borrowedAmount, borrowers[borrower].collateralAmount);
    }
    
    function getPoolStats() external view returns (
        uint256 _totalDeposits,
        uint256 _totalBorrowed,
        uint256 _availableLiquidity,
        uint256 _interestRate
    ) {
        return (totalDeposits, totalBorrowed, totalDeposits - totalBorrowed, interestRate);
    }
    
    function setInterestRate(uint256 newRate) external onlyOwner {
        require(newRate <= 2000, "Interest rate too high"); // Max 20%
        interestRate = newRate;
    }
    
    function setCollateralRatio(uint256 newRatio) external onlyOwner {
        require(newRatio >= 100 && newRatio <= 300, "Invalid collateral ratio");
        baseCollateralRatio = newRatio;
    }
    
    function emergencyWithdraw() external onlyOwner {
        uint256 balance = pyusdToken.balanceOf(address(this));
        require(pyusdToken.transfer(owner(), balance), "Transfer failed");
    }
}
