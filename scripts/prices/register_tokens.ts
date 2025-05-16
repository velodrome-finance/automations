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
import { ITokenUpkeepManager } from '../../typechain-types'

// Load environment variables
dotenv.config()

const TOKEN_UPKEEP_MANAGER_ADDRESS = process.env.TOKEN_UPKEEP_MANAGER_ADDRESS

assert.ok(
  TOKEN_UPKEEP_MANAGER_ADDRESS,
  'TOKEN_UPKEEP_MANAGER_ADDRESS is required',
)

async function registerTokens(
  tokenUpkeepManager: ITokenUpkeepManager,
  tokens: string[],
  batchSize = 25,
) {
  const tokenCount = await tokenUpkeepManager.tokenCount()
  const tokenList = await tokenUpkeepManager.tokenList(0, tokenCount)
  const tokensToRegister: string[] = tokens.filter(
    (token) => !tokenList.includes(token),
  )
  const upkeepIds: string[] = []
  for (let i = 0; i < tokensToRegister.length; i += batchSize) {
    const batch = tokensToRegister.slice(i, i + batchSize)
    console.log(`Registering tokens ${i} to ${i + batchSize}`, batch)
    const tx = await tokenUpkeepManager.registerTokens(batch)
    console.log('Transaction hash:', tx.hash)
    const receipt = await tx.wait()
    const upkeepRegisteredEvents = receipt.events?.filter(
      (event) =>
        event.topics[0] ===
        tokenUpkeepManager.interface.getEventTopic('TokenUpkeepRegistered'),
    )
    const newUpkeepIds =
      upkeepRegisteredEvents?.map((event) =>
        tokenUpkeepManager.interface.parseLog(event).args.upkeepId.toString(),
      ) || []
    console.log('New upkeep IDs:', newUpkeepIds)
    upkeepIds.push(...newUpkeepIds)
  }
  return upkeepIds
}

function logUpkeeps(upkeepIds: string[]) {
  // Define the target directory and file path
  const directoryPath = 'logs'
  const filePath = path.join(directoryPath, 'token_upkeeps.json')
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

function readTokens(): string[] {
  const filePath = path.join('logs', 'tokens.json')
  if (!fs.existsSync(filePath)) {
    throw new Error('Tokens log file not found')
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

  const tokenUpkeepManager: ITokenUpkeepManager = await ethers.getContractAt(
    'ITokenUpkeepManager',
    TOKEN_UPKEEP_MANAGER_ADDRESS!,
  )
  const tokens = readTokens()
  if (tokens.length === 0) {
    throw new Error('No tokens found')
  }
  console.log('Registering tokens...')
  const upkeepIds: string[] = await registerTokens(tokenUpkeepManager, tokens)
  logUpkeeps(upkeepIds)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
