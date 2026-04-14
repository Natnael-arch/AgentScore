// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";

contract AgentRegistry is Ownable {
    struct Agent {
        string name;
        string agentType;
        string modelHash;
        uint256 score;
        bool registered;
        uint256 lastUpdated;
    }

    mapping(address => Agent) public agents;
    mapping(address => bool) public authorizedScorers;

    event AgentRegistered(address indexed agentAddress, string name, string agentType);
    event ScoreUpdated(address indexed agentAddress, uint256 newScore, address indexed scorer);
    event ScorerAuthorized(address indexed scorer, bool status);

    modifier onlyAuthorized() {
        require(owner() == msg.sender || authorizedScorers[msg.sender], "Not authorized");
        _;
    }

    function authorizeScorer(address _scorer, bool _status) external onlyOwner {
        authorizedScorers[_scorer] = _status;
        emit ScorerAuthorized(_scorer, _status);
    }

    function registerAgent(
        string memory _name,
        string memory _agentType,
        string memory _modelHash
    ) external {
        _performRegistration(msg.sender, _name, _agentType, _modelHash);
    }

    function adminRegister(
        address _agentAddress,
        string memory _name,
        string memory _agentType,
        string memory _modelHash
    ) external onlyAuthorized {
        _performRegistration(_agentAddress, _name, _agentType, _modelHash);
    }

    function _performRegistration(
        address _agentAddress,
        string memory _name,
        string memory _agentType,
        string memory _modelHash
    ) internal {
        require(!agents[_agentAddress].registered, "Agent already registered");
        agents[_agentAddress] = Agent({
            name: _name,
            agentType: _agentType,
            modelHash: _modelHash,
            score: 300,
            registered: true,
            lastUpdated: block.timestamp
        });
        emit AgentRegistered(_agentAddress, _name, _agentType);
    }

    function updateScore(address _agentAddress, uint256 _newScore) external onlyAuthorized {
        require(agents[_agentAddress].registered, "Agent not registered");
        require(_newScore >= 300 && _newScore <= 850, "Invalid score range");

        agents[_agentAddress].score = _newScore;
        agents[_agentAddress].lastUpdated = block.timestamp;

        emit ScoreUpdated(_agentAddress, _newScore, msg.sender);
    }

    function getAgent(address _agentAddress) external view returns (Agent memory) {
        return agents[_agentAddress];
    }
    
    function getScore(address _agentAddress) external view returns (uint256) {
        return agents[_agentAddress].score;
    }
}
