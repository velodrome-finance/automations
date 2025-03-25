// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from 'hardhat'
import * as assert from 'assert'
import * as dotenv from 'dotenv'
import { IGaugeUpkeepManager } from '../typechain-types'

// Load environment variables
dotenv.config()

const GAUGE_UPKEEP_MANAGER_ADDRESS = process.env.GAUGE_UPKEEP_MANAGER_ADDRESS
const PERFORM_UPKEEP_ACTION = process.env.PERFORM_UPKEEP_ACTION
const PERFORM_UPKEEP_GAUGE_ADDRESS = process.env.PERFORM_UPKEEP_GAUGE_ADDRESS

assert.ok(
  GAUGE_UPKEEP_MANAGER_ADDRESS,
  'GAUGE_UPKEEP_MANAGER_ADDRESS is required',
)
assert.ok(PERFORM_UPKEEP_ACTION, 'PERFORM_UPKEEP_ACTION is required')
assert.ok(
  PERFORM_UPKEEP_GAUGE_ADDRESS,
  'PERFORM_UPKEEP_GAUGE_ADDRESS is required',
)

enum PerformAction {
  RegisterGauge = 0,
  DeregisterGauge = 1,
}

async function performUpkeep(
  gaugeUpkeepManager: IGaugeUpkeepManager,
  performAction: PerformAction,
  gaugeAddress: string,
) {
  const abiCoder = new ethers.utils.AbiCoder()
  const performData = abiCoder.encode(
    ['uint8', 'address'],
    [performAction, gaugeAddress],
  )
  return gaugeUpkeepManager.performUpkeep(performData)
}

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  const gaugeUpkeepManager: IGaugeUpkeepManager = await ethers.getContractAt(
    'IGaugeUpkeepManager',
    GAUGE_UPKEEP_MANAGER_ADDRESS!,
  )

  console.log('Performing GaugeUpkeepManager upkeep...')
  console.log('Performing action:', PERFORM_UPKEEP_ACTION!)
  console.log('Performing gauge address:', PERFORM_UPKEEP_GAUGE_ADDRESS!)

  const performAction =
    PerformAction[PERFORM_UPKEEP_ACTION! as keyof typeof PerformAction]

  if (performAction === undefined) {
    throw new Error('Invalid perform action')
  }

  const tx = await performUpkeep(
    gaugeUpkeepManager,
    performAction,
    PERFORM_UPKEEP_GAUGE_ADDRESS!,
  )

  console.log('Upkeep performed:', tx.hash)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
