// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import { ethers } from 'hardhat'
import * as assert from 'assert'
import * as dotenv from 'dotenv'
import { verifyContract } from './utils'

// Load environment variables
dotenv.config()

const LINK_TOKEN_ADDRESS = process.env.LINK_TOKEN_ADDRESS
const KEEPER_REGISTRY_ADDRESS = process.env.KEEPER_REGISTRY_ADDRESS
const MAX_BATCH_SIZE = process.env.MAX_BATCH_SIZE
const MIN_PERCENTAGE = process.env.MIN_PERCENTAGE
const TARGET_PERCENTAGE = process.env.TARGET_PERCENTAGE
const MAX_TOP_UP_AMOUNT = process.env.MAX_TOP_UP_AMOUNT
const MAX_ITERATIONS = process.env.MAX_ITERATIONS

assert.ok(LINK_TOKEN_ADDRESS, 'LINK_TOKEN_ADDRESS is required')
assert.ok(KEEPER_REGISTRY_ADDRESS, 'KEEPER_REGISTRY_ADDRESS is required')
assert.ok(MAX_BATCH_SIZE, 'MAX_BATCH_SIZE is required')
assert.ok(MIN_PERCENTAGE, 'MIN_PERCENTAGE is required')
assert.ok(TARGET_PERCENTAGE, 'TARGET_PERCENTAGE is required')
assert.ok(MAX_TOP_UP_AMOUNT, 'MAX_TOP_UP_AMOUNT is required')
assert.ok(MAX_ITERATIONS, 'MAX_ITERATIONS is required')

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

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

  // Verify UpkeepBalanceMonitor contract
  await verifyContract(upkeepBalanceMonitor.address, [
    LINK_TOKEN_ADDRESS!,
    KEEPER_REGISTRY_ADDRESS!,
    {
      maxBatchSize: MAX_BATCH_SIZE!,
      minPercentage: MIN_PERCENTAGE!,
      targetPercentage: TARGET_PERCENTAGE!,
      maxTopUpAmount: MAX_TOP_UP_AMOUNT!,
      maxIterations: MAX_ITERATIONS!,
    },
  ])
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
