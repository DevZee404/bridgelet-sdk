# Manually parsing a contract's returned ScVal Map

This document describes the pattern used in `StellarService.getAccountInfo()` to parse a raw `ScVal` map returned from a Soroban contract into a structured, typed JavaScript object.

## Accessor Chain for Field Extraction

When a Soroban contract returns a map, the result is an `ScVal` of type `scvMap`. To extract data from this map, `getAccountInfo()` uses a chain of accessors on the `ScVal` object. This process involves finding a key in the map and then converting the associated `ScVal` value to its corresponding JavaScript primitive type.

The general pattern is:

1.  Retrieve the array of map entries from the `ScVal` using the `.map()` accessor.
2.  Iterate through the map entries to find the desired key, which is often an `ScVal` of type `scvSymbol`. The key's value can be checked using `.sym().toString()`.
3.  Once the correct key is found, the corresponding value (which is also an `ScVal`) is converted to a JavaScript type using a specific accessor, for example:
    - `.u32()` to extract a 32-bit unsigned integer.
    - `.b()` to extract a boolean value or bytes buffer.

## Manual, Schema-less Parsing

This parsing logic is hand-written for each expected field. The code manually looks for specific symbol keys (field names) and assumes the data type of their values.

Crucially, there is no automatic schema validation. The implementation relies on a few explicit `null` or `undefined` checks to ensure a field exists before parsing, but it does not formally validate that the returned map conforms to an expected structure. This makes the parsing dependent on the contract's implementation details.

## `bridgelet-core` `AccountInfo`

The object constructed by this manual parsing is expected to mirror the `AccountInfo` struct defined in the `bridgelet-core` crate. Any changes to the `AccountInfo` struct on the contract side would require corresponding manual updates to the parsing logic in `StellarService.getAccountInfo()`.
