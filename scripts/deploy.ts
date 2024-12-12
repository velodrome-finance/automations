// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from 'hardhat'
import * as assert from 'assert'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const AUTOMATION_REGISTRAR_ADDRESS = process.env.AUTOMATION_REGISTRAR_ADDRESS
const KEEPER_REGISTRY_ADDRESS = process.env.KEEPER_REGISTRY_ADDRESS
const LINK_TOKEN_ADDRESS = process.env.LINK_TOKEN_ADDRESS
const VOTER_ADDRESS = process.env.VOTER_ADDRESS
const FACTORY_REGISTRY_ADDRESS = process.env.FACTORY_REGISTRY_ADDRESS
const CROSSCHAIN_GAUGE_FACTORIES = process.env.CROSSCHAIN_GAUGE_FACTORIES
const NEW_UPKEEP_FUND_AMOUNT = process.env.NEW_UPKEEP_FUND_AMOUNT
const NEW_UPKEEP_GAS_LIMIT = process.env.NEW_UPKEEP_GAS_LIMIT

assert.ok(
  AUTOMATION_REGISTRAR_ADDRESS,
  'AUTOMATION_REGISTRAR_ADDRESS is required',
)
assert.ok(KEEPER_REGISTRY_ADDRESS, 'KEEPER_REGISTRY_ADDRESS is required')
assert.ok(LINK_TOKEN_ADDRESS, 'LINK_TOKEN_ADDRESS is required')
assert.ok(VOTER_ADDRESS, 'VOTER_ADDRESS is required')
assert.ok(FACTORY_REGISTRY_ADDRESS, 'FACTORY_REGISTRY_ADDRESS is required')
assert.ok(CROSSCHAIN_GAUGE_FACTORIES, 'CROSSCHAIN_GAUGE_FACTORIES is required')
assert.ok(NEW_UPKEEP_FUND_AMOUNT, 'NEW_UPKEEP_FUND_AMOUNT is required')
assert.ok(NEW_UPKEEP_GAS_LIMIT, 'NEW_UPKEEP_GAS_LIMIT is required')

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  // Deploy CronLibrary contract
  const cronLibraryFactory = await ethers.getContractFactory(
    '@chainlink/contracts/src/v0.8/automation/libraries/external/Cron.sol:Cron',
  )
  const cronLibrary = await cronLibraryFactory.deploy()
  await cronLibrary.deployed()
  console.log('CronLibrary deployed to:', cronLibrary.address)

  // Deploy CronUpkeepFactory contract
  const CronUpkeepFactory = await ethers.getContractFactory(
    'CronUpkeepFactory',
    {
      libraries: {
        Cron: cronLibrary.address,
      },
    },
  )
  const cronUpkeepFactory = await CronUpkeepFactory.deploy()
  await cronUpkeepFactory.deployed()
  console.log('CronUpkeepFactory deployed to:', cronUpkeepFactory.address)

  // Deploy GaugeUpkeepManager contract
  const gaugeUpkeepManagerFactory =
    await ethers.getContractFactory('GaugeUpkeepManager')
  const gaugeUpkeepManager = await gaugeUpkeepManagerFactory.deploy(
    LINK_TOKEN_ADDRESS!,
    KEEPER_REGISTRY_ADDRESS!,
    AUTOMATION_REGISTRAR_ADDRESS!,
    cronUpkeepFactory.address,
    VOTER_ADDRESS!,
    FACTORY_REGISTRY_ADDRESS!,
    NEW_UPKEEP_FUND_AMOUNT!,
    NEW_UPKEEP_GAS_LIMIT!,
    CROSSCHAIN_GAUGE_FACTORIES!.split(','),
  )
  await gaugeUpkeepManager.deployed()
  console.log('GaugeUpkeepManager deployed to:', gaugeUpkeepManager.address)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
