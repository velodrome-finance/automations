// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from 'hardhat'
import * as assert from 'assert'
import * as dotenv from 'dotenv'
import { registerCustomLogicUpkeepV2_3 } from '../utils'

// Load environment variables
dotenv.config()

const UPKEEP_BALANCE_MONITOR_ADDRESS =
  process.env.UPKEEP_BALANCE_MONITOR_ADDRESS
const KEEPER_REGISTRY_ADDRESS = process.env.KEEPER_REGISTRY_ADDRESS
const AUTOMATION_REGISTRAR_ADDRESS = process.env.AUTOMATION_REGISTRAR_ADDRESS
const LINK_TOKEN_ADDRESS = process.env.LINK_TOKEN_ADDRESS
const BALANCE_MONITOR_UPKEEP_FUND_AMOUNT =
  process.env.BALANCE_MONITOR_UPKEEP_FUND_AMOUNT
const BALANCE_MONITOR_UPKEEP_GAS_LIMIT =
  process.env.BALANCE_MONITOR_UPKEEP_GAS_LIMIT

assert.ok(
  UPKEEP_BALANCE_MONITOR_ADDRESS,
  'UPKEEP_BALANCE_MONITOR_ADDRESS is required',
)
assert.ok(KEEPER_REGISTRY_ADDRESS, 'KEEPER_REGISTRY_ADDRESS is required')
assert.ok(
  AUTOMATION_REGISTRAR_ADDRESS,
  'AUTOMATION_REGISTRAR_ADDRESS is required',
)
assert.ok(LINK_TOKEN_ADDRESS, 'LINK_TOKEN_ADDRESS is required')
assert.ok(
  BALANCE_MONITOR_UPKEEP_FUND_AMOUNT,
  'BALANCE_MONITOR_UPKEEP_FUND_AMOUNT is required',
)
assert.ok(
  BALANCE_MONITOR_UPKEEP_GAS_LIMIT,
  'BALANCE_MONITOR_UPKEEP_GAS_LIMIT is required',
)

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  console.log('Registering balance monitor upkeep...')

  // Get admin account
  const [upkeepAdmin] = await ethers.getSigners()

  // Get LINK token contract
  const linkToken = await ethers.getContractAt(
    'ERC20Mintable',
    LINK_TOKEN_ADDRESS!,
  )

  // Get AutomationRegistrar contract
  const automationRegistrar = await ethers.getContractAt(
    'AutomationRegistrar2_3',
    AUTOMATION_REGISTRAR_ADDRESS!,
  )

  // Get KeeperRegistry contract
  const keeperRegistry = await ethers.getContractAt(
    'IAutomationRegistryMaster2_3',
    KEEPER_REGISTRY_ADDRESS!,
  )

  // Get UpkeepBalanceMonitor contract
  const upkeepBalanceMonitor = await ethers.getContractAt(
    'UpkeepBalanceMonitorV2_3',
    UPKEEP_BALANCE_MONITOR_ADDRESS!,
  )

  // Approve LINK token for AutomationRegistrar
  const linkBalance = await linkToken.balanceOf(upkeepAdmin.address)
  if (linkBalance.lt(BALANCE_MONITOR_UPKEEP_FUND_AMOUNT!)) {
    throw new Error(
      `Insufficient balance. Required: ${BALANCE_MONITOR_UPKEEP_FUND_AMOUNT} LINK`,
    )
  }
  let tx = await linkToken.approve(
    automationRegistrar.address,
    BALANCE_MONITOR_UPKEEP_FUND_AMOUNT!,
  )
  await tx.wait(10);
  console.log('Approved LINK token for AutomationRegistrar')

  // Register custom logic upkeep
  const upkeepId = await registerCustomLogicUpkeepV2_3(
    automationRegistrar,
    'Balance Monitor Upkeep',
    upkeepBalanceMonitor.address,
    upkeepAdmin.address,
    BALANCE_MONITOR_UPKEEP_FUND_AMOUNT!,
    BALANCE_MONITOR_UPKEEP_GAS_LIMIT!,
    LINK_TOKEN_ADDRESS!,
  )
  console.log('Registered balance monitor upkeep', upkeepId.toString())

  // Get trusted forwarder address of the upkeep and set it in balance monitor
  const forwarder = await keeperRegistry.getForwarder(upkeepId)
  await upkeepBalanceMonitor.setTrustedForwarder(forwarder)
  console.log('Set trusted forwarder for balance monitor upkeep')
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
