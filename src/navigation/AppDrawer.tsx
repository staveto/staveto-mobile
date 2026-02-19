import React from "react";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { DrawerContent } from "../components/DrawerContent";
import { AppTabs } from "./AppTabs";

const Drawer = createDrawerNavigator();

/** Drawer wrapping AppTabs. Avatar on Home opens drawer. Swipe edge disabled to avoid accidental opens. */
export function AppDrawer() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: "front",
        drawerStyle: { width: "86%" },
        swipeEdgeWidth: 0,
        swipeEnabled: false,
        overlayColor: "rgba(0,0,0,0.5)",
      }}
    >
      <Drawer.Screen name="Main" component={AppTabs} />
    </Drawer.Navigator>
  );
}
