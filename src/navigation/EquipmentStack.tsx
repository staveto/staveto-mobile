import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useI18n } from "../i18n/I18nContext";
import { EquipmentScreen } from "../screens/equipmentTab/EquipmentScreen";
import { EquipmentDetailScreen } from "../screens/equipmentTab/EquipmentDetailScreen";
import { EquipmentFormScreen } from "../screens/equipmentTab/EquipmentFormScreen";
import { ServiceRuleFormScreen } from "../screens/equipment/ServiceRuleFormScreen";
import type { ServiceRuleDoc } from "../services/serviceRules";
import { colors } from "../theme";

export type EquipmentStackParamList = {
  EquipmentMain: undefined;
  EquipmentDetail: { equipmentId: string; equipmentOwnerUid?: string };
  EquipmentForm: { equipmentId?: string };
  EquipmentServiceRuleForm: {
    serviceScope: "user";
    userId: string;
    equipmentId: string;
    equipmentName?: string;
    ruleId?: string;
    rule?: ServiceRuleDoc;
  };
};

const Stack = createNativeStackNavigator<EquipmentStackParamList>();

/** Tab stack: list → detail → create/edit user-owned equipment. */
export function EquipmentStack() {
  const { t } = useI18n();
  return (
    <Stack.Navigator
      initialRouteName="EquipmentMain"
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textOnDark,
        headerTitleStyle: { color: colors.textOnDark },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="EquipmentMain"
        component={EquipmentScreen}
        options={{ title: t("equipmentTab.screenTitle"), headerLargeTitle: false }}
      />
      <Stack.Screen
        name="EquipmentDetail"
        component={EquipmentDetailScreen}
        options={{ title: t("equipmentTab.detailTitle") }}
      />
      <Stack.Screen
        name="EquipmentForm"
        component={EquipmentFormScreen}
        options={({ route }) => ({
          title: route.params?.equipmentId ? t("equipmentTab.editTitle") : t("equipmentTab.addTitle"),
        })}
      />
      <Stack.Screen
        name="EquipmentServiceRuleForm"
        component={ServiceRuleFormScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}
