import React from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  FlatList,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../i18n/I18nContext";
import { colors, radius, spacing } from "../theme";
import { CURRENCY_OPTIONS } from "../constants/currencies";

type Props = {
  visible: boolean;
  onClose: () => void;
  value: string;
  onSelect: (code: string) => void;
};

export function CurrencyDropdown({ visible, onClose, value, onSelect }: Props) {
  const { t } = useI18n();
  const { height } = useWindowDimensions();
  const maxHeight = Math.min(height * 0.6, 400);

  const renderItem = ({ item }: { item: { code: string; label: string } }) => {
    const isSelected = value === item.code;
    return (
      <TouchableOpacity
        style={[styles.item, isSelected && styles.itemSelected]}
        onPress={() => {
          onSelect(item.code);
          onClose();
        }}
        activeOpacity={0.7}
      >
        <Text style={[styles.itemText, isSelected && styles.itemTextSelected]}>{item.label}</Text>
        {isSelected && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.content, { maxHeight }]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>{t("expense.currency") || "Mena"}</Text>
            <TouchableOpacity onPress={onClose} style={styles.cancelBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={styles.cancelText}>{t("common.cancel")}</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={CURRENCY_OPTIONS}
            keyExtractor={(item) => item.code}
            renderItem={renderItem}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={true}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  content: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius,
    borderTopRightRadius: radius,
    paddingBottom: spacing.lg,
    maxHeight: 400,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: colors.textMuted,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.08)",
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
  },
  cancelBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  cancelText: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: "500",
  },
  list: {
    maxHeight: 340,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
  },
  itemSelected: {
    backgroundColor: "rgba(224, 103, 55, 0.12)",
  },
  itemText: {
    fontSize: 16,
    color: colors.text,
  },
  itemTextSelected: {
    color: colors.primary,
    fontWeight: "600",
  },
});
