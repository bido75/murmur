// Route-driven one-time tips: when the user lands on a screen whose tips
// haven't been seen yet, the first one with an on-screen anchor shows. Its
// "Got it" marks it seen, and the next tip in the group follows on the next
// render. Nothing shows while a tour is up (the provider gates that).
import { useEffect, useRef } from "react";
import { tipsForScreen, type OnboardingState, type Tip } from "@/lib/onboarding";
import type { AnchorRegistry } from "./context";

/** Map a pathname to the screens tips belong to. The Recordings tab sits at
 * "/", so it counts for /recordings too. */
function screensFor(pathname: string): string[] {
  if (pathname === "/") return ["/", "/recordings"];
  if (pathname.startsWith("/recording/")) return ["/recording"];
  return [pathname];
}

export function RouteTips({
  pathname,
  state,
  userId,
  showTip,
  has,
}: {
  pathname: string;
  state: OnboardingState;
  userId: string | null;
  showTip: (tip: Tip) => void;
  has: AnchorRegistry["has"];
}) {
  // Only decide once per path; re-deciding on every keystroke would re-measure.
  const lastPath = useRef<string | null>(null);
  const shownFor = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || lastPath.current === pathname) return;
    lastPath.current = pathname;
    const screens = screensFor(pathname);
    let tip: Tip | null = null;
    for (const screen of screens) {
      // Tips with a requirement (tasks review, field mode, team admin) are
      // shown by their own screens when the condition is met; the route driver
      // only handles the unconditional ones.
      const candidates = tipsForScreen(screen, state, {
        reviewItems: false,
        fieldMode: false,
        isAdmin: false,
      });
      tip = candidates.find((t) => t.anchor == null || has(t.anchor)) ?? null;
      if (tip) break;
    }
    if (tip && shownFor.current !== pathname) {
      shownFor.current = pathname;
      showTip(tip);
    }
  }, [pathname, state, userId, showTip, has]);

  return null;
}
