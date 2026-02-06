import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Modal,
  TextInput,
  TouchableOpacity,
  Alert,
  RefreshControl,
  ScrollView,
} from "react-native";
import { useFocusEffect, useRoute, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import * as projectsService from "../services/projects";
import * as projectFactory from "../services/projectFactory";
import * as templateService from "../services/templateService";
import type { PhaseCustomization, PhaseStatus } from "../services/projectFactory";
import type { CatalogPhase } from "../lib/types";
import type { ProjectDoc } from "../services/projects";
import { colors, radius, spacing } from "../theme";
import { openInMaps } from "../lib/maps";

type Project = ProjectDoc;

function showError(msg: string) {
  Alert.alert("", msg);
}

type ProjectCreationType = NonNullable<ProjectDoc["projectType"]>;

export function ProjectsScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { t } = useI18n();
  const { orgId } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newStep, setNewStep] = useState<1 | 2 | 3>(1);
  const [selectedType, setSelectedType] = useState<ProjectCreationType | null>(null);
  const [useTemplate, setUseTemplate] = useState<boolean | null>(null); // null = not chosen, true = with template, false = from scratch
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [templatePhases, setTemplatePhases] = useState<CatalogPhase[]>([]);
  const [phaseCustomizations, setPhaseCustomizations] = useState<Map<string, PhaseCustomization>>(new Map());
  const [loadingPhases, setLoadingPhases] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [editName, setEditName] = useState("");
  const [menuProject, setMenuProject] = useState<Project | null>(null);
  const [showMenu, setShowMenu] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    // Guard: orgId must be defined and not empty
    if (!orgId || orgId.trim() === '') {
      console.warn('[ProjectsScreen] load() called with invalid orgId:', orgId);
      setLoading(false);
      setRefreshing(false);
      setProjects([]);
      return;
    }
    
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    
    try {
      console.log('[ProjectsScreen] Loading projects for orgId:', orgId);
      const list = await projectsService.listAllMyProjects(orgId);
      console.log('[ProjectsScreen] Loaded', list.length, 'projects');
      setProjects(list);
    } catch (e: unknown) {
      console.error('[ProjectsScreen] Error loading projects:', e);
      setProjects([]);
      const msg = (e as { code?: string; message?: string }).code === "permission-denied"
        ? "Nemáte oprávnenie na čítanie projektov."
        : (e instanceof Error ? e.message : "Sieťová chyba.");
      showError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [orgId]);

  const onRefresh = useCallback(() => {
    load(true);
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      if ((route.params as { openNew?: boolean })?.openNew) {
        setShowNew(true);
        setNewStep(1);
        setSelectedType(null);
        setNewName("");
        setError(null);
        (navigation as { setParams?: (params: Record<string, unknown>) => void }).setParams?.({ openNew: false });
      }
    }, [navigation, route.params])
  );

  const closeNewModal = () => {
    setShowNew(false);
    setNewStep(1);
    setSelectedType(null);
    setUseTemplate(null);
    setNewName("");
    setNewAddress("");
    setTemplateId("");
    setTemplatePhases([]);
    setPhaseCustomizations(new Map());
    setError(null);
  };

  const onNext = async () => {
    if (newStep === 1) {
      // Krok 1 → Krok 2: Kontrola typu a výber šablóny (len pre MANAGEMENT)
      if (!selectedType) {
        setError('Vyberte typ projektu');
        return;
      }

      // Pre MANAGEMENT projekty: spýtať sa na výber medzi šablónou a "od nuly"
      if (selectedType === 'MANAGEMENT') {
        if (useTemplate === null) {
          setError('Vyberte, či chcete použiť šablónu Staveto alebo vytvoriť projekt od nuly');
          return;
        }
        
        if (useTemplate) {
          // Použiť šablónu
          const determinedTemplateId = 'eu-construction-v1';
          setTemplateId(determinedTemplateId);
          
          // Load template phases
          setLoadingPhases(true);
          setError(null);
          try {
            const phases = await templateService.getTemplatePhases(determinedTemplateId);
            setTemplatePhases(phases);
            
            // Initialize all phases as enabled with 'active' status
            const customizations = new Map<string, PhaseCustomization>();
            phases.forEach(phase => {
              customizations.set(phase.id, {
                phaseId: phase.id,
                enabled: true,
                status: 'active',
              });
            });
            setPhaseCustomizations(customizations);
          } catch (e: any) {
            console.error('[ProjectsScreen] Error loading template phases:', e);
            setError(`Chyba pri načítaní šablóny: ${e.message || 'Neznáma chyba'}`);
            setLoadingPhases(false);
            return;
          } finally {
            setLoadingPhases(false);
          }
        } else {
          // Vytvoriť od nuly - bez šablóny
          setTemplateId("");
          setTemplatePhases([]);
          setPhaseCustomizations(new Map());
        }
      } else if (selectedType === 'BUILD') {
        // BUILD projekty vždy používajú šablónu
        const determinedTemplateId = 'eu-construction-v1';
        setTemplateId(determinedTemplateId);
        
        // Load template phases
        setLoadingPhases(true);
        setError(null);
        try {
          const phases = await templateService.getTemplatePhases(determinedTemplateId);
          setTemplatePhases(phases);
          
          // Initialize all phases as enabled with 'active' status
          const customizations = new Map<string, PhaseCustomization>();
          phases.forEach(phase => {
            customizations.set(phase.id, {
              phaseId: phase.id,
              enabled: true,
              status: 'active',
            });
          });
          setPhaseCustomizations(customizations);
        } catch (e: any) {
          console.error('[ProjectsScreen] Error loading template phases:', e);
          setError(`Chyba pri načítaní šablóny: ${e.message || 'Neznáma chyba'}`);
          setLoadingPhases(false);
          return;
        } finally {
          setLoadingPhases(false);
        }
      } else {
        // RESIDENTIAL, TRADE, MAINTENANCE - bez šablóny
        setTemplateId("");
        setTemplatePhases([]);
        setPhaseCustomizations(new Map());
      }

      setError(null);
      setNewStep(2);
    } else if (newStep === 2) {
      // Krok 2 → Krok 3: Validácia názvu a fáz
      if (!newName.trim()) {
        setError('Zadajte názov projektu');
        return;
      }

      // If template exists (only for MANAGEMENT/BUILD), validate phase customizations
      if (templateId && (selectedType === 'MANAGEMENT' || selectedType === 'BUILD') && phaseCustomizations.size > 0) {
        const enabledPhases = Array.from(phaseCustomizations.values()).filter(c => c.enabled);
        if (enabledPhases.length === 0) {
          setError('Vyberte aspoň jednu fázu');
          return;
        }
      }

      setError(null);
      setNewStep(3);
    }
  };

  const onBack = () => {
    if (newStep === 2) {
      setNewStep(1);
      setError(null);
    } else if (newStep === 3) {
      setNewStep(2);
      setError(null);
    } else {
      closeNewModal();
    }
  };

  const onCreate = async () => {
    // Validácia
    if (!orgId) {
      const errorMsg = 'Nie ste prihlásený. Prosím prihláste sa.';
      setError(errorMsg);
      showError(errorMsg);
      return;
    }
    
    if (!selectedType) {
      const errorMsg = 'Vyberte typ projektu';
      setError(errorMsg);
      return;
    }
    
    if (!newName.trim()) {
      const errorMsg = 'Zadajte názov projektu';
      setError(errorMsg);
      return;
    }

    // If template exists (only for MANAGEMENT/BUILD), validate phase customizations
    if (templateId && (selectedType === 'MANAGEMENT' || selectedType === 'BUILD') && phaseCustomizations.size > 0) {
      const enabledPhases = Array.from(phaseCustomizations.values()).filter(c => c.enabled);
      if (enabledPhases.length === 0) {
        setError('Vyberte aspoň jednu fázu');
        return;
      }
    }
    
    setError(null);
    setSubmitting(true);
    
    try {
      console.log(`[ProjectsScreen] Creating project: type="${selectedType}", name="${newName.trim()}", templateId="${templateId}"`);
      
      // Prepare phase customizations array
      const customizationsArray = templateId && phaseCustomizations.size > 0
        ? Array.from(phaseCustomizations.values())
        : undefined;
      
      console.log(`[ProjectsScreen] Phase customizations:`, customizationsArray);
      
      // Vytvor projekt - ownerId sa automaticky použije z auth.currentUser.uid v projectFactory
      await projectFactory.createProjectFromTemplate({
        projectType: selectedType,
        templateId: templateId,
        name: newName.trim(),
        addressText: newAddress.trim() || undefined,
        phaseCustomizations: customizationsArray,
      });
      
      console.log(`${selectedType} project created successfully`);
      closeNewModal();
      load();
    } catch (e: unknown) {
      console.error('Error creating project:', e);
      const error = e as { code?: string; message?: string };
      const errorCode = error.code;
      const errorMessage = error.message || 'Neznáma chyba';
      
      // Detailed error message with location
      let userMessage = '';
      if (errorCode === "permission-denied") {
        // Parse error message to find where it failed
        if (errorMessage.includes('projects/') && errorMessage.includes('/phases')) {
          userMessage = `❌ Chyba: Nemáte oprávnenie vytvoriť fázy projektu.\n\nKde: projects/{projectId}/phases\nSkontrolujte Firestore rules.`;
        } else if (errorMessage.includes('projects/') && errorMessage.includes('/tasks')) {
          userMessage = `❌ Chyba: Nemáte oprávnenie vytvoriť úlohy projektu.\n\nKde: projects/{projectId}/tasks\nSkontrolujte Firestore rules.`;
        } else if (errorMessage.includes('documents/projects/') || errorMessage.includes('projekt documents')) {
          userMessage = `❌ Chyba: Nemáte oprávnenie vytvoriť projekt.\n\nKde: projects/{projectId}\nSkontrolujte Firestore rules a či ste prihlásený.`;
        } else {
          userMessage = `❌ Chyba: Nemáte oprávnenie vytvoriť projekt.\n\n${errorMessage}\n\nSkontrolujte Firestore rules.`;
        }
      } else if (errorCode === "not-found") {
        userMessage = `⚠️ Template nebol nájdený. Projekt sa vytvorí bez šablóny.\n\n${errorMessage}`;
      } else if (errorMessage.includes('template') || errorMessage.includes('šablón')) {
        userMessage = `⚠️ Chyba pri načítaní šablóny:\n\n${errorMessage}`;
      } else {
        userMessage = `❌ Chyba: ${errorMessage}`;
      }
      
      setError(userMessage);
      showError(userMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const togglePhaseEnabled = (phaseId: string) => {
    const custom = phaseCustomizations.get(phaseId);
    if (custom) {
      const newCustomizations = new Map(phaseCustomizations);
      newCustomizations.set(phaseId, {
        ...custom,
        enabled: !custom.enabled,
      });
      setPhaseCustomizations(newCustomizations);
    }
  };

  const setPhaseStatus = (phaseId: string, status: PhaseStatus) => {
    const custom = phaseCustomizations.get(phaseId);
    if (custom) {
      const newCustomizations = new Map(phaseCustomizations);
      newCustomizations.set(phaseId, {
        ...custom,
        status,
      });
      setPhaseCustomizations(newCustomizations);
    }
  };

  const openProjectMenu = (item: Project) => {
    setMenuProject(item);
    setShowMenu(true);
  };

  const closeProjectMenu = () => {
    setShowMenu(false);
    setMenuProject(null);
  };

  const onMenuEdit = () => {
    if (!menuProject) return;
    setEditProject(menuProject);
    setEditName(menuProject.name || "");
    setShowEdit(true);
    closeProjectMenu();
  };

  const onMenuArchive = async () => {
    if (!menuProject || !orgId) return;
    const isArchived = !!menuProject.archivedAt;
    try {
      if (isArchived) {
        await projectsService.unarchiveProject(orgId, menuProject.id);
      } else {
        await projectsService.archiveProject(orgId, menuProject.id);
      }
      load();
    } catch (e: unknown) {
      const c = (e as { code?: string }).code;
      showError(c === "permission-denied" ? t("projectOverview.noPermission") : (e instanceof Error ? e.message : "Chyba."));
    } finally {
      closeProjectMenu();
    }
  };

  const onMenuDelete = () => {
    if (!menuProject) return;
    Alert.alert(
      t("projects.deleteConfirm"),
      "",
      [
        { text: t("projects.cancel"), style: "cancel" },
        {
          text: t("projects.delete"),
          style: "destructive",
          onPress: async () => {
            if (!orgId) return;
            try {
              await projectsService.deleteProject(orgId, menuProject.id);
              load();
            } catch (e: unknown) {
              const c = (e as { code?: string }).code;
              showError(c === "permission-denied" ? t("projectOverview.noPermission") : (e instanceof Error ? e.message : "Chyba."));
            }
          },
        },
      ]
    );
    closeProjectMenu();
  };

  const onSaveEdit = async () => {
    if (!orgId || !editProject || !editName.trim()) return;
    setSubmitting(true);
    try {
      await projectsService.updateProject(orgId, editProject.id, editName.trim());
      setShowEdit(false);
      setEditProject(null);
      setEditName("");
      load();
    } catch (e: unknown) {
      const c = (e as { code?: string }).code;
      showError(c === "permission-denied" ? "Nemáte oprávnenie." : (e instanceof Error ? e.message : "Chyba."));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const activeProjects = projects.filter((p) => !p.archivedAt);
  const archivedProjects = projects.filter((p) => !!p.archivedAt);

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.fab} onPress={() => setShowNew(true)}>
        <Text style={styles.fabText}>+ {t("projects.fab")}</Text>
      </TouchableOpacity>
      {!activeProjects.length && !archivedProjects.length && !loading ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>{t("projects.empty")}</Text>
          <TouchableOpacity 
            style={styles.refreshButton}
            onPress={onRefresh}
            disabled={refreshing}
          >
            <Text style={styles.refreshButtonText}>
              {refreshing ? "Obnovujem..." : "Obnoviť"}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={activeProjects}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          renderItem={({ item }) => {
            // Determine project category for display
            const projectType = item.projectType;
            const categoryLabel = projectType === "RESIDENTIAL" 
              ? t("projectType.RESIDENTIAL") 
              : projectType === "TRADE"
              ? t("projectType.TRADE")
              : t("projectType.MANAGEMENT"); // MANAGEMENT or undefined = Vedenie výstavby
            
            return (
              <TouchableOpacity
                style={styles.card}
                onPress={() => {
                  // Navigate to ProjectOverview screen
                  (navigation as any).navigate('ProjectOverview', {
                    projectId: item.id,
                    projectName: item.name || t("projects.noName"),
                  });
                }}
                activeOpacity={0.7}
              >
                <View style={styles.cardContent}>
                  <View style={styles.cardMain}>
                    <Text style={styles.name} numberOfLines={1}>{item.name || t("projects.noName")}</Text>
                    <Text style={styles.category} numberOfLines={1}>{categoryLabel}</Text>
                  </View>
                  <View style={styles.cardActions}>
                    {item.addressText && (
                      <TouchableOpacity
                        style={styles.cardMapButton}
                        onPress={(e) => {
                          e.stopPropagation(); // Prevent card click
                          openInMaps(item.addressText!);
                        }}
                        accessibilityLabel="Otvoriť v mapách"
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="location" size={18} color={colors.primary} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={styles.cardMenu}
                      onPress={(e) => {
                        e.stopPropagation(); // Prevent card click when menu is clicked
                        openProjectMenu(item);
                      }}
                      accessibilityLabel={t("projects.edit")}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    >
                      <Text style={styles.cardMenuText}>⋯</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            archivedProjects.length ? (
              <View style={styles.centered}>
                <Text style={styles.emptyText}>{t("projects.noActive")}</Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            archivedProjects.length ? (
              <View style={styles.archivedSection}>
                <Text style={styles.archivedTitle}>{t("projects.archiveSection")}</Text>
                {archivedProjects.map((item) => {
                  const projectType = item.projectType;
                  const categoryLabel = projectType === "RESIDENTIAL" 
                    ? t("projectType.RESIDENTIAL") 
                    : projectType === "TRADE"
                    ? t("projectType.TRADE")
                    : t("projectType.MANAGEMENT");
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.card, styles.archivedCard]}
                      onPress={() => {
                        (navigation as any).navigate('ProjectOverview', {
                          projectId: item.id,
                          projectName: item.name || t("projects.noName"),
                        });
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={styles.cardContent}>
                        <View style={styles.cardMain}>
                          <Text style={[styles.name, styles.archivedText]} numberOfLines={1}>{item.name || t("projects.noName")}</Text>
                          <Text style={[styles.category, styles.archivedText]} numberOfLines={1}>{categoryLabel}</Text>
                        </View>
                        <View style={styles.cardActions}>
                          {item.addressText && (
                            <TouchableOpacity
                              style={styles.cardMapButton}
                              onPress={(e) => {
                                e.stopPropagation();
                                openInMaps(item.addressText!);
                              }}
                              accessibilityLabel="Otvoriť v mapách"
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                              <Ionicons name="location" size={18} color={colors.textMuted} />
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity
                            style={styles.cardMenu}
                            onPress={(e) => {
                              e.stopPropagation();
                              openProjectMenu(item);
                            }}
                            accessibilityLabel={t("projects.edit")}
                            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                          >
                            <Text style={[styles.cardMenuText, styles.archivedText]}>⋯</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null
          }
        />
      )}
      <Modal visible={showMenu} transparent animationType="fade">
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={closeProjectMenu}>
          <View style={styles.menuCard}>
            <Text style={styles.menuTitle}>{menuProject?.name || t("projects.noName")}</Text>
            <TouchableOpacity style={styles.menuItem} onPress={closeProjectMenu}>
              <Text style={styles.menuText}>{t("projects.cancel")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={onMenuEdit}>
              <Text style={styles.menuText}>{t("projects.edit")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={onMenuArchive}>
              <Text style={styles.menuText}>
                {menuProject?.archivedAt ? t("projects.unarchive") : t("projects.archive")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={onMenuDelete}>
              <Text style={styles.menuTextDanger}>{t("projects.delete")}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
      <Modal visible={showNew} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{t("projects.modalTitle")}</Text>
            
            <ScrollView 
              style={styles.modalContent} 
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
            >
            {newStep === 1 ? (
              <>
                {/* Krok 1: Základ - Typ projektu */}
                <Text style={styles.modalLabel}>{t("projects.selectType")}</Text>
                <View style={styles.typeColumn}>
                  <TouchableOpacity
                    style={[styles.typeCard, selectedType === "MANAGEMENT" && styles.typeCardActive]}
                    onPress={() => {
                      setSelectedType("MANAGEMENT");
                      setUseTemplate(null);
                      setError(null);
                    }}
                  >
                    <View style={styles.typeIconContainer}>
                      <Text style={styles.typeEmoji}>🏗️</Text>
                    </View>
                    <Text style={[styles.typeCardText, selectedType === "MANAGEMENT" && styles.typeCardTextActive]}>
                      {t("projectType.MANAGEMENT")}
                    </Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={[styles.typeCard, selectedType === "RESIDENTIAL" && styles.typeCardActive]}
                    onPress={() => {
                      setSelectedType("RESIDENTIAL");
                      setError(null);
                    }}
                  >
                    <View style={styles.typeIconContainer}>
                      <Text style={styles.typeEmoji}>🏠</Text>
                    </View>
                    <Text style={[styles.typeCardText, selectedType === "RESIDENTIAL" && styles.typeCardTextActive]}>
                      {t("projectType.RESIDENTIAL")}
                    </Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={[styles.typeCard, selectedType === "TRADE" && styles.typeCardActive]}
                    onPress={() => {
                      setSelectedType("TRADE");
                      setUseTemplate(null);
                      setError(null);
                    }}
                  >
                    <View style={styles.typeIconContainer}>
                      <Text style={styles.typeEmoji}>🛠️</Text>
                    </View>
                    <Text style={[styles.typeCardText, selectedType === "TRADE" && styles.typeCardTextActive]}>
                      {t("projectType.TRADE")}
                    </Text>
                  </TouchableOpacity>

                  {selectedType === "BUILD" && (
                    <View style={styles.templateInfo}>
                      <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
                      <Text style={styles.templateInfoText}>Šablóna: eu-construction-v1</Text>
                    </View>
                  )}
                </View>
                
                {/* Výber medzi šablónou a "od nuly" - len pre MANAGEMENT */}
                {selectedType === "MANAGEMENT" && (
                  <>
                    <Text style={[styles.modalLabel, { marginTop: spacing.lg }]}>Ako chcete vytvoriť projekt?</Text>
                    {__DEV__ && console.log('[ProjectsScreen] Rendering template choice for MANAGEMENT, useTemplate:', useTemplate)}
                    <View style={styles.templateChoiceRow}>
                      <TouchableOpacity
                        style={[
                          styles.templateChoiceCard,
                          useTemplate === true && styles.templateChoiceCardActive
                        ]}
                        onPress={() => {
                          setUseTemplate(true);
                          setError(null);
                        }}
                      >
                        <Ionicons 
                          name="document-text-outline" 
                          size={24} 
                          color={useTemplate === true ? colors.primary : colors.textMuted} 
                        />
                        <Text style={[
                          styles.templateChoiceText,
                          useTemplate === true && styles.templateChoiceTextActive
                        ]}>
                          So šablónou Staveto
                        </Text>
                        <Text style={styles.templateChoiceSubtext}>
                          Použije sa šablóna s fázami a úlohami
                        </Text>
                      </TouchableOpacity>
                      
                      <TouchableOpacity
                        style={[
                          styles.templateChoiceCard,
                          useTemplate === false && styles.templateChoiceCardActive
                        ]}
                        onPress={() => {
                          setUseTemplate(false);
                          setError(null);
                        }}
                      >
                        <Ionicons 
                          name="create-outline" 
                          size={24} 
                          color={useTemplate === false ? colors.primary : colors.textMuted} 
                        />
                        <Text style={[
                          styles.templateChoiceText,
                          useTemplate === false && styles.templateChoiceTextActive
                        ]}>
                          Od nuly
                        </Text>
                        <Text style={styles.templateChoiceSubtext}>
                          Vytvoríte si vlastné fázy a úlohy
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
                
                {/* Error message */}
                {error && (
                  <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}
              </>
            ) : newStep === 2 ? (
              <>
                {/* Krok 2: Názov projektu + Adresa + Prispôsobiť šablónu (len pre MANAGEMENT/BUILD) */}
                <Text style={styles.modalLabel}>Názov projektu *</Text>
                <TextInput
                  style={styles.inputWhite}
                  value={newName}
                  onChangeText={(text) => {
                    setNewName(text);
                    setError(null);
                  }}
                  placeholder={t("projects.namePlaceholder")}
                  placeholderTextColor="rgba(255, 255, 255, 0.7)"
                  editable={!submitting && !loadingPhases}
                  autoFocus={true}
                />

                <Text style={[styles.modalLabel, { marginTop: spacing.md }]}>Adresa projektu</Text>
                <TextInput
                  style={styles.inputWhite}
                  value={newAddress}
                  onChangeText={(text) => {
                    setNewAddress(text);
                    setError(null);
                  }}
                  placeholder="Napríklad: Bratislava, Slovensko"
                  placeholderTextColor="rgba(255, 255, 255, 0.7)"
                  editable={!submitting && !loadingPhases}
                />

                {loadingPhases ? (
                  <View style={{ marginTop: spacing.lg, alignItems: 'center' }}>
                    <ActivityIndicator color={colors.primary} size="large" />
                    <Text style={[styles.modalLabel, { marginTop: spacing.md }]}>Načítavam šablónu...</Text>
                  </View>
                ) : templateId && (selectedType === 'MANAGEMENT' || selectedType === 'BUILD') && (
                  <>
                    <Text style={[styles.modalLabel, { marginTop: spacing.lg }]}>Prispôsobiť šablónu</Text>
                    {templatePhases.length > 0 ? (
                      <ScrollView style={styles.phasesList} nestedScrollEnabled>
                        {templatePhases.map((phase) => {
                          const custom = phaseCustomizations.get(phase.id);
                          const enabled = custom?.enabled ?? true;
                          const status = custom?.status ?? 'active';
                          
                          return (
                            <View key={phase.id} style={styles.phaseCustomizationRow}>
                              <TouchableOpacity
                                style={styles.phaseCheckbox}
                                onPress={() => togglePhaseEnabled(phase.id)}
                              >
                                <Ionicons
                                  name={enabled ? "checkbox" : "square-outline"}
                                  size={24}
                                  color={enabled ? colors.primary : colors.textMuted}
                                />
                                <Text style={[styles.phaseName, !enabled && styles.phaseNameDisabled]}>
                                  {phase.name || `FÁZA ${phase.order + 1}`}
                                </Text>
                              </TouchableOpacity>
                              
                              {enabled && (
                                <View style={styles.phaseStatusRow}>
                                  <TouchableOpacity
                                    style={[styles.statusButton, status === 'completed' && styles.statusButtonActive]}
                                    onPress={() => setPhaseStatus(phase.id, 'completed')}
                                  >
                                    <Text style={[styles.statusButtonText, status === 'completed' && styles.statusButtonTextActive]}>
                                      Dokončená
                                    </Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={[styles.statusButton, status === 'active' && styles.statusButtonActive]}
                                    onPress={() => setPhaseStatus(phase.id, 'active')}
                                  >
                                    <Text style={[styles.statusButtonText, status === 'active' && styles.statusButtonTextActive]}>
                                      Aktívna
                                    </Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={[styles.statusButton, status === 'later' && styles.statusButtonActive]}
                                    onPress={() => setPhaseStatus(phase.id, 'later')}
                                  >
                                    <Text style={[styles.statusButtonText, status === 'later' && styles.statusButtonTextActive]}>
                                      Neskôr
                                    </Text>
                                  </TouchableOpacity>
                                </View>
                              )}
                            </View>
                          );
                        })}
                      </ScrollView>
                    ) : (
                      <Text style={styles.emptyText}>Šablóna neobsahuje žiadne fázy</Text>
                    )}
                  </>
                )}
                
                {/* Error message */}
                {error && (
                  <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}
              </>
            ) : (
              <>
                {/* Krok 3: Zhrnutie a vytvorenie */}
                <Text style={styles.modalLabel}>Zhrnutie</Text>
                <View style={styles.summaryContainer}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Názov:</Text>
                    <Text style={styles.summaryValue}>{newName}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Typ:</Text>
                    <Text style={styles.summaryValue}>
                      {selectedType === "MANAGEMENT" ? t("projectType.MANAGEMENT") :
                       selectedType === "RESIDENTIAL" ? t("projectType.RESIDENTIAL") :
                       selectedType === "TRADE" ? t("projectType.TRADE") : selectedType}
                    </Text>
                  </View>
                  {newAddress.trim() && (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Adresa:</Text>
                      <Text style={styles.summaryValue}>{newAddress.trim()}</Text>
                    </View>
                  )}
                  {selectedType === 'MANAGEMENT' && (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Spôsob vytvorenia:</Text>
                      <Text style={styles.summaryValue}>
                        {useTemplate ? "So šablónou Staveto" : "Od nuly"}
                      </Text>
                    </View>
                  )}
                  {templateId && (selectedType === 'MANAGEMENT' || selectedType === 'BUILD') && (
                    <>
                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Šablóna:</Text>
                        <Text style={styles.summaryValue}>{templateId}</Text>
                      </View>
                      {templatePhases.length > 0 && (
                        <View style={styles.summaryRow}>
                          <Text style={styles.summaryLabel}>Fázy:</Text>
                          <Text style={styles.summaryValue}>
                            {Array.from(phaseCustomizations.values()).filter(c => c.enabled).length} z {templatePhases.length}
                          </Text>
                        </View>
                      )}
                    </>
                  )}
                </View>
                
                {/* Error message */}
                {error && (
                  <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}
              </>
            )}
            </ScrollView>
            
            {/* Tlačidlá - vždy viditeľné mimo ScrollView */}
            {newStep === 1 ? (
              <View style={styles.modalButtons}>
                <TouchableOpacity 
                  style={styles.modalCancel} 
                  onPress={closeNewModal}
                >
                  <Text style={styles.modalCancelText}>{t("projects.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modalOk, 
                    (!selectedType || (selectedType === "MANAGEMENT" && useTemplate === null)) && styles.modalOkDisabled
                  ]}
                  onPress={onNext}
                  disabled={!selectedType || (selectedType === "MANAGEMENT" && useTemplate === null)}
                >
                  <Text style={styles.modalOkText}>{t("projects.next")}</Text>
                </TouchableOpacity>
              </View>
            ) : newStep === 2 ? (
              <View style={styles.modalButtons}>
                <TouchableOpacity 
                  style={styles.modalCancel} 
                  onPress={onBack}
                  disabled={submitting || loadingPhases}
                >
                  <Text style={styles.modalCancelText}>{t("projects.back")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalOk, (!newName.trim() || submitting || loadingPhases) && styles.modalOkDisabled]}
                  onPress={onNext}
                  disabled={!newName.trim() || submitting || loadingPhases}
                >
                  <Text style={styles.modalOkText}>{t("projects.next")}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.modalButtons}>
                <TouchableOpacity 
                  style={styles.modalCancel} 
                  onPress={onBack}
                  disabled={submitting}
                >
                  <Text style={styles.modalCancelText}>{t("projects.back")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalOk, submitting && styles.modalOkDisabled]}
                  onPress={onCreate}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.modalOkText}>Vygenerovať projekt</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={showEdit} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{t("projects.editTitle")}</Text>
            <TextInput
              style={styles.input}
              value={editName}
              onChangeText={setEditName}
              placeholder={t("projects.namePlaceholder")}
              placeholderTextColor={colors.textMuted}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => { setShowEdit(false); setEditProject(null); setEditName(""); }}
              >
                <Text style={styles.modalCancelText}>{t("projects.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalOk}
                onPress={onSaveEdit}
                disabled={submitting || !editName.trim()}
              >
                <Text style={styles.modalOkText}>{submitting ? "…" : t("projects.save")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, backgroundColor: colors.background, justifyContent: "center", alignItems: "center" },
  list: { padding: spacing.md, paddingBottom: 60 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  archivedSection: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  archivedTitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    fontWeight: "600",
  },
  archivedCard: {
    opacity: 0.7,
  },
  archivedText: {
    color: colors.textMuted,
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  menuCard: {
    backgroundColor: colors.card,
    paddingVertical: spacing.md,
    borderTopLeftRadius: radius,
    borderTopRightRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  menuItem: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  menuText: {
    fontSize: 15,
    color: colors.text,
  },
  menuTextDanger: {
    fontSize: 15,
    color: "#c00",
    fontWeight: "600",
  },
  cardContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardMain: {
    flex: 1,
  },
  cardActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  cardMapButton: {
    padding: spacing.xs,
  },
  name: { fontSize: 16, fontWeight: "600", color: colors.text, marginBottom: 4 },
  category: { fontSize: 13, color: colors.textMuted },
  cardMenu: { padding: spacing.xs ?? 4 },
  cardMenuText: { fontSize: 18, color: colors.textMuted, fontWeight: "600" },
  emptyText: { fontSize: 16, color: colors.textMuted },
  fab: {
    position: "absolute",
    bottom: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius,
    zIndex: 1,
  },
  fabText: { color: "#fff", fontWeight: "600" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: spacing.lg },
  modal: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: "90%",
    minHeight: 360,
    flexDirection: "column",
  },
  modalContent: { flex: 1, maxHeight: "70%" },
  modalTitle: { fontSize: 18, fontWeight: "600", color: colors.text, marginBottom: spacing.md },
  modalLabel: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.sm },
  typeRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg },
  typeGrid: { 
    flexDirection: "row", 
    flexWrap: "wrap", 
    gap: spacing.sm, 
    marginBottom: spacing.lg,
    justifyContent: "space-between",
  },
  typeColumn: {
    flexDirection: "column",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  typeCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radius,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
    minHeight: 70,
  },
  typeCardActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  typeIcon: {
    fontSize: 32,
    marginRight: spacing.md,
  },
  typeIconContainer: {
    marginRight: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeEmoji: {
    fontSize: 28,
  },
  typeCardText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    flex: 1,
  },
  typeCardTextActive: {
    color: "#fff",
  },
  typeBtn: {
    flex: 1,
    minWidth: "48%",
    paddingVertical: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  typeBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeBtnText: { fontSize: 14, fontWeight: "600", color: colors.text },
  typeBtnTextActive: { color: "#fff" },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.md,
  },
  inputWhite: {
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius,
    padding: spacing.md,
    fontSize: 16,
    color: "#fff",
    marginBottom: spacing.md,
  },
  modalButtons: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.md },
  modalCancel: { padding: spacing.sm },
  modalCancelText: { color: colors.textMuted },
  modalOk: { backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius },
  modalOkDisabled: { backgroundColor: colors.textMuted, opacity: 0.5 },
  modalOkText: { color: "#fff", fontWeight: "600" },
  errorContainer: {
    backgroundColor: "#fee",
    borderWidth: 1,
    borderColor: "#fcc",
    borderRadius: radius,
    padding: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  errorText: {
    color: "#c00",
    fontSize: 14,
  },
  infoText: {
    color: colors.textMuted,
    fontSize: 12,
    fontStyle: "italic",
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  refreshButton: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius,
  },
  refreshButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  templateInfo: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius,
    gap: spacing.xs,
  },
  templateInfoText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  templateChoiceRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  templateChoiceCard: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    minHeight: 120,
    justifyContent: "center",
  },
  templateChoiceCardActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + "10",
  },
  templateChoiceText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  templateChoiceTextActive: {
    color: colors.primary,
  },
  templateChoiceSubtext: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  phasesList: {
    maxHeight: 300,
    marginBottom: spacing.md,
  },
  phaseCustomizationRow: {
    marginBottom: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
  },
  phaseCheckbox: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  phaseName: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    marginLeft: spacing.sm,
  },
  phaseNameDisabled: {
    color: colors.textMuted,
    textDecorationLine: "line-through",
  },
  phaseStatusRow: {
    flexDirection: "row",
    gap: spacing.xs,
    marginLeft: spacing.lg + spacing.sm, // Align with phase name
  },
  statusButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radius / 2,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  statusButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  statusButtonText: {
    fontSize: 12,
    color: colors.text,
    fontWeight: "500",
  },
  statusButtonTextActive: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  summaryContainer: {
    backgroundColor: colors.background,
    borderRadius: radius,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  summaryLabel: {
    fontSize: 14,
    color: colors.textMuted,
    fontWeight: "500",
  },
  summaryValue: {
    fontSize: 14,
    color: colors.text,
    fontWeight: "600",
  },
});
