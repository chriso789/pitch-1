// Unit tests must mock provider responses. Never contact a live CRM/backend.
const blockedFetch: typeof fetch = async () => {
  throw new Error('Network disabled in unit tests. Mock the provider response or use an explicitly authorized integration test.');
};
globalThis.fetch = blockedFetch;
