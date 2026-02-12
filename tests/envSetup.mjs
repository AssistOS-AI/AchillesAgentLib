/**
 * Environment setup helper for tests.
 * Environment variables are expected to be provided by the caller
 * (e.g. ploinky injects them via docker -e flags).
 */

export const result = { loaded: false, path: null, variables: {} };
