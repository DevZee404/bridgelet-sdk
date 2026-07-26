# `waitForTransaction()`'s poll-until-confirmed pattern

**Purpose:** Document the retry loop `StellarService.waitForTransaction()` uses after every `sendTransaction()` call.

## Polling Loop Details

`StellarService.waitForTransaction()` employs a fixed polling loop to check the status of a submitted transaction. The key characteristics of this loop are:

*   **Attempts:** 10 attempts.
*   **Interval:** 2 seconds between each attempt.
*   **Total Time:** This results in a total polling duration of approximately 20 seconds.

## Usage

Every state-mutating on-chain call within the `StellarService` utilizes this `waitForTransaction()` helper function. This ensures a consistent mechanism for handling transaction submissions and confirmations.

## Timeout Behavior

If the polling loop completes all 10 attempts without the transaction reaching a terminal status (e.g., success or failure), the caller will receive a generic timeout `Error`. This indicates that the transaction confirmation could not be secured within the allotted ~20 second window.