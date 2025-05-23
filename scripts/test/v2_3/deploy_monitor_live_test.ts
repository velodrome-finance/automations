// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers, run } from 'hardhat'
import * as assert from 'assert'
import * as dotenv from 'dotenv'
import { registerCustomLogicUpkeepV2_3 } from '../../utils'

// Load environment variables
dotenv.config()

const AUTOMATION_REGISTRAR_ADDRESS = process.env.AUTOMATION_REGISTRAR_ADDRESS
const KEEPER_REGISTRY_ADDRESS = process.env.KEEPER_REGISTRY_ADDRESS
const LINK_TOKEN_ADDRESS = process.env.LINK_TOKEN_ADDRESS
const NEW_UPKEEP_GAS_LIMIT = process.env.NEW_UPKEEP_GAS_LIMIT
const BATCH_SIZE = process.env.BATCH_SIZE
const MAX_BATCH_SIZE = process.env.MAX_BATCH_SIZE
const MIN_PERCENTAGE = process.env.MIN_PERCENTAGE
const TARGET_PERCENTAGE = process.env.TARGET_PERCENTAGE
const MAX_TOP_UP_AMOUNT = process.env.MAX_TOP_UP_AMOUNT
const MAX_ITERATIONS = process.env.MAX_ITERATIONS
const BALANCE_MONITOR_UPKEEP_FUND_AMOUNT =
  process.env.BALANCE_MONITOR_UPKEEP_FUND_AMOUNT
const BALANCE_MONITOR_UPKEEP_GAS_LIMIT =
  process.env.BALANCE_MONITOR_UPKEEP_GAS_LIMIT

assert.ok(
  AUTOMATION_REGISTRAR_ADDRESS,
  'AUTOMATION_REGISTRAR_ADDRESS is required',
)
assert.ok(KEEPER_REGISTRY_ADDRESS, 'KEEPER_REGISTRY_ADDRESS is required')
assert.ok(LINK_TOKEN_ADDRESS, 'LINK_TOKEN_ADDRESS is required')
assert.ok(NEW_UPKEEP_GAS_LIMIT, 'NEW_UPKEEP_GAS_LIMIT is required')
assert.ok(BATCH_SIZE, 'BATCH_SIZE is required')
assert.ok(MAX_BATCH_SIZE, 'MAX_BATCH_SIZE is required')
assert.ok(MIN_PERCENTAGE, 'MIN_PERCENTAGE is required')
assert.ok(TARGET_PERCENTAGE, 'TARGET_PERCENTAGE is required')
assert.ok(MAX_TOP_UP_AMOUNT, 'MAX_TOP_UP_AMOUNT is required')
assert.ok(MAX_ITERATIONS, 'MAX_ITERATIONS is required')
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
    'UpkeepBalanceMonitorV2_3',
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
  const gaugeUpkeepManagerFactory = await ethers.getContractFactory(
    'GaugeUpkeepManagerV2_3',
  )
  const underfundedUpkeepAmount = ethers.utils.parseEther('0.1')
  const excludedGaugeFactories: string[] = []
  const gaugeUpkeepManager = await gaugeUpkeepManagerFactory.deploy(
    LINK_TOKEN_ADDRESS!,
    KEEPER_REGISTRY_ADDRESS!,
    AUTOMATION_REGISTRAR_ADDRESS!,
    upkeepBalanceMonitor.address,
    voterMock.address,
    underfundedUpkeepAmount,
    NEW_UPKEEP_GAS_LIMIT!,
    BATCH_SIZE!,
    excludedGaugeFactories,
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
  await linkToken.transfer(gaugeUpkeepManager.address, underfundedUpkeepAmount)
  console.log(
    `Transferred ${underfundedUpkeepAmount} LINK tokens to GaugeUpkeepManager`,
  )

  // Transfer LINK tokens to UpkeepBalanceMonitor contract
  const balanceMonitorFundAmount = ethers.utils.parseEther('3')
  await linkToken.transfer(
    upkeepBalanceMonitor.address,
    balanceMonitorFundAmount,
  )
  console.log(
    `Transferred ${balanceMonitorFundAmount} LINK tokens to UpkeepBalanceMonitor`,
  )

  // ----------------------------
  // Register balance monitor upkeep
  // ----------------------------
  console.log('Registering custom logic upkeep...')

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

  // Approve LINK tokens for AutomationRegistrar
  await linkToken.approve(
    automationRegistrar.address,
    BALANCE_MONITOR_UPKEEP_FUND_AMOUNT!,
  )
  console.log(
    'Approved LINK tokens for AutomationRegistrar',
    BALANCE_MONITOR_UPKEEP_FUND_AMOUNT!,
  )

  const balanceMonitorUpkeepId = await registerCustomLogicUpkeepV2_3(
    automationRegistrar,
    'Balance Monitor Upkeep',
    upkeepBalanceMonitor.address,
    upkeepAdmin.address,
    BALANCE_MONITOR_UPKEEP_FUND_AMOUNT!,
    BALANCE_MONITOR_UPKEEP_GAS_LIMIT!,
    linkToken.address,
  )
  console.log(
    'Registered balance monitor upkeep:',
    balanceMonitorUpkeepId.toString(),
  )

  // Get trusted forwarder and set it to the balance monitor
  const forwarder = await keeperRegistry.getForwarder(balanceMonitorUpkeepId)
  await upkeepBalanceMonitor.setTrustedForwarder(forwarder)
  console.log('Set trusted forwarder to UpkeepBalanceMonitor')

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

  const gaugeUpkeepId = await gaugeUpkeepManager.upkeepIds(0)
  console.log('Gauge upkeep ID:', gaugeUpkeepId.toString())
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
