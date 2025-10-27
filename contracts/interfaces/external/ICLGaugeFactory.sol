// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ICLGaugeFactory {
    /// @notice Address of the Redistributor contract to send excess emissions to
    function redistributor() external view returns (address);

    /// @notice Sets a new redistributor contract
    /// @param _redistributor Address of the new redistributor contract
    /// @dev Only callable by the emission admin
    /// @dev The redistributor permissions (escrow.team or notifyAdmin in legacy gauge factory) should be transferred beforehand.
    /// @dev Will revert if the current redistributor still holds permissions.
    function setRedistributor(address _redistributor) external;
}
