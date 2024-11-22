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

const VOTER_ADDRESS = process.env.VOTER_ADDRESS
const PRICES_ADDRESS = process.env.PRICES_ADDRESS
const BATCH_SIZE = process.env.BATCH_SIZE
const WHITELISTED_TOKENS = process.env.WHITELISTED_TOKENS

assert.ok(VOTER_ADDRESS, 'VOTER_ADDRESS is required')
assert.ok(PRICES_ADDRESS, 'PRICES_ADDRESS is required')
assert.ok(BATCH_SIZE, 'BATCH_SIZE is required')

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  // Deploy PricesKeeper contract
  const pricesKeeperFactory = await ethers.getContractFactory('PricesKeeper')
  const pricesKeeper = await pricesKeeperFactory.deploy(
    VOTER_ADDRESS!,
    PRICES_ADDRESS!,
    BATCH_SIZE!,
    WHITELISTED_TOKENS ? WHITELISTED_TOKENS.split(',') : [],
  )
  await pricesKeeper.deployed()
  console.log('PricesKeeper deployed to:', pricesKeeper.address)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
