import { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-toolbox'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const OPTIMIZER_SETTINGS = {
  enabled: true,
  runs: 200,
}

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: '0.8.6',
        settings: {
          optimizer: OPTIMIZER_SETTINGS,
        },
      },
      {
        version: '0.8.16',
        settings: {
          optimizer: OPTIMIZER_SETTINGS,
        },
      },
      {
        version: '0.8.19',
        settings: {
          optimizer: OPTIMIZER_SETTINGS,
        },
      },
      {
        version: '0.8.20',
        settings: {
          optimizer: OPTIMIZER_SETTINGS,
        },
      },
    ],
  },
  networks: {
    optimism: {
      url: process.env.OP_MAINNET_URL || '',
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    optimismSepolia: {
      url: process.env.OP_SEPOLIA_URL || '',
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    base: {
      url: process.env.BASE_MAINNET_URL || '',
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_URL || '',
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: {
      optimisticEthereum: process.env.OP_ETHERSCAN_API_KEY || '',
      base: process.env.BASE_ETHERSCAN_API_KEY || '',
    },
    customChains: [
      {
        network: 'base',
        chainId: 8453,
        urls: {
          apiURL: process.env.BASE_ETHERSCAN_API_URL || '',
          browserURL: process.env.BASE_ETHERSCAN_BROWSER_URL || '',
        },
      },
    ],
  },
  mocha: {
    timeout: 200000,
  },
}

if (process.env.FORK_ENABLED === 'true') {
  let forkChainUrl =
    process.env.FORK_CHAIN === 'base'
      ? process.env.BASE_MAINNET_URL
      : process.env.OP_MAINNET_URL
  config.networks!.hardhat = {
    forking: {
      url: forkChainUrl || '',
      blockNumber: parseInt(process.env.BLOCK_NUMBER || ''),
    },
  }
}

export default config
