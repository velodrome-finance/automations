import { expect } from 'chai'
import { ethers, network } from 'hardhat'
import {
  time,
  impersonateAccount,
  stopImpersonatingAccount,
  mine,
} from '@nomicfoundation/hardhat-network-helpers'
import { findLog } from '../../utils'
import { BigNumber } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  Voter,
  AutomationRegistrar2_1,
  IKeeperRegistryMaster,
  IERC20,
  IPrices,
  UpkeepBalanceMonitor,
  TokenUpkeepManager,
} from '../../../typechain-types'
import { UPKEEP_CANCELLATION_DELAY, MAX_UINT32 } from '../../constants'

enum PerformAction {
  RegisterToken = 0,
  DeregisterToken = 1,
}

// Optimism Mainnet Addresses
export const AUTOMATION_REGISTRAR_ADDRESS =
  '0xe601C5837307f07aB39DEB0f5516602f045BF14f'
export const KEEPER_REGISTRY_ADDRESS =
  '0x696fB0d7D069cc0bb35a7c36115CE63E55cb9AA6'
export const LINK_TOKEN_ADDRESS = '0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6'
export const VOTER_ADDRESS = '0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C'
export const PRICES_ORACLE_ADDRESS =
  '0x1447721108462075aEd82f835d06FBb57E3d2f6D'
export const PRICES_ORACLE_OWNER_ADDRESS =
  '0x667EddE578BA64B5d9DeeaF3DB6d46506460a7A7'
export const USDC_TOKEN_ADDRESS = '0x0b2c639c533813f4aa9d7837caf62653d097ff85'
export const VELO_TOKEN_ADDRESS = '0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db'
export const VELO_TOKEN_PRICE = '71523'
export const LINK_HOLDER_ADDRESS = '0x166C794d890dD91bBe71F304ecA660E1c4892CBB'

const { AddressZero, HashZero, MaxUint256 } = ethers.constants

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

async function registerLogTriggerUpkeep(
  automationRegistrar: AutomationRegistrar2_1,
  eventSignature: string,
  voterAddress: string,
  tokenUpkeepManagerAddress: string,
) {
  const triggerConfig = ethers.utils.defaultAbiCoder.encode(
    ['address', 'uint8', 'bytes32', 'bytes32', 'bytes32', 'bytes32'],
    [
      voterAddress,
      '000', // no topic filters
      eventSignature,
      HashZero,
      HashZero,
      HashZero,
    ],
  )
  const registerTx = await automationRegistrar.registerUpkeep({
    name: 'LogTriggerUpkeep',
    encryptedEmail: '0x',
    upkeepContract: tokenUpkeepManagerAddress,
    gasLimit: 5_000_000,
    adminAddress: tokenUpkeepManagerAddress,
    triggerType: 1,
    checkData: '0x',
    triggerConfig,
    offchainConfig: '0x',
    amount: ethers.utils.parseEther('10'),
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

let snapshotId: any

describe('TokenUpkeepManager Script Tests', function () {
  let accounts: SignerWithAddress[]
  let tokenUpkeepManager: TokenUpkeepManager
  let upkeepBalanceMonitor: UpkeepBalanceMonitor
  let pricesOracle: IPrices
  let voter: Voter
  let keeperRegistry: IKeeperRegistryMaster
  let linkToken: IERC20
  let whitelistTokenUpkeepId: BigNumber
  let tokenUpkeepId: BigNumber
  let tokenUpkeepAddress: string

  const newUpkeepGasLimit = 1e6
  const newUpkeepFundAmount = ethers.utils.parseEther('1')

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
    // setup prices contract
    pricesOracle = await ethers.getContractAt('IPrices', PRICES_ORACLE_ADDRESS)
    // deploy upkeep balance monitor
    const upkeepBalanceMonitorFactory = await ethers.getContractFactory(
      'UpkeepBalanceMonitor',
    )
    upkeepBalanceMonitor = await upkeepBalanceMonitorFactory.deploy(
      linkToken.address,
      keeperRegistry.address,
      {
        maxBatchSize: 10,
        minPercentage: 120,
        targetPercentage: 300,
        maxTopUpAmount: ethers.utils.parseEther('10'),
        maxIterations: 10,
      },
    )
    // setup token upkeep manager
    const tokenUpkeepManagerFactory =
      await ethers.getContractFactory('TokenUpkeepManager')
    tokenUpkeepManager = await tokenUpkeepManagerFactory.deploy(
      linkToken.address,
      keeperRegistry.address,
      automationRegistrar.address,
      voter.address,
      pricesOracle.address,
      upkeepBalanceMonitor.address,
      newUpkeepFundAmount,
      newUpkeepGasLimit,
    )
    // set token upkeep manager as watch list manager in balance monitor
    await upkeepBalanceMonitor.grantWatchlistManagerRole(
      tokenUpkeepManager.address,
    )
    // transfer link tokens to deployer
    await accounts[0].sendTransaction({
      to: LINK_HOLDER_ADDRESS,
      value: ethers.utils.parseEther('1'),
    })
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
    // transfer link tokens to token upkeep manager
    await linkToken.transfer(
      tokenUpkeepManager.address,
      ethers.utils.parseEther('50'),
    )
    // impersonate automation registrar owner and set auto approve for log trigger type
    const automationRegistrarOwner = await automationRegistrar.owner()
    await accounts[0].sendTransaction({
      to: automationRegistrarOwner,
      value: ethers.utils.parseEther('1'),
    })
    await impersonateAccount(automationRegistrarOwner)
    const automationRegistrarOwnerSigner = await ethers.getSigner(
      automationRegistrarOwner,
    )
    const setAutoApproveTx =
      await automationRegistrar.populateTransaction.setTriggerConfig(
        1, // log triggerType
        2, // approve all
        10000, // auto approve max allowed
      )
    await automationRegistrarOwnerSigner.sendTransaction({
      ...setAutoApproveTx,
      from: automationRegistrarOwner,
    })
    await stopImpersonatingAccount(automationRegistrarOwner)
    // register upkeep triggers
    await linkToken.approve(automationRegistrar.address, MaxUint256)
    whitelistTokenUpkeepId = await registerLogTriggerUpkeep(
      automationRegistrar,
      voter.interface.getEventTopic('WhitelistToken'),
      voter.address,
      tokenUpkeepManager.address,
    )
    // get trusted forwarder address and set it to token upkeep manager
    const forwarder = await keeperRegistry.getForwarder(whitelistTokenUpkeepId)
    await tokenUpkeepManager.setTrustedForwarder(forwarder)
  })

  after(async function () {
    // revert to the initial snapshot
    await network.provider.send('evm_revert', [snapshotId])
  })

  it('Token upkeep registration flow', async () => {
    // whitelist token via voter
    const voterGovernor = await voter.governor()
    await accounts[0].sendTransaction({
      to: voterGovernor,
      value: ethers.utils.parseEther('1'),
    })
    await impersonateAccount(voterGovernor)
    const voterSigner = await ethers.getSigner(voterGovernor)
    const whitelistTokenTx = await voter.populateTransaction.whitelistToken(
      VELO_TOKEN_ADDRESS,
      true,
    )
    const resultTx = await voterSigner.sendTransaction({
      ...whitelistTokenTx,
      from: voterGovernor,
    })
    await stopImpersonatingAccount(voterGovernor)
    const resultReceipt = await resultTx.wait()
    const whitelistTokenLog = findLog(
      resultReceipt,
      voter.interface.getEventTopic('WhitelistToken'),
    )
    const { token: whitelistedToken, _bool: isWhitelisted } =
      voter.interface.parseLog(whitelistTokenLog).args

    expect(whitelistedToken).to.equal(VELO_TOKEN_ADDRESS)
    expect(isWhitelisted).to.be.true

    // checkLog should return correct perform data on WhitelistToken event
    const triggerLog = {
      index: whitelistTokenLog.transactionIndex,
      txHash: whitelistTokenLog.transactionHash,
      blockNumber: whitelistTokenLog.blockNumber,
      blockHash: whitelistTokenLog.blockHash,
      timestamp: 0,
      source: voter.address,
      topics: whitelistTokenLog.topics,
      data: whitelistTokenLog.data,
    }
    const checkLogResult = await tokenUpkeepManager.callStatic.checkLog(
      triggerLog,
      HashZero,
    )

    expect(checkLogResult.upkeepNeeded).to.be.true
    expect(checkLogResult.performData).to.equal(
      ethers.utils.defaultAbiCoder.encode(
        ['uint8', 'address'],
        [PerformAction.RegisterToken, whitelistedToken],
      ),
    )

    // call performUpkeep with register perform data via KeeperRegistry
    const { receipt: performReceipt } = await simulatePerformUpkeep(
      keeperRegistry,
      whitelistTokenUpkeepId,
      checkLogResult.performData,
    )

    // check if token is registered
    const tokenRegisteredLog = findLog(
      performReceipt,
      tokenUpkeepManager.interface.getEventTopic('TokenRegistered'),
    )
    const { token: registeredToken } =
      tokenUpkeepManager.interface.parseLog(tokenRegisteredLog).args

    expect(registeredToken).to.equal(whitelistedToken)
    expect(await tokenUpkeepManager.tokenAt(0)).to.equal(whitelistedToken)

    // check if token upkeep is registered
    const tokenUpkeepCreatedLog = findLog(
      performReceipt,
      tokenUpkeepManager.interface.getEventTopic('TokenUpkeepRegistered'),
    )
    const { tokenUpkeep, upkeepId } = tokenUpkeepManager.interface.parseLog(
      tokenUpkeepCreatedLog,
    ).args

    expect(tokenUpkeep).to.be.properAddress
    expect(await tokenUpkeepManager.upkeepIds(0)).to.equal(upkeepId)

    // set token upkeep address and id
    tokenUpkeepAddress = tokenUpkeep
    tokenUpkeepId = upkeepId
  })

  it('Token upkeep execution flow', async () => {
    // attach to token upkeep contract
    const tokenUpkeep = await ethers.getContractAt(
      'TokenUpkeep',
      tokenUpkeepAddress,
    )

    // impersonate prices oracle owner
    await accounts[0].sendTransaction({
      to: PRICES_ORACLE_OWNER_ADDRESS,
      value: ethers.utils.parseEther('1'),
    })
    await impersonateAccount(PRICES_ORACLE_OWNER_ADDRESS)
    const pricesOracleOwnerSigner = await ethers.getSigner(
      PRICES_ORACLE_OWNER_ADDRESS,
    )
    // add token upkeep manager as keeper
    const addKeeperTx = await pricesOracle.populateTransaction.addKeeper(
      tokenUpkeepManager.address,
    )
    await pricesOracleOwnerSigner.sendTransaction({
      ...addKeeperTx,
      from: PRICES_ORACLE_OWNER_ADDRESS,
    })
    // set stable token to USDC
    const setStableTokenTx =
      await pricesOracle.populateTransaction.setStableToken(USDC_TOKEN_ADDRESS)
    await pricesOracleOwnerSigner.sendTransaction({
      ...setStableTokenTx,
      from: PRICES_ORACLE_OWNER_ADDRESS,
    })
    // set time window to 1 hour
    const setTimeWindowTx =
      await pricesOracle.populateTransaction.setTimeWindow(3600)
    await pricesOracleOwnerSigner.sendTransaction({
      ...setTimeWindowTx,
      from: PRICES_ORACLE_OWNER_ADDRESS,
    })
    await stopImpersonatingAccount(PRICES_ORACLE_OWNER_ADDRESS)

    // check if token price fetch is needed
    const [upkeepNeeded, performData] =
      await tokenUpkeep.callStatic.checkUpkeep(HashZero)

    const expectedPerformData = ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'address', 'uint256'],
      [0, VELO_TOKEN_ADDRESS, VELO_TOKEN_PRICE],
    )

    expect(upkeepNeeded).to.be.true
    expect(performData).to.equal(expectedPerformData)

    // check that prices oracle is not updated yet
    const blockTimestamp = await time.latest()
    const tokenPriceBefore = await pricesOracle.latest(
      VELO_TOKEN_ADDRESS,
      blockTimestamp,
    )
    expect(tokenPriceBefore).to.equal(0)

    // perform token upkeep via KeeperRegistry
    const { receipt: performReceipt } = await simulatePerformUpkeep(
      keeperRegistry,
      tokenUpkeepId,
      performData,
    )

    // check if token upkeep is successfully executed
    const upkeepPerformedLog = findLog(
      performReceipt,
      tokenUpkeep.interface.getEventTopic('TokenUpkeepPerformed'),
    )
    const { currentIndex, success } =
      tokenUpkeep.interface.parseLog(upkeepPerformedLog).args

    expect(success).to.be.true
    expect(currentIndex).to.equal(0)

    // check if token price is updated
    const tokenPriceUpdatedLog = findLog(
      performReceipt,
      tokenUpkeepManager.interface.getEventTopic('FetchedTokenPrice'),
    )
    const { token, price } =
      tokenUpkeepManager.interface.parseLog(tokenPriceUpdatedLog).args

    expect(token).to.equal(VELO_TOKEN_ADDRESS)
    expect(price).to.equal(VELO_TOKEN_PRICE)

    // check prices oracle is updated
    const tokenPriceAfter = await pricesOracle.latest(
      VELO_TOKEN_ADDRESS,
      blockTimestamp,
    )
    expect(tokenPriceAfter).to.equal(VELO_TOKEN_PRICE)
  })

  it('Token upkeep deregistration flow', async () => {
    // remove from whitelist token via voter
    const voterGovernor = await voter.governor()
    await impersonateAccount(voterGovernor)
    const voterSigner = await ethers.getSigner(voterGovernor)
    const removeTokenTx = await voter.populateTransaction.whitelistToken(
      VELO_TOKEN_ADDRESS,
      false,
    )
    const resultTx = await voterSigner.sendTransaction({
      ...removeTokenTx,
      from: voterGovernor,
    })
    await stopImpersonatingAccount(voterGovernor)
    const resultReceipt = await resultTx.wait()
    const removeTokenLog = findLog(
      resultReceipt,
      voter.interface.getEventTopic('WhitelistToken'),
    )
    const { token: removedToken, _bool: isWhitelisted } =
      voter.interface.parseLog(removeTokenLog).args

    expect(removedToken).to.equal(VELO_TOKEN_ADDRESS)
    expect(isWhitelisted).to.be.false

    // checkLog should return correct perform data on WhitelistToken event
    const triggerLog = {
      index: removeTokenLog.transactionIndex,
      txHash: removeTokenLog.transactionHash,
      blockNumber: removeTokenLog.blockNumber,
      blockHash: removeTokenLog.blockHash,
      timestamp: 0,
      source: voter.address,
      topics: removeTokenLog.topics,
      data: removeTokenLog.data,
    }
    const checkLogResult = await tokenUpkeepManager.callStatic.checkLog(
      triggerLog,
      HashZero,
    )

    expect(checkLogResult.upkeepNeeded).to.be.true
    expect(checkLogResult.performData).to.equal(
      ethers.utils.defaultAbiCoder.encode(
        ['uint8', 'address'],
        [PerformAction.DeregisterToken, removedToken],
      ),
    )

    // check if token upkeep is active
    const upkeepDetailsBefore = await keeperRegistry.getUpkeep(tokenUpkeepId)
    expect(upkeepDetailsBefore.maxValidBlocknumber).to.equal(MAX_UINT32)

    // call performUpkeep with cancel perform data via KeeperRegistry
    const { receipt: performReceipt } = await simulatePerformUpkeep(
      keeperRegistry,
      whitelistTokenUpkeepId,
      checkLogResult.performData,
    )

    // check if token is removed
    const tokenDeregisteredLog = findLog(
      performReceipt,
      tokenUpkeepManager.interface.getEventTopic('TokenDeregistered'),
    )
    const { token: deregisteredToken } =
      tokenUpkeepManager.interface.parseLog(tokenDeregisteredLog).args

    expect(deregisteredToken).to.equal(removedToken)

    await expect(tokenUpkeepManager.tokenAt(0)).to.be.reverted

    // check if token upkeep is cancelled
    const tokenUpkeepCancelledLog = findLog(
      performReceipt,
      tokenUpkeepManager.interface.getEventTopic('TokenUpkeepCancelled'),
    )
    const { upkeepId: cancelledUpkeepId } =
      tokenUpkeepManager.interface.parseLog(tokenUpkeepCancelledLog).args
    const upkeepDetailsAfter = await keeperRegistry.getUpkeep(tokenUpkeepId)

    expect(cancelledUpkeepId).to.equal(tokenUpkeepId)
    expect(upkeepDetailsAfter.maxValidBlocknumber).to.not.equal(MAX_UINT32)

    // check if upkeep is included in cancelledUpkeeps set
    expect(await tokenUpkeepManager.cancelledUpkeeps(0, 1)).to.deep.include(
      cancelledUpkeepId,
    )
  })

  it('Token upkeep withdrawal flow', async () => {
    // wait for cancellation delay after upkeep is cancelled so that it can be withdrawn
    await mine(UPKEEP_CANCELLATION_DELAY)

    const tokenUpkeepManagerBalanceBefore = await linkToken.balanceOf(
      tokenUpkeepManager.address,
    )
    const upkeepDetailsBefore = await keeperRegistry.getUpkeep(tokenUpkeepId)

    // withdraw upkeep balance via TokenUpkeepManager
    const withdrawTx = await tokenUpkeepManager.withdrawCancelledUpkeeps(0, 1)
    const withdrawReceipt = await withdrawTx.wait()

    // check if token upkeep is withdrawn
    const tokenUpkeepWithdrawnLog = findLog(
      withdrawReceipt,
      tokenUpkeepManager.interface.getEventTopic('TokenUpkeepWithdrawn'),
    )
    const { upkeepId: withdrawnUpkeepId } =
      tokenUpkeepManager.interface.parseLog(tokenUpkeepWithdrawnLog).args
    const tokenUpkeepManagerBalanceAfter = await linkToken.balanceOf(
      tokenUpkeepManager.address,
    )

    expect(withdrawnUpkeepId).to.equal(tokenUpkeepId)
    expect(tokenUpkeepManagerBalanceAfter).to.equal(
      tokenUpkeepManagerBalanceBefore.add(upkeepDetailsBefore.balance),
    )
  })

  it('Contract LINK withdrawal flow', async () => {
    const ownerBalanceBefore = await linkToken.balanceOf(accounts[0].address)
    const contractBalanceBefore = await linkToken.balanceOf(
      tokenUpkeepManager.address,
    )
    await tokenUpkeepManager.withdrawLinkBalance()
    const ownerBalanceAfter = await linkToken.balanceOf(accounts[0].address)
    const contractBalanceAfter = await linkToken.balanceOf(
      tokenUpkeepManager.address,
    )

    expect(contractBalanceAfter).to.equal(0)
    expect(ownerBalanceAfter).to.equal(
      ownerBalanceBefore.add(contractBalanceBefore),
    )
  })
})
