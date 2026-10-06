const DEFAULT_QUOTA_COOLDOWN_MS = Math.max(
  60_000,
  Number(process.env.WALMART_PROVIDER_QUOTA_COOLDOWN_MS || 24 * 60 * 60 * 1000)
);

const blockedUntil = new Map();

function isBlocked(provider) {
  const entry = blockedUntil.get(provider);
  if (!entry) return false;
  if (Date.now() >= entry.until) {
    blockedUntil.delete(provider);
    return false;
  }
  return true;
}

function block(provider, reason, cooldownMs = DEFAULT_QUOTA_COOLDOWN_MS) {
  const openedAt = Date.now();
  blockedUntil.set(provider, {
    reason: String(reason || "Provider quota or access limit reached"),
    openedAt: new Date(openedAt).toISOString(),
    retryAfter: new Date(openedAt + cooldownMs).toISOString(),
    until: openedAt + cooldownMs
  });
}

function getState(provider) {
  const entry = blockedUntil.get(provider);
  return {
    open: isBlocked(provider),
    reason: entry?.reason || null,
    openedAt: entry?.openedAt || null,
    retryAfter: entry?.retryAfter || null
  };
}

module.exports = {
  DEFAULT_QUOTA_COOLDOWN_MS,
  isBlocked,
  block,
  getState
};
