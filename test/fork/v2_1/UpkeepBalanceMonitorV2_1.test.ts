import { expect } from 'chai'
import { ethers, network } from 'hardhat'
import {
  impersonateAccount,
  stopImpersonatingAccount,
} from '@nomicfoundation/hardhat-network-helpers'
import { findLog } from '../../utils'
import { BigNumber } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  Voter,
  GaugeUpkeepManagerV2_1,
  AutomationRegistrar2_1,
  IKeeperRegistryMaster,
  IERC20,
  UpkeepBalanceMonitorV2_1,
} from '../../../typechain-types'

// Optimism Mainnet Addresses
export const AUTOMATION_REGISTRAR_ADDRESS =
  '0xe601C5837307f07aB39DEB0f5516602f045BF14f'
export const KEEPER_REGISTRY_ADDRESS =
  '0x696fB0d7D069cc0bb35a7c36115CE63E55cb9AA6'
export const LINK_TOKEN_ADDRESS = '0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6'
export const VOTER_ADDRESS = '0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C'
export const EXCLUDED_GAUGE_FACTORIES = [
  '0x42e403b73898320f23109708b0ba1Ae85838C445',
  '0xeAD23f606643E387a073D0EE8718602291ffaAeB',
]
export const GAUGE_ADDRESS = '0x8d2723Fe2bfc3E9C2515a8789dADF8C82f58F04f'
export const LINK_HOLDER_ADDRESS = '0x166C794d890dD91bBe71F304ecA660E1c4892CBB'

const { AddressZero, HashZero } = ethers.constants

async function simulatePerformUpkeep(
  keeperRegistry: IKeeperRegistryMaster,
  upkeepId: BigNumber,
  performData: string,
) {
  await impersonateAccount(AddressZero)
  const zeroSigner = await ethers.getSigner(AddressZero)
  const performTx =
    await keeperRegistry.populateTransaction.simulatePerformUpkeep(
      upkeepId,
      performData,
    )
  const performResultTx = await zeroSigner.sendTransaction({
    ...performTx,
    from: AddressZero,
  })
  await stopImpersonatingAccount(AddressZero)
  const performReceipt = await performResultTx.wait()
  return { tx: performResultTx, receipt: performReceipt }
}

export async function registerCustomLogicUpkeep(
  automationRegistrar: AutomationRegistrar2_1,
  upkeepName: string,
  targetContract: string,
  adminAddress: string,
  fundAmount: BigNumber,
  gasLimit: number,
) {
  const registerTx = await automationRegistrar.registerUpkeep({
    name: upkeepName,
    encryptedEmail: '0x',
    upkeepContract: targetContract,
    gasLimit: gasLimit,
    adminAddress,
    triggerType: 0, // Custom logic trigger type
    checkData: '0x',
    triggerConfig: '0x',
    offchainConfig: '0x',
    amount: fundAmount,
  })
  const registerReceipt = await registerTx.wait()

  const registrationApprovedLog = findLog(
    registerReceipt,
    automationRegistrar.interface.getEventTopic('RegistrationApproved'),
  )
  const upkeepId = automationRegistrar.interface.parseLog(
    registrationApprovedLog,
  ).args.upkeepId

  return ethers.BigNumber.from(upkeepId)
}

let snapshotId: any

describe('UpkeepBalanceMonitorV2_1 Script Tests', function () {
  let accounts: SignerWithAddress[]
  let gaugeUpkeepManager: GaugeUpkeepManagerV2_1
  let upkeepBalanceMonitor: UpkeepBalanceMonitorV2_1
  let voter: Voter
  let keeperRegistry: IKeeperRegistryMaster
  let linkToken: IERC20
  let balanceMonitorUpkeepId: BigNumber

  const balanceMonitorConfig = {
    maxBatchSize: 10,
    minPercentage: 120,
    targetPercentage: 300,
    maxTopUpAmount: ethers.utils.parseEther('10'),
    maxIterations: 10,
  }
  const upkeepFundAmount = ethers.utils.parseEther('10')
  const upkeepGasLimit = 5e6

  const newGaugeUpkeepFundAmount = ethers.utils.parseEther('1')
  const newGaugeUpkeepGasLimit = 1e6
  const batchSize = 5

  before(async function () {
    accounts = await ethers.getSigners()
    // take a snapshot at the start
    snapshotId = await network.provider.send('evm_snapshot')
    // setup link token contract
    linkToken = await ethers.getContractAt('ERC20Mintable', LINK_TOKEN_ADDRESS)
    // setup automation registrar contract
    const automationRegistrar = await ethers.getContractAt(
      'AutomationRegistrar2_1',
      AUTOMATION_REGISTRAR_ADDRESS,
    )
    // setup keeper registry contract
    keeperRegistry = await ethers.getContractAt(
      'IKeeperRegistryMaster',
      KEEPER_REGISTRY_ADDRESS,
    )
    // setup voter contract
    voter = await ethers.getContractAt('Voter', VOTER_ADDRESS)
    // deploy upkeep balance monitor
    const upkeepBalanceMonitorFactory = await ethers.getContractFactory(
      'UpkeepBalanceMonitorV2_1',
    )
    upkeepBalanceMonitor = await upkeepBalanceMonitorFactory.deploy(
      linkToken.address,
      keeperRegistry.address,
      balanceMonitorConfig,
    )
    // setup gauge upkeep manager
    const gaugeUpkeepManagerFactory = await ethers.getContractFactory(
      'GaugeUpkeepManagerV2_1',
    )
    gaugeUpkeepManager = await gaugeUpkeepManagerFactory.deploy(
      linkToken.address,
      keeperRegistry.address,
      automationRegistrar.address,
      upkeepBalanceMonitor.address,
      voter.address,
      newGaugeUpkeepFundAmount,
      newGaugeUpkeepGasLimit,
      batchSize,
      EXCLUDED_GAUGE_FACTORIES,
    )
    // set gauge upkeep manager as watch list manager in balance monitor
    await upkeepBalanceMonitor.grantWatchlistManagerRole(
      gaugeUpkeepManager.address,
    )
    // transfer link tokens to deployer
    await impersonateAccount(LINK_HOLDER_ADDRESS)
    const linkHolderSigner = await ethers.getSigner(LINK_HOLDER_ADDRESS)
    const transferLinkTx = await linkToken.populateTransaction.transfer(
      accounts[0].address,
      ethers.utils.parseEther('100'),
    )
    await linkHolderSigner.sendTransaction({
      ...transferLinkTx,
      from: LINK_HOLDER_ADDRESS,
    })
    await stopImpersonatingAccount(LINK_HOLDER_ADDRESS)
    // transfer link tokens to gauge upkeep manager
    await linkToken.transfer(
      gaugeUpkeepManager.address,
      ethers.utils.parseEther('50'),
    )
    // transfer link tokens to upkeep balance monitor
    await linkToken.transfer(
      upkeepBalanceMonitor.address,
      ethers.utils.parseEther('10'),
    )
    // register gauge upkeep
    await gaugeUpkeepManager.registerGauges([GAUGE_ADDRESS])
    // register upkeep trigger
    await linkToken.approve(automationRegistrar.address, upkeepFundAmount)
    balanceMonitorUpkeepId = await registerCustomLogicUpkeep(
      automationRegistrar,
      'BalanceMonitorUpkeep',
      upkeepBalanceMonitor.address,
      accounts[0].address,
      upkeepFundAmount,
      upkeepGasLimit,
    )
    // get trusted forwarder address and set it in upkeep balance monitor
    const trustedForwarder = await keeperRegistry.getForwarder(
      balanceMonitorUpkeepId,
    )
    await upkeepBalanceMonitor.setTrustedForwarder(trustedForwarder)
  })

  after(async function () {
    // revert to the initial snapshot
    await network.provider.send('evm_revert', [snapshotId])
  })

  it('Top-up underfunded upkeep flow', async function () {
    const [upkeepNeeded, performData] =
      await upkeepBalanceMonitor.callStatic.checkUpkeep(HashZero)

    // calculate top-up amount
    const gaugeUpkeepId = await gaugeUpkeepManager.upkeepIds(0)
    const balance = await keeperRegistry.getBalance(gaugeUpkeepId)
    const minBalance = await keeperRegistry.getMinBalance(gaugeUpkeepId)
    const targetBalance = minBalance
      .mul(balanceMonitorConfig.targetPercentage)
      .div(100)
    const topUpAmount = targetBalance.sub(balance).toString()

    // check upkeep data should contain gauge upkeep id and top-up amount
    const needsFunding = [gaugeUpkeepId]
    const topUpAmounts = [topUpAmount]
    const encodedData = ethers.utils.defaultAbiCoder.encode(
      ['uint256[]', 'uint96[]'],
      [needsFunding, topUpAmounts],
    )

    expect(upkeepNeeded).to.be.true
    expect(performData).to.equal(encodedData)

    // perform balance monitor upkeep via KeeperRegistry
    const { receipt: performReceipt } = await simulatePerformUpkeep(
      keeperRegistry,
      balanceMonitorUpkeepId,
      performData,
    )

    // check if the top-up was successful
    const topUpLog = findLog(
      performReceipt,
      upkeepBalanceMonitor.interface.getEventTopic('TopUpSucceeded'),
    )

    const { upkeepId: toppedUpkeepId, amount: toppedUpAmount } =
      upkeepBalanceMonitor.interface.parseLog(topUpLog).args

    expect(toppedUpkeepId).to.equal(gaugeUpkeepId)
    expect(toppedUpAmount).to.equal(topUpAmount)

    // check if the balance of the gauge upkeep is equal to the target balance
    const newBalance = await keeperRegistry.getBalance(gaugeUpkeepId)
    expect(newBalance).to.equal(targetBalance)

    // check if no more top-up is needed
    const [upkeepNeededAfter, performDataAfter] =
      await upkeepBalanceMonitor.callStatic.checkUpkeep(HashZero)

    expect(upkeepNeededAfter).to.be.false
    expect(performDataAfter).to.equal('0x')
  })

  it('Withdraw contract balance flow', async function () {
    const ownerBalance = await linkToken.balanceOf(accounts[0].address)
    const contractBalance = await linkToken.balanceOf(
      upkeepBalanceMonitor.address,
    )
    await upkeepBalanceMonitor.withdraw(contractBalance, accounts[0].address)

    const newContractBalance = await linkToken.balanceOf(
      upkeepBalanceMonitor.address,
    )
    const newOwnerBalance = await linkToken.balanceOf(accounts[0].address)

    expect(newContractBalance).to.equal(0)
    expect(newOwnerBalance).to.equal(ownerBalance.add(contractBalance))
  })
})
