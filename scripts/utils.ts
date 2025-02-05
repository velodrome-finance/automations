import { ethers, run } from 'hardhat'
import { TransactionReceipt } from '@ethersproject/providers'
import { AutomationRegistrar2_1 } from '../typechain-types'

export async function verifyContract(
  address: string,
  constructorArgs: any[] = [],
  libraries = {},
) {
  try {
    console.log(`Verifying contract at address: ${address}`)
    await run('verify:verify', {
      address,
      constructorArguments: constructorArgs,
      libraries,
    })
    console.log(`Contract verified successfully: ${address}`)
  } catch (error) {
    console.error(
      `Verification failed for contract at address: ${address}`,
      error,
    )
  }
}

export async function registerLogTriggerUpkeep(
  automationRegistrar: AutomationRegistrar2_1,
  eventEmitterAddress: string,
  eventSignature: string,
  targetContract: string,
  adminAddress: string,
  upkeepName: string,
  fundAmount: string,
  gasLimit: string,
) {
  const triggerConfig = ethers.utils.defaultAbiCoder.encode(
    ['address', 'uint8', 'bytes32', 'bytes32', 'bytes32', 'bytes32'],
    [
      eventEmitterAddress,
      '000', // no topic filters
      eventSignature,
      ethers.constants.HashZero,
      ethers.constants.HashZero,
      ethers.constants.HashZero,
    ],
  )
  const registerTx = await automationRegistrar.registerUpkeep({
    name: upkeepName,
    encryptedEmail: '0x',
    upkeepContract: targetContract,
    gasLimit: gasLimit,
    adminAddress,
    triggerType: 1,
    checkData: '0x',
    triggerConfig,
    offchainConfig: '0x',
    amount: fundAmount,
  })
  const registerReceipt = await registerTx.wait()

  const registrationApprovedLog = findLog(
    registerReceipt,
    automationRegistrar.interface.getEventTopic('RegistrationApproved'),
  )
  const logUpkeepId = automationRegistrar.interface.parseLog(
    registrationApprovedLog,
  ).args.upkeepId

  return ethers.BigNumber.from(logUpkeepId)
}

export function findLog(receipt: TransactionReceipt, eventSignature: string) {
  const log = receipt.logs.find((log) => log.topics[0] === eventSignature)
  if (!log) {
    throw new Error(`Event log not found for ${eventSignature}`)
  }
  return log
}
