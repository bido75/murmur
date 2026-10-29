// The tooltip card. In a tour step it sits above or below the spotlight target
// (whichever fits, never off-screen); centred steps and one-time tips get a
// centred or anchored variant. Keyboard navigation on web and screen-reader
// announcements come with it.
import { useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { radius, space, useTheme } from "@/lib/theme";
import type { AnchorRect } from "./context";

export type TipCardProps = {
  title: string;
  text: string;
  /** "N of M" label, e.g. "2 of 7". Null on centred single cards. */
  stepLabel?: string | null;
  targetRect: AnchorRect | null;
  /** Placement hint: anchored next to the target, or centred on screen. */
  mode: "spotlight" | "centered";
  onBack?: () => void;
  onNext?: () => void;
  onSkip?: () => void;
  backLabel?: string;
  nextLabel?: string;
  skipLabel?: string;
  /** Final-stop call to action (the tour completes after it runs). */
  cta?: { label: string; onPress: () => void };
  /** Larger text and buttons for Field mode. */
  large?: boolean;
  /** Which "N of M" index to announce; null keeps announcements off. */
  announceIndex?: number;
  announceTotal?: number;
  singleButtonLabel?: string;
  onSingleButton?: () => void;
};

export function TipCard(props: TipCardProps) {
  const { onSkip, onNext, onBack } = props;
  const t = useTheme();
  const { width: winW, height: winH } = useWindowDimensions();
  const fade = useMemo(() => new Animated.Value(0), []);
  const cardRef = useRef<ComponentRef<typeof View>>(null);
  const [cardH, setCardH] = useState(0);
  const large = props.large ?? false;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [fade, props.title]);

  // Screen readers hear the step when it opens.
  useEffect(() => {
    if (props.announceIndex == null || props.announceTotal == null) return;
    AccessibilityInfo.announceForAccessibility(
      `Step ${props.announceIndex} of ${props.announceTotal}. ${props.title}. ${props.text}`,
    );
    // Move focus to the card so keyboard and switch users land here.
    const id = setTimeout(() => cardRef.current?.focus(), 250);
    return () => clearTimeout(id);
  }, [props.announceIndex, props.announceTotal, props.title, props.text]);

  // Web keyboard: Esc skips, ←/→ navigate, Enter activates. Focus stays here.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSkip?.();
      else if (e.key === "ArrowRight" || e.key === "Enter") onNext?.();
      else if (e.key === "ArrowLeft") onBack?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onSkip, onNext, onBack]);

  const CARD_MAX = 360;
  const MARGIN = 16;
  const cardW = Math.min(CARD_MAX, winW - MARGIN * 2);

  // Position: anchored steps go above the target when there's room, else below;
  // everything else is centred. Clamped to the screen edges.
  let top = (winH - Math.max(cardH, 160)) / 2;
  let left = (winW - cardW) / 2;
  if (props.mode === "spotlight" && props.targetRect) {
    const r = props.targetRect;
    const above = r.y - cardH - 12;
    top = above > MARGIN + 40 ? above : Math.min(r.y + r.height + 12, winH - cardH - MARGIN);
    left = Math.min(Math.max(MARGIN, r.x + r.width / 2 - cardW / 2), winW - cardW - MARGIN);
    top = Math.max(MARGIN, Math.min(top, winH - cardH - MARGIN));
  }

  const btnMin = large ? 52 : 44;

  return (
    <Animated.View
      ref={cardRef}
      accessible
      accessibilityRole="dialog"
      accessibilityLabel={props.title}
      aria-live="assertive"
      focusable
      style={{
        position: "absolute",
        left,
        top,
        width: cardW,
        opacity: fade,
        backgroundColor: t.surface,
        borderRadius: radius.md,
        padding: large ? space.lg : space.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: t.border,
        // Above the spotlight dim layer and the tab bar.
        zIndex: 30,
        elevation: 8,
      }}
      onLayout={(e) => setCardH(e.nativeEvent.layout.height)}
    >
      {props.stepLabel && (
        <Text
          style={{ color: t.muted, fontSize: 12, fontWeight: "600", marginBottom: 4 }}
          maxFontSizeMultiplier={large ? 1.4 : 2}
        >
          {props.stepLabel}
        </Text>
      )}
      <Text
        style={{
          color: t.ink,
          fontSize: large ? 19 : 16,
          fontWeight: "700",
          marginBottom: 4,
        }}
        maxFontSizeMultiplier={large ? 1.4 : 2}
      >
        {props.title}
      </Text>
      <Text
        style={{ color: t.ink, fontSize: large ? 17 : 14, lineHeight: (large ? 17 : 14) * 1.45 }}
        maxFontSizeMultiplier={large ? 1.4 : 2}
      >
        {props.text}
      </Text>

      <View style={{ flexDirection: "row", alignItems: "center", marginTop: space.md, gap: 8 }}>
        {props.onBack && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={props.backLabel ?? "Back"}
            onPress={props.onBack}
            hitSlop={6}
            style={{ minHeight: btnMin, justifyContent: "center", paddingHorizontal: 10 }}
          >
            <Text style={{ color: t.muted, fontWeight: "600" }}>{props.backLabel ?? "Back"}</Text>
          </Pressable>
        )}
        <View style={{ flex: 1 }} />
        {props.onSkip && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={props.skipLabel ?? "Skip tour"}
            onPress={props.onSkip}
            hitSlop={6}
            style={{ minHeight: btnMin, justifyContent: "center", paddingHorizontal: 8 }}
          >
            <Text style={{ color: t.muted }}>{props.skipLabel ?? "Skip tour"}</Text>
          </Pressable>
        )}
        {props.cta ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={props.cta.label}
            onPress={props.cta.onPress}
            style={{
              minHeight: btnMin,
              justifyContent: "center",
              backgroundColor: t.accent,
              borderRadius: radius.sm,
              paddingHorizontal: 14,
            }}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>{props.cta.label}</Text>
          </Pressable>
        ) : props.onSingleButton ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={props.singleButtonLabel ?? "Got it"}
            onPress={props.onSingleButton}
            style={{
              minHeight: btnMin,
              justifyContent: "center",
              backgroundColor: t.accent,
              borderRadius: radius.sm,
              paddingHorizontal: 14,
            }}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>
              {props.singleButtonLabel ?? "Got it"}
            </Text>
          </Pressable>
        ) : props.onNext ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={props.nextLabel ?? "Next"}
            onPress={props.onNext}
            style={{
              minHeight: btnMin,
              justifyContent: "center",
              backgroundColor: t.accent,
              borderRadius: radius.sm,
              paddingHorizontal: 16,
            }}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>{props.nextLabel ?? "Next"}</Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}
