import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { userBalanceCharges, users } from "@/drizzle/schema";
import { invalidateCachedUser } from "@/lib/security/api-key-auth-cache";
import { COST_SCALE, toCostDecimal } from "@/lib/utils/currency";

export type UserBalanceChargeResult =
  | { status: "unlimited" }
  | { status: "charged"; balanceUsd: string }
  | { status: "already_charged" }
  | { status: "user_not_found" }
  | { status: "invalid" };

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/**
 * Debit the CCH user's remaining local credit for one final billing leg.
 *
 * `chargeKey` is stable for the billing leg (`winner` or `loser:<attempt>`),
 * so repeated finalization is idempotent while winner and loser charges for
 * one request remain independent. The user row is locked before the ledger
 * insert and debit, making concurrent requests serialize on the balance.
 *
 * A request that passed the preflight may finish above the remaining balance
 * because its final cost is not known before the upstream response. In that
 * case the balance is allowed to become negative so the persisted balance still
 * reconciles with the actual final bill; the next preflight blocks new work.
 */
export async function chargeUserBalance(input: {
  userId: number;
  requestId: number;
  providerId: number;
  chargeKey: string;
  amountUsd: string | number;
}): Promise<UserBalanceChargeResult> {
  const amount = toCostDecimal(input.amountUsd);
  const amountNumber = amount?.toNumber() ?? Number.NaN;
  const chargeKey = input.chargeKey.trim();

  if (
    !amount ||
    !Number.isFinite(amountNumber) ||
    amount.lte(0) ||
    !isPositiveInteger(input.userId) ||
    !isPositiveInteger(input.requestId) ||
    !isPositiveInteger(input.providerId) ||
    chargeKey.length === 0 ||
    chargeKey.length > 128
  ) {
    return { status: "invalid" };
  }

  const amountUsd = amount.toDecimalPlaces(COST_SCALE).toFixed(COST_SCALE);
  if (Number(amountUsd) <= 0) {
    return { status: "invalid" };
  }

  const result: UserBalanceChargeResult = await db.transaction(
    async (tx): Promise<UserBalanceChargeResult> => {
    const userRows = await tx.execute(sql`
      SELECT balance_usd
      FROM users
      WHERE id = ${input.userId}
      FOR UPDATE
    `);
    const userRow = userRows[0] as { balance_usd: string | null } | undefined;
    if (!userRow) {
      return { status: "user_not_found" };
    }

    const existingCharge = await tx.execute(sql`
      SELECT id
      FROM user_balance_charges
      WHERE request_id = ${input.requestId}
        AND charge_key = ${chargeKey}
      LIMIT 1
    `);
    if (existingCharge.length > 0) {
      return { status: "already_charged" };
    }

    const inserted = await tx
      .insert(userBalanceCharges)
      .values({
        userId: input.userId,
        requestId: input.requestId,
        providerId: input.providerId,
        chargeKey,
        amountUsd,
      })
      .onConflictDoNothing({
        target: [userBalanceCharges.requestId, userBalanceCharges.chargeKey],
      })
      .returning({ id: userBalanceCharges.id });

    if (inserted.length === 0) {
      return { status: "already_charged" };
    }

    if (userRow.balance_usd == null) {
      return { status: "unlimited" };
    }

    const updated = await tx
      .update(users)
      .set({
        balanceUsd: sql`${users.balanceUsd} - ${amountUsd}`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, input.userId))
      .returning({ balanceUsd: users.balanceUsd });

    if (updated.length === 0) {
      throw new Error("CCH user balance changed while charging");
    }

    return {
      status: "charged",
      balanceUsd: String(updated[0]?.balanceUsd ?? "0"),
    };
  });

  // The auth path may serve the user from Redis for up to its configured TTL.
  // Invalidate only after a committed finite-balance debit; unlimited and
  // idempotent paths do not change the cached balance.
  if (result.status === "charged") {
    await invalidateCachedUser(input.userId).catch(() => {});
  }

  return result;
}
