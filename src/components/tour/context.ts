// Shared React context for the onboarding system, so TourAnchor (used across
// screens) and TourProvider (mounted once in the root layout) don't import
// each other. The spotlight and tip cards get what they need as props.
import { createContext, useContext, type ComponentRef, type RefObject } from "react";
import { type View } from "react-native";

/** The underlying native view behind a <View /> (SDK 58 ref typing). */
export type ViewRef = ComponentRef<typeof View>;

export type AnchorRect = { x: number; y: number; width: number; height: number };

export type AnchorRegistry = {
  /** Every TourAnchor registers its view here on mount (and clears on unmount). */
  register(id: string, ref: RefObject<ViewRef | null>): void;
  unregister(id: string): void;
  /** Absolute page rectangle of the anchor, or null when it isn't on screen. */
  measure(id: string): Promise<AnchorRect | null>;
  /** True when some view with this id is currently mounted. */
  has(id: string): boolean;
};

export const AnchorRegistryContext = createContext<AnchorRegistry>({
  register: () => undefined,
  unregister: () => undefined,
  measure: async () => null,
  has: () => false,
});

export function useTourAnchors(): AnchorRegistry {
  return useContext(AnchorRegistryContext);
}
