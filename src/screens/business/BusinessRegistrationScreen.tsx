import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { getAuth } from "../../firebase";
import { useBusinessContext } from "../../hooks/useBusinessContext";
import { useI18n } from "../../i18n/I18nContext";
import { createBusinessOrg } from "../../services/businessRegistration";
import { colors, radius, spacing } from "../../theme";

type FormState = {
  companyName: string;
  legalName: string;
  countryCode: string;
  registrationNumber: string;
  taxId: string;
  vatId: string;
  billingEmail: string;
  billingAddressLine1: string;
  billingAddressCity: string;
  billingAddressZip: string;
  contactName: string;
  phone: string;
};

type PlanCode = "business_starter" | "business_team" | "business_company";
type BillingPeriod = "monthly" | "yearly";

const BUSINESS_PLANS: Array<{
  planCode: PlanCode;
  seatsIncluded: number;
  monthlyPrice: number;
  yearlyPrice: number;
  titleKey: string;
}> = [
  {
    planCode: "business_starter",
    seatsIncluded: 5,
    monthlyPrice: 149,
    yearlyPrice: 1490,
    titleKey: "business.planSelection.starterTitle",
  },
  {
    planCode: "business_team",
    seatsIncluded: 15,
    monthlyPrice: 329,
    yearlyPrice: 3290,
    titleKey: "business.planSelection.teamTitle",
  },
  {
    planCode: "business_company",
    seatsIncluded: 30,
    monthlyPrice: 649,
    yearlyPrice: 6490,
    titleKey: "business.planSelection.companyTitle",
  },
];

type RegistrationRouteParams = {
  planCode?: PlanCode;
  billingPeriod?: BillingPeriod;
};

type SupportedCountryCode = "SK" | "CZ" | "AT" | "DE" | "PL" | "GB" | "US" | "OTHER";

const INITIAL_FORM: FormState = {
  companyName: "",
  legalName: "",
  countryCode: "SK",
  registrationNumber: "",
  taxId: "",
  vatId: "",
  billingEmail: "",
  billingAddressLine1: "",
  billingAddressCity: "",
  billingAddressZip: "",
  contactName: "",
  phone: "",
};

type ValidationResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      field: string;
      message: string;
    };

const COUNTRY_OPTIONS: Array<{ code: SupportedCountryCode; labelKey: string }> = [
  { code: "SK", labelKey: "business.registration.country.sk" },
  { code: "CZ", labelKey: "business.registration.country.cz" },
  { code: "AT", labelKey: "business.registration.country.at" },
  { code: "DE", labelKey: "business.registration.country.de" },
  { code: "PL", labelKey: "business.registration.country.pl" },
  { code: "GB", labelKey: "business.registration.country.gb" },
  { code: "US", labelKey: "business.registration.country.us" },
  { code: "OTHER", labelKey: "business.registration.country.other" },
];

const COUNTRY_LABELS: Record<
  SupportedCountryCode,
  {
    registrationLabelKey: string;
    taxIdLabelKey: string;
    vatIdLabelKey: string;
    zipLabelKey: string;
    registrationRequired: boolean;
  }
> = {
  SK: {
    registrationLabelKey: "business.registration.countryLabels.sk.registration",
    taxIdLabelKey: "business.registration.countryLabels.sk.taxId",
    vatIdLabelKey: "business.registration.countryLabels.sk.vatId",
    zipLabelKey: "business.registration.countryLabels.sk.zip",
    registrationRequired: true,
  },
  CZ: {
    registrationLabelKey: "business.registration.countryLabels.cz.registration",
    taxIdLabelKey: "business.registration.countryLabels.cz.taxId",
    vatIdLabelKey: "business.registration.countryLabels.cz.vatId",
    zipLabelKey: "business.registration.countryLabels.cz.zip",
    registrationRequired: true,
  },
  AT: {
    registrationLabelKey: "business.registration.countryLabels.at.registration",
    taxIdLabelKey: "business.registration.countryLabels.at.taxId",
    vatIdLabelKey: "business.registration.countryLabels.at.vatId",
    zipLabelKey: "business.registration.countryLabels.at.zip",
    registrationRequired: false,
  },
  DE: {
    registrationLabelKey: "business.registration.countryLabels.de.registration",
    taxIdLabelKey: "business.registration.countryLabels.de.taxId",
    vatIdLabelKey: "business.registration.countryLabels.de.vatId",
    zipLabelKey: "business.registration.countryLabels.de.zip",
    registrationRequired: false,
  },
  PL: {
    registrationLabelKey: "business.registration.countryLabels.pl.registration",
    taxIdLabelKey: "business.registration.countryLabels.pl.taxId",
    vatIdLabelKey: "business.registration.countryLabels.pl.vatId",
    zipLabelKey: "business.registration.countryLabels.pl.zip",
    registrationRequired: false,
  },
  GB: {
    registrationLabelKey: "business.registration.countryLabels.gb.registration",
    taxIdLabelKey: "business.registration.countryLabels.gb.taxId",
    vatIdLabelKey: "business.registration.countryLabels.gb.vatId",
    zipLabelKey: "business.registration.countryLabels.gb.zip",
    registrationRequired: false,
  },
  US: {
    registrationLabelKey: "business.registration.countryLabels.us.registration",
    taxIdLabelKey: "business.registration.countryLabels.us.taxId",
    vatIdLabelKey: "business.registration.countryLabels.us.vatId",
    zipLabelKey: "business.registration.countryLabels.us.zip",
    registrationRequired: false,
  },
  OTHER: {
    registrationLabelKey: "business.registration.countryLabels.other.registration",
    taxIdLabelKey: "business.registration.countryLabels.other.taxId",
    vatIdLabelKey: "business.registration.countryLabels.other.vatId",
    zipLabelKey: "business.registration.countryLabels.other.zip",
    registrationRequired: false,
  },
};

function getErrorDetails(error: unknown): { code: string; message: string; stack?: string } {
  const code =
    typeof (error as { code?: unknown } | null)?.code === "string"
      ? ((error as { code: string }).code as string)
      : "unknown";
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  return { code, message, stack };
}

export function BusinessRegistrationScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { setActiveBusinessOrgId } = useBusinessContext();
  const { t } = useI18n();
  const routeParams = ((route as { params?: RegistrationRouteParams }).params ?? {}) as RegistrationRouteParams;
  const selectedPlanCode = routeParams.planCode;
  const selectedBillingPeriod = routeParams.billingPeriod;
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [countryModalVisible, setCountryModalVisible] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const normalizedCountry = useMemo<SupportedCountryCode>(() => {
    const normalized = form.countryCode.trim().toUpperCase();
    return COUNTRY_OPTIONS.some((item) => item.code === normalized)
      ? (normalized as SupportedCountryCode)
      : "OTHER";
  }, [form.countryCode]);
  const labels = COUNTRY_LABELS[normalizedCountry];

  const setField = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const selectedCountryLabel = t(
    COUNTRY_OPTIONS.find((country) => country.code === normalizedCountry)?.labelKey ??
      "business.registration.countryPicker.selectCountry"
  );
  const registrationLabel = t(labels.registrationLabelKey);
  const taxIdLabel = t(labels.taxIdLabelKey);
  const vatIdLabel = t(labels.vatIdLabelKey);
  const zipLabel = t(labels.zipLabelKey);
  const selectedBusinessPlan = useMemo(
    () => BUSINESS_PLANS.find((plan) => plan.planCode === selectedPlanCode) ?? null,
    [selectedPlanCode]
  );
  const selectedPrice = selectedBusinessPlan
    ? selectedBillingPeriod === "yearly"
      ? selectedBusinessPlan.yearlyPrice
      : selectedBusinessPlan.monthlyPrice
    : null;

  React.useEffect(() => {
    if (!selectedBusinessPlan || (selectedBillingPeriod !== "monthly" && selectedBillingPeriod !== "yearly")) {
      Alert.alert(
        t("business.registration.alert.planMissingTitle"),
        t("business.registration.alert.planMissingBody")
      );
      (navigation as { navigate: (name: string) => void }).navigate("BusinessPlanSelection");
    }
  }, [navigation, selectedBillingPeriod, selectedBusinessPlan, t]);

  const validate = (): ValidationResult => {
    if (!selectedBusinessPlan || (selectedBillingPeriod !== "monthly" && selectedBillingPeriod !== "yearly")) {
      return { ok: false, field: "planCode", message: t("business.registration.alert.planMissingBody") };
    }
    if (!form.companyName.trim()) {
      return { ok: false, field: "companyName", message: t("business.registration.validation.companyNameRequired") };
    }
    if (!form.legalName.trim()) {
      return { ok: false, field: "legalName", message: t("business.registration.validation.legalNameRequired") };
    }
    if (!normalizedCountry) {
      return { ok: false, field: "countryCode", message: t("business.registration.validation.countryRequired") };
    }
    if (!form.billingEmail.trim()) {
      return { ok: false, field: "billingEmail", message: t("business.registration.validation.billingEmailRequired") };
    }
    if (!form.billingAddressLine1.trim()) {
      return { ok: false, field: "billingAddress.line1", message: t("business.registration.validation.billingLine1Required") };
    }
    if (!form.billingAddressCity.trim()) {
      return { ok: false, field: "billingAddress.city", message: t("business.registration.validation.billingCityRequired") };
    }
    if (!form.billingAddressZip.trim()) {
      return {
        ok: false,
        field: "billingAddress.zip",
        message: t("business.registration.validation.billingZipRequired", { zipLabel }),
      };
    }
    if (labels.registrationRequired && !form.registrationNumber.trim()) {
      return {
        ok: false,
        field: "companyIdentifiers.registrationNumber",
        message: t("business.registration.validation.registrationRequiredForSkCz", { registrationLabel }),
      };
    }
    return { ok: true };
  };

  const onSubmit = async () => {
    console.log("[BusinessRegistration] submit pressed");
    setFormError(null);
    const validation = validate();
    if (!validation.ok) {
      console.warn("[BusinessRegistration] validation failed", {
        field: validation.field,
        message: validation.message,
      });
      setFormError(validation.message);
      Alert.alert(t("business.registration.alert.invalidDataTitle"), t("business.registration.alert.invalidDataBody"));
      return;
    }
    console.log("[BusinessRegistration] validation passed");

    const authUser = getAuth()?.currentUser ?? null;
    if (!authUser?.uid) {
      console.warn("[BusinessRegistration] no auth user before callable");
      const authError = t("business.registration.alert.notSignedInBody");
      setFormError(authError);
      Alert.alert(t("business.registration.alert.notSignedInTitle"), authError);
      return;
    }

    console.log("[BusinessRegistration] calling createBusinessOrg", {
      planCode: selectedBusinessPlan?.planCode ?? null,
      billingPeriod: selectedBillingPeriod ?? null,
      countryCode: normalizedCountry,
      requestedSeats: selectedBusinessPlan?.seatsIncluded ?? null,
      hasRegistrationNumber: !!form.registrationNumber.trim(),
      hasBillingEmail: !!form.billingEmail.trim(),
    });

    setSubmitting(true);
    try {
      const result = await createBusinessOrg({
        planCode: selectedBusinessPlan!.planCode,
        billingPeriod: selectedBillingPeriod!,
        companyName: form.companyName.trim(),
        legalName: form.legalName.trim(),
        countryCode: normalizedCountry,
        billingEmail: form.billingEmail.trim(),
        requestedSeats: selectedBusinessPlan!.seatsIncluded,
        billingAddress: {
          line1: form.billingAddressLine1.trim(),
          city: form.billingAddressCity.trim(),
          zip: form.billingAddressZip.trim(),
        },
        companyIdentifiers: {
          registrationNumber: form.registrationNumber.trim() || null,
          taxId: form.taxId.trim() || null,
          vatId: form.vatId.trim() || null,
        },
        contactName: form.contactName.trim() || null,
        phone: form.phone.trim() || null,
      });
      console.log("[BusinessRegistration] createBusinessOrg success", {
        orgId: result.orgId,
        orderId: result.orderId,
        orderNumber: result.orderNumber,
      });

      setActiveBusinessOrgId(result.orgId);
      (navigation as { navigate: (name: string, params?: object) => void }).navigate(
        "BusinessOrderPending",
        {
          orgId: result.orgId,
          orderId: result.orderId,
          companyName: form.companyName.trim(),
          requestedSeats: selectedBusinessPlan!.seatsIncluded,
          countryCode: normalizedCountry,
          billingEmail: form.billingEmail.trim(),
          orderNumber: result.orderNumber,
          variableSymbol: result.variableSymbol,
          paymentReference: result.paymentReference,
          status: result.status,
        }
      );
    } catch (error) {
      const details = getErrorDetails(error);
      console.warn("[BusinessRegistration] createBusinessOrg error", details);
      setFormError(t("business.registration.alert.submitFailedBody"));
      Alert.alert(
        t("business.registration.alert.submitFailedTitle"),
        t("business.registration.alert.submitFailedBodyWithCode", {
          code: details.code,
          message: details.message || t("business.registration.alert.tryAgain"),
        })
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t("business.registration.title")}</Text>
      <Text style={styles.subtitle}>{t("business.registration.subtitle")}</Text>

      {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

      <Text style={styles.label}>{t("business.registration.companyNameLabel")} *</Text>
      <TextInput
        style={styles.input}
        value={form.companyName}
        onChangeText={(v) => setField("companyName", v)}
        placeholder={t("business.registration.companyNamePlaceholder")}
        placeholderTextColor={colors.inputPlaceholderOnLight}
      />

      <Text style={styles.label}>{t("business.registration.legalNameLabel")} *</Text>
      <TextInput
        style={styles.input}
        value={form.legalName}
        onChangeText={(v) => setField("legalName", v)}
        placeholder={t("business.registration.legalNamePlaceholder")}
        placeholderTextColor={colors.inputPlaceholderOnLight}
      />

      <Text style={styles.label}>{t("business.registration.countryLabel")} *</Text>
      <TouchableOpacity
        style={styles.countrySelect}
        onPress={() => setCountryModalVisible(true)}
        activeOpacity={0.85}
        disabled={submitting}
      >
        <Text style={styles.countrySelectText}>
          {selectedCountryLabel} ({normalizedCountry})
        </Text>
      </TouchableOpacity>

      <Text style={styles.label}>
        {registrationLabel} {labels.registrationRequired ? "*" : ""}
      </Text>
      <TextInput
        style={styles.input}
        value={form.registrationNumber}
        onChangeText={(v) => setField("registrationNumber", v)}
        placeholder={registrationLabel}
        placeholderTextColor={colors.inputPlaceholderOnLight}
      />

      <Text style={styles.label}>{taxIdLabel}</Text>
      <TextInput
        style={styles.input}
        value={form.taxId}
        onChangeText={(v) => setField("taxId", v)}
        placeholder={taxIdLabel}
        placeholderTextColor={colors.inputPlaceholderOnLight}
      />

      <Text style={styles.label}>{vatIdLabel}</Text>
      <TextInput
        style={styles.input}
        value={form.vatId}
        onChangeText={(v) => setField("vatId", v)}
        placeholder={vatIdLabel}
        placeholderTextColor={colors.inputPlaceholderOnLight}
      />

      <Text style={styles.label}>{t("business.registration.billingEmailLabel")} *</Text>
      <TextInput
        style={styles.input}
        value={form.billingEmail}
        onChangeText={(v) => setField("billingEmail", v)}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder={t("business.registration.billingEmailPlaceholder")}
        placeholderTextColor={colors.inputPlaceholderOnLight}
      />

      <Text style={styles.label}>{t("business.registration.billingLine1Label")} *</Text>
      <TextInput
        style={styles.input}
        value={form.billingAddressLine1}
        onChangeText={(v) => setField("billingAddressLine1", v)}
        placeholder={t("business.registration.billingLine1Placeholder")}
        placeholderTextColor={colors.inputPlaceholderOnLight}
      />

      <Text style={styles.label}>{t("business.registration.billingCityLabel")} *</Text>
      <TextInput
        style={styles.input}
        value={form.billingAddressCity}
        onChangeText={(v) => setField("billingAddressCity", v)}
        placeholder={t("business.registration.billingCityPlaceholder")}
        placeholderTextColor={colors.inputPlaceholderOnLight}
      />

      <Text style={styles.label}>{t("business.registration.billingZipLabel", { zipLabel })} *</Text>
      <TextInput
        style={styles.input}
        value={form.billingAddressZip}
        onChangeText={(v) => setField("billingAddressZip", v)}
        placeholder={zipLabel}
        placeholderTextColor={colors.inputPlaceholderOnLight}
      />

      <Text style={styles.label}>{t("business.registration.contactNameLabel")}</Text>
      <TextInput
        style={styles.input}
        value={form.contactName}
        onChangeText={(v) => setField("contactName", v)}
        placeholder={t("business.registration.optionalPlaceholder")}
        placeholderTextColor={colors.inputPlaceholderOnLight}
      />

      <Text style={styles.label}>{t("business.registration.phoneLabel")}</Text>
      <TextInput
        style={styles.input}
        value={form.phone}
        onChangeText={(v) => setField("phone", v)}
        keyboardType="phone-pad"
        placeholder={t("business.registration.optionalPlaceholder")}
        placeholderTextColor={colors.inputPlaceholderOnLight}
      />

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>{t("business.registration.summary.title")}</Text>
        <Text style={styles.summaryLine}>
          {t("business.registration.summary.plan")}:{" "}
          {selectedBusinessPlan ? t(selectedBusinessPlan.titleKey) : "—"}
        </Text>
        <Text style={styles.summaryLine}>
          {t("business.registration.summary.seats")}: {selectedBusinessPlan ? String(selectedBusinessPlan.seatsIncluded) : "—"}
        </Text>
        <Text style={styles.summaryLine}>
          {t("business.registration.summary.period")}:{" "}
          {t(
            selectedBillingPeriod === "yearly"
              ? "business.planSelection.billingYearly"
              : "business.planSelection.billingMonthly"
          )}
        </Text>
        <Text style={styles.summaryLine}>
          {t("business.registration.summary.price")}:{" "}
          {selectedPrice !== null
            ? selectedBillingPeriod === "yearly"
              ? t("business.planSelection.yearlyPrice", { price: String(selectedPrice) })
              : t("business.planSelection.monthlyPrice", { price: String(selectedPrice) })
            : "—"}
        </Text>
      </View>

      <TouchableOpacity style={styles.submitButton} onPress={onSubmit} disabled={submitting}>
        {submitting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.submitButtonText}>{t("business.registration.submitCta")}</Text>
        )}
      </TouchableOpacity>

      <Modal transparent visible={countryModalVisible} animationType="fade" onRequestClose={() => setCountryModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t("business.registration.countryPicker.title")}</Text>
            {COUNTRY_OPTIONS.map((option) => {
              const selected = option.code === normalizedCountry;
              return (
                <TouchableOpacity
                  key={option.code}
                  style={[styles.countryOption, selected && styles.countryOptionSelected]}
                  onPress={() => {
                    setField("countryCode", option.code);
                    setCountryModalVisible(false);
                  }}
                >
                  <Text style={[styles.countryOptionText, selected && styles.countryOptionTextSelected]}>
                    {t(option.labelKey)} ({option.code})
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={styles.modalCancelButton} onPress={() => setCountryModalVisible(false)}>
              <Text style={styles.modalCancelText}>{t("business.registration.countryPicker.cancel")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textOnDark,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    color: colors.onboardingHelperOnDark,
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  errorText: {
    color: "#ffd7d7",
    backgroundColor: "rgba(220, 53, 69, 0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: radius,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.labelOnDark,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    borderRadius: radius,
    backgroundColor: colors.formPanel,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 48,
  },
  countrySelect: {
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    borderRadius: radius,
    backgroundColor: colors.formPanel,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 48,
    justifyContent: "center",
  },
  countrySelectText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "500",
  },
  submitButton: {
    marginTop: spacing.xl,
    backgroundColor: colors.primary,
    borderRadius: radius,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
    minHeight: 48,
  },
  submitButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  summaryCard: {
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
    borderRadius: radius,
    backgroundColor: colors.formPanel,
    padding: spacing.md,
  },
  summaryTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  summaryLine: {
    color: colors.text,
    fontSize: 14,
    marginBottom: spacing.xs,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.formPanel,
    borderRadius: radius,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.formPanelBorder,
  },
  modalTitle: {
    color: colors.text,
    fontWeight: "700",
    fontSize: 16,
    marginBottom: spacing.sm,
  },
  countryOption: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius,
    marginBottom: spacing.xs,
    backgroundColor: "#e3eaf2",
  },
  countryOptionSelected: {
    backgroundColor: "#d4dde8",
    borderWidth: 1,
    borderColor: colors.primary,
  },
  countryOptionText: {
    color: colors.text,
    fontSize: 15,
  },
  countryOptionTextSelected: {
    fontWeight: "700",
  },
  modalCancelButton: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  modalCancelText: {
    color: colors.primary,
    fontWeight: "700",
    fontSize: 15,
  },
});

