// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers, run } from 'hardhat'
import * as assert from 'assert'
import * as dotenv from 'dotenv'
import { registerLogTriggerUpkeep } from '../../../utils'

// Load environment variables
dotenv.config()

const AUTOMATION_REGISTRAR_ADDRESS = process.env.AUTOMATION_REGISTRAR_ADDRESS
const KEEPER_REGISTRY_ADDRESS = process.env.KEEPER_REGISTRY_ADDRESS
const LINK_TOKEN_ADDRESS = process.env.LINK_TOKEN_ADDRESS
const NEW_UPKEEP_FUND_AMOUNT = process.env.NEW_UPKEEP_FUND_AMOUNT
const NEW_UPKEEP_GAS_LIMIT = process.env.NEW_UPKEEP_GAS_LIMIT
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
assert.ok(NEW_UPKEEP_FUND_AMOUNT, 'NEW_UPKEEP_FUND_AMOUNT is required')
assert.ok(NEW_UPKEEP_GAS_LIMIT, 'NEW_UPKEEP_GAS_LIMIT is required')
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
  const voterMockFactory = await ethers.getContractFactory('VoterMock')
  const voterMock = await voterMockFactory.deploy(
    ethers.constants.AddressZero,
    ethers.constants.AddressZero,
    ethers.constants.AddressZero,
  )
  console.log('VoterMock deployed to:', voterMock.address)

  // Deploy PricesMock contract
  const pricesMockFactory = await ethers.getContractFactory('PricesMock')
  const pricesMock = await pricesMockFactory.deploy()
  console.log('PricesMock deployed to:', pricesMock.address)

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

  // Deploy TokenUpkeepManager contract
  const tokenUpkeepManagerFactory =
    await ethers.getContractFactory('TokenUpkeepManager')
  const tokenUpkeepManager = await tokenUpkeepManagerFactory.deploy(
    LINK_TOKEN_ADDRESS!,
    KEEPER_REGISTRY_ADDRESS!,
    AUTOMATION_REGISTRAR_ADDRESS!,
    voterMock.address,
    pricesMock.address,
    upkeepBalanceMonitor.address,
    NEW_UPKEEP_FUND_AMOUNT!,
    NEW_UPKEEP_GAS_LIMIT!,
  )
  await tokenUpkeepManager.deployed()
  console.log('TokenUpkeepManager deployed to:', tokenUpkeepManager.address)

  // Grant watchlist manager role to TokenUpkeepManager contract
  await upkeepBalanceMonitor.grantWatchlistManagerRole(
    tokenUpkeepManager.address,
  )
  console.log('TokenUpkeepManager granted watchlist manager role')

  // Transfer LINK tokens to TokenUpkeepManager contract
  const linkToken = await ethers.getContractAt(
    'ERC20Mintable',
    LINK_TOKEN_ADDRESS!,
  )
  await linkToken.transfer(tokenUpkeepManager.address, NEW_UPKEEP_FUND_AMOUNT!)
  console.log(
    `Transferred ${NEW_UPKEEP_FUND_AMOUNT} LINK tokens to TokenUpkeepManager`,
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
  const totalLinkRequired = LOG_UPKEEP_FUND_AMOUNT!
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

  // Register whitelist token log upkeep
  const tokenLogUpkeepId = await registerLogTriggerUpkeep(
    automationRegistrar,
    voterMock.address,
    voterMock.interface.getEventTopic('WhitelistToken'),
    tokenUpkeepManager.address,
    upkeepAdmin.address,
    'Whitelist Token Log Upkeep',
    LOG_UPKEEP_FUND_AMOUNT!,
    LOG_UPKEEP_GAS_LIMIT!,
  )
  console.log(
    'Registered whitelist token log upkeep',
    tokenLogUpkeepId.toString(),
  )

  // Get trusted forwarder address for token upkeep manager
  const forwarder = await keeperRegistry.getForwarder(tokenLogUpkeepId)
  await tokenUpkeepManager.setTrustedForwarder(forwarder)
  console.log('Set trusted forwarder for TokenUpkeepManager')

  // ----------------
  // Register fake tokens
  // ----------------
  console.log('Registering fake tokens...')

  // Register fake tokens with TokenUpkeepManager contract
  const fakeTokens = Array.from(
    { length: 25 },
    () => ethers.Wallet.createRandom().address,
  )
  await tokenUpkeepManager.registerTokens(fakeTokens)
  console.log('Registered fake tokens with TokenUpkeepManager', fakeTokens)

  // ----------------
  // Trigger log upkeeps
  // ----------------
  console.log('Triggering log upkeeps...')

  const fakeToken = ethers.Wallet.createRandom().address

  // Trigger whitelist token log upkeep
  await voterMock.whitelistToken(fakeToken, true)
  console.log('Triggered whitelist token log upkeep with fake token', fakeToken)

  // Sleep for 10 seconds
  await new Promise((resolve) => setTimeout(resolve, 10000))

  // Trigger remove token log upkeep
  await voterMock.whitelistToken(fakeToken, false)
  console.log('Triggered remove token log upkeep with fake token', fakeToken)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
