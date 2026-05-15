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
import { useNavigation } from "@react-navigation/native";
import { getAuth } from "../../firebase";
import { useBusinessContext } from "../../hooks/useBusinessContext";
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
  requestedSeats: string;
};

type SupportedCountryCode = "SK" | "CZ" | "AT" | "DE" | "PL" | "OTHER";

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
  requestedSeats: "5",
};

type ValidationResult =
  | {
      ok: true;
      requestedSeats: number;
    }
  | {
      ok: false;
      field: string;
      message: string;
    };

const COUNTRY_OPTIONS: Array<{ code: SupportedCountryCode; label: string }> = [
  { code: "SK", label: "Slovensko" },
  { code: "CZ", label: "Česko" },
  { code: "AT", label: "Rakúsko" },
  { code: "DE", label: "Nemecko" },
  { code: "PL", label: "Poľsko" },
  { code: "OTHER", label: "Iná krajina" },
];

const COUNTRY_LABELS: Record<
  SupportedCountryCode,
  {
    registrationLabel: string;
    taxIdLabel: string;
    vatIdLabel: string;
    zipLabel: string;
    registrationRequired: boolean;
  }
> = {
  SK: {
    registrationLabel: "IČO / registračné číslo",
    taxIdLabel: "DIČ",
    vatIdLabel: "IČ DPH",
    zipLabel: "PSČ",
    registrationRequired: true,
  },
  CZ: {
    registrationLabel: "IČO / registrační číslo",
    taxIdLabel: "DIČ",
    vatIdLabel: "DIČ k DPH",
    zipLabel: "PSČ",
    registrationRequired: true,
  },
  AT: {
    registrationLabel: "Firmenbuchnummer / registračné číslo",
    taxIdLabel: "Steuernummer",
    vatIdLabel: "UID / VAT ID",
    zipLabel: "PLZ",
    registrationRequired: false,
  },
  DE: {
    registrationLabel: "Handelsregisternummer / registračné číslo",
    taxIdLabel: "Steuernummer",
    vatIdLabel: "USt-IdNr. / VAT ID",
    zipLabel: "PLZ",
    registrationRequired: false,
  },
  PL: {
    registrationLabel: "REGON / registračné číslo",
    taxIdLabel: "NIP / Tax ID",
    vatIdLabel: "VAT UE",
    zipLabel: "Kod pocztowy",
    registrationRequired: false,
  },
  OTHER: {
    registrationLabel: "Company registration number",
    taxIdLabel: "Tax ID",
    vatIdLabel: "VAT ID",
    zipLabel: "ZIP / Postal code",
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
  const { setActiveBusinessOrgId } = useBusinessContext();
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

  const selectedCountryLabel =
    COUNTRY_OPTIONS.find((country) => country.code === normalizedCountry)?.label ?? "Vyberte krajinu";

  const validate = (): ValidationResult => {
    if (!form.companyName.trim()) return { ok: false, field: "companyName", message: "Názov firmy je povinný." };
    if (!form.legalName.trim()) return { ok: false, field: "legalName", message: "Právny názov je povinný." };
    if (!normalizedCountry) return { ok: false, field: "countryCode", message: "Krajina je povinná." };
    if (!form.billingEmail.trim()) {
      return { ok: false, field: "billingEmail", message: "Fakturačný e-mail je povinný." };
    }
    if (!form.billingAddressLine1.trim()) {
      return { ok: false, field: "billingAddress.line1", message: "Ulica fakturačnej adresy je povinná." };
    }
    if (!form.billingAddressCity.trim()) {
      return { ok: false, field: "billingAddress.city", message: "Mesto fakturačnej adresy je povinné." };
    }
    if (!form.billingAddressZip.trim()) {
      return {
        ok: false,
        field: "billingAddress.zip",
        message: `${labels.zipLabel} fakturačnej adresy je povinné.`,
      };
    }
    if (labels.registrationRequired && !form.registrationNumber.trim()) {
      return {
        ok: false,
        field: "companyIdentifiers.registrationNumber",
        message: `${labels.registrationLabel} je pre SK/CZ povinné.`,
      };
    }
    const seats = Number(form.requestedSeats);
    if (!Number.isInteger(seats) || seats < 1) {
      return {
        ok: false,
        field: "requestedSeats",
        message: "Počet licencií musí byť celé číslo aspoň 1.",
      };
    }
    return { ok: true, requestedSeats: seats };
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
      Alert.alert(
        "Neplatné údaje",
        "Skontrolujte povinné polia a počet licencií (celé číslo aspoň 1)."
      );
      return;
    }
    console.log("[BusinessRegistration] validation passed");

    const authUser = getAuth()?.currentUser ?? null;
    if (!authUser?.uid) {
      console.warn("[BusinessRegistration] no auth user before callable");
      setFormError("Nie ste prihlásený. Prihláste sa a skúste znova.");
      Alert.alert("Nie ste prihlásený. Prihláste sa a skúste znova.");
      return;
    }

    console.log("[BusinessRegistration] calling createBusinessOrg", {
      countryCode: normalizedCountry,
      requestedSeats: validation.requestedSeats,
      hasRegistrationNumber: !!form.registrationNumber.trim(),
      hasBillingEmail: !!form.billingEmail.trim(),
    });

    setSubmitting(true);
    try {
      const result = await createBusinessOrg({
        companyName: form.companyName.trim(),
        legalName: form.legalName.trim(),
        countryCode: normalizedCountry,
        billingEmail: form.billingEmail.trim(),
        requestedSeats: validation.requestedSeats,
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
          requestedSeats: validation.requestedSeats,
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
      setFormError(details.message || "Registrácia zlyhala. Skúste to prosím znova.");
      Alert.alert(
        "Registrácia zlyhala",
        `Code: ${details.code}\nMessage: ${details.message || "Skúste to prosím znova."}`
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Registrácia firmy</Text>
      <Text style={styles.subtitle}>Vyplňte fakturačné údaje a počet používateľov pre Staveto Business.</Text>

      {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

      <Text style={styles.label}>Názov firmy *</Text>
      <TextInput
        style={styles.input}
        value={form.companyName}
        onChangeText={(v) => setField("companyName", v)}
        placeholder="Napr. Staveto s.r.o."
        placeholderTextColor={colors.inputPlaceholderOnLight}
      />

      <Text style={styles.label}>Právny názov *</Text>
      <TextInput
        style={styles.input}
        value={form.legalName}
        onChangeText={(v) => setField("legalName", v)}
        placeholder="Napr. Staveto spoločnosť s ručením obmedzeným"
        placeholderTextColor={colors.inputPlaceholderOnLight}
      />

      <Text style={styles.label}>Krajina firmy *</Text>
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
        {labels.registrationLabel} {labels.registrationRequired ? "*" : ""}
      </Text>
      <TextInput
        style={styles.input}
        value={form.registrationNumber}
        onChangeText={(v) => setField("registrationNumber", v)}
        placeholder={labels.registrationLabel}
        placeholderTextColor={colors.inputPlaceholderOnLight}
      />

      <Text style={styles.label}>{labels.taxIdLabel}</Text>
      <TextInput
        style={styles.input}
        value={form.taxId}
        onChangeText={(v) => setField("taxId", v)}
        placeholder={labels.taxIdLabel}
        placeholderTextColor={colors.inputPlaceholderOnLight}
      />

      <Text style={styles.label}>{labels.vatIdLabel}</Text>
      <TextInput
        style={styles.input}
        value={form.vatId}
        onChangeText={(v) => setField("vatId", v)}
        placeholder={labels.vatIdLabel}
        placeholderTextColor={colors.inputPlaceholderOnLight}
      />

      <Text style={styles.label}>Fakturačný e-mail *</Text>
      <TextInput
        style={styles.input}
        value={form.billingEmail}
        onChangeText={(v) => setField("billingEmail", v)}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="fakturacia@firma.sk"
        placeholderTextColor={colors.inputPlaceholderOnLight}
      />

      <Text style={styles.label}>Fakturačná adresa - ulica *</Text>
      <TextInput
        style={styles.input}
        value={form.billingAddressLine1}
        onChangeText={(v) => setField("billingAddressLine1", v)}
        placeholder="Ulica a číslo"
        placeholderTextColor={colors.inputPlaceholderOnLight}
      />

      <Text style={styles.label}>Fakturačná adresa - mesto *</Text>
      <TextInput
        style={styles.input}
        value={form.billingAddressCity}
        onChangeText={(v) => setField("billingAddressCity", v)}
        placeholder="Mesto"
        placeholderTextColor={colors.inputPlaceholderOnLight}
      />

      <Text style={styles.label}>Fakturačná adresa - {labels.zipLabel} *</Text>
      <TextInput
        style={styles.input}
        value={form.billingAddressZip}
        onChangeText={(v) => setField("billingAddressZip", v)}
        placeholder={labels.zipLabel}
        placeholderTextColor={colors.inputPlaceholderOnLight}
      />

      <Text style={styles.label}>Kontaktná osoba</Text>
      <TextInput
        style={styles.input}
        value={form.contactName}
        onChangeText={(v) => setField("contactName", v)}
        placeholder="Voliteľné"
        placeholderTextColor={colors.inputPlaceholderOnLight}
      />

      <Text style={styles.label}>Telefón</Text>
      <TextInput
        style={styles.input}
        value={form.phone}
        onChangeText={(v) => setField("phone", v)}
        keyboardType="phone-pad"
        placeholder="Voliteľné"
        placeholderTextColor={colors.inputPlaceholderOnLight}
      />

      <Text style={styles.label}>Počet používateľov / licencií *</Text>
      <TextInput
        style={styles.input}
        value={form.requestedSeats}
        onChangeText={(v) => setField("requestedSeats", v.replace(/[^\d]/g, ""))}
        keyboardType="number-pad"
        placeholder="Napr. 5"
        placeholderTextColor={colors.inputPlaceholderOnLight}
      />

      <TouchableOpacity style={styles.submitButton} onPress={onSubmit} disabled={submitting}>
        {submitting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.submitButtonText}>Vytvoriť firemný účet</Text>
        )}
      </TouchableOpacity>

      <Modal transparent visible={countryModalVisible} animationType="fade" onRequestClose={() => setCountryModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Vyberte krajinu firmy</Text>
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
                    {option.label} ({option.code})
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={styles.modalCancelButton} onPress={() => setCountryModalVisible(false)}>
              <Text style={styles.modalCancelText}>Zavrieť</Text>
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

