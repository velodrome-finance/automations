// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers, run } from 'hardhat'
import * as assert from 'assert'
import * as dotenv from 'dotenv'
import { verifyContract } from '../utils'

// Load environment variables
dotenv.config()

const AUTOMATION_REGISTRAR_ADDRESS = process.env.AUTOMATION_REGISTRAR_ADDRESS
const KEEPER_REGISTRY_ADDRESS = process.env.KEEPER_REGISTRY_ADDRESS
const LINK_TOKEN_ADDRESS = process.env.LINK_TOKEN_ADDRESS
const VOTER_ADDRESS = process.env.VOTER_ADDRESS
const PRICES_ORACLE_ADDRESS = process.env.PRICES_ORACLE_ADDRESS
const UPKEEP_BALANCE_MONITOR_ADDRESS =
  process.env.UPKEEP_BALANCE_MONITOR_ADDRESS
const NEW_UPKEEP_FUND_AMOUNT = process.env.NEW_UPKEEP_FUND_AMOUNT
const NEW_UPKEEP_GAS_LIMIT = process.env.NEW_UPKEEP_GAS_LIMIT

assert.ok(
  AUTOMATION_REGISTRAR_ADDRESS,
  'AUTOMATION_REGISTRAR_ADDRESS is required',
)
assert.ok(KEEPER_REGISTRY_ADDRESS, 'KEEPER_REGISTRY_ADDRESS is required')
assert.ok(LINK_TOKEN_ADDRESS, 'LINK_TOKEN_ADDRESS is required')
assert.ok(VOTER_ADDRESS, 'VOTER_ADDRESS is required')
assert.ok(PRICES_ORACLE_ADDRESS, 'PRICES_ORACLE_ADDRESS is required')
assert.ok(
  UPKEEP_BALANCE_MONITOR_ADDRESS,
  'UPKEEP_BALANCE_MONITOR_ADDRESS is required',
)
assert.ok(NEW_UPKEEP_FUND_AMOUNT, 'NEW_UPKEEP_FUND_AMOUNT is required')
assert.ok(NEW_UPKEEP_GAS_LIMIT, 'NEW_UPKEEP_GAS_LIMIT is required')

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  // Deploy TokenUpkeepManager contract
  const tokenUpkeepManagerFactory =
    await ethers.getContractFactory('TokenUpkeepManager')
  const tokenUpkeepManager = await tokenUpkeepManagerFactory.deploy(
    LINK_TOKEN_ADDRESS!,
    KEEPER_REGISTRY_ADDRESS!,
    AUTOMATION_REGISTRAR_ADDRESS!,
    VOTER_ADDRESS!,
    PRICES_ORACLE_ADDRESS!,
    UPKEEP_BALANCE_MONITOR_ADDRESS!,
    NEW_UPKEEP_FUND_AMOUNT!,
    NEW_UPKEEP_GAS_LIMIT!,
  )
  await tokenUpkeepManager.deployed()
  console.log('TokenUpkeepManager deployed to:', tokenUpkeepManager.address)

  // Grant watchlist manager role to TokenUpkeepManager contract
  const upkeepBalanceMonitor = await ethers.getContractAt(
    'UpkeepBalanceMonitorV2_1',
    UPKEEP_BALANCE_MONITOR_ADDRESS!,
  )
  await upkeepBalanceMonitor.grantWatchlistManagerRole(
    tokenUpkeepManager.address,
  )
  console.log('TokenUpkeepManager granted watchlist manager role')

  // Verify TokenUpkeepManager contract
  await verifyContract(tokenUpkeepManager.address, [
    LINK_TOKEN_ADDRESS!,
    KEEPER_REGISTRY_ADDRESS!,
    AUTOMATION_REGISTRAR_ADDRESS!,
    VOTER_ADDRESS!,
    PRICES_ORACLE_ADDRESS!,
    UPKEEP_BALANCE_MONITOR_ADDRESS!,
    NEW_UPKEEP_FUND_AMOUNT!,
    NEW_UPKEEP_GAS_LIMIT!,
  ])
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
