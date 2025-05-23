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
  GaugeUpkeepManagerV2_3,
  AutomationRegistrar2_3,
  IAutomationRegistryMaster2_3,
  IERC20,
  UpkeepBalanceMonitorV2_3,
} from '../../../typechain-types'

// Base Mainnet Addresses
const AUTOMATION_REGISTRAR_ADDRESS =
  '0xE28Adc50c7551CFf69FCF32D45d037e5F6554264'
const KEEPER_REGISTRY_ADDRESS = '0xf4bAb6A129164aBa9B113cB96BA4266dF49f8743'
const LINK_TOKEN_ADDRESS = '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196'
const VOTER_ADDRESS = '0x16613524e02ad97eDfeF371bC883F2F5d6C480A5'
const EXCLUDED_GAUGE_FACTORIES = [
  '0x42e403b73898320f23109708b0ba1Ae85838C445',
  '0xeAD23f606643E387a073D0EE8718602291ffaAeB',
]
export const GAUGE_ADDRESS = '0x5b41A91Cc14496E7fcc381595Dc2680EF71B6462'
const LINK_HOLDER_ADDRESS = '0xdf812b91d8bf6df698bfd1d8047839479ba63420'

const { AddressZero, HashZero } = ethers.constants

async function simulatePerformUpkeep(
  keeperRegistry: IAutomationRegistryMaster2_3,
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
  automationRegistrar: AutomationRegistrar2_3,
  upkeepName: string,
  targetContract: string,
  adminAddress: string,
  fundAmount: BigNumber,
  gasLimit: number,
  billingToken: string,
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
    billingToken,
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

describe('UpkeepBalanceMonitorV2_3 Script Tests', function () {
  let accounts: SignerWithAddress[]
  let gaugeUpkeepManager: GaugeUpkeepManagerV2_3
  let upkeepBalanceMonitor: UpkeepBalanceMonitorV2_3
  let voter: Voter
  let keeperRegistry: IAutomationRegistryMaster2_3
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
      'AutomationRegistrar2_3',
      AUTOMATION_REGISTRAR_ADDRESS,
    )
    // setup keeper registry contract
    keeperRegistry = await ethers.getContractAt(
      'IAutomationRegistryMaster2_3',
      KEEPER_REGISTRY_ADDRESS,
    )
    // setup voter contract
    voter = await ethers.getContractAt('Voter', VOTER_ADDRESS)
    // deploy upkeep balance monitor
    const upkeepBalanceMonitorFactory = await ethers.getContractFactory(
      'UpkeepBalanceMonitorV2_3',
    )
    upkeepBalanceMonitor = await upkeepBalanceMonitorFactory.deploy(
      linkToken.address,
      keeperRegistry.address,
      balanceMonitorConfig,
    )
    // setup gauge upkeep manager
    const gaugeUpkeepManagerFactory = await ethers.getContractFactory(
      'GaugeUpkeepManagerV2_3',
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
      linkToken.address,
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
