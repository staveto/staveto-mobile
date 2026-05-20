import { useCallback, useState } from "react";
import {
  useFocusEffect,
  useNavigation,
  type NavigationProp,
  type ParamListBase,
} from "@react-navigation/native";

/** True when a bottom tab navigator is an ancestor (native tab bar is visible). */
export function isInsideMainTabNavigator(navigation: NavigationProp<ParamListBase>): boolean {
  let nav = navigation.getParent();
  while (nav) {
    const state = nav.getState();
    if (state?.type === "tab") return true;
    nav = nav.getParent();
  }
  return false;
}

/**
 * Use on stack screens that optionally render {@link AppBottomMenu}:
 * hide the custom dock when the main tab bar is already shown (e.g. HomeStack → ProjectOverview).
 */
export function useIsInsideMainTabNavigator(): boolean {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const [inside, setInside] = useState(() => isInsideMainTabNavigator(navigation));

  useFocusEffect(
    useCallback(() => {
      setInside(isInsideMainTabNavigator(navigation));
    }, [navigation])
  );

  return inside;
}
