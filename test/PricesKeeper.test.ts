import { expect } from 'chai'
import { ethers } from 'hardhat'
import { time } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { PricesKeeper, PricesMock, VoterMock } from '../typechain-types'

const { AddressZero, HashZero } = ethers.constants

enum PerformAction {
  FetchPrices = 0,
  WhitelistToken = 1,
}

const abiCoder = new ethers.utils.AbiCoder()

const fetchPricesPerformData = abiCoder.encode(
  ['uint8', 'bytes'],
  [PerformAction.FetchPrices, '0x'],
)
const whitelistPerformData = abiCoder.encode(
  ['uint8', 'bytes'],
  [PerformAction.WhitelistToken, abiCoder.encode(['address'], [AddressZero])],
)

describe('PricesKeeper', function () {
  let pricesKeeper: PricesKeeper
  let pricesMock: PricesMock
  let voterMock: VoterMock
  let whitelistedTokens: string[]
  let accounts: SignerWithAddress[]

  const batchSize = 2
  const fetchInterval = 3600

  beforeEach(async function () {
    accounts = await ethers.getSigners()

    const pricesMockFactory = await ethers.getContractFactory('PricesMock')
    pricesMock = await pricesMockFactory.deploy()

    const voterMockFactory = await ethers.getContractFactory('VoterMock')
    voterMock = await voterMockFactory.deploy()

    const pricesKeeperFactory = await ethers.getContractFactory('PricesKeeper')
    whitelistedTokens = Array(batchSize).fill(AddressZero)
    pricesKeeper = await pricesKeeperFactory.deploy(
      voterMock.address,
      pricesMock.address,
      batchSize,
      whitelistedTokens,
    )
    await pricesKeeper.addTrustedForwarder(accounts[0].address)
  })

  describe('Fetch prices', function () {
    it('should trigger fetch prices action initially', async function () {
      const [upkeepNeeded, performData] = await pricesKeeper
        .connect(AddressZero)
        .callStatic.checkUpkeep(HashZero)

      expect(upkeepNeeded).to.be.true
      expect(performData).to.equal(fetchPricesPerformData)
    })

    it('should not trigger fetch prices action if interval has not passed', async function () {
      await pricesKeeper.performUpkeep(fetchPricesPerformData)

      const [upkeepNeeded, performData] = await pricesKeeper
        .connect(AddressZero)
        .callStatic.checkUpkeep(HashZero)

      expect(upkeepNeeded).to.be.false
      expect(performData).to.equal(
        ethers.utils.hexlify(ethers.utils.toUtf8Bytes('Interval not reached')),
      )
    })

    it('should trigger fetch prices action if interval has passed', async function () {
      await pricesKeeper.performUpkeep(fetchPricesPerformData)

      await time.increase(fetchInterval)

      const [upkeepNeeded, performData] = await pricesKeeper
        .connect(AddressZero)
        .callStatic.checkUpkeep(HashZero)

      expect(upkeepNeeded).to.be.true
      expect(performData).to.equal(fetchPricesPerformData)
    })

    it('should perform fetch prices action', async function () {
      await expect(pricesKeeper.performUpkeep(fetchPricesPerformData))
        .to.emit(pricesKeeper, 'FetchedPrices')
        .withArgs(whitelistedTokens)
    })

    it('should fetch prices for whitelisted tokens', async function () {
      const tx = await pricesKeeper.performUpkeep(fetchPricesPerformData)
      for (let i = 0; i < batchSize; i++) {
        await expect(tx)
          .to.emit(pricesMock, 'Price')
          .withArgs(whitelistedTokens[i], 1000)
      }
    })

    it('should not fetch prices if all tokens are fetched for the interval', async function () {
      await pricesKeeper.performUpkeep(fetchPricesPerformData)

      await expect(
        pricesKeeper.performUpkeep(fetchPricesPerformData),
      ).to.be.revertedWithCustomError(pricesKeeper, 'AlreadyFetched')
    })

    it('should process multiple batches of whitelisted tokens', async function () {
      for (let i = 0; i < batchSize; i++) {
        whitelistedTokens.push(AddressZero)
        await pricesKeeper.performUpkeep(whitelistPerformData)
      }
      const tx = await pricesKeeper.performUpkeep(fetchPricesPerformData)
      for (let i = 0; i < batchSize; i++) {
        await expect(tx)
          .to.emit(pricesMock, 'Price')
          .withArgs(whitelistedTokens[i], 1000)
      }
      const tx2 = await pricesKeeper.performUpkeep(fetchPricesPerformData)
      for (let i = batchSize; i < batchSize * 2; i++) {
        await expect(tx2)
          .to.emit(pricesMock, 'Price')
          .withArgs(whitelistedTokens[i], 1000)
      }
    })

    it('should process leftover tokens in the last batch', async function () {
      for (let i = 0; i < batchSize + 1; i++) {
        whitelistedTokens.push(AddressZero)
        await pricesKeeper.performUpkeep(whitelistPerformData)
      }
      const tx = await pricesKeeper.performUpkeep(fetchPricesPerformData)
      for (let i = 0; i < batchSize; i++) {
        await expect(tx)
          .to.emit(pricesMock, 'Price')
          .withArgs(whitelistedTokens[i], 1000)
      }
      const tx2 = await pricesKeeper.performUpkeep(fetchPricesPerformData)
      await expect(tx2)
        .to.emit(pricesMock, 'Price')
        .withArgs(whitelistedTokens[batchSize], 1000)
    })

    it('should fetch newly added whitelisted tokens while interval is in progress', async function () {
      for (let i = 0; i < batchSize - 1; i++) {
        whitelistedTokens.push(AddressZero)
        await pricesKeeper.performUpkeep(whitelistPerformData)
      }
      await pricesKeeper.performUpkeep(fetchPricesPerformData)

      const tx = await pricesKeeper.performUpkeep(whitelistPerformData)
      await expect(tx)
        .to.emit(pricesKeeper, 'WhitelistedTokenAdded')
        .withArgs(AddressZero)

      await time.increase(fetchInterval)

      const tx2 = await pricesKeeper.performUpkeep(fetchPricesPerformData)
      for (let i = 0; i < batchSize; i++) {
        await expect(tx2)
          .to.emit(pricesMock, 'Price')
          .withArgs(whitelistedTokens[i], 1000)
      }
    })

    it('should allow only trusted forwarder to fetch prices', async function () {
      await expect(
        pricesKeeper.connect(accounts[1]).performUpkeep(fetchPricesPerformData),
      ).to.be.revertedWithCustomError(pricesKeeper, 'UnauthorizedSender')
    })
  })

  describe('Add whitelisted token', function () {
    it('should trigger whitelist token action', async function () {
      const whitelistTokenTx = await voterMock.whitelistToken(AddressZero)
      const whitelistTokenReceipt = await whitelistTokenTx.wait()
      const whitelistTokenLog = whitelistTokenReceipt.logs[0]
      const triggerLog = {
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
        await pricesKeeper.callStatic.checkLog(triggerLog, HashZero)

      expect(upkeepNeeded).to.be.true
      expect(performData).to.equal(whitelistPerformData)
    })

    it('should whitelist token', async function () {
      await pricesKeeper.performUpkeep(whitelistPerformData)

      const whitelistedToken = await pricesKeeper.whitelistedTokens(batchSize)
      expect(whitelistedToken).to.equal(AddressZero)
    })

    it('should allow only trusted forwarder to whitelist token', async function () {
      await expect(
        pricesKeeper.connect(accounts[1]).performUpkeep(whitelistPerformData),
      ).to.be.revertedWithCustomError(pricesKeeper, 'UnauthorizedSender')
    })
  })

  describe('Owner', function () {
    it('should update batch size', async function () {
      const newBatchSize = 4
      await pricesKeeper.setBatchSize(newBatchSize)

      const batchSize = await pricesKeeper.batchSize()
      expect(batchSize).to.equal(newBatchSize)
    })
  })
})
