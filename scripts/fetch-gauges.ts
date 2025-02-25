// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import * as fs from 'fs'
import * as path from 'path'
import { ethers } from 'hardhat'
import * as assert from 'assert'
import * as dotenv from 'dotenv'
import { Contract } from 'ethers'
import { SugarAbi } from './abi'

// Load environment variables
dotenv.config()

const VOTER_ADDRESS = process.env.VOTER_ADDRESS
const SUGAR_ADDRESS = process.env.SUGAR_ADDRESS

assert.ok(VOTER_ADDRESS, 'VOTER_ADDRESS is required')
assert.ok(SUGAR_ADDRESS, 'SUGAR_ADDRESS is required')

export async function getPools(lpSugar: Contract, chunkSize = 75) {
  const allPools: any[] = []
  const promises: Promise<void>[] = []
  const maxPools: number = Number(await lpSugar.MAX_ITERATIONS())
  for (let startIndex = 0; startIndex < maxPools; startIndex += chunkSize) {
    const endIndex = Math.min(startIndex + chunkSize, maxPools)
    promises.push(
      // eslint-disable-next-line no-async-promise-executor
      new Promise(async (resolve, reject) => {
        try {
          const pools = await lpSugar.forSwaps(
            endIndex - startIndex,
            startIndex,
          )
          allPools.push(
            ...pools.map(
              ([_lp, _type, _token0, _token1, _factory, _pool_fee]) => _lp,
            ),
          )
          resolve()
        } catch (err) {
          reject(err)
        }
      }),
    )
  }
  await Promise.all(promises)
  return allPools
}

async function getGauges(voter: Contract, pools: string[]): Promise<string[]> {
  let gauges: string[] = []
  for (const pool of pools) {
    console.log('Fetching gauges for pool', pool)
    const gauge = await voter.gauges(pool)
    console.log('Gauge found:', gauge)
    if (gauge != ethers.constants.AddressZero) {
      const isAlive = await voter.isAlive(gauge)
      if (isAlive) {
        gauges.push(gauge)
        console.log('Gauge is alive:', gauge)
      }
    }
    // sleep for 3 seconds to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  return gauges
}

function logGauges(gauges: string[]) {
  // Define the target directory and file path
  const directoryPath = 'logs'
  const filePath = path.join(directoryPath, 'gauges.json')
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath) // Create the directory if it doesn't exist
  }
  let existingGauges: string[] = []
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      existingGauges = JSON.parse(content)
    } catch (err) {
      console.error('Error reading existing gauges file:', err)
    }
  }
  // Filter out gauges that are already logged
  const newGauges = gauges.filter((gauge) => !existingGauges.includes(gauge))
  if (newGauges.length === 0) {
    console.log('No new gauges to append.')
    return
  }
  const combinedGauges = [...existingGauges, ...newGauges]
  const jsonContent = JSON.stringify(combinedGauges, null, 2)
  // Write the JSON content to the file
  fs.writeFile(filePath, jsonContent, 'utf8', (err) => {
    if (err) {
      console.error('Error writing to file', err)
      return
    }
    console.log(`Logs successfully written to ${filePath}.`)
  })
}

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  const voter: Contract = await ethers.getContractAt('Voter', VOTER_ADDRESS!)
  const lpSugar: Contract = await ethers.getContractAt(
    JSON.parse(SugarAbi),
    SUGAR_ADDRESS!,
  )
  console.log('Fetching pools...')
  const pools: string[] = await getPools(lpSugar)
  console.log('Fetching gauges...')
  const gauges: string[] = await getGauges(voter, pools)
  logGauges(gauges)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
