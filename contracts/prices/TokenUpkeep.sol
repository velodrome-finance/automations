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
    uint256 public override currentInterval;
    /// @inheritdoc ITokenUpkeep
    uint256 public override lastRun;
    /// @inheritdoc ITokenUpkeep
    address public override trustedForwarder;

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
        (uint256 _currentIndex, uint256 _currentInterval, address token, uint256 price) = abi.decode(
            _performData,
            (uint256, uint256, address, uint256)
        );

        if (lastRun + _currentInterval > block.timestamp || _currentIndex > _endIndex) {
            revert UpkeepNotNeeded();
        }
        bool isLastIndex = _currentIndex == _endIndex - 1;
        bool success;
        address _tokenUpkeepManager = tokenUpkeepManager;
        if (token != address(0)) {
            success = ITokenUpkeepManager(_tokenUpkeepManager).storePriceAndCleanup(token, price, isLastIndex);
        }

        if (isLastIndex) {
            currentIndex = startIndex;
            lastRun = (block.timestamp / _currentInterval) * _currentInterval;
            if (token == address(0)) ITokenUpkeepManager(_tokenUpkeepManager).finishUpkeepAndCleanup(lastRun);
        } else {
            if (currentIndex == startIndex) currentInterval = ITokenUpkeepManager(_tokenUpkeepManager).fetchInterval();
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
        address _tokenUpkeepManager = tokenUpkeepManager;
        uint256 _currentIndex = currentIndex;

        uint256 fetchInterval = _currentIndex > startIndex
            ? currentInterval
            : ITokenUpkeepManager(_tokenUpkeepManager).fetchInterval();

        if (lastRun + fetchInterval < block.timestamp) {
            uint256 _endIndex = _adjustedEndIndex();

            (address token, uint256 index, uint256 price) = ITokenUpkeepManager(_tokenUpkeepManager).fetchFirstPrice(
                _currentIndex,
                _endIndex
            );

            // If a valid token is found, encode its info for processing.
            // Otherwise, encode the last index with zeros to advance the current index
            // and complete the processing cycle even when no tokens need updating.
            return
                token != address(0)
                    ? (true, abi.encode(index, fetchInterval, token, price))
                    : (true, abi.encode(_endIndex - 1, fetchInterval, address(0), 0));
        }
    }

    function _adjustedEndIndex() internal view returns (uint256) {
        uint256 listLength = ITokenUpkeepManager(tokenUpkeepManager).tokenListLength();
        return listLength < endIndex ? listLength : endIndex;
    }
}
