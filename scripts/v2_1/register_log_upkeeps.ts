// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from 'hardhat'
import { BigNumber } from 'ethers'
import * as assert from 'assert'
import * as dotenv from 'dotenv'
import { registerLogTriggerUpkeep } from '../utils'

// Load environment variables
dotenv.config()

const GAUGE_UPKEEP_MANAGER_ADDRESS = process.env.GAUGE_UPKEEP_MANAGER_ADDRESS
const VOTER_ADDRESS = process.env.VOTER_ADDRESS
const KEEPER_REGISTRY_ADDRESS = process.env.KEEPER_REGISTRY_ADDRESS
const AUTOMATION_REGISTRAR_ADDRESS = process.env.AUTOMATION_REGISTRAR_ADDRESS
const LINK_TOKEN_ADDRESS = process.env.LINK_TOKEN_ADDRESS
const UPKEEP_BALANCE_MONITOR_ADDRESS =
  process.env.UPKEEP_BALANCE_MONITOR_ADDRESS
const LOG_UPKEEP_FUND_AMOUNT = process.env.LOG_UPKEEP_FUND_AMOUNT
const LOG_UPKEEP_GAS_LIMIT = process.env.LOG_UPKEEP_GAS_LIMIT

assert.ok(
  GAUGE_UPKEEP_MANAGER_ADDRESS,
  'GAUGE_UPKEEP_MANAGER_ADDRESS is required',
)
assert.ok(VOTER_ADDRESS, 'VOTER_ADDRESS is required')
assert.ok(KEEPER_REGISTRY_ADDRESS, 'KEEPER_REGISTRY_ADDRESS is required')
assert.ok(
  AUTOMATION_REGISTRAR_ADDRESS,
  'AUTOMATION_REGISTRAR_ADDRESS is required',
)
assert.ok(LINK_TOKEN_ADDRESS, 'LINK_TOKEN_ADDRESS is required')
assert.ok(
  UPKEEP_BALANCE_MONITOR_ADDRESS,
  'UPKEEP_BALANCE_MONITOR_ADDRESS is required',
)
assert.ok(LOG_UPKEEP_FUND_AMOUNT, 'LOG_UPKEEP_FUND_AMOUNT is required')
assert.ok(LOG_UPKEEP_GAS_LIMIT, 'LOG_UPKEEP_GAS_LIMIT is required')

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  console.log('Registering log upkeeps...')

  // Get admin account
  const [upkeepAdmin] = await ethers.getSigners()

  // Get LINK token contract
  const linkToken = await ethers.getContractAt(
    'ERC20Mintable',
    LINK_TOKEN_ADDRESS!,
  )

  // Get AutomationRegistrar contract
  const automationRegistrar = await ethers.getContractAt(
    'AutomationRegistrar2_1',
    AUTOMATION_REGISTRAR_ADDRESS!,
  )

  // Get KeeperRegistry contract
  const keeperRegistry = await ethers.getContractAt(
    'IKeeperRegistryMaster',
    KEEPER_REGISTRY_ADDRESS!,
  )

  // Get GaugeUpkeepManager contract
  const gaugeUpkeepManager = await ethers.getContractAt(
    'GaugeUpkeepManagerV2_1',
    GAUGE_UPKEEP_MANAGER_ADDRESS!,
  )

  // Get Voter contract
  const voter = await ethers.getContractAt('Voter', VOTER_ADDRESS!)

  // Get UpkeepBalanceMonitor contract
  const upkeepBalanceMonitor = await ethers.getContractAt(
    'UpkeepBalanceMonitor',
    UPKEEP_BALANCE_MONITOR_ADDRESS!,
  )

  // Approve LINK token for AutomationRegistrar
  const totalLinkRequired = BigNumber.from(LOG_UPKEEP_FUND_AMOUNT!).mul(3)
  const linkBalance = await linkToken.balanceOf(upkeepAdmin.address)
  if (linkBalance.lt(totalLinkRequired)) {
    throw new Error(
      `Insufficient balance. Required: ${totalLinkRequired.toString()} LINK`,
    )
  }
  await linkToken.approve(automationRegistrar.address, totalLinkRequired)
  console.log(
    'Approved LINK token for AutomationRegistrar',
    totalLinkRequired.toString(),
  )

  // Register create gauge log upkeep
  const createGaugeLogUpkeepId = await registerLogTriggerUpkeep(
    automationRegistrar,
    voter.address,
    voter.interface.getEventTopic('GaugeCreated'),
    gaugeUpkeepManager.address,
    upkeepAdmin.address,
    'Create Gauge Log Upkeep',
    LOG_UPKEEP_FUND_AMOUNT!,
    LOG_UPKEEP_GAS_LIMIT!,
  )
  console.log(
    'Registered create gauge log upkeep',
    createGaugeLogUpkeepId.toString(),
  )

  // Register kill gauge log upkeep
  const killGaugeLogUpkeepId = await registerLogTriggerUpkeep(
    automationRegistrar,
    voter.address,
    voter.interface.getEventTopic('GaugeKilled'),
    gaugeUpkeepManager.address,
    upkeepAdmin.address,
    'Kill Gauge Log Upkeep',
    LOG_UPKEEP_FUND_AMOUNT!,
    LOG_UPKEEP_GAS_LIMIT!,
  )
  console.log(
    'Registered kill gauge log upkeep',
    killGaugeLogUpkeepId.toString(),
  )

  // Register revive gauge log upkeep
  const reviveGaugeLogUpkeepId = await registerLogTriggerUpkeep(
    automationRegistrar,
    voter.address,
    voter.interface.getEventTopic('GaugeRevived'),
    gaugeUpkeepManager.address,
    upkeepAdmin.address,
    'Revive Gauge Log Upkeep',
    LOG_UPKEEP_FUND_AMOUNT!,
    LOG_UPKEEP_GAS_LIMIT!,
  )
  console.log(
    'Registered revive gauge log upkeep',
    reviveGaugeLogUpkeepId.toString(),
  )

  // Get trusted forwarder addresses for all upkeeps and set them in gauge upkeep manager
  const forwarders = await Promise.all([
    keeperRegistry.getForwarder(createGaugeLogUpkeepId),
    keeperRegistry.getForwarder(killGaugeLogUpkeepId),
    keeperRegistry.getForwarder(reviveGaugeLogUpkeepId),
  ])
  for (const forwarder of forwarders) {
    await gaugeUpkeepManager.setTrustedForwarder(forwarder, true)
  }
  console.log('Set trusted forwarders for all upkeeps')

  // Add upkeeps to upkeep balance monitor
  await upkeepBalanceMonitor.addMultipleToWatchList([
    createGaugeLogUpkeepId,
    killGaugeLogUpkeepId,
    reviveGaugeLogUpkeepId,
  ])
  console.log('Added all upkeeps to upkeep balance monitor')
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
