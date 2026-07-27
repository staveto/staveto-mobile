/**
 * Web-aligned simplified project creation:
 * contact → details → createDraftJob
 * (no archetype / AI / method picker; no quote tab after create)
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "../i18n/I18nContext";
import { useAuth } from "../context/AuthContext";
import { useActiveOrg } from "../hooks/useActiveOrg";
import { spacing } from "../theme";
import type { ProjectDoc } from "../services/projects";
import {
  getActiveProductProjectType,
  isKnownStorageType,
  isLegacyMaintenanceEquipmentHub,
} from "../lib/projectTypeModel";
import { CloneProjectModal } from "./CloneProjectModal";
import { CloneSourcePickerModal } from "./CloneSourcePickerModal";
import { JobSiteLocationField } from "./JobSiteLocationField";
import {
  createDraftJob,
  type InternalProjectHints,
} from "../services/projectCreationService";
import {
  createCustomer,
  getCustomerDisplayName,
  listCustomersForUser,
  projectCustomerFieldsFromDoc,
  projectCustomerFieldsFromNewInput,
  type CreateCustomerInput,
  type CustomerDoc,
  type CustomerType,
  type ProjectCustomerFields,
} from "../services/customers";
import { getLocalizedCountryName } from "../utils/countries";

export type UnifiedProjectCreationVariant = "onboarding" | "inApp";

export type UnifiedProjectCreationSuccess = {
  projectId: string;
  source: "ai" | "manual" | "clone";
  internalProjectType: "BUILD" | "TRADE";
};

type Step = "contact" | "details";
type ContactMode = "existing" | "new" | "none";
type ClonePhase = "idle" | "pick" | "modal";

type Props = {
  variant: UnifiedProjectCreationVariant;
  existingProjects: ProjectDoc[];
  internalHints: InternalProjectHints;
  submitting?: boolean;
  onSuccess: (payload: UnifiedProjectCreationSuccess) => void | Promise<void>;
};

const COUNTRY_OPTIONS = ["SK", "CZ", "AT", "DE", "PL", "HU"] as const;

/** Light form surface (modal) — do not reuse navy `colors.background` / `colors.border`. */
const ui = {
  navy: "#0F2A4D",
  orange: "#E06737",
  surface: "#FFFFFF",
  surfaceMuted: "#F6F8FB",
  border: "#D0D7E2",
  borderStrong: "#94A3B8",
  muted: "#64748B",
  iconBg: "#EEF2F7",
  selectedBg: "#FFF4EE",
  ring: "rgba(224, 103, 55, 0.22)",
} as const;

function filterCloneSources(projects: ProjectDoc[]): ProjectDoc[] {
  return projects.filter((p) => {
    if (!p.projectType || !isKnownStorageType(p.projectType)) return false;
    if (isLegacyMaintenanceEquipmentHub(p)) return false;
    const active = getActiveProductProjectType(p);
    return active === "BUILD" || active === "TRADE";
  });
}

export function UnifiedProjectCreationFlow({
  variant,
  existingProjects,
  internalHints,
  submitting: parentSubmitting,
  onSuccess,
}: Props) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { activeBusinessOrgId } = useActiveOrg();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<Step>("contact");
  const [contactMode, setContactMode] = useState<ContactMode | null>(null);
  const [customers, setCustomers] = useState<CustomerDoc[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDoc | null>(null);

  const [newContactType, setNewContactType] = useState<CustomerType>("person");
  const [newContactName, setNewContactName] = useState("");
  const [newContactPersonName, setNewContactPersonName] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newContactIco, setNewContactIco] = useState("");
  const [newContactTaxId, setNewContactTaxId] = useState("");
  const [newContactAddress, setNewContactAddress] = useState("");
  const [extendedContactOpen, setExtendedContactOpen] = useState(false);

  const [name, setName] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [location, setLocation] = useState("");
  const [countryCode, setCountryCode] = useState<(typeof COUNTRY_OPTIONS)[number]>(() => {
    const hint = internalHints.countryCode?.trim().toUpperCase() ?? "";
    return (COUNTRY_OPTIONS as readonly string[]).includes(hint)
      ? (hint as (typeof COUNTRY_OPTIONS)[number])
      : "SK";
  });

  const [creating, setCreating] = useState(false);
  const [clonePhase, setClonePhase] = useState<ClonePhase>("idle");
  const [cloneSource, setCloneSource] = useState<ProjectDoc | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const cloneSources = useMemo(() => filterCloneSources(existingProjects), [existingProjects]);
  const allowCopy = variant === "inApp" && cloneSources.length > 0;
  const busy = creating || !!parentSubmitting;

  const loadCustomers = useCallback(async () => {
    setCustomersLoading(true);
    try {
      const list = await listCustomersForUser({ orgId: activeBusinessOrgId });
      setCustomers(list);
    } catch {
      setCustomers([]);
    } finally {
      setCustomersLoading(false);
    }
  }, [activeBusinessOrgId]);

  useEffect(() => {
    if (contactMode === "existing") void loadCustomers();
  }, [contactMode, loadCustomers]);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      const hay = [
        c.name,
        c.companyName,
        c.contactPersonName,
        c.email,
        c.phone,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [customers, customerSearch]);

  const contactReady =
    contactMode === "none" ||
    (contactMode === "existing" && !!selectedCustomer) ||
    (contactMode === "new" &&
      newContactType === "person" &&
      !!newContactName.trim()) ||
    (contactMode === "new" &&
      newContactType === "company" &&
      !!newContactName.trim() &&
      !!newContactPersonName.trim());

  const resolveCustomerFields = useCallback(async (): Promise<ProjectCustomerFields> => {
    if (contactMode === "existing" && selectedCustomer) {
      return projectCustomerFieldsFromDoc(selectedCustomer);
    }
    if (contactMode === "new") {
      const input: CreateCustomerInput =
        newContactType === "company"
          ? {
              type: "company",
              name: newContactName.trim(),
              companyName: newContactName.trim(),
              contactPersonName: newContactPersonName.trim(),
              email: newContactEmail.trim() || undefined,
              phone: newContactPhone.trim() || undefined,
              ico: newContactIco.trim() || undefined,
              taxId: newContactTaxId.trim() || undefined,
              address: newContactAddress.trim() || undefined,
              addressText: newContactAddress.trim() || undefined,
            }
          : {
              type: "person",
              name: newContactName.trim(),
              email: newContactEmail.trim() || undefined,
              phone: newContactPhone.trim() || undefined,
              ico: extendedContactOpen ? newContactIco.trim() || undefined : undefined,
              taxId: extendedContactOpen ? newContactTaxId.trim() || undefined : undefined,
              address: extendedContactOpen
                ? newContactAddress.trim() || undefined
                : undefined,
              addressText: extendedContactOpen
                ? newContactAddress.trim() || undefined
                : undefined,
            };
      const customerId = await createCustomer(input, { orgId: activeBusinessOrgId });
      return projectCustomerFieldsFromNewInput(customerId, input);
    }
    return {};
  }, [
    activeBusinessOrgId,
    contactMode,
    extendedContactOpen,
    newContactAddress,
    newContactEmail,
    newContactIco,
    newContactName,
    newContactPersonName,
    newContactPhone,
    newContactTaxId,
    newContactType,
    selectedCustomer,
  ]);

  const goDetails = useCallback(() => {
    if (!contactMode) {
      setFieldError(t("createProject.simplified.validation.customer"));
      return;
    }
    if (!contactReady) {
      setFieldError(t("createProject.simplified.validation.customer"));
      return;
    }
    setFieldError(null);
    setStep("details");
  }, [contactMode, contactReady, t]);

  const handleCreate = useCallback(async () => {
    const jobName = name.trim();
    if (!jobName) {
      setFieldError(t("createProject.simplified.validation.name"));
      return;
    }
    if (!contactMode || !contactReady) {
      setStep("contact");
      setFieldError(t("createProject.simplified.validation.customer"));
      return;
    }
    setCreating(true);
    setFieldError(null);
    try {
      const customer = await resolveCustomerFields();
      const projectId = await createDraftJob({
        name: jobName,
        customerRequest: shortDescription.trim() || undefined,
        addressText: location.trim() || undefined,
        countryCode: countryCode.trim() || undefined,
        customer,
      });
      await onSuccess({
        projectId,
        source: "manual",
        internalProjectType: "TRADE",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? "");
      Alert.alert("", msg || t("onboardingMvp.errorSaveFailed"));
    } finally {
      setCreating(false);
    }
  }, [
    contactMode,
    contactReady,
    countryCode,
    location,
    name,
    onSuccess,
    resolveCustomerFields,
    shortDescription,
    t,
  ]);

  const onCopyTap = useCallback(() => {
    if (!allowCopy) {
      Alert.alert("", t("createProject.simplified.copy.empty"));
      return;
    }
    setClonePhase("pick");
  }, [allowCopy, t]);

  const cloneOwner = !!cloneSource?.ownerId && cloneSource.ownerId === user?.id;

  const renderStepper = () => {
    const steps: Array<{ id: Step; label: string }> = [
      { id: "contact", label: t("createProject.simplified.stepper.contact") },
      { id: "details", label: t("createProject.simplified.stepper.info") },
    ];
    return (
      <View style={styles.stepper} accessibilityRole="text">
        {steps.map((s, index) => {
          const active = step === s.id;
          const done = step === "details" && s.id === "contact";
          return (
            <View key={s.id} style={styles.stepItem}>
              {index > 0 ? (
                <View style={[styles.stepperLine, (done || active) && styles.stepperLineActive]} />
              ) : null}
              <View style={[styles.stepCluster, active && styles.stepClusterActive]}>
                <View
                  style={[
                    styles.stepCircle,
                    (active || done) && styles.stepCircleActive,
                  ]}
                >
                  {done ? (
                    <Ionicons name="checkmark" size={16} color="#fff" />
                  ) : (
                    <Text style={[styles.stepCircleText, (active || done) && styles.stepCircleTextActive]}>
                      {index + 1}
                    </Text>
                  )}
                </View>
                <Text style={[styles.stepLabel, active && styles.stepLabelActive, done && styles.stepLabelDone]}>
                  {s.label}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  const renderContactModeCard = (
    mode: ContactMode,
    icon: keyof typeof Ionicons.glyphMap,
    titleKey: string,
    descKey: string
  ) => {
    const selected = contactMode === mode;
    return (
      <Pressable
        key={mode}
        onPress={() => {
          setContactMode(mode);
          setFieldError(null);
          if (mode !== "existing") setSelectedCustomer(null);
        }}
        disabled={busy}
        style={({ pressed }) => [
          styles.modeCard,
          selected && styles.modeCardSelected,
          pressed && !busy && styles.modeCardPressed,
        ]}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
      >
        <View style={[styles.modeIcon, selected && styles.modeIconSelected]}>
          <Ionicons name={icon} size={22} color={selected ? "#fff" : ui.navy} />
        </View>
        <View style={styles.modeTextCol}>
          <View style={styles.modeTitleRow}>
            <Text style={styles.modeTitle}>{t(titleKey)}</Text>
            {selected ? (
              <View style={styles.checkBadge}>
                <Ionicons name="checkmark" size={14} color="#fff" />
              </View>
            ) : null}
          </View>
          <Text style={styles.modeDesc}>{t(descKey)}</Text>
        </View>
      </Pressable>
    );
  };

  const renderContact = () => (
    <View style={styles.flex}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {renderStepper()}

        <View style={styles.headingRow}>
          <View style={styles.headingTextCol}>
            <Text style={styles.screenTitle}>{t("createProject.simplified.customerTitle")}</Text>
            <Text style={styles.screenSubtitle}>{t("createProject.simplified.customerLead")}</Text>
          </View>
          {variant === "inApp" ? (
            <TouchableOpacity
              style={[styles.copyBtn, !allowCopy && styles.copyBtnDisabled]}
              onPress={onCopyTap}
              disabled={busy || !allowCopy}
              accessibilityRole="button"
              accessibilityLabel={t("createProject.simplified.copySecondary")}
            >
              <Ionicons name="copy-outline" size={18} color={allowCopy ? ui.orange : ui.muted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {renderContactModeCard(
          "existing",
          "people-outline",
          "createProject.simplified.contact.existing",
          "createProject.simplified.contact.existingDesc"
        )}
        {renderContactModeCard(
          "new",
          "person-add-outline",
          "createProject.simplified.contact.new",
          "createProject.simplified.contact.newDesc"
        )}
        {renderContactModeCard(
          "none",
          "person-outline",
          "createProject.simplified.contact.none",
          "createProject.simplified.contact.noneDesc"
        )}

        {contactMode === "none" ? (
          <View style={styles.infoBox}>
            <Text style={styles.infoBoxText}>{t("createProject.simplified.contact.noneInfo")}</Text>
          </View>
        ) : null}

        {contactMode === "existing" ? (
          <View style={styles.sectionBlock}>
            {selectedCustomer ? (
              <View style={styles.selectedCustomerCard}>
                <View style={styles.modeIconSelected}>
                  <Ionicons
                    name={
                      selectedCustomer.type === "company" ? "business-outline" : "person-outline"
                    }
                    size={20}
                    color="#fff"
                  />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.selectedCustomerName} numberOfLines={2}>
                    {getCustomerDisplayName(selectedCustomer) || selectedCustomer.name}
                  </Text>
                  {[selectedCustomer.email, selectedCustomer.phone].filter(Boolean).length > 0 ? (
                    <Text style={styles.selectedCustomerMeta} numberOfLines={1}>
                      {[selectedCustomer.email, selectedCustomer.phone].filter(Boolean).join(" · ")}
                    </Text>
                  ) : null}
                </View>
                <TouchableOpacity
                  onPress={() => {
                    setSelectedCustomer(null);
                    setCustomerSearch("");
                  }}
                  disabled={busy}
                >
                  <Text style={styles.changeLink}>{t("createProject.simplified.changeCustomer")}</Text>
                </TouchableOpacity>
              </View>
            ) : customersLoading ? (
              <ActivityIndicator color={ui.orange} />
            ) : customers.length === 0 ? (
              <Text style={styles.helper}>{t("createProject.simplified.customersEmpty")}</Text>
            ) : (
              <>
                <Text style={styles.fieldLabel}>{t("createProject.simplified.contact.existing")}</Text>
                <TextInput
                  style={styles.input}
                  value={customerSearch}
                  onChangeText={setCustomerSearch}
                  placeholder={t("createProject.simplified.contactSearchPlaceholder")}
                  placeholderTextColor={ui.muted}
                  editable={!busy}
                />
                <View style={styles.searchList}>
                  {filteredCustomers.length === 0 ? (
                    <Text style={styles.helper}>
                      {t("createProject.simplified.customerSearchEmpty")}
                    </Text>
                  ) : (
                    filteredCustomers.slice(0, 12).map((c) => (
                      <TouchableOpacity
                        key={c.id}
                        style={styles.searchItem}
                        onPress={() => {
                          setSelectedCustomer(c);
                          setCustomerSearch(getCustomerDisplayName(c) || c.name);
                          setFieldError(null);
                        }}
                        disabled={busy}
                      >
                        <Text style={styles.searchItemTitle}>
                          {getCustomerDisplayName(c) || c.name}
                        </Text>
                        {c.type === "company" && c.contactPersonName ? (
                          <Text style={styles.searchItemMeta}>{c.contactPersonName}</Text>
                        ) : null}
                      </TouchableOpacity>
                    ))
                  )}
                </View>
              </>
            )}
          </View>
        ) : null}

        {contactMode === "new" ? (
          <View style={styles.sectionBlock}>
            <Text style={styles.fieldLabel}>{t("createProject.simplified.customerTypeLabel")}</Text>
            <View style={styles.pillRow}>
              {(["person", "company"] as const).map((type) => {
                const selected = newContactType === type;
                return (
                  <TouchableOpacity
                    key={type}
                    style={[styles.pill, selected && styles.pillSelected]}
                    onPress={() => setNewContactType(type)}
                    disabled={busy}
                  >
                    <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
                      {t(`createProject.simplified.customerType.${type}`)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {newContactType === "person" ? (
              <>
                <Text style={styles.fieldLabel}>
                  {t("createProject.simplified.customerPersonName")} *
                </Text>
                <TextInput
                  style={styles.input}
                  value={newContactName}
                  onChangeText={setNewContactName}
                  editable={!busy}
                />
              </>
            ) : (
              <>
                <Text style={styles.fieldLabel}>
                  {t("createProject.simplified.customerCompanyName")} *
                </Text>
                <TextInput
                  style={styles.input}
                  value={newContactName}
                  onChangeText={setNewContactName}
                  editable={!busy}
                />
                <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>
                  {t("createProject.simplified.customerContactPerson")} *
                </Text>
                <TextInput
                  style={styles.input}
                  value={newContactPersonName}
                  onChangeText={setNewContactPersonName}
                  editable={!busy}
                />
              </>
            )}

            <View style={styles.twoCol}>
              <View style={styles.col}>
                <Text style={styles.fieldLabel}>{t("createProject.simplified.customerEmail")}</Text>
                <TextInput
                  style={styles.input}
                  value={newContactEmail}
                  onChangeText={setNewContactEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  editable={!busy}
                />
              </View>
              <View style={styles.col}>
                <Text style={styles.fieldLabel}>{t("createProject.simplified.customerPhone")}</Text>
                <TextInput
                  style={styles.input}
                  value={newContactPhone}
                  onChangeText={setNewContactPhone}
                  keyboardType="phone-pad"
                  editable={!busy}
                />
              </View>
            </View>

            {newContactType === "company" || extendedContactOpen ? (
              <>
                <View style={styles.twoCol}>
                  <View style={styles.col}>
                    <Text style={styles.fieldLabel}>{t("createProject.simplified.customerIco")}</Text>
                    <TextInput
                      style={styles.input}
                      value={newContactIco}
                      onChangeText={setNewContactIco}
                      editable={!busy}
                    />
                  </View>
                  <View style={styles.col}>
                    <Text style={styles.fieldLabel}>
                      {t("createProject.simplified.customerTaxId")}
                    </Text>
                    <TextInput
                      style={styles.input}
                      value={newContactTaxId}
                      onChangeText={setNewContactTaxId}
                      editable={!busy}
                    />
                  </View>
                </View>
                <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>
                  {t("createProject.simplified.customerAddress")}
                </Text>
                <TextInput
                  style={styles.input}
                  value={newContactAddress}
                  onChangeText={setNewContactAddress}
                  editable={!busy}
                />
              </>
            ) : (
              <TouchableOpacity
                style={styles.optionalToggle}
                onPress={() => setExtendedContactOpen(true)}
                disabled={busy}
              >
                <Ionicons name="chevron-down" size={16} color={ui.muted} />
                <Text style={styles.optionalToggleText}>
                  {t("createProject.simplified.extendedCustomerFields")}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}

        {fieldError && step === "contact" ? (
          <Text style={styles.errorText} accessibilityRole="alert">
            {fieldError}
          </Text>
        ) : null}
      </ScrollView>

      <View style={[styles.footerRow, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <TouchableOpacity
          style={[styles.btnPrimary, styles.btnPrimaryFull, (!contactReady || busy) && styles.btnDisabled]}
          onPress={goDetails}
          disabled={!contactReady || busy}
        >
          <Text style={styles.btnPrimaryText}>{t("common.continue")}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderDetails = () => (
    <View style={styles.flex}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {renderStepper()}

        <Text style={styles.screenTitle}>{t("createProject.simplified.infoTitle")}</Text>
        <Text style={styles.screenSubtitle}>{t("createProject.simplified.infoLeadNoQuote")}</Text>

        <Text style={styles.fieldLabel}>
          {t("createProject.simplified.nameLabel")}
          <Text style={styles.requiredMark}> *</Text>
        </Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={(v) => {
            setName(v);
            setFieldError(null);
          }}
          placeholder={t("createProject.simplified.namePlaceholder")}
          placeholderTextColor={ui.muted}
          editable={!busy}
        />

        <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>
          {t("createProject.simplified.descriptionLabel")}
        </Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={shortDescription}
          onChangeText={setShortDescription}
          placeholder={t("createProject.simplified.descriptionPlaceholder")}
          placeholderTextColor={ui.muted}
          multiline
          textAlignVertical="top"
          editable={!busy}
        />

        <JobSiteLocationField
          value={location}
          onChange={setLocation}
          countryCode={countryCode}
          placeholder={t("createProject.simplified.locationPlaceholder")}
          editable={!busy}
        />

        <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>
          {t("createProject.simplified.country")}
        </Text>
        <View style={styles.pillRow}>
          {COUNTRY_OPTIONS.map((code) => {
            const selected = countryCode === code;
            return (
              <TouchableOpacity
                key={code}
                style={[styles.pill, selected && styles.pillSelected]}
                onPress={() => setCountryCode(code)}
                disabled={busy}
              >
                <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
                  {getLocalizedCountryName(code, locale) || code}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {fieldError && step === "details" ? (
          <Text style={styles.errorText} accessibilityRole="alert">
            {fieldError}
          </Text>
        ) : null}
      </ScrollView>

      <View style={[styles.footerRow, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <TouchableOpacity
          style={styles.btnGhost}
          onPress={() => setStep("contact")}
          disabled={busy}
        >
          <Text style={styles.btnGhostText}>{t("common.back")}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btnPrimary, styles.btnPrimaryGrow, (!name.trim() || busy) && styles.btnDisabled]}
          onPress={() => void handleCreate()}
          disabled={!name.trim() || busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnPrimaryText}>{t("createProject.simplified.createProject")}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <>
      {step === "contact" ? renderContact() : null}
      {step === "details" ? renderDetails() : null}

      <CloneSourcePickerModal
        visible={clonePhase === "pick"}
        engineType="ALL"
        projects={existingProjects}
        onClose={() => setClonePhase("idle")}
        onPick={(p) => {
          setCloneSource(p);
          setClonePhase("modal");
        }}
      />
      <CloneProjectModal
        visible={clonePhase === "modal" && !!cloneSource}
        onClose={() => {
          setClonePhase("idle");
          setCloneSource(null);
        }}
        sourceProjectId={cloneSource?.id ?? ""}
        sourceProjectName={cloneSource?.name ?? ""}
        sourceProjectType={cloneSource?.projectType}
        sourceJobsTabVisible={cloneSource?.jobsTabVisible}
        sourceCountryCode={cloneSource?.countryCode}
        sourceCity={cloneSource?.city}
        sourceAddressText={cloneSource?.addressText}
        isOwner={cloneOwner}
        onSuccess={async (newId) => {
          const picked = cloneSource;
          setClonePhase("idle");
          setCloneSource(null);
          await onSuccess({
            projectId: newId,
            source: "clone",
            internalProjectType:
              picked && getActiveProductProjectType(picked) === "BUILD" ? "BUILD" : "TRADE",
          });
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.xs, paddingTop: spacing.xs },
  headingRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  headingTextCol: { flex: 1, minWidth: 0 },
  screenTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: ui.navy,
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  screenSubtitle: {
    fontSize: 14,
    color: ui.muted,
    lineHeight: 20,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  stepItem: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
  },
  stepCluster: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
    paddingRight: 4,
    borderRadius: 999,
  },
  stepClusterActive: {
    backgroundColor: "rgba(224, 103, 55, 0.08)",
    paddingLeft: 2,
    paddingRight: 12,
  },
  stepCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  stepCircleActive: {
    backgroundColor: ui.orange,
  },
  stepCircleText: {
    fontSize: 13,
    fontWeight: "800",
    color: ui.muted,
  },
  stepCircleTextActive: { color: "#fff" },
  stepLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#94A3B8",
  },
  stepLabelActive: { color: ui.navy, fontWeight: "700" },
  stepLabelDone: { color: "#334155" },
  stepperLine: {
    width: 18,
    height: 2,
    borderRadius: 1,
    backgroundColor: "#E2E8F0",
    marginHorizontal: 6,
  },
  stepperLineActive: { backgroundColor: "rgba(224, 103, 55, 0.45)" },
  copyBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: ui.border,
    backgroundColor: ui.surface,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  copyBtnDisabled: { opacity: 0.4 },
  modeCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingVertical: 16,
    paddingHorizontal: 14,
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: ui.border,
    backgroundColor: ui.surface,
  },
  modeCardSelected: {
    borderColor: ui.orange,
    backgroundColor: ui.selectedBg,
  },
  modeCardPressed: {
    borderColor: ui.borderStrong,
  },
  modeIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: ui.iconBg,
    alignItems: "center",
    justifyContent: "center",
  },
  modeIconSelected: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: ui.orange,
    alignItems: "center",
    justifyContent: "center",
  },
  modeTextCol: { flex: 1, minWidth: 0, paddingTop: 2 },
  modeTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  modeTitle: { fontSize: 16, fontWeight: "700", color: ui.navy, flexShrink: 1 },
  modeDesc: { fontSize: 13, color: ui.muted, marginTop: 4, lineHeight: 18 },
  checkBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: ui.orange,
    alignItems: "center",
    justifyContent: "center",
  },
  infoBox: {
    backgroundColor: ui.surfaceMuted,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: ui.border,
    padding: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  infoBoxText: { fontSize: 14, color: "#475569", lineHeight: 20 },
  sectionBlock: { marginTop: spacing.md },
  selectedCustomerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: 16,
    backgroundColor: ui.selectedBg,
    borderWidth: 2,
    borderColor: ui.orange,
  },
  selectedCustomerName: { fontSize: 16, fontWeight: "700", color: ui.navy },
  selectedCustomerMeta: { fontSize: 13, color: ui.muted, marginTop: 2 },
  changeLink: { fontSize: 14, fontWeight: "700", color: ui.orange },
  searchList: {
    marginTop: spacing.sm,
    borderWidth: 1.5,
    borderColor: ui.borderStrong,
    borderRadius: 14,
    backgroundColor: ui.surface,
    overflow: "hidden",
  },
  searchItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: ui.border,
    minHeight: 52,
    justifyContent: "center",
  },
  searchItemTitle: { fontSize: 15, fontWeight: "600", color: ui.navy },
  searchItemMeta: { fontSize: 12, color: ui.muted, marginTop: 2 },
  fieldLabel: { fontSize: 15, fontWeight: "700", color: ui.navy, marginBottom: 8 },
  requiredMark: { color: ui.orange, fontWeight: "800" },
  input: {
    backgroundColor: ui.surface,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: ui.borderStrong,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    minHeight: 50,
    fontSize: 16,
    color: ui.navy,
  },
  textArea: { minHeight: 104, paddingTop: 12 },
  helper: { fontSize: 13, color: ui.muted, lineHeight: 18 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: ui.border,
    backgroundColor: ui.surface,
  },
  pillSelected: {
    borderColor: ui.orange,
    backgroundColor: ui.selectedBg,
  },
  pillText: { fontSize: 13, fontWeight: "600", color: ui.navy },
  pillTextSelected: { color: ui.orange },
  twoCol: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  col: { flex: 1, minWidth: 0 },
  optionalToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.md,
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: ui.borderStrong,
    backgroundColor: ui.surface,
  },
  optionalToggleText: { fontSize: 14, fontWeight: "600", color: "#334155" },
  errorText: { marginTop: spacing.md, color: "#B42318", fontSize: 14, fontWeight: "600" },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: "#E8EDF4",
    backgroundColor: ui.surface,
  },
  btnGhost: {
    paddingVertical: 12,
    paddingHorizontal: spacing.sm,
    minHeight: 52,
    justifyContent: "center",
  },
  btnGhostText: { fontSize: 15, fontWeight: "700", color: ui.orange },
  btnPrimary: {
    backgroundColor: ui.orange,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderRadius: 14,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimaryFull: { flex: 1 },
  btnPrimaryGrow: { flex: 1 },
  btnPrimaryText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  btnDisabled: { opacity: 0.4 },
});
