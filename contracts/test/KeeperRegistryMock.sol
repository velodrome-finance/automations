// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

contract KeeperRegistryMock {
    event UpkeepCancelled(uint256 id);
    event UpkeepWithdrawn(uint256 id, address to);

    function cancelUpkeep(uint256 id) external {
        emit UpkeepCancelled(id);
    }

    function withdrawFunds(uint256 id, address to) external {
        emit UpkeepWithdrawn(id, to);
    }
}
