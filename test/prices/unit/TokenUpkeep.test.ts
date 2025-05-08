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
      ['uint256', 'address', 'uint256'],
      [0, tokenList[0], 1],
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

    it('should trigger upkeep index reset when there are only zero address tokens', async function () {
      await tokenUpkeepManagerMock.removeTokenList()

      const [upkeepNeeded, performData] =
        await tokenUpkeep.callStatic.checkUpkeep(HashZero)

      expect(upkeepNeeded).to.be.true
      expect(performData).to.equal(
        ethers.utils.defaultAbiCoder.encode(
          ['uint256', 'address', 'uint256'],
          [tokenCount - 2, ethers.constants.AddressZero, 0],
        ),
      )
    })

    it('should skip zero address tokens', async function () {
      // remove first token from list so it becomes zero address
      await tokenUpkeepManagerMock.removeFromTokenList(tokenList[0])

      const [upkeepNeeded, performData] =
        await tokenUpkeep.callStatic.checkUpkeep(HashZero)

      // the perform data should be for the next token in the list
      expect(performData).to.equal(
        ethers.utils.defaultAbiCoder.encode(
          ['uint256', 'address', 'uint256'],
          [1, tokenList[1], 1],
        ),
      )
      expect(upkeepNeeded).to.be.true
    })
  })

  describe('Perform Upkeep', function () {
    it('should perform upkeep when tokens need to be processed', async function () {
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

        expect(await tokenUpkeep.currentIndex()).to.equal(i)

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
      // deploy token upkeep with a range that is not full
      tokenUpkeep = await tokenUpkeepFactory.deploy(startIndex, endIndex + 5)
      await tokenUpkeep.setTrustedForwarder(accounts[0].address)

      let fetchedTokensCount = 0
      for (let i = 0; i < tokenCount; i++) {
        const [_, performData] =
          await tokenUpkeep.callStatic.checkUpkeep(HashZero)

        expect(await tokenUpkeep.currentIndex()).to.equal(i)

        const performTx = tokenUpkeep
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

        expect(await tokenUpkeep.currentIndex()).to.equal(i)

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
        expect(await tokenUpkeep.currentIndex()).to.equal(i)
        await tokenUpkeep.connect(accounts[0]).performUpkeep(performData)
      }

      // check that current index is reset to start index
      expect(await tokenUpkeep.currentIndex()).to.equal(
        await tokenUpkeep.startIndex(),
      )

      // check that upkeep is not needed
      const [checkUpkeep, performData] =
        await tokenUpkeep.callStatic.checkUpkeep(HashZero)

      expect(checkUpkeep).to.be.false
      expect(performData).to.equal('0x')

      // try to perform upkeep again before interval has passed
      await expect(
        tokenUpkeep.connect(accounts[0]).performUpkeep(samplePerformData),
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

    it('should signal when the last index is reached', async function () {
      for (let i = 0; i < tokenCount - 1; i++) {
        const [_, performData] =
          await tokenUpkeep.callStatic.checkUpkeep(HashZero)
        await tokenUpkeep.connect(accounts[0]).performUpkeep(performData)
      }
      const [_, performData] =
        await tokenUpkeep.callStatic.checkUpkeep(HashZero)
      const lastPerformTx = await tokenUpkeep
        .connect(accounts[0])
        .performUpkeep(performData)
      const lastPerformReceipt = await lastPerformTx.wait()

      const lastIndexReachedLog = findLog(
        lastPerformReceipt,
        tokenUpkeepManagerMock.interface.getEventTopic('LastIndexReached'),
      )
      expect(lastIndexReachedLog).to.exist
    })

    it('should finalize token upkeep when there are only zero address tokens', async function () {
      // remove all tokens from list so they become zero address
      await tokenUpkeepManagerMock.removeTokenList()

      expect(await tokenUpkeep.currentIndex()).to.equal(
        await tokenUpkeep.startIndex(),
      )
      expect(await tokenUpkeepManagerMock.tokenCount()).to.equal(0)
      expect(await tokenUpkeepManagerMock.tokenListLength()).to.equal(
        tokenCount - 1,
      )

      const [_, performData] =
        await tokenUpkeep.callStatic.checkUpkeep(HashZero)

      expect(performData).to.equal(
        ethers.utils.defaultAbiCoder.encode(
          ['uint256', 'address', 'uint256'],
          [tokenCount - 2, ethers.constants.AddressZero, 0],
        ),
      )

      const performTx = await tokenUpkeep
        .connect(accounts[0])
        .performUpkeep(performData)
      const performReceipt = await performTx.wait()

      const finishedUpkeepLog = findLog(
        performReceipt,
        tokenUpkeepManagerMock.interface.getEventTopic('FinishedUpkeep'),
      )
      expect(finishedUpkeepLog).to.exist

      expect(await tokenUpkeep.currentIndex()).to.equal(
        await tokenUpkeep.startIndex(),
      )
    })

    it('should finalize token upkeep when the list is partially filled with zero address tokens', async function () {
      // remove tokens consecutively from the middle of the list
      await tokenUpkeepManagerMock.removeFromTokenList(tokenList[3])
      await tokenUpkeepManagerMock.removeFromTokenList(tokenList[4])
      await tokenUpkeepManagerMock.removeFromTokenList(tokenList[5])

      expect(await tokenUpkeep.currentIndex()).to.equal(
        await tokenUpkeep.startIndex(),
      )
      expect(await tokenUpkeepManagerMock.tokenCount()).to.equal(tokenCount - 3)
      expect(await tokenUpkeepManagerMock.tokenListLength()).to.equal(
        tokenCount,
      )

      // process first tokens
      for (let i = 0; i < 3; i++) {
        const [_, performData] =
          await tokenUpkeep.callStatic.checkUpkeep(HashZero)
        await tokenUpkeep.connect(accounts[0]).performUpkeep(performData)
      }

      // check that current index is incremented
      expect(await tokenUpkeep.currentIndex()).to.equal(3)

      // process the rest of the tokens except the last one
      for (let i = 0; i < 3; i++) {
        const [_, performData] =
          await tokenUpkeep.callStatic.checkUpkeep(HashZero)
        await tokenUpkeep.connect(accounts[0]).performUpkeep(performData)
      }

      // check that current index is incremented
      expect(await tokenUpkeep.currentIndex()).to.equal(tokenCount - 1)

      // process the last token
      const [_, performData] =
        await tokenUpkeep.callStatic.checkUpkeep(HashZero)

      const performTx = await tokenUpkeep
        .connect(accounts[0])
        .performUpkeep(performData)
      const performReceipt = await performTx.wait()

      const lastIndexReachedLog = findLog(
        performReceipt,
        tokenUpkeepManagerMock.interface.getEventTopic('LastIndexReached'),
      )
      expect(lastIndexReachedLog).to.exist

      expect(await tokenUpkeep.currentIndex()).to.equal(
        await tokenUpkeep.startIndex(),
      )
    })

    it('should finalize token upkeep when the last token in the list is zero address', async function () {
      // add a new token to the list so the last one in the range is not popped when removed
      const newToken = ethers.Wallet.createRandom().address
      await tokenUpkeepManagerMock.setTokenList([newToken])

      // remove the last token from the range so it becomes zero address
      await tokenUpkeepManagerMock.removeFromTokenList(tokenList[9])

      // check that the last token is zero address
      expect(await tokenUpkeepManagerMock.tokenAt(9)).to.equal(
        ethers.constants.AddressZero,
      )

      // process all tokens except the last one
      for (let i = 0; i < tokenCount - 1; i++) {
        const [_, performData] =
          await tokenUpkeep.callStatic.checkUpkeep(HashZero)
        await tokenUpkeep.connect(accounts[0]).performUpkeep(performData)
      }

      // check that current index is incremented
      expect(await tokenUpkeep.currentIndex()).to.equal(tokenCount - 1)

      // process the last token which is zero address
      const [_, performData] =
        await tokenUpkeep.callStatic.checkUpkeep(HashZero)
      const performTx = await tokenUpkeep
        .connect(accounts[0])
        .performUpkeep(performData)
      const performReceipt = await performTx.wait()

      // check that upkeep is finished even if the last token is zero address
      const finishedUpkeepLog = findLog(
        performReceipt,
        tokenUpkeepManagerMock.interface.getEventTopic('FinishedUpkeep'),
      )
      expect(finishedUpkeepLog).to.exist

      expect(await tokenUpkeep.currentIndex()).to.equal(
        await tokenUpkeep.startIndex(),
      )
    })

    it('should finalize token upkeep when there are multiple zero address tokens at the end', async function () {
      // add a new token to the list so the last one in the range is not popped when removed
      const newToken = ethers.Wallet.createRandom().address
      await tokenUpkeepManagerMock.setTokenList([newToken])

      // remove the last three tokens from the range so they become zero address
      await tokenUpkeepManagerMock.removeFromTokenList(tokenList[7])
      await tokenUpkeepManagerMock.removeFromTokenList(tokenList[8])
      await tokenUpkeepManagerMock.removeFromTokenList(tokenList[9])

      // check that the last three tokens are zero address
      expect(await tokenUpkeepManagerMock.tokenAt(7)).to.equal(
        ethers.constants.AddressZero,
      )
      expect(await tokenUpkeepManagerMock.tokenAt(8)).to.equal(
        ethers.constants.AddressZero,
      )
      expect(await tokenUpkeepManagerMock.tokenAt(9)).to.equal(
        ethers.constants.AddressZero,
      )

      // process all tokens except the last three
      for (let i = 0; i < tokenCount - 3; i++) {
        const [_, performData] =
          await tokenUpkeep.callStatic.checkUpkeep(HashZero)
        await tokenUpkeep.connect(accounts[0]).performUpkeep(performData)
      }

      // check that current index is incremented
      expect(await tokenUpkeep.currentIndex()).to.equal(tokenCount - 3)

      // process the last iteration which is all zero address tokens
      const [_, performData] =
        await tokenUpkeep.callStatic.checkUpkeep(HashZero)
      const performTx = await tokenUpkeep
        .connect(accounts[0])
        .performUpkeep(performData)
      const performReceipt = await performTx.wait()

      // check that upkeep is finished even if the last tokens are zero address
      const finishedUpkeepLog = findLog(
        performReceipt,
        tokenUpkeepManagerMock.interface.getEventTopic('FinishedUpkeep'),
      )
      expect(finishedUpkeepLog).to.exist

      expect(await tokenUpkeep.currentIndex()).to.equal(
        await tokenUpkeep.startIndex(),
      )
    })

    it('should not store token price if already fetched', async function () {
      // simulate fetching first token price
      await pricesMock.storePrice(tokenList[0], 1)

      const [_, performData] =
        await tokenUpkeep.callStatic.checkUpkeep(HashZero)

      await expect(tokenUpkeep.connect(accounts[0]).performUpkeep(performData))
        .to.emit(tokenUpkeep, 'TokenUpkeepPerformed')
        .withArgs(0, false)
    })

    it('should skip zero address tokens', async function () {
      // remove tokens from list so they become zero address
      await tokenUpkeepManagerMock.removeFromTokenList(tokenList[0])
      await tokenUpkeepManagerMock.removeFromTokenList(tokenList[5])

      let fetchedTokensCount = 0
      let tokenUpkeepIndex = 0
      for (let i = 0; i < tokenCount - 2; i++) {
        const [_, performData] =
          await tokenUpkeep.callStatic.checkUpkeep(HashZero)
        const performTx = tokenUpkeep
          .connect(accounts[0])
          .performUpkeep(performData)

        // adjust tokenUpkeepIndex for skipped tokens
        if (i === 0 || i === 4) {
          tokenUpkeepIndex++
        }
        await expect(performTx)
          .to.emit(tokenUpkeep, 'TokenUpkeepPerformed')
          .withArgs(tokenUpkeepIndex, true)

        tokenUpkeepIndex++
        fetchedTokensCount++
      }

      // check that all tokens are fetched
      expect(fetchedTokensCount).to.equal(tokenCount - 2)

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

    it('should continue fetching tokens after skipping one', async function () {
      // simulate fetching token price in the middle of the range
      const fetchedTokenIndex = 5
      await pricesMock.storePrice(tokenList[fetchedTokenIndex], 1)

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

    it('should reset current index when there are only zero address tokens', async function () {
      // remove all tokens from list so they become zero address
      await tokenUpkeepManagerMock.removeTokenList()

      const [_, performData] =
        await tokenUpkeep.callStatic.checkUpkeep(HashZero)

      const performTx = await tokenUpkeep
        .connect(accounts[0])
        .performUpkeep(performData)
      const performReceipt = await performTx.wait()
      const upkeepPerformedLog = findLog(
        performReceipt,
        tokenUpkeep.interface.getEventTopic('TokenUpkeepPerformed'),
      )
      expect(upkeepPerformedLog).to.exist

      const [index, stored] =
        tokenUpkeep.interface.parseLog(upkeepPerformedLog).args

      expect(index).to.equal(tokenCount - 2)
      expect(stored).to.be.false
      expect(await tokenUpkeep.currentIndex()).to.equal(
        await tokenUpkeep.startIndex(),
      )
    })
  })

  describe('Trusted Forwarder', function () {
    it('should set trusted forwarder', async function () {
      const trustedForwarder = accounts[1].address

      await tokenUpkeep.setTrustedForwarder(trustedForwarder)

      expect(await tokenUpkeep.trustedForwarder()).to.equal(trustedForwarder)
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
