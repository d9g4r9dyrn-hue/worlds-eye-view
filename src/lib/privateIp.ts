// Shared with geoip.ts (skip geolocation for private client IPs) and
// fetchUrlSafely() below (block outbound fetches from resolving to internal
// addresses). Includes 169.254.169.254-style link-local — the address every
// major cloud provider's instance-metadata endpoint lives at, and the
// classic SSRF target.
const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

export function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(ip));
}
