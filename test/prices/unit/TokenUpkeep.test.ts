import { expect } from 'chai'
import { ethers, network } from 'hardhat'
import { time } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  PricesMock,
  TokenUpkeep,
  TokenUpkeep__factory,
  TokenUpkeepManagerMock,
} from '../../../typechain-types'
import { findLog } from '../../utils'

const { HashZero } = ethers.constants

describe('TokenUpkeep Unit Tests', function () {
  let tokenUpkeepFactory: TokenUpkeep__factory
  let tokenUpkeep: TokenUpkeep
  let tokenUpkeepManagerMock: TokenUpkeepManagerMock
  let pricesMock: PricesMock
  let tokenList: string[]
  let samplePerformData: string
  let accounts: SignerWithAddress[]

  const startIndex = 0
  const endIndex = 10
  const tokenCount = 10
  const fetchInterval = 3600

  beforeEach(async function () {
    accounts = await ethers.getSigners()

    // deploy prices mock
    const pricesMockFactory = await ethers.getContractFactory('PricesMock')
    pricesMock = await pricesMockFactory.deploy()

    // deploy token upkeep manager mock
    const tokenUpkeepManagerMockFactory = await ethers.getContractFactory(
      'TokenUpkeepManagerMock',
    )
    tokenUpkeepManagerMock = await tokenUpkeepManagerMockFactory.deploy(
      pricesMock.address,
    )

    // set token list
    tokenList = Array.from(
      { length: tokenCount },
      () => ethers.Wallet.createRandom().address,
    )
    await tokenUpkeepManagerMock.setTokenList(tokenList)

    // impersonate token upkeep manager
    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [tokenUpkeepManagerMock.address],
    })
    const impersonatedSigner = ethers.provider.getSigner(
      tokenUpkeepManagerMock.address,
    )
    await network.provider.send('hardhat_setBalance', [
      tokenUpkeepManagerMock.address,
      '0xffffffffffffffff',
    ])

    // deploy token upkeep via token upkeep manager
    tokenUpkeepFactory = await ethers.getContractFactory(
      'TokenUpkeep',
      impersonatedSigner,
    )
    tokenUpkeep = await tokenUpkeepFactory.deploy(startIndex, endIndex)

    // set trusted forwarder
    await tokenUpkeep.setTrustedForwarder(accounts[0].address)

    // create sample perform data
    samplePerformData = ethers.utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [tokenList[0], 1],
    )
  })

  describe('Check Upkeep', function () {
    it('should trigger upkeep when tokens need to be processed', async function () {
      const [upkeepNeeded, performData] =
        await tokenUpkeep.callStatic.checkUpkeep(HashZero)

      expect(upkeepNeeded).to.be.true
      expect(performData).to.equal(samplePerformData)
    })

    it('should trigger upkeep when interval has passed', async function () {
      // perform upkeep for all tokens in range
      for (let i = 0; i < tokenCount; i++) {
        const [_, performData] =
          await tokenUpkeep.callStatic.checkUpkeep(HashZero)
        await tokenUpkeep.connect(accounts[0]).performUpkeep(performData)
      }

      // simulate interval passing
      await time.increase(fetchInterval)

      const [upkeepNeeded, performData] =
        await tokenUpkeep.callStatic.checkUpkeep(HashZero)

      expect(upkeepNeeded).to.be.true
      expect(performData).to.equal(samplePerformData)
    })

    it('should not trigger upkeep when tokens are already processed', async function () {
      // perform upkeep for all tokens in range
      for (let i = 0; i < tokenCount; i++) {
        const [_, performData] =
          await tokenUpkeep.callStatic.checkUpkeep(HashZero)
        await tokenUpkeep.connect(accounts[0]).performUpkeep(performData)
      }

      const [upkeepNeeded, performData] =
        await tokenUpkeep.callStatic.checkUpkeep(HashZero)

      expect(upkeepNeeded).to.be.false
      expect(performData).to.equal('0x')
    })

    it('should not trigger upkeep when token list is empty', async function () {
      await tokenUpkeepManagerMock.removeTokenList()

      const [upkeepNeeded, performData] =
        await tokenUpkeep.callStatic.checkUpkeep(HashZero)

      expect(upkeepNeeded).to.be.false
      expect(performData).to.equal('0x')
    })
  })

  describe('Perform Upkeep', function () {
    it('should perform upkeep when token need to be processed', async function () {
      const [_, performData] =
        await tokenUpkeep.callStatic.checkUpkeep(HashZero)

      const performTx = await tokenUpkeep
        .connect(accounts[0])
        .performUpkeep(performData)

      await expect(performTx)
        .to.emit(tokenUpkeep, 'TokenUpkeepPerformed')
        .withArgs(0, true)

      // check that current index is incremented
      expect(await tokenUpkeep.currentIndex()).to.equal(1)
    })

    it('should perform upkeep for all tokens in range', async function () {
      let fetchedTokensCount = 0
      for (let i = 0; i < tokenCount; i++) {
        const [_, performData] =
          await tokenUpkeep.callStatic.checkUpkeep(HashZero)

        const performTx = await tokenUpkeep
          .connect(accounts[0])
          .performUpkeep(performData)

        await expect(performTx)
          .to.emit(tokenUpkeep, 'TokenUpkeepPerformed')
          .withArgs(i, true)

        fetchedTokensCount++
      }

      // check that all tokens are fetched
      expect(fetchedTokensCount).to.equal(tokenCount)

      // check if current index is reset to start index
      expect(await tokenUpkeep.currentIndex()).to.equal(
        await tokenUpkeep.startIndex(),
      )

      // check that upkeep is not needed
      const [checkUpkeep, performData] =
        await tokenUpkeep.callStatic.checkUpkeep(HashZero)

      expect(checkUpkeep).to.be.false
      expect(performData).to.equal('0x')
    })

    it('should perform upkeep correctly when range is not full', async function () {
      const newTokenCount = 5
      const newTokenList = tokenList.slice(0, newTokenCount)
      await tokenUpkeepManagerMock.removeTokenList()
      await tokenUpkeepManagerMock.setTokenList(newTokenList)

      let fetchedTokensCount = 0
      for (let i = 0; i < newTokenCount; i++) {
        const [_, performData] =
          await tokenUpkeep.callStatic.checkUpkeep(HashZero)

        const performTx = tokenUpkeep
          .connect(accounts[0])
          .performUpkeep(performData)

        await expect(performTx)
          .to.emit(tokenUpkeep, 'TokenUpkeepPerformed')
          .withArgs(i, true)

        fetchedTokensCount++
      }

      // check that all tokens are fetched
      expect(fetchedTokensCount).to.equal(newTokenCount)

      // check if current index is reset to start index
      expect(await tokenUpkeep.currentIndex()).to.equal(
        await tokenUpkeep.startIndex(),
      )

      // check that upkeep is not needed
      const [checkUpkeep, performData] =
        await tokenUpkeep.callStatic.checkUpkeep(HashZero)

      expect(checkUpkeep).to.be.false
      expect(performData).to.equal('0x')
    })

    it('should perform upkeep correctly when start index is not 0', async function () {
      const newStartIndex = 10
      const newEndIndex = 20
      const newTokenCount = newEndIndex - newStartIndex
      const newTokenList = Array.from(
        { length: newEndIndex },
        () => ethers.Wallet.createRandom().address,
      )
      await tokenUpkeepManagerMock.removeTokenList()
      await tokenUpkeepManagerMock.setTokenList(newTokenList)

      tokenUpkeep = await tokenUpkeepFactory.deploy(newStartIndex, newEndIndex)
      await tokenUpkeep.setTrustedForwarder(accounts[0].address)

      let fetchedTokensCount = 0
      for (let i = newStartIndex; i < newEndIndex; i++) {
        const [_, performData] =
          await tokenUpkeep.callStatic.checkUpkeep(HashZero)

        const performTx = tokenUpkeep
          .connect(accounts[0])
          .performUpkeep(performData)

        await expect(performTx)
          .to.emit(tokenUpkeep, 'TokenUpkeepPerformed')
          .withArgs(i, true)

        fetchedTokensCount++
      }

      // check that all tokens are fetched
      expect(fetchedTokensCount).to.equal(newTokenCount)

      // check if current index is reset to start index
      expect(await tokenUpkeep.currentIndex()).to.equal(newStartIndex)

      // check that upkeep is not needed
      const [checkUpkeep, performData] =
        await tokenUpkeep.callStatic.checkUpkeep(HashZero)

      expect(checkUpkeep).to.be.false
      expect(performData).to.equal('0x')
    })

    it('should not perform upkeep after all tokens are processed', async function () {
      // perform upkeep for all tokens in range
      for (let i = 0; i < tokenCount; i++) {
        const [_, performData] =
          await tokenUpkeep.callStatic.checkUpkeep(HashZero)
        await tokenUpkeep.connect(accounts[0]).performUpkeep(performData)
      }

      // check that upkeep is not needed
      const [checkUpkeep, performData] =
        await tokenUpkeep.callStatic.checkUpkeep(HashZero)

      expect(checkUpkeep).to.be.false
      expect(performData).to.equal('0x')

      // try to perform upkeep again before interval has passed
      await expect(
        tokenUpkeep.connect(accounts[0]).performUpkeep(performData),
      ).to.be.revertedWithCustomError(tokenUpkeep, 'UpkeepNotNeeded')
    })

    it('should store fetched token price via token upkeep manager', async function () {
      const [_, performData] =
        await tokenUpkeep.callStatic.checkUpkeep(HashZero)

      const tx = await tokenUpkeep
        .connect(accounts[0])
        .performUpkeep(performData)
      const receipt = await tx.wait()

      const fetchedTokenLog = findLog(
        receipt,
        tokenUpkeepManagerMock.interface.getEventTopic('FetchedTokenPrice'),
      )
      expect(fetchedTokenLog).to.exist

      const [token, price] =
        tokenUpkeepManagerMock.interface.parseLog(fetchedTokenLog).args

      expect(token).to.equal(tokenList[0])
      expect(price).to.equal(1)
    })

    it('should not store token price if already fetched', async function () {
      // simulate fetching first token price
      await pricesMock.storePrices([tokenList[0]], [1])

      const [_, performData] =
        await tokenUpkeep.callStatic.checkUpkeep(HashZero)

      await expect(tokenUpkeep.connect(accounts[0]).performUpkeep(performData))
        .to.emit(tokenUpkeep, 'TokenUpkeepPerformed')
        .withArgs(0, false)
    })

    it('should continue fetching tokens after skipping one', async function () {
      // simulate fetching token price in the middle of the range
      const fetchedTokenIndex = 5
      await pricesMock.storePrices([tokenList[fetchedTokenIndex]], [1])

      let fetchedTokensCount = 0
      for (let i = 0; i < tokenCount; i++) {
        const [_, performData] =
          await tokenUpkeep.callStatic.checkUpkeep(HashZero)

        const performTx = tokenUpkeep
          .connect(accounts[0])
          .performUpkeep(performData)

        if (i !== fetchedTokenIndex) {
          await expect(performTx)
            .to.emit(tokenUpkeep, 'TokenUpkeepPerformed')
            .withArgs(i, true)
          fetchedTokensCount++
        } else {
          await expect(performTx)
            .to.emit(tokenUpkeep, 'TokenUpkeepPerformed')
            .withArgs(i, false)
        }
      }

      // check that all tokens are fetched
      expect(fetchedTokensCount).to.equal(tokenCount - 1)

      // check if current index is reset to start index
      expect(await tokenUpkeep.currentIndex()).to.equal(
        await tokenUpkeep.startIndex(),
      )

      // check that upkeep is not needed
      const [checkUpkeep, performData] =
        await tokenUpkeep.callStatic.checkUpkeep(HashZero)

      expect(checkUpkeep).to.be.false
      expect(performData).to.equal('0x')
    })
  })

  describe('Trusted Forwarder', function () {
    it('should set trusted forwarder', async function () {
      const trustedForwarder = accounts[1].address

      await tokenUpkeep.setTrustedForwarder(trustedForwarder)

      expect(await tokenUpkeep.trustedForwarder()).to.equal
    })

    it('should allow only trusted forwarder to perform upkeep', async function () {
      const [_, performData] =
        await tokenUpkeep.callStatic.checkUpkeep(HashZero)

      await expect(
        tokenUpkeep.connect(accounts[1]).performUpkeep(performData),
      ).to.be.revertedWithCustomError(tokenUpkeep, 'UnauthorizedSender')
    })
  })
})
