// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Log} from "@chainlink/contracts/src/v0.8/automation/interfaces/ILogAutomation.sol";
import {StableEnumerableSet} from "../libraries/StableEnumerableSet.sol";
import {IVoter} from "../../../vendor/velodrome-contracts/contracts/interfaces/IVoter.sol";
import {IPrices} from "../interfaces/IPrices.sol";
import {ITokenUpkeepManager} from "../interfaces/common/ITokenUpkeepManager.sol";

abstract contract TokenUpkeepManager is ITokenUpkeepManager, Ownable {
    using SafeERC20 for IERC20;
    using StableEnumerableSet for StableEnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.UintSet;

    /// @inheritdoc ITokenUpkeepManager
    address public immutable override linkToken;
    /// @inheritdoc ITokenUpkeepManager
    address public immutable override automationRegistrar;
    /// @inheritdoc ITokenUpkeepManager
    address public immutable override voter;
    /// @inheritdoc ITokenUpkeepManager
    address public override pricesOracle;
    /// @inheritdoc ITokenUpkeepManager
    address public override upkeepBalanceMonitor;
    /// @inheritdoc ITokenUpkeepManager
    uint96 public override newUpkeepFundAmount;
    /// @inheritdoc ITokenUpkeepManager
    address public override trustedForwarder;
    /// @inheritdoc ITokenUpkeepManager
    uint32 public override newUpkeepGasLimit;

    /// @inheritdoc ITokenUpkeepManager
    mapping(uint256 => address) public override tokenUpkeep;
    /// @inheritdoc ITokenUpkeepManager
    mapping(address => bool) public override isTokenUpkeep;
    /// @inheritdoc ITokenUpkeepManager
    mapping(uint256 => uint256) public override finishedUpkeeps;

    /// @inheritdoc ITokenUpkeepManager
    uint256[] public override upkeepIds;

    StableEnumerableSet.AddressSet internal _tokenList;
    EnumerableSet.UintSet internal _cancelledUpkeepIds;

    uint256 internal constant TOKENS_PER_UPKEEP = 100;
    uint256 internal constant UPKEEP_CANCEL_BUFFER = 20;
    uint8 internal constant CONDITIONAL_TRIGGER_TYPE = 0;
    string internal constant UPKEEP_NAME = "Token upkeep";

    bytes32 private constant WHITELIST_TOKEN_EVENT = 0x44948130cf88523dbc150908a47dd6332c33a01a3869d7f2fa78e51d5a5f9c57;

    constructor(
        address _linkToken,
        address _automationRegistrar,
        address _voter,
        address _pricesOracle,
        address _upkeepBalanceMonitor,
        uint96 _newUpkeepFundAmount,
        uint32 _newUpkeepGasLimit
    ) {
        linkToken = _linkToken;
        automationRegistrar = _automationRegistrar;
        voter = _voter;
        pricesOracle = _pricesOracle;
        upkeepBalanceMonitor = _upkeepBalanceMonitor;
        newUpkeepFundAmount = _newUpkeepFundAmount;
        newUpkeepGasLimit = _newUpkeepGasLimit;
    }

    /// @inheritdoc ITokenUpkeepManager
    function performUpkeep(bytes calldata performData) external override {
        if (msg.sender != trustedForwarder) {
            revert UnauthorizedSender();
        }
        (PerformAction action, address token) = abi.decode(performData, (PerformAction, address));
        if (action == PerformAction.RegisterToken) {
            _registerToken(token);
        } else if (action == PerformAction.DeregisterToken) {
            _deregisterToken(token);
        } else {
            revert InvalidAction();
        }
    }

    /// @inheritdoc ITokenUpkeepManager
    function fetchFirstPrice(
        uint256 _startIndex,
        uint256 _endIndex
    ) external view override returns (address, uint256, uint256) {
        address token;
        for (uint256 i = _startIndex; i < _endIndex; i++) {
            token = _tokenList.at(i);
            if (token != address(0)) {
                return (token, i, IPrices(pricesOracle).fetchPrice(token));
            }
        }
        return (address(0), 0, 0);
    }

    /// @inheritdoc ITokenUpkeepManager
    function storePriceAndCleanup(
        address _token,
        uint256 _price,
        uint256 _fetchInterval,
        bool _isLastIndex
    ) external override returns (bool stored) {
        if (!isTokenUpkeep[msg.sender]) {
            revert UnauthorizedSender();
        }
        uint256 timestamp = (block.timestamp / _fetchInterval) * _fetchInterval;
        address _pricesOracle = pricesOracle;
        if (IPrices(_pricesOracle).latest(_token, block.timestamp, _fetchInterval) == 0) {
            IPrices(_pricesOracle).storePrice(_token, _price, timestamp);
            stored = true;
            emit FetchedTokenPrice(_token, _price);
        }
        if (_isLastIndex) {
            _finishUpkeepAndCleanup(timestamp);
        }
    }

    /// @inheritdoc ITokenUpkeepManager
    function finishUpkeepAndCleanup(uint256 _lastRun) external override {
        if (!isTokenUpkeep[msg.sender]) {
            revert UnauthorizedSender();
        }
        _finishUpkeepAndCleanup(_lastRun);
    }

    /// @inheritdoc ITokenUpkeepManager
    function registerTokens(address[] calldata _tokens) external override onlyOwner {
        uint256 length = _tokens.length;
        address token;
        for (uint256 i = 0; i < length; i++) {
            token = _tokens[i];
            if (_tokenList.contains(token)) {
                revert TokenAlreadyRegistered();
            }
            if (!IVoter(voter).isWhitelistedToken(token)) {
                revert TokenNotWhitelisted();
            }
        }
        for (uint256 i = 0; i < length; i++) {
            _registerToken(_tokens[i]);
        }
    }

    /// @inheritdoc ITokenUpkeepManager
    function deregisterTokens(address[] calldata _tokens) external override onlyOwner {
        uint256 length = _tokens.length;
        for (uint256 i = 0; i < length; i++) {
            if (!_tokenList.contains(_tokens[i])) {
                revert TokenNotRegistered();
            }
        }
        for (uint256 i = 0; i < length; i++) {
            _deregisterToken(_tokens[i]);
        }
    }

    /// @inheritdoc ITokenUpkeepManager
    function withdrawCancelledUpkeeps(uint256 _startIndex, uint256 _endIndex) external override onlyOwner {
        uint256 length = _cancelledUpkeepIds.length();
        _endIndex = _endIndex > length ? length : _endIndex;
        if (_startIndex >= _endIndex) {
            revert InvalidIndex();
        }
        for (uint256 i = _endIndex; i > _startIndex; i--) {
            _withdrawUpkeep(_cancelledUpkeepIds.at(i - 1));
        }
    }

    /// @inheritdoc ITokenUpkeepManager
    function withdrawLinkBalance() external override onlyOwner {
        uint256 balance = IERC20(linkToken).balanceOf(address(this));
        if (balance == 0) {
            revert NoLinkBalance();
        }
        IERC20(linkToken).safeTransfer(msg.sender, balance);
        emit LinkBalanceWithdrawn(msg.sender, balance);
    }

    /// @inheritdoc ITokenUpkeepManager
    function cleanupTokenList() external override onlyOwner {
        _cleanupTokenList();
    }

    /// @inheritdoc ITokenUpkeepManager
    function setNewUpkeepGasLimit(uint32 _newUpkeepGasLimit) external override onlyOwner {
        newUpkeepGasLimit = _newUpkeepGasLimit;
        emit NewUpkeepGasLimitSet(_newUpkeepGasLimit);
    }

    /// @inheritdoc ITokenUpkeepManager
    function setNewUpkeepFundAmount(uint96 _newUpkeepFundAmount) external override onlyOwner {
        newUpkeepFundAmount = _newUpkeepFundAmount;
        emit NewUpkeepFundAmountSet(_newUpkeepFundAmount);
    }

    /// @inheritdoc ITokenUpkeepManager
    function setTrustedForwarder(address _trustedForwarder) external override onlyOwner {
        if (_trustedForwarder == address(0)) {
            revert AddressZeroNotAllowed();
        }
        trustedForwarder = _trustedForwarder;
        emit TrustedForwarderSet(_trustedForwarder);
    }

    /// @inheritdoc ITokenUpkeepManager
    function setUpkeepBalanceMonitor(address _upkeepBalanceMonitor) external override onlyOwner {
        if (_upkeepBalanceMonitor == address(0)) {
            revert AddressZeroNotAllowed();
        }
        upkeepBalanceMonitor = _upkeepBalanceMonitor;
        emit UpkeepBalanceMonitorSet(_upkeepBalanceMonitor);
    }

    /// @inheritdoc ITokenUpkeepManager
    function setPricesOracle(address _pricesOracle) external override onlyOwner {
        if (_pricesOracle == address(0)) {
            revert AddressZeroNotAllowed();
        }
        pricesOracle = _pricesOracle;
        emit PricesOracleSet(_pricesOracle);
    }

    /// @inheritdoc ITokenUpkeepManager
    function checkLog(
        Log calldata _log,
        bytes memory
    ) external view override returns (bool upkeepNeeded, bytes memory performData) {
        bytes32 eventSignature = _log.topics[0];
        if (eventSignature == WHITELIST_TOKEN_EVENT) {
            address token = _bytes32ToAddress(_log.topics[2]);
            bool enabled = _bytes32ToBool(_log.topics[3]);
            if (enabled) {
                if (!_tokenList.contains(token)) {
                    return (true, abi.encode(PerformAction.RegisterToken, token));
                }
            } else {
                if (_tokenList.contains(token)) {
                    return (true, abi.encode(PerformAction.DeregisterToken, token));
                }
            }
        }
    }

    /// @inheritdoc ITokenUpkeepManager
    function tokenList(
        uint256 _startIndex,
        uint256 _endIndex
    ) external view override returns (address[] memory tokens) {
        uint256 length = _tokenList.length();
        _endIndex = _endIndex > length ? length : _endIndex;
        uint256 size = _endIndex - _startIndex;
        tokens = new address[](size);
        for (uint256 i = 0; i < size; i++) {
            tokens[i] = _tokenList.at(_startIndex + i);
        }
    }

    /// @inheritdoc ITokenUpkeepManager
    function tokenAt(uint256 _index) external view override returns (address) {
        return _tokenList.at(_index);
    }

    /// @inheritdoc ITokenUpkeepManager
    function tokenListLength() external view override returns (uint256) {
        return _tokenList.length();
    }

    /// @inheritdoc ITokenUpkeepManager
    function tokenCount() external view override returns (uint256) {
        return _tokenList.lengthWithoutZeroes();
    }

    /// @inheritdoc ITokenUpkeepManager
    function upkeepCount() external view override returns (uint256) {
        return upkeepIds.length;
    }

    /// @inheritdoc ITokenUpkeepManager
    function cancelledUpkeeps(
        uint256 _startIndex,
        uint256 _endIndex
    ) external view override returns (uint256[] memory cancelledUpkeepIds) {
        uint256 length = _cancelledUpkeepIds.length();
        _endIndex = _endIndex > length ? length : _endIndex;
        uint256 size = _endIndex - _startIndex;
        cancelledUpkeepIds = new uint256[](size);
        for (uint256 i = 0; i < size; i++) {
            cancelledUpkeepIds[i] = _cancelledUpkeepIds.at(_startIndex + i);
        }
    }

    /// @inheritdoc ITokenUpkeepManager
    function cancelledUpkeepCount() external view override returns (uint256) {
        return _cancelledUpkeepIds.length();
    }

    /// @inheritdoc ITokenUpkeepManager
    function fetchInterval() external view override returns (uint256) {
        return IPrices(pricesOracle).timeWindow();
    }

    /// @dev Assumes that the token is not already registered
    function _registerToken(address _token) internal {
        uint256 _tokenCount = _tokenList.length();
        _tokenList.add(_token);
        if (_tokenCount % TOKENS_PER_UPKEEP == 0) {
            _registerTokenUpkeep();
        }
        emit TokenRegistered(_token);
    }

    /// @dev Assumes that the token is already registered
    function _deregisterToken(address _token) internal {
        _tokenList.remove(_token);
        uint256 _tokenCount = _tokenList.lengthWithoutZeroes();
        uint256 _currentUpkeep = upkeepIds.length - 1;
        uint256 currentUpkeepStartIndex = _getNextUpkeepStartIndex(_currentUpkeep);
        if (_tokenCount + UPKEEP_CANCEL_BUFFER <= currentUpkeepStartIndex || _tokenCount == 0) {
            _cancelTokenUpkeep(upkeepIds[_currentUpkeep]);
        }
        emit TokenDeregistered(_token);
    }

    function _registerTokenUpkeep() internal virtual;

    function _cancelTokenUpkeep(uint256 _upkeepId) internal virtual;

    function _withdrawUpkeep(uint256 _upkeepId) internal virtual;

    function _finishUpkeepAndCleanup(uint256 _lastRun) internal {
        finishedUpkeeps[_lastRun]++;
        if (finishedUpkeeps[_lastRun] == upkeepIds.length) {
            _cleanupTokenList();
        }
    }

    function _cleanupTokenList() internal {
        _tokenList.cleanup();
        emit TokenListCleaned();
    }

    function _getNextUpkeepStartIndex(uint256 _upkeepCount) internal pure returns (uint256) {
        return _upkeepCount * TOKENS_PER_UPKEEP;
    }

    function _bytes32ToAddress(bytes32 _address) internal pure returns (address) {
        return address(uint160(uint256(_address)));
    }

    function _bytes32ToBool(bytes32 _bool) internal pure returns (bool) {
        return _bool == bytes32(uint256(1));
    }
}
