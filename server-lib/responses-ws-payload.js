"use strict";

const BYTES_PER_MIB = 1024 * 1024;

function parsePositiveMib(value, fallbackMib) {
  const bytes = Math.floor(Number(value) * BYTES_PER_MIB);
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : fallbackMib * BYTES_PER_MIB;
}

// Read once per server startup so the receiver and application enforce the
// same limits. Accept fractional MiB for constrained deployments and tests.
function readResponsesWsPayloadLimits(env = process.env) {
  const absolute = parsePositiveMib(env.CCH_RESPONSES_WS_ABSOLUTE_REQUEST_LIMIT_MIB, 100);
  const soft = Math.min(parsePositiveMib(env.CCH_RESPONSES_WS_CLIENT_SOFT_LIMIT_MIB, 32), absolute);
  const hard = Math.max(parsePositiveMib(env.CCH_RESPONSES_WS_HARD_MAX_PAYLOAD_MIB, 128), absolute);
  const pending = Math.max(parsePositiveMib(env.CCH_RESPONSES_WS_MAX_PENDING_MIB, 128), hard);
  return Object.freeze({ soft, absolute, hard, pending });
}

module.exports = { readResponsesWsPayloadLimits };
