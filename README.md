# Velodrome Automation

This repository contains the scripts designed to automate the Velodrome ecosystem using Chainlink oracles.

## Components

- **GaugeUpkeepManager**: This contract is responsible for registering and deregistering scheduled distribute call upkeeps for a gauge. It is registered as an upkeep itself with the following triggers:
  - Log triggers (from the `Voter` contract)
    - `GaugeCreated`: Registers a new cron upkeep for the gauge when it is created.
    - `GaugeKilled`: Deregisters the upkeep for the gauge.
    - `GaugeRevived`: Registers a new upkeep for the gauge.
  - Condition triggers
    - Check for cancelled gauges that need to be refunded.

## Installation

This repository uses [Hardhat](https://hardhat.org/) as the development environment. To install the dependencies, run:

```bash
npm install
```

## Configuration

Copy the `.env.example` file to `.env` and fill in the required values.

## Testing

Tests are executed using Hardhat. To run the tests, execute:

```bash
npx hardhat test
```

## Deployment

To deploy the contracts, execute:

```bash
npx hardhat run scripts/deploy.ts --network <network>
```

**Note:** The contract require LINK tokens to pay for the upkeep registration.
