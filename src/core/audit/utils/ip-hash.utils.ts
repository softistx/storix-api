// The address of a request as the audit log keeps it: HMAC-SHA256 of the
// address under `AUDIT_IP_KEY`, in hexadecimal. The same address gives the
// same hash (so one person's actions can be followed), and without the key a
// hash cannot be turned back into an address by trying every IPv4 one.
// Changing the key starts a new series: older events no longer match.
export function hashAddress(key: string, address: string): string {
  return new Bun.CryptoHasher("sha256", key).update(address).digest("hex");
}
