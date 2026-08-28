// Kept as a compatibility shim: the real implementation now lives in social.js,
// which can talk to Zernio OR PostPeer depending on POSTING_PROVIDER. New code
// should import from './social.js' directly.
export { connectedAccounts, postToConnected, DEFAULT_PROFILE } from './social.js'
