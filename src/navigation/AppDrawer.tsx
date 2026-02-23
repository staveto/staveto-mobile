import React from "react";
import { Dimensions } from "react-native";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { DrawerContent } from "../components/DrawerContent";
import { AppTabs } from "./AppTabs";

const Drawer = createDrawerNavigator();

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const DRAWER_WIDTH = Math.min(320, SCREEN_WIDTH * 0.78);

/** Drawer wrapping AppTabs. Avatar on Home opens drawer. Swipe edge disabled to avoid accidental opens. */
export function AppDrawer() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: "front",
        drawerStyle: { width: DRAWER_WIDTH },
        swipeEdgeWidth: 0,
        swipeEnabled: false,
        overlayColor: "rgba(0,0,0,0.5)",
      }}
    >
      <Drawer.Screen name="Main" component={AppTabs} />
    </Drawer.Navigator>
  );
}
