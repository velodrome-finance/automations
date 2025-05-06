import { expect } from 'chai'
import { ethers, network } from 'hardhat'
import { BigNumber } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  IERC20,
  TokenUpkeepManager,
  KeeperRegistryMock,
  AutomationRegistrarMock,
  UpkeepBalanceMonitor,
  PricesMock,
  VoterMock,
} from '../../../typechain-types'
import { findLog } from '../../utils'

const { AddressZero, HashZero } = ethers.constants

enum PerformAction {
  RegisterToken = 0,
  DeregisterToken = 1,
}

describe('TokenUpkeepManager Unit Tests', function () {
  let tokenUpkeepManager: TokenUpkeepManager
  let upkeepBalanceMonitor: UpkeepBalanceMonitor
  let linkToken: IERC20
  let keeperRegistryMock: KeeperRegistryMock
  let automationRegistrarMock: AutomationRegistrarMock
  let voterMock: VoterMock
  let pricesMock: PricesMock
  let tokenList: string[]
  let registerPerformData: string
  let deregisterPerformData: string
  let accounts: SignerWithAddress[]

  const upkeepManagerFundAmount = ethers.utils.parseEther('1')
  const upkeepFundAmount = ethers.utils.parseEther('0.1')
  const tokensPerUpkeepLimit = 100
  const upkeepCancelBuffer = 20
  const upkeepGasLimit = 500000
  const upkeepId = BigNumber.from(1)

  beforeEach(async function () {
    accounts = await ethers.getSigners()

    // deploy link token
    const erc20MintableFactory =
      await ethers.getContractFactory('ERC20Mintable')
    linkToken = await erc20MintableFactory.deploy()

    // deploy automation registrar mock
    const automationRegistrarMockFactory = await ethers.getContractFactory(
      'AutomationRegistrarMock',
    )
    automationRegistrarMock = await automationRegistrarMockFactory.deploy()

    // deploy keeper registry mock
    const keeperRegistryMockFactory =
      await ethers.getContractFactory('KeeperRegistryMock')
    keeperRegistryMock = await keeperRegistryMockFactory.deploy()
    await keeperRegistryMock.setForwarder(accounts[0].address)

    // deploy upkeep balance monitor
    const upkeepBalanceMonitorFactory = await ethers.getContractFactory(
      'UpkeepBalanceMonitor',
    )
    upkeepBalanceMonitor = await upkeepBalanceMonitorFactory.deploy(
      linkToken.address,
      keeperRegistryMock.address,
      {
        maxBatchSize: 10,
        minPercentage: 120,
        targetPercentage: 300,
        maxTopUpAmount: ethers.utils.parseEther('10'),
        maxIterations: 10,
      },
    )

    // deploy voter mock
    const voterMockFactory = await ethers.getContractFactory('VoterMock')
    voterMock = await voterMockFactory.deploy(
      AddressZero,
      AddressZero,
      AddressZero,
    )

    // deploy prices mock
    const pricesMockFactory = await ethers.getContractFactory('PricesMock')
    pricesMock = await pricesMockFactory.deploy()

    // deploy token upkeep manager
    const tokenUpkeepManagerFactory =
      await ethers.getContractFactory('TokenUpkeepManager')
    tokenUpkeepManager = await tokenUpkeepManagerFactory.deploy(
      linkToken.address,
      keeperRegistryMock.address,
      automationRegistrarMock.address,
      voterMock.address,
      pricesMock.address,
      upkeepBalanceMonitor.address,
      upkeepFundAmount,
      upkeepGasLimit,
    )
    tokenUpkeepManager.setTrustedForwarder(accounts[0].address)

    // set token upkeep manager as watch list manager in balance monitor
    await upkeepBalanceMonitor.grantWatchlistManagerRole(
      tokenUpkeepManager.address,
    )

    // fund token upkeep manager with link token
    await linkToken.transfer(
      tokenUpkeepManager.address,
      upkeepManagerFundAmount,
    )

    // generate whitelist token data
    tokenList = Array.from(
      { length: 10 },
      () => ethers.Wallet.createRandom().address,
    )

    // whitelist tokens in voter mock
    for (const token of tokenList) {
      await voterMock.whitelistToken(token, true)
    }

    // generate sample perform data
    registerPerformData = ethers.utils.defaultAbiCoder.encode(
      ['uint8', 'address'],
      [PerformAction.RegisterToken, tokenList[0]],
    )
    deregisterPerformData = ethers.utils.defaultAbiCoder.encode(
      ['uint8', 'address'],
      [PerformAction.DeregisterToken, tokenList[0]],
    )
  })

  describe('Register token', function () {
    it('should trigger a new token registration', async () => {
      const whitelistTokenTx = await voterMock.whitelistToken(
        tokenList[0],
        true,
      )
      const whitelistTokenReceipt = await whitelistTokenTx.wait()
      const whitelistTokenLog = whitelistTokenReceipt.logs[0]
      const log = {
        index: whitelistTokenLog.transactionIndex,
        txHash: whitelistTokenLog.transactionHash,
        blockNumber: whitelistTokenLog.blockNumber,
        blockHash: whitelistTokenLog.blockHash,
        timestamp: 0,
        source: voterMock.address,
        topics: whitelistTokenLog.topics,
        data: whitelistTokenLog.data,
      }

      const [upkeepNeeded, performData] =
        await tokenUpkeepManager.callStatic.checkLog(log, HashZero)

      expect(upkeepNeeded).to.be.true
      expect(performData).to.equal(registerPerformData)
    })

    it('should register a new token', async () => {
      const tx = await tokenUpkeepManager.performUpkeep(registerPerformData)

      await expect(tx)
        .to.emit(tokenUpkeepManager, 'TokenRegistered')
        .withArgs(tokenList[0])

      expect(await tokenUpkeepManager.tokenAt(0)).to.equal(tokenList[0])
    })

    it('should register a new token upkeep', async () => {
      const tx = await tokenUpkeepManager.performUpkeep(registerPerformData)
      const receipt = await tx.wait()
      const log = findLog(
        receipt,
        tokenUpkeepManager.interface.getEventTopic('TokenUpkeepRegistered'),
      )
      const [tokenUpkeepAddress] =
        tokenUpkeepManager.interface.parseLog(log).args

      await expect(tx).to.emit(tokenUpkeepManager, 'TokenUpkeepRegistered')

      expect(await tokenUpkeepManager.upkeepIds(0)).to.equal(1)
      expect(await tokenUpkeepManager.upkeepCount()).to.equal(1)
      expect(await tokenUpkeepManager.isTokenUpkeep(tokenUpkeepAddress)).to.be
        .true
      expect(await tokenUpkeepManager.tokenUpkeep(1)).to.equal(
        tokenUpkeepAddress,
      )
    })

    it('should set the trusted forwarder when registering a new upkeep', async () => {
      const tx = await tokenUpkeepManager.performUpkeep(registerPerformData)
      const receipt = await tx.wait()

      const log = findLog(
        receipt,
        tokenUpkeepManager.interface.getEventTopic('TokenUpkeepRegistered'),
      )
      expect(log).to.exist

      const [tokenUpkeepAddress] =
        tokenUpkeepManager.interface.parseLog(log).args
      const tokenUpkeep = await ethers.getContractAt(
        'TokenUpkeep',
        tokenUpkeepAddress,
      )

      expect(await tokenUpkeep.trustedForwarder()).to.equal(accounts[0].address)
    })

    it('should not register a new upkeep until the tokens per upkeep limit is reached', async () => {
      const bulkFakeTokenAddresses = Array.from(
        { length: tokensPerUpkeepLimit },
        () => ethers.Wallet.createRandom().address,
      )
      for (const token of bulkFakeTokenAddresses) {
        await voterMock.whitelistToken(token, true)
      }
      await tokenUpkeepManager.registerTokens(bulkFakeTokenAddresses)

      // should not register more than the tokens per upkeep limit
      expect(await tokenUpkeepManager.upkeepCount()).to.equal(1)
      expect(await tokenUpkeepManager.tokenCount()).to.equal(
        tokensPerUpkeepLimit,
      )

      // should register a new upkeep after the tokens per upkeep limit is reached
      await tokenUpkeepManager.registerTokens([tokenList[0]])

      expect(await tokenUpkeepManager.upkeepCount()).to.equal(2)
      expect(await tokenUpkeepManager.tokenCount()).to.equal(
        tokensPerUpkeepLimit + 1,
      )
    })

    it('should add registered upkeeps to the watch list', async () => {
      await tokenUpkeepManager.performUpkeep(registerPerformData)

      const watchList = await upkeepBalanceMonitor.getWatchList()

      expect(watchList).to.deep.include(upkeepId)
    })

    it('should not allow non-trusted forwarder to register upkeep', async () => {
      await expect(
        tokenUpkeepManager
          .connect(accounts[1])
          .performUpkeep(registerPerformData),
      ).to.be.revertedWithCustomError(tokenUpkeepManager, 'UnauthorizedSender')
    })
  })

  describe('Deregister token', function () {
    it('should trigger token deregistration', async () => {
      await tokenUpkeepManager.performUpkeep(registerPerformData)

      const removeTokenTx = await voterMock.whitelistToken(tokenList[0], false)
      const removeTokenReceipt = await removeTokenTx.wait()
      const removeTokenLog = removeTokenReceipt.logs[0]
      const log = {
        index: removeTokenLog.transactionIndex,
        txHash: removeTokenLog.transactionHash,
        blockNumber: removeTokenLog.blockNumber,
        blockHash: removeTokenLog.blockHash,
        timestamp: 0,
        source: voterMock.address,
        topics: removeTokenLog.topics,
        data: removeTokenLog.data,
      }

      const [upkeepNeeded, performData] =
        await tokenUpkeepManager.callStatic.checkLog(log, HashZero)

      expect(upkeepNeeded).to.be.true
      expect(performData).to.equal(deregisterPerformData)
    })

    it('should deregister a token', async () => {
      await tokenUpkeepManager.performUpkeep(registerPerformData)
      const tx = await tokenUpkeepManager.performUpkeep(deregisterPerformData)

      await expect(tx)
        .to.emit(tokenUpkeepManager, 'TokenDeregistered')
        .withArgs(tokenList[0])

      await expect(tokenUpkeepManager.tokenAt(0)).to.be.reverted
      expect(await tokenUpkeepManager.tokenCount()).to.equal(0)
    })

    it('should cancel a token upkeep', async () => {
      const registerTx =
        await tokenUpkeepManager.performUpkeep(registerPerformData)
      const registerReceipt = await registerTx.wait()
      const registerLog = findLog(
        registerReceipt,
        tokenUpkeepManager.interface.getEventTopic('TokenUpkeepRegistered'),
      )
      const [tokenUpkeepAddress] =
        tokenUpkeepManager.interface.parseLog(registerLog).args

      const tx = await tokenUpkeepManager.performUpkeep(deregisterPerformData)

      await expect(tx)
        .to.emit(tokenUpkeepManager, 'TokenUpkeepCancelled')
        .withArgs(upkeepId)

      await expect(tokenUpkeepManager.upkeepIds(0)).to.be.reverted
      expect(await tokenUpkeepManager.upkeepCount()).to.equal(0)
      expect(await tokenUpkeepManager.cancelledUpkeeps(0, 1)).deep.include(
        upkeepId,
      )
      expect(await tokenUpkeepManager.isTokenUpkeep(tokenUpkeepAddress)).to.be
        .false
      expect(await tokenUpkeepManager.tokenUpkeep(upkeepId)).to.equal(
        AddressZero,
      )
    })

    it('should not cancel upkeep before the buffer is reached', async () => {
      const bulkFakeTokenAddresses = Array.from(
        { length: tokensPerUpkeepLimit + 1 },
        () => ethers.Wallet.createRandom().address,
      )
      for (const token of bulkFakeTokenAddresses) {
        await voterMock.whitelistToken(token, true)
      }
      await tokenUpkeepManager.registerTokens(bulkFakeTokenAddresses)
      expect(await tokenUpkeepManager.upkeepCount()).to.equal(2)

      // upkeep should not be cancelled until the buffer is reached
      await tokenUpkeepManager.deregisterTokens(
        bulkFakeTokenAddresses.slice(0, upkeepCancelBuffer),
      )
      expect(await tokenUpkeepManager.upkeepCount()).to.equal(2)

      // upkeep should be cancelled after the buffer is reached
      await expect(
        tokenUpkeepManager.deregisterTokens(
          bulkFakeTokenAddresses.slice(
            upkeepCancelBuffer,
            upkeepCancelBuffer + 1,
          ),
        ),
      ).to.emit(tokenUpkeepManager, 'TokenUpkeepCancelled')
      expect(await tokenUpkeepManager.upkeepCount()).to.equal(1)
      expect(await tokenUpkeepManager.tokenCount()).to.equal(
        tokensPerUpkeepLimit - upkeepCancelBuffer,
      )
    })

    it('should remove cancelled upkeeps from the watch list', async () => {
      await tokenUpkeepManager.performUpkeep(registerPerformData)
      await tokenUpkeepManager.performUpkeep(deregisterPerformData)

      const watchList = await upkeepBalanceMonitor.getWatchList()

      expect(watchList).to.not.include(upkeepId)
    })

    it('should not allow non-trusted forwarder to cancel upkeep', async () => {
      await tokenUpkeepManager.performUpkeep(registerPerformData)
      await expect(
        tokenUpkeepManager
          .connect(accounts[1])
          .performUpkeep(deregisterPerformData),
      ).to.be.revertedWithCustomError(tokenUpkeepManager, 'UnauthorizedSender')
    })
  })

  describe('Fetch token price', function () {
    it('should fetch token price', async () => {
      await tokenUpkeepManager.performUpkeep(registerPerformData)

      const [token, index, price] = await tokenUpkeepManager.fetchFirstPrice(
        0,
        1,
      )

      expect(token).to.equal(tokenList[0])
      expect(index).to.equal(0)
      expect(price).to.equal(1)
    })

    it('should fetch the first non-zero token price', async () => {
      await tokenUpkeepManager.registerTokens(tokenList)

      // deregister all tokens except the last one
      await tokenUpkeepManager.deregisterTokens(tokenList.slice(0, -1))

      const [token, index, price] = await tokenUpkeepManager.fetchFirstPrice(
        0,
        tokenList.length,
      )

      expect(token).to.equal(tokenList[tokenList.length - 1])
      expect(index).to.equal(tokenList.length - 1)
      expect(price).to.equal(1)
    })

    it('should not fetch token price if there are no non-zero tokens', async () => {
      await tokenUpkeepManager.registerTokens(tokenList)
      await tokenUpkeepManager.deregisterTokens(tokenList)

      const [token, index, price] = await tokenUpkeepManager.fetchFirstPrice(
        0,
        tokenList.length - 1,
      )

      expect(token).to.equal(AddressZero)
      expect(index).to.equal(0)
      expect(price).to.equal(0)
    })
  })

  describe('Store fetched price', function () {
    it('should store a new token price', async () => {
      // register token upkeep
      const registerTx =
        await tokenUpkeepManager.performUpkeep(registerPerformData)
      const registerReceipt = await registerTx.wait()

      // get token upkeep address
      const registerLog = findLog(
        registerReceipt,
        tokenUpkeepManager.interface.getEventTopic('TokenUpkeepRegistered'),
      )
      const [tokenUpkeepAddress] =
        tokenUpkeepManager.interface.parseLog(registerLog).args

      // impersonate token upkeep
      await network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [tokenUpkeepAddress],
      })
      const impersonatedSigner = ethers.provider.getSigner(tokenUpkeepAddress)
      await network.provider.send('hardhat_setBalance', [
        tokenUpkeepAddress,
        '0xffffffffffffffff',
      ])

      // store price via token upkeep
      const token = tokenList[0]
      const price = ethers.utils.parseEther('1')
      const storeTx = await tokenUpkeepManager
        .connect(impersonatedSigner)
        .storePriceAndCleanup(token, price, false)

      await expect(storeTx)
        .to.emit(tokenUpkeepManager, 'FetchedTokenPrice')
        .withArgs(token, price)

      // check if prices mock was called
      const storeReceipt = await storeTx.wait()
      const priceLog = findLog(
        storeReceipt,
        pricesMock.interface.getEventTopic('Price'),
      )
      const [storedToken, storedPrice] =
        pricesMock.interface.parseLog(priceLog).args

      expect(storedToken).to.equal(token)
      expect(storedPrice).to.equal(price)
    })

    it('should clean up the token list at the last token', async () => {
      // register token upkeep
      const registerTx =
        await tokenUpkeepManager.performUpkeep(registerPerformData)
      const registerReceipt = await registerTx.wait()

      // register more tokens
      await tokenUpkeepManager.registerTokens([tokenList[1], tokenList[2]])

      // deregister one token to trigger cleanup
      await tokenUpkeepManager.deregisterTokens([tokenList[1]])

      expect(await tokenUpkeepManager.tokenCount()).to.equal(2)
      expect(await tokenUpkeepManager.tokenListLength()).to.equal(3)

      // get token upkeep address
      const registerLog = findLog(
        registerReceipt,
        tokenUpkeepManager.interface.getEventTopic('TokenUpkeepRegistered'),
      )
      const [tokenUpkeepAddress] =
        tokenUpkeepManager.interface.parseLog(registerLog).args
      // impersonate token upkeep
      await network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [tokenUpkeepAddress],
      })
      const impersonatedSigner = ethers.provider.getSigner(tokenUpkeepAddress)
      await network.provider.send('hardhat_setBalance', [
        tokenUpkeepAddress,
        '0xffffffffffffffff',
      ])

      // store price via token upkeep
      const token = tokenList[0]
      const price = ethers.utils.parseEther('1')
      const storeTx = await tokenUpkeepManager
        .connect(impersonatedSigner)
        .storePriceAndCleanup(token, price, false)

      await expect(storeTx)
        .to.emit(tokenUpkeepManager, 'FetchedTokenPrice')
        .withArgs(token, price)

      await expect(storeTx).to.not.emit(tokenUpkeepManager, 'TokenListCleaned')

      // store price for the last token
      const token2 = tokenList[1]
      const price2 = ethers.utils.parseEther('1')
      const storeTx2 = await tokenUpkeepManager
        .connect(impersonatedSigner)
        .storePriceAndCleanup(token2, price2, true)

      await expect(storeTx2)
        .to.emit(tokenUpkeepManager, 'FetchedTokenPrice')
        .withArgs(token2, price2)

      await expect(storeTx2).to.emit(tokenUpkeepManager, 'TokenListCleaned')

      expect(await tokenUpkeepManager.tokenListLength()).to.equal(
        await tokenUpkeepManager.tokenCount(),
      )
    })

    it('should only allow token upkeep to store price', async () => {
      await expect(
        tokenUpkeepManager.storePriceAndCleanup(
          tokenList[0],
          ethers.utils.parseEther('1'),
          false,
        ),
      ).to.be.revertedWithCustomError(tokenUpkeepManager, 'UnauthorizedSender')
    })
  })

  describe('Finish upkeep', function () {
    it('should clean up the token list when all upkeeps are finished', async () => {
      // register token upkeep
      const registerTx =
        await tokenUpkeepManager.performUpkeep(registerPerformData)
      const registerReceipt = await registerTx.wait()

      // get token upkeep address
      const registerLog = findLog(
        registerReceipt,
        tokenUpkeepManager.interface.getEventTopic('TokenUpkeepRegistered'),
      )
      const [tokenUpkeepAddress] =
        tokenUpkeepManager.interface.parseLog(registerLog).args

      // impersonate token upkeep
      await network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [tokenUpkeepAddress],
      })
      const impersonatedSigner = ethers.provider.getSigner(tokenUpkeepAddress)
      await network.provider.send('hardhat_setBalance', [
        tokenUpkeepAddress,
        '0xffffffffffffffff',
      ])

      const block = await ethers.provider.getBlock('latest')
      const lastHour = Math.floor(block.timestamp / 3600) * 3600

      await expect(
        tokenUpkeepManager
          .connect(impersonatedSigner)
          .finishUpkeepAndCleanup(lastHour),
      ).to.emit(tokenUpkeepManager, 'TokenListCleaned')
    })

    it('should not allow non-trusted forwarder to finish upkeep', async () => {
      await expect(
        tokenUpkeepManager.connect(accounts[1]).finishUpkeepAndCleanup(0),
      ).to.be.revertedWithCustomError(tokenUpkeepManager, 'UnauthorizedSender')
    })
  })

  describe('Cleanup token list', function () {
    it('should clean up the token list', async () => {
      expect(await tokenUpkeepManager.tokenListLength()).to.equal(0)
      expect(await tokenUpkeepManager.tokenCount()).to.equal(0)

      // register tokens
      await tokenUpkeepManager.registerTokens(tokenList)

      expect(await tokenUpkeepManager.tokenListLength()).to.equal(
        tokenList.length,
      )
      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenList.length)

      // deregister half of the tokens
      const removedTokens = tokenList.slice(0, 5)
      await tokenUpkeepManager.deregisterTokens(removedTokens)
      const newLength = tokenList.length - removedTokens.length

      expect(await tokenUpkeepManager.tokenListLength()).to.equal(
        tokenList.length,
      )
      expect(await tokenUpkeepManager.tokenCount()).to.equal(newLength)

      // cleanup token list
      const tx = await tokenUpkeepManager.cleanupTokenList()

      await expect(tx).to.emit(tokenUpkeepManager, 'TokenListCleaned')

      expect(await tokenUpkeepManager.tokenCount()).to.equal(newLength)
      expect(await tokenUpkeepManager.tokenListLength()).to.equal(newLength)
    })

    it('should clean up the token list when all tokens are deregistered', async () => {
      const tokenCount = 50
      const bulkFakeTokenAddresses = Array.from(
        { length: tokenCount },
        () => ethers.Wallet.createRandom().address,
      )
      for (const token of bulkFakeTokenAddresses) {
        await voterMock.whitelistToken(token, true)
      }

      // register a large number of tokens
      await tokenUpkeepManager.registerTokens(bulkFakeTokenAddresses)

      expect(await tokenUpkeepManager.tokenListLength()).to.equal(tokenCount)
      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenCount)

      // deregister all tokens
      await tokenUpkeepManager.deregisterTokens(bulkFakeTokenAddresses)

      expect(await tokenUpkeepManager.tokenListLength()).to.equal(
        // excluding the last token which is just popped
        tokenCount - 1,
      )
      expect(await tokenUpkeepManager.tokenCount()).to.equal(0)

      // cleanup token list
      const tx = await tokenUpkeepManager.cleanupTokenList()

      await expect(tx).to.emit(tokenUpkeepManager, 'TokenListCleaned')

      expect(await tokenUpkeepManager.tokenCount()).to.equal(0)
      expect(await tokenUpkeepManager.tokenListLength()).to.equal(0)
    })

    it('should clean up the token list when first tokens are removed in ascending order', async () => {
      const tokenCount = 50
      const bulkFakeTokenAddresses = Array.from(
        { length: tokenCount },
        () => ethers.Wallet.createRandom().address,
      )
      for (const token of bulkFakeTokenAddresses) {
        await voterMock.whitelistToken(token, true)
      }

      // register a large number of tokens
      await tokenUpkeepManager.registerTokens(bulkFakeTokenAddresses)

      expect(await tokenUpkeepManager.tokenListLength()).to.equal(tokenCount)
      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenCount)

      // deregister fist half of the tokens in ascending order
      await tokenUpkeepManager.deregisterTokens(
        bulkFakeTokenAddresses.slice(0, 25),
      )

      expect(await tokenUpkeepManager.tokenListLength()).to.equal(tokenCount)
      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenCount / 2)

      // cleanup token list
      const tx = await tokenUpkeepManager.cleanupTokenList()

      await expect(tx).to.emit(tokenUpkeepManager, 'TokenListCleaned')

      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenCount / 2)
      expect(await tokenUpkeepManager.tokenListLength()).to.equal(
        tokenCount / 2,
      )

      // check if all remaining tokens are in the token list
      const tokenList = await tokenUpkeepManager.tokenList(0, 25)
      const remainingTokens = bulkFakeTokenAddresses.slice(25)
      expect(tokenList).to.deep.equal(remainingTokens)
    })

    it('should clean up the token list when first tokens are removed in descending order', async () => {
      const tokenCount = 50
      const bulkFakeTokenAddresses = Array.from(
        { length: tokenCount },
        () => ethers.Wallet.createRandom().address,
      )
      for (const token of bulkFakeTokenAddresses) {
        await voterMock.whitelistToken(token, true)
      }

      // register a large number of tokens
      await tokenUpkeepManager.registerTokens(bulkFakeTokenAddresses)

      expect(await tokenUpkeepManager.tokenListLength()).to.equal(tokenCount)
      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenCount)

      // deregister first half of the tokens in descending order
      for (let i = tokenCount / 2 - 1; i >= 0; i--) {
        await tokenUpkeepManager.deregisterTokens([bulkFakeTokenAddresses[i]])
      }

      expect(await tokenUpkeepManager.tokenListLength()).to.equal(tokenCount)
      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenCount / 2)

      // cleanup token list
      const tx = await tokenUpkeepManager.cleanupTokenList()

      await expect(tx).to.emit(tokenUpkeepManager, 'TokenListCleaned')

      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenCount / 2)
      expect(await tokenUpkeepManager.tokenListLength()).to.equal(
        tokenCount / 2,
      )

      // check if all remaining tokens are in the token list
      const tokenList = await tokenUpkeepManager.tokenList(0, tokenCount / 2)
      const remainingTokens = bulkFakeTokenAddresses.slice(tokenCount / 2)
      for (let i = 0; i < tokenCount / 2; i++) {
        expect(tokenList).to.include(remainingTokens[i])
      }
    })

    it('should clean up the token list when last tokens are removed in ascending order', async () => {
      const tokenCount = 50
      const bulkFakeTokenAddresses = Array.from(
        { length: tokenCount },
        () => ethers.Wallet.createRandom().address,
      )
      for (const token of bulkFakeTokenAddresses) {
        await voterMock.whitelistToken(token, true)
      }

      // register a large number of tokens
      await tokenUpkeepManager.registerTokens(bulkFakeTokenAddresses)

      expect(await tokenUpkeepManager.tokenListLength()).to.equal(tokenCount)
      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenCount)

      // deregister second half of the tokens in ascending order
      await tokenUpkeepManager.deregisterTokens(
        bulkFakeTokenAddresses.slice(25),
      )

      expect(await tokenUpkeepManager.tokenListLength()).to.equal(
        // excluding the last token which is just popped
        tokenCount - 1,
      )
      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenCount / 2)

      // cleanup token list
      const tx = await tokenUpkeepManager.cleanupTokenList()

      await expect(tx).to.emit(tokenUpkeepManager, 'TokenListCleaned')

      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenCount / 2)
      expect(await tokenUpkeepManager.tokenListLength()).to.equal(
        tokenCount / 2,
      )

      // check if all remaining tokens are in the token list
      const tokenList = await tokenUpkeepManager.tokenList(0, 25)
      const remainingTokens = bulkFakeTokenAddresses.slice(0, 25)
      expect(tokenList).to.deep.equal(remainingTokens)
    })

    it('should clean up the token list when last tokens are removed in descending order', async () => {
      const tokenCount = 50
      const bulkFakeTokenAddresses = Array.from(
        { length: tokenCount },
        () => ethers.Wallet.createRandom().address,
      )
      for (const token of bulkFakeTokenAddresses) {
        await voterMock.whitelistToken(token, true)
      }

      // register a large number of tokens
      await tokenUpkeepManager.registerTokens(bulkFakeTokenAddresses)

      expect(await tokenUpkeepManager.tokenListLength()).to.equal(tokenCount)
      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenCount)

      // deregister second half of the tokens in descending order
      for (let i = tokenCount - 1; i >= tokenCount / 2; i--) {
        await tokenUpkeepManager.deregisterTokens([bulkFakeTokenAddresses[i]])
      }

      // token list length should be the same since each token is popped
      expect(await tokenUpkeepManager.tokenListLength()).to.equal(
        tokenCount / 2,
      )
      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenCount / 2)

      // cleanup token list
      const tx = await tokenUpkeepManager.cleanupTokenList()

      await expect(tx).to.emit(tokenUpkeepManager, 'TokenListCleaned')

      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenCount / 2)
      expect(await tokenUpkeepManager.tokenListLength()).to.equal(
        tokenCount / 2,
      )

      // check if all remaining tokens are in the token list
      const tokenList = await tokenUpkeepManager.tokenList(0, tokenCount / 2)
      const remainingTokens = bulkFakeTokenAddresses.slice(0, tokenCount / 2)
      expect(tokenList).to.deep.equal(remainingTokens)
    })

    it('should clean up the token list when tokens are removed in random order', async () => {
      const tokenCount = 50
      const bulkFakeTokenAddresses = Array.from(
        { length: tokenCount },
        () => ethers.Wallet.createRandom().address,
      )
      for (const token of bulkFakeTokenAddresses) {
        await voterMock.whitelistToken(token, true)
      }

      // register a large number of tokens
      await tokenUpkeepManager.registerTokens(bulkFakeTokenAddresses)

      expect(await tokenUpkeepManager.tokenListLength()).to.equal(tokenCount)
      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenCount)

      // deregister half of the tokens in random order
      const randomIndexes = new Set<number>([
        4, 43, 37, 2, 42, 40, 30, 21, 33, 6, 19, 23, 29, 31, 9, 20, 18, 35, 15,
        32, 47, 24, 0, 14, 41,
      ])
      for (const index of randomIndexes) {
        await tokenUpkeepManager.deregisterTokens([
          bulkFakeTokenAddresses[index],
        ])
      }

      expect(await tokenUpkeepManager.tokenListLength()).to.equal(tokenCount)
      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenCount / 2)

      // cleanup token list
      const tx = await tokenUpkeepManager.cleanupTokenList()

      await expect(tx).to.emit(tokenUpkeepManager, 'TokenListCleaned')

      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenCount / 2)
      expect(await tokenUpkeepManager.tokenListLength()).to.equal(
        tokenCount / 2,
      )

      // check if all remaining tokens are in the token list
      const tokenList = await tokenUpkeepManager.tokenList(0, tokenCount / 2)
      const remainingTokens = bulkFakeTokenAddresses.filter(
        (_, index) => !randomIndexes.has(index),
      )
      expect(remainingTokens.length).to.equal(tokenCount / 2)
      for (let i = 0; i < tokenCount / 2; i++) {
        expect(tokenList).to.include(remainingTokens[i])
      }
    })

    it('should cleanup the token list when tokens are removed in consecutive batches', async () => {
      const tokenCount = 50
      const bulkFakeTokenAddresses = Array.from(
        { length: tokenCount },
        () => ethers.Wallet.createRandom().address,
      )
      for (const token of bulkFakeTokenAddresses) {
        await voterMock.whitelistToken(token, true)
      }

      // register a large number of tokens
      await tokenUpkeepManager.registerTokens(bulkFakeTokenAddresses)

      expect(await tokenUpkeepManager.tokenListLength()).to.equal(tokenCount)
      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenCount)

      // deregister half of the tokens in consecutive batches
      const remoedTokens = new Set<string>()
      const batchSize = 5
      for (let i = 0; i < tokenCount; i += batchSize) {
        // skip every other batch
        if (i % (batchSize * 2) === 0) continue
        const tokensToRemove = bulkFakeTokenAddresses.slice(i, i + batchSize)
        await tokenUpkeepManager.deregisterTokens(tokensToRemove)
        for (const token of tokensToRemove) {
          remoedTokens.add(token)
        }
      }

      expect(await tokenUpkeepManager.tokenListLength()).to.equal(
        // excluding the last token which is just popped
        tokenCount - 1,
      )
      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenCount / 2)

      // cleanup token list
      const tx = await tokenUpkeepManager.cleanupTokenList()

      await expect(tx).to.emit(tokenUpkeepManager, 'TokenListCleaned')

      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenCount / 2)
      expect(await tokenUpkeepManager.tokenListLength()).to.equal(
        tokenCount / 2,
      )

      // check if all remaining tokens are in the token list
      const tokenList = await tokenUpkeepManager.tokenList(0, tokenCount / 2)
      const remainingTokens = bulkFakeTokenAddresses.filter(
        (_, index) => !remoedTokens.has(bulkFakeTokenAddresses[index]),
      )
      expect(remainingTokens.length).to.equal(tokenCount / 2)
      for (let i = 0; i < tokenCount / 2; i++) {
        expect(tokenList).to.include(remainingTokens[i])
      }
    })

    it('should cleanup the token list when the index before last token is removed', async () => {
      const tokenCount = 50
      const bulkFakeTokenAddresses = Array.from(
        { length: tokenCount },
        () => ethers.Wallet.createRandom().address,
      )
      for (const token of bulkFakeTokenAddresses) {
        await voterMock.whitelistToken(token, true)
      }

      // register a large number of tokens
      await tokenUpkeepManager.registerTokens(bulkFakeTokenAddresses)

      expect(await tokenUpkeepManager.tokenListLength()).to.equal(tokenCount)
      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenCount)

      // deregister the token before the last token
      // so that during cleanup when the last token is popped
      // the new last token will be zero
      await tokenUpkeepManager.deregisterTokens([
        bulkFakeTokenAddresses[tokenCount - 2],
      ])
      // deregister first half of the tokens
      await tokenUpkeepManager.deregisterTokens(
        bulkFakeTokenAddresses.slice(0, tokenCount / 2),
      )

      expect(await tokenUpkeepManager.tokenListLength()).to.equal(tokenCount)
      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenCount / 2 - 1)

      // cleanup token list
      const tx = await tokenUpkeepManager.cleanupTokenList()

      await expect(tx).to.emit(tokenUpkeepManager, 'TokenListCleaned')

      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenCount / 2 - 1)
      expect(await tokenUpkeepManager.tokenListLength()).to.equal(
        tokenCount / 2 - 1,
      )

      // check if all remaining tokens are in the token list
      const tokenList = await tokenUpkeepManager.tokenList(
        0,
        tokenCount / 2 - 1,
      )
      const remainingTokens = bulkFakeTokenAddresses.filter(
        (_, index) => index !== tokenCount - 2 && index >= tokenCount / 2,
      )
      expect(remainingTokens.length).to.equal(tokenCount / 2 - 1)
      for (let i = 0; i < tokenCount / 2 - 1; i++) {
        expect(tokenList).to.include(remainingTokens[i])
      }
    })

    it('should clean up the token list within the gas limit', async () => {
      const performUpkeepGasLimit = 5_000_000
      const maxTokensCleanup = 150

      // register a large number of tokens
      const bulkFakeTokenAddresses = Array.from(
        { length: maxTokensCleanup },
        () => ethers.Wallet.createRandom().address,
      )
      for (const token of bulkFakeTokenAddresses) {
        await voterMock.whitelistToken(token, true)
      }
      await tokenUpkeepManager.registerTokens(bulkFakeTokenAddresses)

      // split in two batches to avoid hitting the block gas limit
      const bulkFakeTokenAddresses2 = Array.from(
        { length: maxTokensCleanup },
        () => ethers.Wallet.createRandom().address,
      )
      for (const token of bulkFakeTokenAddresses2) {
        await voterMock.whitelistToken(token, true)
      }
      await tokenUpkeepManager.registerTokens(bulkFakeTokenAddresses2)

      // deregister half of the tokens
      await tokenUpkeepManager.deregisterTokens(bulkFakeTokenAddresses)

      const tx = await tokenUpkeepManager.cleanupTokenList()
      const receipt = await tx.wait()

      expect(receipt.gasUsed).to.be.lessThan(performUpkeepGasLimit)
    })

    it('should not cleanup the token list if no tokens were removed', async () => {
      const tokenCount = 50
      const bulkFakeTokenAddresses = Array.from(
        { length: tokenCount },
        () => ethers.Wallet.createRandom().address,
      )
      for (const token of bulkFakeTokenAddresses) {
        await voterMock.whitelistToken(token, true)
      }

      // register a large number of tokens
      await tokenUpkeepManager.registerTokens(bulkFakeTokenAddresses)

      expect(await tokenUpkeepManager.tokenListLength()).to.equal(tokenCount)
      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenCount)

      // cleanup token list
      const tx = await tokenUpkeepManager.cleanupTokenList()

      await expect(tx).to.emit(tokenUpkeepManager, 'TokenListCleaned')

      expect(await tokenUpkeepManager.tokenCount()).to.equal(tokenCount)
      expect(await tokenUpkeepManager.tokenListLength()).to.equal(tokenCount)
    })
  })

  describe('Withdraw token upkeep', function () {
    it('should withdraw cancelled upkeep balance', async () => {
      await tokenUpkeepManager.performUpkeep(registerPerformData)
      await tokenUpkeepManager.performUpkeep(deregisterPerformData)

      const tx = await tokenUpkeepManager.withdrawCancelledUpkeeps(0, 1)

      await expect(tx)
        .to.emit(tokenUpkeepManager, 'TokenUpkeepWithdrawn')
        .withArgs(upkeepId)
    })

    it('should withdraw multiple cancelled upkeeps', async () => {
      const upkeepCount = 2
      const fakeTokenAddresses = Array.from(
        { length: tokensPerUpkeepLimit * upkeepCount },
        () => ethers.Wallet.createRandom().address,
      )
      for (const token of fakeTokenAddresses) {
        await voterMock.whitelistToken(token, true)
      }
      await tokenUpkeepManager.registerTokens(fakeTokenAddresses)
      await tokenUpkeepManager.deregisterTokens(fakeTokenAddresses)

      expect(await tokenUpkeepManager.cancelledUpkeepCount()).to.equal(
        upkeepCount,
      )

      const tx = await tokenUpkeepManager.withdrawCancelledUpkeeps(
        0,
        upkeepCount,
      )
      const receipt = await tx.wait()
      const tokenUpkeepWithdrawnLogs = receipt.logs.filter(
        (log) =>
          log.topics[0] ===
          tokenUpkeepManager.interface.getEventTopic('TokenUpkeepWithdrawn'),
      )

      expect(tokenUpkeepWithdrawnLogs.length).to.equal(upkeepCount)
      expect(await tokenUpkeepManager.cancelledUpkeepCount()).to.equal(0)
    })
  })

  describe('Owner functions', function () {
    it('should set a new upkeep gas limit', async () => {
      const newUpkeepGasLimit = 100000
      await tokenUpkeepManager.setNewUpkeepGasLimit(newUpkeepGasLimit)

      expect(await tokenUpkeepManager.newUpkeepGasLimit()).to.equal(
        newUpkeepGasLimit,
      )
    })

    it('should set a new upkeep fund amount', async () => {
      const newUpkeepFundAmount = ethers.utils.parseEther('0.2')
      await tokenUpkeepManager.setNewUpkeepFundAmount(newUpkeepFundAmount)

      expect(await tokenUpkeepManager.newUpkeepFundAmount()).to.equal(
        newUpkeepFundAmount,
      )
    })

    it('should set a new trusted forwarder', async () => {
      await tokenUpkeepManager.setTrustedForwarder(accounts[1].address)

      expect(await tokenUpkeepManager.trustedForwarder()).to.equal(
        accounts[1].address,
      )
    })

    it('should set a new upkeep balance monitor', async () => {
      const newUpkeepBalanceMonitor = accounts[1]

      await tokenUpkeepManager.setUpkeepBalanceMonitor(
        newUpkeepBalanceMonitor.address,
      )

      expect(await tokenUpkeepManager.upkeepBalanceMonitor()).to.equal(
        newUpkeepBalanceMonitor.address,
      )
    })

    it('should set a new prices oracle', async () => {
      const newPricesOracle = accounts[1]

      await tokenUpkeepManager.setPricesOracle(newPricesOracle.address)

      expect(await tokenUpkeepManager.pricesOracle()).to.equal(
        newPricesOracle.address,
      )
    })

    it('should register tokens in bulk', async () => {
      const tx = await tokenUpkeepManager.registerTokens(tokenList.slice(0, 3))

      await expect(tx).to.emit(tokenUpkeepManager, 'TokenUpkeepRegistered')
      await expect(tx)
        .to.emit(tokenUpkeepManager, 'TokenRegistered')
        .withArgs(tokenList[0])
        .to.emit(tokenUpkeepManager, 'TokenRegistered')
        .withArgs(tokenList[1])
        .to.emit(tokenUpkeepManager, 'TokenRegistered')
        .withArgs(tokenList[2])
    })

    it('should revert if registering a token that is not whitelisted', async () => {
      const fakeToken = ethers.Wallet.createRandom().address
      await expect(
        tokenUpkeepManager.registerTokens([fakeToken]),
      ).to.be.revertedWithCustomError(tokenUpkeepManager, 'TokenNotWhitelisted')
    })

    it('should deregister tokens in bulk', async () => {
      await tokenUpkeepManager.registerTokens(tokenList.slice(0, 3))

      const tx = await tokenUpkeepManager.deregisterTokens(
        tokenList.slice(0, 3),
      )

      await expect(tx)
        .to.emit(tokenUpkeepManager, 'TokenDeregistered')
        .withArgs(tokenList[0])
        .to.emit(tokenUpkeepManager, 'TokenDeregistered')
        .withArgs(tokenList[1])
        .to.emit(tokenUpkeepManager, 'TokenDeregistered')
        .withArgs(tokenList[2])
    })

    it('should withdraw link token balance', async () => {
      const ownerBalanceBefore = await linkToken.balanceOf(accounts[0].address)

      await expect(tokenUpkeepManager.withdrawLinkBalance())
        .to.emit(tokenUpkeepManager, 'LinkBalanceWithdrawn')
        .withArgs(accounts[0].address, upkeepManagerFundAmount)

      const ownerBalanceAfter = await linkToken.balanceOf(accounts[0].address)

      expect(ownerBalanceAfter).to.equal(
        ownerBalanceBefore.add(upkeepManagerFundAmount),
      )
    })
  })

  describe('Misc', function () {
    it('should get the token count', async () => {
      await tokenUpkeepManager.performUpkeep(registerPerformData)

      expect(await tokenUpkeepManager.tokenCount()).to.equal(1)
    })

    it('should get the token at an index', async () => {
      await tokenUpkeepManager.performUpkeep(registerPerformData)

      expect(await tokenUpkeepManager.tokenAt(0)).to.equal(tokenList[0])
    })

    it('should return a range of tokens', async () => {
      const bulkFakeTokenAddresses = Array.from(
        { length: 5 },
        () => ethers.Wallet.createRandom().address,
      )
      for (const token of bulkFakeTokenAddresses) {
        await voterMock.whitelistToken(token, true)
      }
      await tokenUpkeepManager.registerTokens(bulkFakeTokenAddresses)

      const tokens = await tokenUpkeepManager.tokenList(0, 5)

      expect(tokens).to.have.lengthOf(5)
      expect(tokens).to.include.members(bulkFakeTokenAddresses)
    })

    it('should get the upkeep count', async () => {
      await tokenUpkeepManager.performUpkeep(registerPerformData)

      expect(await tokenUpkeepManager.upkeepCount()).to.equal(1)
    })

    it('should get the upkeep id at an index', async () => {
      await tokenUpkeepManager.performUpkeep(registerPerformData)

      expect(await tokenUpkeepManager.upkeepIds(0)).to.equal(1)
    })

    it('should get cancelled upkeep ids', async () => {
      expect(await tokenUpkeepManager.cancelledUpkeeps(0, 1)).to.be.empty

      await tokenUpkeepManager.performUpkeep(registerPerformData)
      await tokenUpkeepManager.performUpkeep(deregisterPerformData)

      expect(await tokenUpkeepManager.cancelledUpkeeps(0, 1)).to.deep.include(
        upkeepId,
      )
    })

    it('should get cancelled upkeeps count', async () => {
      expect(await tokenUpkeepManager.cancelledUpkeepCount()).to.equal(0)

      await tokenUpkeepManager.performUpkeep(registerPerformData)
      await tokenUpkeepManager.performUpkeep(deregisterPerformData)

      expect(await tokenUpkeepManager.cancelledUpkeepCount()).to.equal(1)
    })
  })
})
