import React, { useEffect } from "react";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Platform } from "react-native";
import { useAuth } from "@/src/context/AuthContext";
import { colors } from "@/src/theme";

export default function TabsLayout() {
  const { user } = useAuth();
  const router = useRouter();
  const role = user?.role;

  useEffect(() => {
    if (!user) router.replace("/auth");
  }, [user]);

  const show = {
    floorplan: true,
    numbers: role === "teacher" || role === "boss" || role === "admin",
    chat: role === "cleaner" || role === "boss",
    // Everyone can view & vote in the contest; only cleaner/boss can submit.
    contest: true,
  };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: Platform.OS === "ios" ? 88 : 64,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="floorplan"
        options={{
          title: "Floor Plan",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="map" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="numbers"
        options={{
          title: "Numbers",
          href: show.numbers ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="stats-chart" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chats",
          href: show.chat ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="contest"
        options={{
          title: "Contest",
          href: show.contest ? undefined : null,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="trophy" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
