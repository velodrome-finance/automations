import { run } from 'hardhat'

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
