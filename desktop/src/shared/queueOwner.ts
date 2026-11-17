// One upload queue per account.
//
// The outbox lives in one file, but a machine can hold more than one account over
// time. Without a guard, a recording queued by account A could be uploaded under
// account B's session - the wrong user's storage, the wrong user's rows. The rule is
// simple: if the last account to touch the queue is not the signed-in one, the old
// queue is quarantined under its owner's id and the new account starts clean. It is
// never deleted, so signing back in as A resumes A's pending uploads.
export type OwnerAction = "keep" | "rotate";

export function nextOwnerAction(lastOwner: string | null, currentOwner: string | null): OwnerAction {
  // First sign-in on a machine: adopt the (possibly restored) queue as this account's.
  if (!lastOwner) return "keep";
  // Same account again: the queue is theirs.
  if (lastOwner === currentOwner) return "keep";
  // A different account signed in: whatever was queued belongs to the last one.
  return "rotate";
}

/** Where a quarantined queue is kept, so the old account can resume it later. */
export function quarantineName(owner: string): string {
  return `queue-${owner}.json`;
}
