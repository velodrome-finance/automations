// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers, run } from 'hardhat'
import * as assert from 'assert'
import * as dotenv from 'dotenv'
import { verifyContract } from '../../utils'

// Load environment variables
dotenv.config()

const AUTOMATION_REGISTRAR_ADDRESS = process.env.AUTOMATION_REGISTRAR_ADDRESS
const KEEPER_REGISTRY_ADDRESS = process.env.KEEPER_REGISTRY_ADDRESS
const LINK_TOKEN_ADDRESS = process.env.LINK_TOKEN_ADDRESS
const UPKEEP_BALANCE_MONITOR_ADDRESS =
  process.env.UPKEEP_BALANCE_MONITOR_ADDRESS
const VOTER_ADDRESS = process.env.VOTER_ADDRESS
const CL_GAUGE_FACTORY_ADDRESS = process.env.CL_GAUGE_FACTORY_ADDRESS
const EXCLUDED_GAUGE_FACTORIES = process.env.EXCLUDED_GAUGE_FACTORIES
const NEW_UPKEEP_FUND_AMOUNT = process.env.NEW_UPKEEP_FUND_AMOUNT
const NEW_UPKEEP_GAS_LIMIT = process.env.NEW_UPKEEP_GAS_LIMIT
const BATCH_SIZE = process.env.BATCH_SIZE

assert.ok(
  AUTOMATION_REGISTRAR_ADDRESS,
  'AUTOMATION_REGISTRAR_ADDRESS is required',
)
assert.ok(KEEPER_REGISTRY_ADDRESS, 'KEEPER_REGISTRY_ADDRESS is required')
assert.ok(LINK_TOKEN_ADDRESS, 'LINK_TOKEN_ADDRESS is required')
assert.ok(
  UPKEEP_BALANCE_MONITOR_ADDRESS,
  'UPKEEP_BALANCE_MONITOR_ADDRESS is required',
)
assert.ok(VOTER_ADDRESS, 'VOTER_ADDRESS is required')
assert.ok(CL_GAUGE_FACTORY_ADDRESS, 'CL_GAUGE_FACTORY_ADDRESS is required')
assert.ok(NEW_UPKEEP_FUND_AMOUNT, 'NEW_UPKEEP_FUND_AMOUNT is required')
assert.ok(NEW_UPKEEP_GAS_LIMIT, 'NEW_UPKEEP_GAS_LIMIT is required')
assert.ok(BATCH_SIZE, 'BATCH_SIZE is required')

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  // Deploy RedistributeUpkeepManager contract
  const redistributeUpkeepManagerFactory = await ethers.getContractFactory(
    'RedistributeUpkeepManagerV2_3',
  )
  const excludedGaugeFactories = EXCLUDED_GAUGE_FACTORIES
    ? EXCLUDED_GAUGE_FACTORIES.split(',')
    : []
  const redistributeUpkeepManager =
    await redistributeUpkeepManagerFactory.deploy(
      LINK_TOKEN_ADDRESS!,
      KEEPER_REGISTRY_ADDRESS!,
      AUTOMATION_REGISTRAR_ADDRESS!,
      UPKEEP_BALANCE_MONITOR_ADDRESS!,
      VOTER_ADDRESS!,
      CL_GAUGE_FACTORY_ADDRESS!,
      NEW_UPKEEP_FUND_AMOUNT!,
      NEW_UPKEEP_GAS_LIMIT!,
      BATCH_SIZE!,
      excludedGaugeFactories,
    )
  await redistributeUpkeepManager.deployTransaction.wait(10)
  await redistributeUpkeepManager.deployed()
  console.log(
    'RedistributeUpkeepManager deployed to:',
    redistributeUpkeepManager.address,
  )

  // Grant watchlist manager role to RedistributeUpkeepManager contract
  const upkeepBalanceMonitor = await ethers.getContractAt(
    'UpkeepBalanceMonitorV2_3',
    UPKEEP_BALANCE_MONITOR_ADDRESS!,
  )
  const tx = await upkeepBalanceMonitor.grantWatchlistManagerRole(
    redistributeUpkeepManager.address,
  )
  await tx.wait(10)
  console.log('RedistributeUpkeepManager granted watchlist manager role')

  // Verify RedistributeUpkeepManager contract
  await verifyContract(redistributeUpkeepManager.address, [
    LINK_TOKEN_ADDRESS!,
    KEEPER_REGISTRY_ADDRESS!,
    AUTOMATION_REGISTRAR_ADDRESS!,
    UPKEEP_BALANCE_MONITOR_ADDRESS!,
    VOTER_ADDRESS!,
    CL_GAUGE_FACTORY_ADDRESS!,
    NEW_UPKEEP_FUND_AMOUNT!,
    NEW_UPKEEP_GAS_LIMIT!,
    BATCH_SIZE!,
    excludedGaugeFactories,
  ])
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
