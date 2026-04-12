// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AgentScoreAttestation
 * @notice Stores AI-agent credit scores on Kite AI chain.
 *         Only the designated oracle can attest new scores.
 */
contract AgentScoreAttestation {

    struct ScoreRecord {
        uint16  score;          // 300 – 850
        uint32  timestamp;
        uint8   paymentRate;    // 0 – 100
        uint8   diversity;
        uint32  txCount;
        uint16  agentAgeDays;
    }

    /// @notice The oracle address that is allowed to call attest()
    address public immutable oracle;

    /// @notice Current score for each agent
    mapping(address => ScoreRecord) public scores;

    /// @notice Full attestation history per agent
    mapping(address => ScoreRecord[]) public history;

    /// @notice Emitted every time a new score is attested
    event ScoreAttested(address indexed agent, uint16 score, uint32 timestamp);

    /// @param _oracle  The wallet that will call attest() (set once, immutable)
    constructor(address _oracle) {
        require(_oracle != address(0), "Oracle address cannot be zero");
        oracle = _oracle;
    }

    modifier onlyOracle() {
        require(msg.sender == oracle, "Only the oracle can attest scores");
        _;
    }

    /**
     * @notice Record a new credit-score attestation for an agent.
     * @param agent         The agent wallet being scored
     * @param score         Credit score (300 – 850)
     * @param paymentRate   Payment success rate 0 – 100
     * @param diversity     Number of unique payees
     * @param txCount       Total transaction count
     * @param agentAgeDays  Age of the agent in days
     */
    function attest(
        address agent,
        uint16  score,
        uint8   paymentRate,
        uint8   diversity,
        uint32  txCount,
        uint16  agentAgeDays
    ) external onlyOracle {
        require(score >= 300 && score <= 850, "Score out of range 300-850");
        require(paymentRate <= 100, "paymentRate must be 0-100");

        ScoreRecord memory record = ScoreRecord({
            score:        score,
            timestamp:    uint32(block.timestamp),
            paymentRate:  paymentRate,
            diversity:    diversity,
            txCount:      txCount,
            agentAgeDays: agentAgeDays
        });

        scores[agent] = record;
        history[agent].push(record);

        emit ScoreAttested(agent, score, uint32(block.timestamp));
    }

    /**
     * @notice Get the current score and timestamp for an agent.
     *         This is what the LendingPool contract calls.
     */
    function getScore(address agent) external view returns (uint16 score, uint32 timestamp) {
        ScoreRecord storage r = scores[agent];
        return (r.score, r.timestamp);
    }

    /**
     * @notice Check whether an agent's score is fresh enough.
     * @param agent          The agent to check
     * @param maxAgeSeconds  Maximum acceptable age in seconds
     */
    function isScoreFresh(address agent, uint32 maxAgeSeconds) external view returns (bool) {
        uint32 ts = scores[agent].timestamp;
        if (ts == 0) return false;
        return (uint32(block.timestamp) - ts) <= maxAgeSeconds;
    }

    /**
     * @notice Return the full current ScoreRecord for an agent.
     */
    function getFullRecord(address agent) external view returns (ScoreRecord memory) {
        return scores[agent];
    }

    /**
     * @notice Return the complete attestation history for an agent.
     */
    function getHistory(address agent) external view returns (ScoreRecord[] memory) {
        return history[agent];
    }
}
