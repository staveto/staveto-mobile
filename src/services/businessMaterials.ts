/**
 * Aggregates project-level materials for Business org overview (read-only).
 * Source of truth remains projects/{projectId}/materials and materialSuggestions.
 */
import { collection, limit, query, where } from "../lib/rnFirestore";
import { getDocsSmart } from "./firestoreSmartRead";
import { db, getAuth } from "../firebase";
import { resolveMaterialCurrency } from "../lib/materialCatalog";
import { listMaterialSuggestions, listProjectMaterials } from "./projectMaterials";

const MAX_ORG_PROJECTS = 100;
const MAX_PARALLEL_PROJECTS = 8;
const TOP_LIST_LIMIT = 10;

export type CurrencyTotal = { currency: string; total: number };

export type BusinessMaterialsOverview = {
  totalsByCurrency: CurrencyTotal[];
  usedItemCount: number;
  suggestedItemCount: number;
  acceptedSuggestionCount: number;
  rejectedSuggestionCount: number;
  projectsWithMaterialsCount: number;
  projectSummaries: Array<{
    projectId: string;
    projectName: string;
    totalsByCurrency: CurrencyTotal[];
    usedItemCount: number;
    suggestedItemCount: number;
  }>;
  categorySummaries: Array<{
    category: string;
    totalsByCurrency: CurrencyTotal[];
    usedItemCount: number;
  }>;
  supplierSummaries: Array<{
    supplierName: string;
    totalsByCurrency: CurrencyTotal[];
    usedItemCount: number;
  }>;
  pendingSuggestedCount: number;
};

function addCurrencyAmount(map: Map<string, number>, currency: string | undefined, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const code = resolveMaterialCurrency({ expenseCurrency: currency });
  map.set(code, (map.get(code) ?? 0) + amount);
}

function mapToCurrencyTotals(map: Map<string, number>): CurrencyTotal[] {
  return [...map.entries()]
    .map(([currency, total]) => ({ currency, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

function sumTotals(groups: CurrencyTotal[]): number {
  return groups.reduce((s, g) => s + g.total, 0);
}

function formatCurrencyTotals(groups: CurrencyTotal[]): string {
  if (groups.length === 0) return "—";
  return groups.map((g) => `${g.total.toFixed(2)} ${g.currency}`).join(" · ");
}

export { formatCurrencyTotals as formatBusinessMaterialCurrencyTotals };

async function listOrganizationProjects(orgId: string): Promise<Array<{ id: string; name: string }>> {
  const uid = getAuth()?.currentUser?.uid;
  if (!uid || !orgId.trim()) return [];

  const q = query(collection(db, "projects"), where("orgId", "==", orgId.trim()), limit(MAX_ORG_PROJECTS));
  const snap = await getDocsSmart(q);
  const out: Array<{ id: string; name: string }> = [];
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    if (data.archivedAt) continue;
    out.push({
      id: d.id,
      name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : d.id,
    });
  }
  return out;
}

export async function getBusinessMaterialsOverview(orgId: string): Promise<BusinessMaterialsOverview> {
  const empty: BusinessMaterialsOverview = {
    totalsByCurrency: [],
    usedItemCount: 0,
    suggestedItemCount: 0,
    acceptedSuggestionCount: 0,
    rejectedSuggestionCount: 0,
    projectsWithMaterialsCount: 0,
    projectSummaries: [],
    categorySummaries: [],
    supplierSummaries: [],
    pendingSuggestedCount: 0,
  };

  if (!orgId.trim()) return empty;

  const projects = await listOrganizationProjects(orgId);
  if (projects.length === 0) return empty;

  const globalTotals = new Map<string, number>();
  const categoryMaps = new Map<string, Map<string, number>>();
  const categoryCounts = new Map<string, number>();
  const supplierMaps = new Map<string, Map<string, number>>();
  const supplierCounts = new Map<string, number>();
  const projectSummaries: BusinessMaterialsOverview["projectSummaries"] = [];

  let usedItemCount = 0;
  let suggestedItemCount = 0;
  let acceptedSuggestionCount = 0;
  let rejectedSuggestionCount = 0;
  let pendingSuggestedCount = 0;
  let projectsWithMaterialsCount = 0;

  for (let i = 0; i < projects.length; i += MAX_PARALLEL_PROJECTS) {
    const chunk = projects.slice(i, i + MAX_PARALLEL_PROJECTS);
    const bundles = await Promise.all(
      chunk.map(async (project) => {
        const [materials, suggestions] = await Promise.all([
          listProjectMaterials(project.id),
          listMaterialSuggestions(project.id),
        ]);
        return { project, materials, suggestions };
      })
    );

    for (const { project, materials, suggestions } of bundles) {
      const planned = suggestions.filter((s) => s.status === "planned");
      suggestedItemCount += planned.length;
      acceptedSuggestionCount += suggestions.filter((s) => s.status === "accepted").length;
      rejectedSuggestionCount += suggestions.filter((s) => s.status === "rejected").length;
      pendingSuggestedCount += planned.length;
      usedItemCount += materials.length;

      if (materials.length === 0 && planned.length === 0) continue;
      projectsWithMaterialsCount += 1;

      const projectCurrencyMap = new Map<string, number>();
      for (const m of materials) {
        const amount =
          m.totalPrice ?? (m.unitPrice != null && Number.isFinite(m.unitPrice) ? m.unitPrice * m.quantity : 0);
        addCurrencyAmount(globalTotals, m.currency, amount);
        addCurrencyAmount(projectCurrencyMap, m.currency, amount);

        const cat = m.category ?? "other_material";
        if (!categoryMaps.has(cat)) categoryMaps.set(cat, new Map());
        addCurrencyAmount(categoryMaps.get(cat)!, m.currency, amount);
        categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);

        const supplier = m.supplierName?.trim();
        if (supplier) {
          if (!supplierMaps.has(supplier)) supplierMaps.set(supplier, new Map());
          addCurrencyAmount(supplierMaps.get(supplier)!, m.currency, amount);
          supplierCounts.set(supplier, (supplierCounts.get(supplier) ?? 0) + 1);
        }
      }

      projectSummaries.push({
        projectId: project.id,
        projectName: project.name,
        totalsByCurrency: mapToCurrencyTotals(projectCurrencyMap),
        usedItemCount: materials.length,
        suggestedItemCount: planned.length,
      });
    }
  }

  projectSummaries.sort((a, b) => sumTotals(b.totalsByCurrency) - sumTotals(a.totalsByCurrency));

  const categorySummaries = [...categoryMaps.entries()]
    .map(([category, map]) => ({
      category,
      totalsByCurrency: mapToCurrencyTotals(map),
      usedItemCount: categoryCounts.get(category) ?? 0,
    }))
    .sort((a, b) => sumTotals(b.totalsByCurrency) - sumTotals(a.totalsByCurrency))
    .slice(0, TOP_LIST_LIMIT);

  const supplierSummaries = [...supplierMaps.entries()]
    .map(([supplierName, map]) => ({
      supplierName,
      totalsByCurrency: mapToCurrencyTotals(map),
      usedItemCount: supplierCounts.get(supplierName) ?? 0,
    }))
    .sort((a, b) => sumTotals(b.totalsByCurrency) - sumTotals(a.totalsByCurrency))
    .slice(0, TOP_LIST_LIMIT);

  return {
    totalsByCurrency: mapToCurrencyTotals(globalTotals),
    usedItemCount,
    suggestedItemCount,
    acceptedSuggestionCount,
    rejectedSuggestionCount,
    projectsWithMaterialsCount,
    projectSummaries: projectSummaries.slice(0, TOP_LIST_LIMIT),
    categorySummaries,
    supplierSummaries,
    pendingSuggestedCount,
  };
}
