// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

contract KeeperRegistryMock {
    event UpkeepCancelled(uint256 id);
    event UpkeepWithdrawn(uint256 id, address to);

    function getBalance(uint256 _id) external pure returns (uint96) {
        return uint96(0);
    }

    function getMinBalance(uint256 _id) external pure returns (uint96) {
        return uint96(0);
    }

    function cancelUpkeep(uint256 _id) external {
        emit UpkeepCancelled(_id);
    }

    function withdrawFunds(uint256 _id, address _to) external {
        emit UpkeepWithdrawn(_id, _to);
    }
}
