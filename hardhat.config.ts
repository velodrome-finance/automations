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
  },
  etherscan: {
    apiKey: {
      optimisticEthereum: process.env.ETHERSCAN_API_KEY || '',
    },
  },
}

if (process.env.FORK_ENABLED === 'true') {
  config.networks!.hardhat = {
    forking: {
      url: process.env.OP_MAINNET_URL || '',
      blockNumber: parseInt(process.env.BLOCK_NUMBER || ''),
    },
  }
}

export default config
