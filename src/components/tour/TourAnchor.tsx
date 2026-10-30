// A wrapper that makes any element a spotlight target. The ref is registered
// with the TourProvider under a stable id; the spotlight measures it with
// measureInWindow, which works the same on iOS, Android and web.
import { useEffect, useRef, type ComponentRef, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { useTourAnchors } from "./context";

export function TourAnchor({
  id,
  children,
  style,
}: {
  id: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { register, unregister } = useTourAnchors();
  const ref = useRef<ComponentRef<typeof View>>(null);
  useEffect(() => {
    register(id, ref);
    return () => unregister(id);
  }, [id, register, unregister]);
  return (
    // collapsable: false keeps the view real on Android so it can be measured
    // even when it only wraps a single child.
    <View ref={ref} collapsable={false} style={style}>
      {children}
    </View>
  );
}
