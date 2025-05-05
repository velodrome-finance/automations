// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
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

        uint256 _endIndex = _adjustedEndIndex();
        (uint256 _currentIndex, address token, uint256 price) = abi.decode(_performData, (uint256, address, uint256));

        if (lastRun + FETCH_INTERVAL > block.timestamp || _currentIndex > _endIndex) {
            revert UpkeepNotNeeded();
        }
        bool isLastIndex = _currentIndex == _endIndex - 1;
        bool success;
        if (token != address(0)) {
            success = ITokenUpkeepManager(tokenUpkeepManager).storePriceAndCleanup(token, price, isLastIndex);
        }

        if (isLastIndex) {
            currentIndex = startIndex;
            lastRun = (block.timestamp / FETCH_INTERVAL) * FETCH_INTERVAL;
        } else {
            currentIndex = _currentIndex + 1;
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
    function checkUpkeep(bytes calldata) external view override returns (bool upkeepNeeded, bytes memory performData) {
        if (lastRun + FETCH_INTERVAL < block.timestamp) {
            uint256 _currentIndex = currentIndex;
            uint256 _endIndex = _adjustedEndIndex();

            (address token, uint256 index, uint256 price) = ITokenUpkeepManager(tokenUpkeepManager).fetchFirstPrice(
                _currentIndex,
                _endIndex
            );

            if (token != address(0)) {
                return (true, abi.encode(index, token, price));
            }
            return (true, abi.encode(_endIndex - 1, address(0), 0));
        }
    }

    function _adjustedEndIndex() internal view returns (uint256) {
        uint256 listLength = ITokenUpkeepManager(tokenUpkeepManager).tokenListLength();
        return listLength < endIndex ? listLength : endIndex;
    }
}
