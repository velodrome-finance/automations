import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

export const AUTOMATION_REGISTRAR_ADDRESS =
  process.env.AUTOMATION_REGISTRAR_ADDRESS || 'unset'
export const KEEPER_REGISTRY_ADDRESS =
  process.env.KEEPER_REGISTRY_ADDRESS || 'unset'
export const LINK_TOKEN_ADDRESS = process.env.LINK_TOKEN_ADDRESS || 'unset'
export const VOTER_ADDRESS = process.env.VOTER_ADDRESS || 'unset'
export const NEW_UPKEEP_FUND_AMOUNT =
  process.env.NEW_UPKEEP_FUND_AMOUNT || 'unset'
export const NEW_UPKEEP_GAS_LIMIT = process.env.NEW_UPKEEP_GAS_LIMIT || 'unset'

export const POOL_FACTORY_ADDRESS = '0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a'
export const POOL_ADDRESS = '0x8b9d5a71F347BC1967f39435B5d83C7C581AfbcF'
export const LINK_HOLDER_ADDRESS = '0x166C794d890dD91bBe71F304ecA660E1c4892CBB'

export const UPKEEP_CANCELLATION_DELAY = 50 // blocks
export const MAX_UINT32 = 2 ** 32 - 1 // 4,294,967,295

export enum PerformAction {
  RegisterUpkeep = 0,
  CancelUpkeep = 1,
}
