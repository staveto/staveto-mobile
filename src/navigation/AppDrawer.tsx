import React from "react";
import { useWindowDimensions } from "react-native";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { DrawerContent } from "../components/DrawerContent";
import { AppTabs } from "./AppTabs";

const Drawer = createDrawerNavigator();

/** Responsive drawer width: 85% of screen, max 360px. Prevents overflow on edge-to-edge Android. */
function getDrawerWidth(screenWidth: number): number {
  return Math.min(screenWidth * 0.85, 360);
}

/** Drawer wrapping AppTabs. Avatar on Home opens drawer. Swipe edge disabled to avoid accidental opens. */
export function AppDrawer() {
  const { width: screenWidth } = useWindowDimensions();
  const drawerWidth = getDrawerWidth(screenWidth);

  return (
    <Drawer.Navigator
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: "front",
        drawerStyle: {
          width: drawerWidth,
          overflow: "hidden",
        },
        swipeEdgeWidth: 0,
        swipeEnabled: false,
        overlayColor: "rgba(0,0,0,0.5)",
      }}
    >
      <Drawer.Screen name="Main" component={AppTabs} />
    </Drawer.Navigator>
  );
}
