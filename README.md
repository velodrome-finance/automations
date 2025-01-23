# Velodrome Automation

This repository contains the scripts designed to automate the Velodrome ecosystem using Chainlink oracles.

## Components

- **GaugeUpkeepManager**: This contract is responsible for registering and deregistering scheduled distribute call upkeeps for a gauge. It is registered as an upkeep itself with the following triggers:
  - Log triggers (from the `Voter` contract)
    - `GaugeCreated`: Registers a new cron upkeep for the gauge when it is created.
    - `GaugeKilled`: Deregisters the upkeep for the gauge when it is killed.
    - `GaugeRevived`: Registers a new upkeep for the gauge when it is revived.
- **CronUpkeepFactory**: This contract is responsible for creating cron upkeeps for the `GaugeUpkeepManager` contract.
- **UpkeepBalanceMonitor**: This is a utility contract that watches the balances of all active gauge upkeeps and triggers top-up transactions when the balance falls below a certain threshold.

## Installation

This repository uses [Hardhat](https://hardhat.org/) as the development environment.

1. Install the dependencies:

```bash
pnpm install
```

2. Install submodules:

```bash
git submodule update --init --recursive
```

## Configuration

Copy the example configuration and fill in the required environment variables:

```bash
cp .env.example .env
```

## Testing

Tests are executed using Hardhat.

1. Run the unit tests:

```bash
pnpm run test:unit
```

2. Run the script tests on a forked network:

```bash
pnpm run test:fork
```

## Deployment

### Gauge Upkeep Manager

1. Deploy `GaugeUpkeepManager` and `CronUpkeepFactory` contracts by running:

```bash
npx hardhat run scripts/deploy_upkeep_manager.ts --network <network>
```

2. Transfer LINK tokens to the `GaugeUpkeepManager` contract required for new gauge upkeep registrations. The amount of LINK required is determined by the `NEW_UPKEEP_FUND_AMOUNT` environment variable.

3. Register one upkeep for each log trigger type (`GaugeCreated`, `GaugeKilled`, `GaugeRevived`) emmited by the `Voter` contract and targeting the `GaugeUpkeepManager` contract. Currently, this is done manually by using the [Automation UI](https://automation.chain.link/). Make sure to set the gas limit to the maximum value (5m) to avoid out-of-gas errors.

4. After registering the upkeeps, set the trusted forwarders on the `GaugeUpkeepManager` contract. This is done by calling the `setTrustedForwarder` function with the address of the `Forwarder` contract as parameter. Each log trigger upkeep has a unique forwarder address, so this step must be repeated for each upkeep.

### Upkeep Balance Monitor

1. Deploy the `UpkeepBalanceMonitor` contract by running:

```bash
npx hardhat run scripts/deploy_balance_monitor.ts --network <network>
```

1. Transfer LINK tokens to the `UpkeepBalanceMonitor` contract which will be used to top-up the gauge upkeeps.

2. Register the `UpkeepBalanceMonitor` as a custom logic upkeep. Currently, this is done manually by using the [Automation UI](https://automation.chain.link/). The gas limit is determined by the `MAX_BATCH_SIZE` environment variable.

3. After registering the upkeep, set the trusted forwarder on the `UpkeepBalanceMonitor` contract. This is done by calling the `setTrustedForwarder` function with the address of the `Forwarder` contract as parameter.

4. Additionally, to enable the `GaugeUpkeepManager` to add and remove upkeeps from the watchlist as they are registered or canceled, it must be granted permission by calling `grantWatchlistManagerRole` on the `UpkeepBalanceMonitor` contract.
