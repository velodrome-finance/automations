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
import { IGaugeUpkeepManager } from '../../typechain-types'

// Load environment variables
dotenv.config()

const GAUGE_UPKEEP_MANAGER_ADDRESS = process.env.GAUGE_UPKEEP_MANAGER_ADDRESS

assert.ok(
  GAUGE_UPKEEP_MANAGER_ADDRESS,
  'GAUGE_UPKEEP_MANAGER_ADDRESS is required',
)

async function registerGauges(
  gaugeUpkeepManager: IGaugeUpkeepManager,
  gauges: string[],
  batchSize = 25,
) {
  const gaugeCount = await gaugeUpkeepManager.gaugeCount()
  const gaugeList = await gaugeUpkeepManager.gaugeList(0, gaugeCount)
  const gaugesToRegister: string[] = gauges.filter(
    (gauge) => !gaugeList.includes(gauge),
  )
  const upkeepIds: string[] = []
  for (let i = 0; i < gaugesToRegister.length; i += batchSize) {
    const batch = gaugesToRegister.slice(i, i + batchSize)
    console.log(`Registering gauges ${i} to ${i + batchSize}`, batch)
    const tx = await gaugeUpkeepManager.registerGauges(batch)
    console.log('Transaction hash:', tx.hash)
    const receipt = await tx.wait(10)
    const upkeepRegisteredEvents = receipt.events?.filter(
      (event) =>
        event.topics[0] ===
        gaugeUpkeepManager.interface.getEventTopic('GaugeUpkeepRegistered'),
    )
    const newUpkeepIds =
      upkeepRegisteredEvents?.map((event) =>
        gaugeUpkeepManager.interface.parseLog(event).args.upkeepId.toString(),
      ) || []
    console.log('New upkeep IDs:', newUpkeepIds)
    upkeepIds.push(...newUpkeepIds)
  }
  return upkeepIds
}

function logUpkeeps(upkeepIds: string[]) {
  // Define the target directory and file path
  const directoryPath = 'logs'
  const filePath = path.join(directoryPath, 'upkeeps.json')
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath) // Create the directory if it doesn't exist
  }

  // Write the JSON content to the file
  const jsonContent = JSON.stringify(upkeepIds, null, 2)
  fs.writeFile(filePath, jsonContent, 'utf8', (err) => {
    if (err) {
      console.error('Error writing to file', err)
      return
    }
    console.log(`Logs successfully written to ${filePath}.`)
  })
}

function readGauges(): string[] {
  const filePath = path.join('logs', 'gauges.json')
  if (!fs.existsSync(filePath)) {
    throw new Error('Gauges log file not found')
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
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
  const gauges = readGauges()
  if (gauges.length === 0) {
    throw new Error('No gauges found')
  }
  console.log('Registering gauges...')
  const upkeepIds: string[] = await registerGauges(gaugeUpkeepManager, gauges)
  logUpkeeps(upkeepIds)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
