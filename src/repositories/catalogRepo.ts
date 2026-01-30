import { collection, doc, getDoc, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../firebase";
import { paths } from "../lib/firestorePaths";

export type CatalogPhase = {
  id: string;
  name: string;
  description: string;
  order: number;
};

export type CatalogTask = {
  id: string;
  phaseId: string;
  order: number;
  title: string;
  trade: string;
  priority: string;
  required: boolean;
  defaultStatus: string;
};

export type CatalogTemplate = {
  id: string;
  name: string;
  projectType: string;
};

export async function getTemplate(templateId: string): Promise<CatalogTemplate | null> {
  const ref = doc(db, paths.catalogTemplate(templateId));
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    id: snap.id,
    name: (d.name as string) ?? "",
    projectType: (d.projectType as string) ?? "BUILD",
  };
}

export async function getTemplatePhases(templateId: string): Promise<CatalogPhase[]> {
  const c = collection(db, paths.catalogPhases(templateId));
  const q = query(c, orderBy("order", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      name: (x.name as string) ?? "",
      description: (x.description as string) ?? "",
      order: (x.order as number) ?? 0,
    };
  });
}

export async function getTemplateTasks(templateId: string): Promise<CatalogTask[]> {
  const c = collection(db, paths.catalogTasks(templateId));
  const q = query(c, orderBy("order", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const x = d.data();
    const req = x.required;
    return {
      id: d.id,
      phaseId: (x.phaseId as string) ?? "",
      order: (x.order as number) ?? 0,
      title: (x.title as string) ?? "",
      trade: (x.trade as string) ?? "",
      priority: (x.priority as string) ?? "",
      required: typeof req === "boolean" ? req : String(req).toUpperCase() === "TRUE",
      defaultStatus: (x.defaultStatus as string) ?? "OPEN",
    };
  });
}
