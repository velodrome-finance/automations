// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {StableEnumerableSet} from "./libraries/StableEnumerableSet.sol";
import {Log} from "@chainlink/contracts/src/v0.8/automation/interfaces/ILogAutomation.sol";
import {IVoter} from "../../vendor/velodrome-contracts/contracts/interfaces/IVoter.sol";
import {IKeeperRegistryMaster} from "@chainlink/contracts/src/v0.8/automation/interfaces/v2_1/IKeeperRegistryMaster.sol";
import {IAutomationRegistrarV2_1} from "../interfaces/v2_1/IAutomationRegistrarV2_1.sol";
import {IUpkeepBalanceMonitor} from "../interfaces/IUpkeepBalanceMonitor.sol";
import {IPrices} from "./interfaces/IPrices.sol";
import {TokenUpkeep} from "./TokenUpkeep.sol";
import {ITokenUpkeepManager} from "./interfaces/ITokenUpkeepManager.sol";

contract TokenUpkeepManager is ITokenUpkeepManager, Ownable {
    using SafeERC20 for IERC20;
    using StableEnumerableSet for StableEnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.UintSet;

    /// @inheritdoc ITokenUpkeepManager
    address public immutable override linkToken;
    /// @inheritdoc ITokenUpkeepManager
    address public immutable override keeperRegistry;
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
    EnumerableSet.UintSet private _cancelledUpkeepIds;

    uint256 private constant FETCH_INTERVAL = 1 hours;
    uint256 private constant TOKENS_PER_UPKEEP = 100;
    uint256 private constant UPKEEP_CANCEL_BUFFER = 20;
    uint8 private constant CONDITIONAL_TRIGGER_TYPE = 0;
    string private constant UPKEEP_NAME = "Token upkeep";

    bytes32 private constant WHITELIST_TOKEN_EVENT = 0x44948130cf88523dbc150908a47dd6332c33a01a3869d7f2fa78e51d5a5f9c57;

    constructor(
        address _linkToken,
        address _keeperRegistry,
        address _automationRegistrar,
        address _voter,
        address _pricesOracle,
        address _upkeepBalanceMonitor,
        uint96 _newUpkeepFundAmount,
        uint32 _newUpkeepGasLimit
    ) {
        linkToken = _linkToken;
        keeperRegistry = _keeperRegistry;
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
    ) external view override returns (address token, uint256 index, uint256 price) {
        for (uint256 i = _startIndex; i < _endIndex; i++) {
            token = _tokenList.at(i);
            if (token != address(0)) {
                index = i;
                price = _fetchPrice(token);
                return (token, index, price);
            }
        }
    }

    /// @inheritdoc ITokenUpkeepManager
    function storePriceAndCleanup(
        address _token,
        uint256 _price,
        bool _isLastIndex
    ) external override returns (bool stored) {
        if (!isTokenUpkeep[msg.sender]) {
            revert UnauthorizedSender();
        }
        if (IPrices(pricesOracle).latest(_token, block.timestamp) == 0) {
            address[] memory tokens = new address[](1);
            tokens[0] = _token;
            uint256[] memory prices = new uint256[](1);
            prices[0] = _price;
            IPrices(pricesOracle).storePrices(tokens, prices);
            stored = true;
            emit FetchedTokenPrice(_token, _price);
        }
        if (_isLastIndex) {
            uint256 lastHour = (block.timestamp / FETCH_INTERVAL) * FETCH_INTERVAL;
            finishedUpkeeps[lastHour] += 1;
            if (finishedUpkeeps[lastHour] == upkeepIds.length) {
                _cleanupTokenList();
            }
        }
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

    function _fetchPrice(address _token) internal view returns (uint256) {
        address[] memory tokens = new address[](1);
        tokens[0] = _token;
        uint256[] memory prices = IPrices(pricesOracle).fetchPrices(tokens);
        return prices[0];
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

    function _registerTokenUpkeep() internal {
        uint256 startIndex = _getNextUpkeepStartIndex(upkeepIds.length);
        uint256 endIndex = startIndex + TOKENS_PER_UPKEEP;
        address _tokenUpkeep = address(new TokenUpkeep(startIndex, endIndex));
        isTokenUpkeep[_tokenUpkeep] = true;
        IAutomationRegistrarV2_1.RegistrationParams memory params = IAutomationRegistrarV2_1.RegistrationParams({
            name: UPKEEP_NAME,
            encryptedEmail: "",
            upkeepContract: _tokenUpkeep,
            gasLimit: newUpkeepGasLimit,
            adminAddress: address(this),
            triggerType: CONDITIONAL_TRIGGER_TYPE,
            checkData: "",
            triggerConfig: "",
            offchainConfig: "",
            amount: newUpkeepFundAmount
        });
        uint256 upkeepId = _registerUpkeep(params);
        upkeepIds.push(upkeepId);
        tokenUpkeep[upkeepId] = _tokenUpkeep;
        address forwarder = IKeeperRegistryMaster(keeperRegistry).getForwarder(upkeepId);
        TokenUpkeep(_tokenUpkeep).setTrustedForwarder(forwarder);
        IUpkeepBalanceMonitor(upkeepBalanceMonitor).addToWatchList(upkeepId);
        emit TokenUpkeepRegistered(_tokenUpkeep, upkeepId, startIndex, endIndex);
    }

    function _registerUpkeep(IAutomationRegistrarV2_1.RegistrationParams memory _params) internal returns (uint256) {
        IERC20(linkToken).safeIncreaseAllowance(automationRegistrar, _params.amount);
        uint256 upkeepID = IAutomationRegistrarV2_1(automationRegistrar).registerUpkeep(_params);
        if (upkeepID != 0) {
            return upkeepID;
        } else {
            revert AutoApproveDisabled();
        }
    }

    function _cancelTokenUpkeep(uint256 _upkeepId) internal {
        upkeepIds.pop();
        delete isTokenUpkeep[tokenUpkeep[_upkeepId]];
        delete tokenUpkeep[_upkeepId];
        _cancelledUpkeepIds.add(_upkeepId);
        IUpkeepBalanceMonitor(upkeepBalanceMonitor).removeFromWatchList(_upkeepId);
        IKeeperRegistryMaster(keeperRegistry).cancelUpkeep(_upkeepId);
        emit TokenUpkeepCancelled(_upkeepId);
    }

    function _cleanupTokenList() internal {
        _tokenList.cleanup();
        emit TokenListCleaned();
    }

    function _withdrawUpkeep(uint256 _upkeepId) internal {
        _cancelledUpkeepIds.remove(_upkeepId);
        IKeeperRegistryMaster(keeperRegistry).withdrawFunds(_upkeepId, address(this));
        emit TokenUpkeepWithdrawn(_upkeepId);
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
