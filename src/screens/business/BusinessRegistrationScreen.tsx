import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

  const normalizedCountry = useMemo(() => form.countryCode.trim().toUpperCase(), [form.countryCode]);
  const isSkCz = normalizedCountry === "SK" || normalizedCountry === "CZ";

  const setField = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

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
      return { ok: false, field: "billingAddress.zip", message: "PSČ fakturačnej adresy je povinné." };
    }
    if (isSkCz && !form.registrationNumber.trim()) {
      return {
        ok: false,
        field: "companyIdentifiers.registrationNumber",
        message: "IČO/registration number je pre SK/CZ povinné.",
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
    const validation = validate();
    if (!validation.ok) {
      console.warn("[BusinessRegistration] validation failed", {
        field: validation.field,
        message: validation.message,
      });
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
      <Text style={styles.subtitle}>Vyplňte údaje pre Staveto Business</Text>

      <Text style={styles.label}>Názov firmy *</Text>
      <TextInput style={styles.input} value={form.companyName} onChangeText={(v) => setField("companyName", v)} />

      <Text style={styles.label}>Právny názov *</Text>
      <TextInput style={styles.input} value={form.legalName} onChangeText={(v) => setField("legalName", v)} />

      <Text style={styles.label}>Krajina (ISO kód) *</Text>
      <TextInput
        style={styles.input}
        value={form.countryCode}
        onChangeText={(v) => setField("countryCode", v.toUpperCase())}
        autoCapitalize="characters"
      />

      <Text style={styles.label}>IČO / Registration number {isSkCz ? "*" : ""}</Text>
      <TextInput
        style={styles.input}
        value={form.registrationNumber}
        onChangeText={(v) => setField("registrationNumber", v)}
      />

      <Text style={styles.label}>DIČ / Tax ID</Text>
      <TextInput style={styles.input} value={form.taxId} onChangeText={(v) => setField("taxId", v)} />

      <Text style={styles.label}>IČ DPH / VAT ID</Text>
      <TextInput style={styles.input} value={form.vatId} onChangeText={(v) => setField("vatId", v)} />

      <Text style={styles.label}>Fakturačný e-mail *</Text>
      <TextInput
        style={styles.input}
        value={form.billingEmail}
        onChangeText={(v) => setField("billingEmail", v)}
        autoCapitalize="none"
        keyboardType="email-address"
      />

      <Text style={styles.label}>Fakturačná adresa - ulica *</Text>
      <TextInput
        style={styles.input}
        value={form.billingAddressLine1}
        onChangeText={(v) => setField("billingAddressLine1", v)}
      />

      <Text style={styles.label}>Fakturačná adresa - mesto *</Text>
      <TextInput
        style={styles.input}
        value={form.billingAddressCity}
        onChangeText={(v) => setField("billingAddressCity", v)}
      />

      <Text style={styles.label}>Fakturačná adresa - PSČ *</Text>
      <TextInput
        style={styles.input}
        value={form.billingAddressZip}
        onChangeText={(v) => setField("billingAddressZip", v)}
      />

      <Text style={styles.label}>Kontaktná osoba</Text>
      <TextInput style={styles.input} value={form.contactName} onChangeText={(v) => setField("contactName", v)} />

      <Text style={styles.label}>Telefón</Text>
      <TextInput
        style={styles.input}
        value={form.phone}
        onChangeText={(v) => setField("phone", v)}
        keyboardType="phone-pad"
      />

      <Text style={styles.label}>Počet licencií *</Text>
      <TextInput
        style={styles.input}
        value={form.requestedSeats}
        onChangeText={(v) => setField("requestedSeats", v.replace(/[^\d]/g, ""))}
        keyboardType="number-pad"
      />

      <TouchableOpacity style={styles.submitButton} onPress={onSubmit} disabled={submitting}>
        {submitting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.submitButtonText}>Vytvoriť firemný účet</Text>
        )}
      </TouchableOpacity>
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
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    backgroundColor: colors.card,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  submitButton: {
    marginTop: spacing.lg,
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
});

