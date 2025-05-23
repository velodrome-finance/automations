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
import { SugarAbi } from '../abi'

// Load environment variables
dotenv.config()

const SUGAR_ADDRESS = process.env.SUGAR_ADDRESS

assert.ok(SUGAR_ADDRESS, 'SUGAR_ADDRESS is required')

const MAX_POOLS = 2000

export async function getTokens(lpSugar: Contract, chunkSize = 100) {
  const allTokens: any[] = []
  const promises: Promise<void>[] = []
  for (let startIndex = 0; startIndex < MAX_POOLS; startIndex += chunkSize) {
    const endIndex = Math.min(startIndex + chunkSize, MAX_POOLS)
    promises.push(
      // eslint-disable-next-line no-async-promise-executor
      new Promise(async (resolve, reject) => {
        try {
          const tokens = await lpSugar.tokens(
            endIndex - startIndex,
            startIndex,
            ethers.constants.AddressZero,
            [],
          )
          allTokens.push(...tokens)
          resolve()
        } catch (err) {
          reject(err)
        }
      }),
    )
    const delay = Math.floor(Math.random() * 2000) + 1000 // Random delay between 1000–3000 ms
    await new Promise((resolve) => setTimeout(resolve, delay))
  }
  await Promise.all(promises)
  // Filter out unlisted tokens, get token addresses, and remove duplicates
  return [
    ...new Set(
      allTokens
        .filter((token) => token.listed === true)
        .map((token) => token.token_address),
    ),
  ]
}

function logTokens(tokens: string[]) {
  // Define the target directory and file path
  const directoryPath = 'logs'
  const filePath = path.join(directoryPath, 'tokens.json')
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath) // Create the directory if it doesn't exist
  }
  // Read the existing tokens file
  let existingTokens: string[] = []
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      existingTokens = JSON.parse(content)
    } catch (err) {
      console.error('Error reading existing tokens file:', err)
    }
  }
  // Combine existing tokens with new tokens and remove duplicates
  const combinedTokens = existingTokens.concat(tokens)
  const uniqueTokens = [...new Set(combinedTokens)]
  // Write the JSON content to the file
  const jsonContent = JSON.stringify(uniqueTokens, null, 2)
  fs.writeFile(filePath, jsonContent, 'utf8', (err) => {
    if (err) {
      console.error('Error writing to file', err)
      return
    }
    console.log(`Tokens successfully written to ${filePath}.`)
  })
}

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  const lpSugar: Contract = await ethers.getContractAt(
    JSON.parse(SugarAbi),
    SUGAR_ADDRESS!,
  )
  console.log('Fetching tokens...')
  const tokens = await getTokens(lpSugar)
  console.log('Tokens: ', tokens)
  console.log('Number of Tokens: ', tokens.length)

  logTokens(tokens)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
