// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ILogAutomation, Log} from "@chainlink/contracts/src/v0.8/automation/interfaces/ILogAutomation.sol";
import {AutomationCompatibleInterface} from "@chainlink/contracts/src/v0.8/automation/interfaces/AutomationCompatibleInterface.sol";
import {IPricesKeeper} from "./interfaces/IPricesKeeper.sol";
import {IPrices} from "./interfaces/IPrices.sol";

contract PricesKeeper is IPricesKeeper, ILogAutomation, AutomationCompatibleInterface, Ownable {
    /// @inheritdoc IPricesKeeper
    address public immutable override voter;
    /// @inheritdoc IPricesKeeper
    address public immutable override prices;
    /// @inheritdoc IPricesKeeper
    address[] public override whitelistedTokens;
    /// @inheritdoc IPricesKeeper
    uint32 public override batchSize;
    /// @inheritdoc IPricesKeeper
    mapping(uint256 => uint32) public batchIndex;
    /// @inheritdoc IPricesKeeper
    uint256 public override lastFetchTimestamp;

    uint256 private constant FETCH_INTERVAL = 1 hours;

    bytes32 private constant WHITELIST_TOKEN_EVENT = 0x44948130cf88523dbc150908a47dd6332c33a01a3869d7f2fa78e51d5a5f9c57;

    enum PerformAction {
        FetchPrices,
        WhitelistToken
    }

    error InvalidAction();
    error AlreadyFetched();

    constructor(address _voter, address _prices, uint32 _batchSize, address[] memory _initialWhitelistedTokens) {
        voter = _voter;
        prices = _prices;
        batchSize = _batchSize;
        whitelistedTokens = _initialWhitelistedTokens;
    }

    /// @inheritdoc ILogAutomation
    /// @notice Called by the automation DON when a new log is emitted by the target contract
    /// @dev This function is called by the automation DON to check if any action is needed
    /// @return upkeepNeeded True if any action is needed according to the log
    /// @return performData Encoded action and data passed to performUpkeep if upkeepNeeded is true
    function checkLog(
        Log calldata log,
        bytes memory
    ) external view override returns (bool upkeepNeeded, bytes memory performData) {
        bytes32 eventSignature = log.topics[0];
        if (eventSignature == WHITELIST_TOKEN_EVENT) {
            address token = _bytes32ToAddress(log.topics[2]);
            return (true, abi.encode(PerformAction.WhitelistToken, abi.encode(token)));
        }
    }

    /// @inheritdoc AutomationCompatibleInterface
    /// @notice Check if prices need to be fetched
    /// @dev This function is called by the automation DON to check if any upkeeps are needed
    /// @return upkeepNeeded True if any upkeep is needed
    /// @return performData Encoded action and data passed to performUpkeep if upkeepNeeded is true
    function checkUpkeep(bytes calldata) external view override returns (bool upkeepNeeded, bytes memory performData) {
        if (block.timestamp < lastFetchTimestamp + FETCH_INTERVAL) {
            return (false, "Interval not reached");
        }
        if (whitelistedTokens.length == 0) {
            return (false, "No tokens to fetch");
        }
        return (true, abi.encode(PerformAction.FetchPrices, ""));
    }

    /// @inheritdoc AutomationCompatibleInterface
    /// @notice Perform the upkeep action according to the performData passed from checkUpkeep/checkLog
    /// @dev This function is called by the automation network to perform the upkeep action
    function performUpkeep(
        bytes calldata performData
    ) external override(ILogAutomation, AutomationCompatibleInterface) {
        (PerformAction action, bytes memory data) = abi.decode(performData, (PerformAction, bytes));
        if (action == PerformAction.FetchPrices) {
            _performFetchPrices();
        } else if (action == PerformAction.WhitelistToken) {
            address token = abi.decode(data, (address));
            _addWhitelistedToken(token);
        } else {
            revert InvalidAction();
        }
    }

    function _performFetchPrices() internal {
        uint256 timestamp = (block.timestamp / 1 hours) * 1 hours;
        uint32 _batchIndex = batchIndex[timestamp];

        if (_batchIndex >= whitelistedTokens.length) {
            revert AlreadyFetched();
        }

        uint32 _batchSize = batchSize;
        if (_batchIndex + _batchSize > whitelistedTokens.length) {
            _batchSize = uint32(whitelistedTokens.length - _batchIndex);
        }

        IERC20[] memory _tokens = new IERC20[](_batchSize);
        for (uint32 i = 0; i < _batchSize; i++) {
            _tokens[i] = IERC20(whitelistedTokens[_batchIndex + i]);
        }

        _fetchPrices(_tokens);

        _batchIndex += uint32(_tokens.length);

        if (_batchIndex >= whitelistedTokens.length) {
            lastFetchTimestamp = timestamp;
        }
        batchIndex[timestamp] = _batchIndex;
    }

    function _fetchPrices(IERC20[] memory _tokens) internal {
        IPrices(prices).fetchPrices(_tokens);
        emit FetchedPrices(_tokens);
    }

    function _addWhitelistedToken(address _token) internal {
        whitelistedTokens.push(_token);
        emit WhitelistedTokenAdded(_token);
    }

    function _bytes32ToAddress(bytes32 _address) internal pure returns (address) {
        return address(uint160(uint256(_address)));
    }

    /// @inheritdoc IPricesKeeper
    function setBatchSize(uint32 _batchSize) external override onlyOwner {
        batchSize = _batchSize;
        emit BatchSizeSet(_batchSize);
    }
}
