// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPrices} from "./interfaces/IPrices.sol";
import {ITokenUpkeep} from "./interfaces/ITokenUpkeep.sol";
import {ITokenUpkeepManager} from "./interfaces/ITokenUpkeepManager.sol";

contract TokenUpkeep is ITokenUpkeep, Ownable {
    /// @inheritdoc ITokenUpkeep
    address public immutable override tokenUpkeepManager;
    /// @inheritdoc ITokenUpkeep
    uint256 public immutable override startIndex;
    /// @inheritdoc ITokenUpkeep
    uint256 public immutable override endIndex;

    /// @inheritdoc ITokenUpkeep
    uint256 public override currentIndex;
    /// @inheritdoc ITokenUpkeep
    uint256 public override lastRun;
    /// @inheritdoc ITokenUpkeep
    address public override trustedForwarder;

    uint256 private constant FETCH_INTERVAL = 1 hours;

    constructor(uint256 _startIndex, uint256 _endIndex) {
        tokenUpkeepManager = msg.sender;
        startIndex = _startIndex;
        endIndex = _endIndex;
        currentIndex = _startIndex;
    }

    /// @inheritdoc ITokenUpkeep
    function performUpkeep(bytes calldata _performData) external override {
        if (msg.sender != trustedForwarder) revert UnauthorizedSender();

        uint256 _currentIndex = currentIndex;
        uint256 _endIndex = _adjustedEndIndex();
        if (!_upkeepNeeded(_currentIndex, _endIndex)) revert UpkeepNotNeeded();

        (address token, uint256 price) = abi.decode(_performData, (address, uint256));
        bool success = ITokenUpkeepManager(tokenUpkeepManager).storePrice(token, price);

        uint256 nextIndex = _currentIndex + 1;
        if (nextIndex < _endIndex) {
            currentIndex = nextIndex;
        } else {
            currentIndex = startIndex;
            lastRun = (block.timestamp / 1 hours) * 1 hours;
        }
        emit TokenUpkeepPerformed(_currentIndex, success);
    }

    /// @inheritdoc ITokenUpkeep
    function setTrustedForwarder(address _trustedForwarder) external override onlyOwner {
        if (_trustedForwarder == address(0)) {
            revert AddressZeroNotAllowed();
        }
        trustedForwarder = _trustedForwarder;
        emit TrustedForwarderSet(_trustedForwarder);
    }

    /// @inheritdoc ITokenUpkeep
    function checkUpkeep(bytes calldata) external view override returns (bool, bytes memory) {
        uint256 _currentIndex = currentIndex;
        if (_upkeepNeeded(_currentIndex, _adjustedEndIndex())) {
            (address token, uint256 price) = ITokenUpkeepManager(tokenUpkeepManager).fetchPriceByIndex(_currentIndex);
            return (true, abi.encode(token, price));
        }
    }

    function _upkeepNeeded(uint256 _currentIndex, uint256 _endIndex) internal view returns (bool) {
        return lastRun + FETCH_INTERVAL < block.timestamp && _currentIndex < _endIndex;
    }

    function _adjustedEndIndex() internal view returns (uint256) {
        uint256 tokenCount = ITokenUpkeepManager(tokenUpkeepManager).tokenCount();
        return tokenCount < endIndex ? tokenCount : endIndex;
    }
}
