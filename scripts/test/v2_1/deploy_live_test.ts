// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers, run } from 'hardhat'
import { BigNumber } from 'ethers'
import * as assert from 'assert'
import * as dotenv from 'dotenv'
import { registerLogTriggerUpkeep } from '../../utils'

// Load environment variables
dotenv.config()

const AUTOMATION_REGISTRAR_ADDRESS = process.env.AUTOMATION_REGISTRAR_ADDRESS
const KEEPER_REGISTRY_ADDRESS = process.env.KEEPER_REGISTRY_ADDRESS
const LINK_TOKEN_ADDRESS = process.env.LINK_TOKEN_ADDRESS
const EXCLUDED_GAUGE_FACTORIES = process.env.EXCLUDED_GAUGE_FACTORIES
const NEW_UPKEEP_FUND_AMOUNT = process.env.NEW_UPKEEP_FUND_AMOUNT
const NEW_UPKEEP_GAS_LIMIT = process.env.NEW_UPKEEP_GAS_LIMIT
const BATCH_SIZE = process.env.BATCH_SIZE
const MAX_BATCH_SIZE = process.env.MAX_BATCH_SIZE
const MIN_PERCENTAGE = process.env.MIN_PERCENTAGE
const TARGET_PERCENTAGE = process.env.TARGET_PERCENTAGE
const MAX_TOP_UP_AMOUNT = process.env.MAX_TOP_UP_AMOUNT
const MAX_ITERATIONS = process.env.MAX_ITERATIONS
const LOG_UPKEEP_FUND_AMOUNT = process.env.LOG_UPKEEP_FUND_AMOUNT
const LOG_UPKEEP_GAS_LIMIT = process.env.LOG_UPKEEP_GAS_LIMIT

assert.ok(
  AUTOMATION_REGISTRAR_ADDRESS,
  'AUTOMATION_REGISTRAR_ADDRESS is required',
)
assert.ok(KEEPER_REGISTRY_ADDRESS, 'KEEPER_REGISTRY_ADDRESS is required')
assert.ok(LINK_TOKEN_ADDRESS, 'LINK_TOKEN_ADDRESS is required')
assert.ok(EXCLUDED_GAUGE_FACTORIES, 'EXCLUDED_GAUGE_FACTORIES is required')
assert.ok(NEW_UPKEEP_FUND_AMOUNT, 'NEW_UPKEEP_FUND_AMOUNT is required')
assert.ok(NEW_UPKEEP_GAS_LIMIT, 'NEW_UPKEEP_GAS_LIMIT is required')
assert.ok(BATCH_SIZE, 'BATCH_SIZE is required')
assert.ok(MAX_BATCH_SIZE, 'MAX_BATCH_SIZE is required')
assert.ok(MIN_PERCENTAGE, 'MIN_PERCENTAGE is required')
assert.ok(TARGET_PERCENTAGE, 'TARGET_PERCENTAGE is required')
assert.ok(MAX_TOP_UP_AMOUNT, 'MAX_TOP_UP_AMOUNT is required')
assert.ok(MAX_ITERATIONS, 'MAX_ITERATIONS is required')
assert.ok(LOG_UPKEEP_FUND_AMOUNT, 'LOG_UPKEEP_FUND_AMOUNT is required')
assert.ok(LOG_UPKEEP_GAS_LIMIT, 'LOG_UPKEEP_GAS_LIMIT is required')

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  // Get admin account
  const [upkeepAdmin] = await ethers.getSigners()

  // ----------------
  // Setup contracts
  // ----------------
  console.log('Deploying contracts...')

  // Deploy VoterMock contract
  const fakeRegularFactoryAddress = ethers.Wallet.createRandom().address
  const factoryRegistryMockFactory = await ethers.getContractFactory(
    'FactoryRegistryMock',
  )
  const factoryRegistryMock = await factoryRegistryMockFactory.deploy(
    fakeRegularFactoryAddress,
  )
  const poolMockFactory = await ethers.getContractFactory('PoolMock')
  const poolMock = await poolMockFactory.deploy()
  const voterMockFactory = await ethers.getContractFactory('VoterMock')
  const voterMock = await voterMockFactory.deploy(
    poolMock.address,
    factoryRegistryMock.address,
    fakeRegularFactoryAddress,
  )
  await voterMock.deployed()
  console.log('VoterMock deployed to:', voterMock.address)

  // Deploy UpkeepBalanceMonitor contract
  const UpkeepBalanceMonitor = await ethers.getContractFactory(
    'UpkeepBalanceMonitor',
  )
  const upkeepBalanceMonitor = await UpkeepBalanceMonitor.deploy(
    LINK_TOKEN_ADDRESS!,
    KEEPER_REGISTRY_ADDRESS!,
    {
      maxBatchSize: MAX_BATCH_SIZE!,
      minPercentage: MIN_PERCENTAGE!,
      targetPercentage: TARGET_PERCENTAGE!,
      maxTopUpAmount: MAX_TOP_UP_AMOUNT!,
      maxIterations: MAX_ITERATIONS!,
    },
  )
  await upkeepBalanceMonitor.deployed()
  console.log('UpkeepBalanceMonitor deployed to:', upkeepBalanceMonitor.address)

  // Deploy GaugeUpkeepManager contract
  const gaugeUpkeepManagerFactory =
    await ethers.getContractFactory('GaugeUpkeepManagerV2_1')
  const gaugeUpkeepManager = await gaugeUpkeepManagerFactory.deploy(
    LINK_TOKEN_ADDRESS!,
    KEEPER_REGISTRY_ADDRESS!,
    AUTOMATION_REGISTRAR_ADDRESS!,
    upkeepBalanceMonitor.address,
    voterMock.address,
    NEW_UPKEEP_FUND_AMOUNT!,
    NEW_UPKEEP_GAS_LIMIT!,
    BATCH_SIZE!,
    EXCLUDED_GAUGE_FACTORIES!.split(','),
  )
  await gaugeUpkeepManager.deployed()
  console.log('GaugeUpkeepManager deployed to:', gaugeUpkeepManager.address)

  // Grant watchlist manager role to GaugeUpkeepManager contract
  await upkeepBalanceMonitor.grantWatchlistManagerRole(
    gaugeUpkeepManager.address,
  )
  console.log('GaugeUpkeepManager granted watchlist manager role')

  // Transfer LINK tokens to GaugeUpkeepManager contract
  const linkToken = await ethers.getContractAt(
    'ERC20Mintable',
    LINK_TOKEN_ADDRESS!,
  )
  await linkToken.transfer(gaugeUpkeepManager.address, NEW_UPKEEP_FUND_AMOUNT!)
  console.log(
    `Transferred ${NEW_UPKEEP_FUND_AMOUNT} LINK tokens to GaugeUpkeepManager`,
  )

  // ----------------------------
  // Register log trigger upkeeps
  // ----------------------------
  console.log('Registering log upkeeps...')

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
    voterMock.address,
    voterMock.interface.getEventTopic('GaugeCreated'),
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
    voterMock.address,
    voterMock.interface.getEventTopic('GaugeKilled'),
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
    voterMock.address,
    voterMock.interface.getEventTopic('GaugeRevived'),
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

  // ----------------
  // Register fake gauges
  // ----------------
  console.log('Registering fake gauges...')

  // Register fake gauges with GaugeUpkeepManager contract
  const fakeGauges = Array.from(
    { length: 25 },
    () => ethers.Wallet.createRandom().address,
  )
  await gaugeUpkeepManager.registerGauges(fakeGauges)
  console.log('Registered fake gauges with GaugeUpkeepManager', fakeGauges)

  // ----------------
  // Trigger upkeeps
  // ----------------
  console.log('Triggering upkeeps...')

  const fakeGauge = ethers.Wallet.createRandom().address

  // Trigger create gauge log upkeep
  await voterMock.createGauge(fakeGauge)
  console.log('Triggered create gauge log upkeep with fake gauge', fakeGauge)

  // Sleep for 10 seconds
  await new Promise((resolve) => setTimeout(resolve, 10000))

  // Trigger kill gauge log upkeep
  await voterMock.killGauge(fakeGauge)
  console.log('Triggered kill gauge log upkeep with fake gauge', fakeGauge)

  // Sleep for 10 seconds
  await new Promise((resolve) => setTimeout(resolve, 10000))

  // Trigger revive gauge log upkeep
  await voterMock.reviveGauge(fakeGauge)
  console.log('Triggered revive gauge log upkeep with fake gauge', fakeGauge)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
