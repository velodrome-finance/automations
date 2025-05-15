// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import * as fs from 'fs'
import * as path from 'path'
import { ethers } from 'hardhat'
import * as dotenv from 'dotenv'
import { Contract } from 'ethers'
import { GaugeSugarAbi } from './gaugeSugarAbi'

// Load environment variables
dotenv.config()

async function getGauges(gaugeSugar: Contract, poolFactories: string[], batchSize = 50): Promise<[string[], number[]]> {
  let gauges: string[] = []
  let failedBatches: number[] = []

  for (const poolFactoryAddr of poolFactories) {
    const poolFactory: Contract = await ethers.getContractAt('IPoolFactory', poolFactoryAddr)

    let length = 0;
    try {
        length = await poolFactory.allPoolsLength()
    } catch (err) {
        console.error(`Error fetching length for PoolFactory ${poolFactory.address}:`, err)
        break
    }

    for(let i = 0; i < length; i += batchSize) {
      try {
        let gaugeBatch: string[] = await gaugeSugar.fetchGauges(poolFactory.address, i, batchSize);
        gaugeBatch = gaugeBatch.filter((gauge) => gauge !== ethers.constants.AddressZero)
        gauges.push(...gaugeBatch)
      } catch (err) {
        console.error(`Error fetching gauges for Batch with Offset ${i}:`, err)
        failedBatches.push(i)
      }
    }

  }
  console.log(gauges)

  return [gauges, failedBatches]
}

function logGauges(gauges: string[]) {
  // Define the target directory and file path
  const directoryPath = 'logs'
  const filePath = path.join(directoryPath, 'gauges.json')
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath) // Create the directory if it doesn't exist
  }
  // Read the existing gauges file
  let existingGauges: string[] = []
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      existingGauges = JSON.parse(content)
    } catch (err) {
      console.error('Error reading existing gauges file:', err)
    }
  }
  // Combine existing gauges with new gauges and remove duplicates
  const combinedGauges = existingGauges.concat(gauges)
  const uniqueGauges = [...new Set(combinedGauges)]
  // Write the JSON content to the file
  const jsonContent = JSON.stringify(uniqueGauges, null, 2)
  fs.writeFile(filePath, jsonContent, 'utf8', (err) => {
    if (err) {
      console.error('Error writing to file', err)
      return
    }
    console.log(`Logs successfully written to ${filePath}.`)
  })
}

function logFailedBatches(failedBatches: number[]) {
  // Define the target directory and file path
  const directoryPath = 'logs'
  const filePath = path.join(directoryPath, 'failedBatches.json')
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath) // Create the directory if it doesn't exist
  }
  // Read the existing failedBatches file
  let existingBatches: number[] = []
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      existingBatches = JSON.parse(content)
    } catch (err) {
      console.error('Error reading existing failedBatches file:', err)
    }
  }
  // Combine existing pool list with new failedBatches and remove duplicates
  const combinedBatches = existingBatches.concat(failedBatches)
  const uniqueBatches = [...new Set(combinedBatches)]
  // Write the JSON content to the file
  const jsonContent = JSON.stringify(uniqueBatches, null, 2)
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

  // NOTE: OP Constants
  const gaugeSugarAddr: string = "0x3855A2BF3E0eDb4CB9a6AfA67c39DC4475D7A805"
  const poolFactories: string[] = ['0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a', '0xCc0bDDB707055e04e497aB22a59c2aF4391cd12F']

  // // NOTE: Base Constants
  // const gaugeSugarAddr: string = "0x1338649Ba8DDf05f445693B6F6efd96735f9031e"
  // const poolFactories: string[] = ['0x420DD381b31aEf6683db6B902084cB0FFECe40Da', '0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A']

  const gaugeSugar: Contract = await ethers.getContractAt(
    JSON.parse(GaugeSugarAbi),
    gaugeSugarAddr,
  )
  console.log('Fetching gauges...')
  const [gauges, failedBatches]: [string[], number[]] = await getGauges(gaugeSugar, poolFactories)
  console.log("Gauge Count: ", gauges.length);
  logGauges(gauges)
  if (failedBatches.length > 0) {
    logFailedBatches(failedBatches)
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
