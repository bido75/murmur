import { Pressable, Text, type ColorValue } from "react-native";
import { Tabs } from "expo-router/js-tabs";
import { useTheme } from "@/lib/theme";
import { TourAnchor } from "@/components/tour/TourAnchor";

function Icon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;
}

/** The tab button wrapped so the tour can point at it. The wrapper fills the
 * tab slot exactly like the default button; pressing still navigates. */
function anchoredTabButton(id: string) {
  // The tab-bar button props carry styles and handlers from the navigator; the
  // TourAnchor measures the wrapper, and the pressable inside keeps navigation.
  return function AnchoredTabButton(props: any) {
    return (
      <TourAnchor id={id} style={{ flex: 1 }}>
        <Pressable {...props} style={[props.style, { flex: 1 }]} />
      </TourAnchor>
    );
  };
}

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.bg },
        headerTintColor: t.ink,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.border },
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.muted,
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Recordings",
          tabBarIcon: ({ color }) => <Icon glyph="●" color={color} />,
          tabBarButton: anchoredTabButton("tab-recordings") as never,
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: "Projects",
          tabBarIcon: ({ color }) => <Icon glyph="▤" color={color} />,
          tabBarButton: anchoredTabButton("tab-projects") as never,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color }) => <Icon glyph="⌕" color={color} />,
          tabBarButton: anchoredTabButton("tab-search") as never,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: "Tasks",
          tabBarIcon: ({ color }) => <Icon glyph="✓" color={color} />,
          tabBarButton: anchoredTabButton("tab-tasks") as never,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => <Icon glyph="⚙" color={color} />,
        }}
      />
    </Tabs>
  );
}
