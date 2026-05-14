import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { colors } from "../../theme";

type AdminStackParamList = {
  AdminHome: undefined;
  AdminOrganizations: undefined;
};

export function AdminHomeScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<AdminStackParamList>>();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Staveto Admin</Text>
      <Text style={styles.subtitle}>Interná administrácia Staveto Business</Text>

      <View style={styles.sectionList}>
        <Pressable
          style={({ pressed }) => [styles.sectionButton, pressed && styles.sectionButtonPressed]}
          onPress={() => navigation.navigate("AdminOrganizations")}
          accessibilityRole="button"
          accessibilityLabel="Firmy"
        >
          <Text style={styles.sectionButtonText}>- Firmy</Text>
        </Pressable>
        <Text style={styles.sectionItem}>- Licencie</Text>
        <Text style={styles.sectionItem}>- Faktúry</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    textAlign: "center",
    marginBottom: 18,
  },
  sectionList: {
    width: "100%",
    maxWidth: 360,
    paddingHorizontal: 12,
  },
  sectionItem: {
    fontSize: 15,
    color: colors.textMuted,
    marginBottom: 8,
  },
  sectionButton: {
    marginBottom: 8,
    paddingVertical: 2,
  },
  sectionButtonPressed: {
    opacity: 0.75,
  },
  sectionButtonText: {
    fontSize: 15,
    color: colors.primary,
    fontWeight: "600",
  },
});

