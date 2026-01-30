import { collection, doc, getDoc, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { paths } from '../lib/firestorePaths';
import type { CatalogTemplate, CatalogPhase, CatalogTask } from '../lib/types';

/**
 * Get a catalog template by ID
 */
export async function getTemplate(templateId: string): Promise<CatalogTemplate | null> {
  const templateDoc = await getDoc(doc(db, paths.catalogTemplate(templateId)));
  if (!templateDoc.exists()) {
    return null;
  }
  return {
    id: templateDoc.id,
    ...templateDoc.data(),
  } as CatalogTemplate;
}

/**
 * Get all phases for a template, ordered by order field
 */
export async function getTemplatePhases(templateId: string): Promise<CatalogPhase[]> {
  const phasesRef = collection(db, paths.catalogPhases(templateId));
  const q = query(phasesRef, orderBy('order', 'asc'));
  const snapshot = await getDocs(q);
  
  return snapshot.docs.map(doc => {
    const data = doc.data();
    // Map phaseName -> name (Firestore uses phaseName, but CatalogPhase expects name)
    return {
      id: doc.id,
      name: data.phaseName || data.name || '', // Support both phaseName and name
      order: data.order ?? 0,
      description: data.description || data.phaseDescription || undefined,
    };
  }) as CatalogPhase[];
}

/**
 * Get all tasks for a template, ordered by order field
 */
export async function getTemplateTasks(templateId: string): Promise<CatalogTask[]> {
  const tasksRef = collection(db, paths.catalogTasks(templateId));
  const q = query(tasksRef, orderBy('order', 'asc'));
  const snapshot = await getDocs(q);
  
  return snapshot.docs.map(doc => {
    const data = doc.data();
    // Map taskTitle -> title (Firestore uses taskTitle, but CatalogTask expects title)
    return {
      id: doc.id,
      phaseId: data.phaseId || '',
      title: data.taskTitle || data.title || '', // Support both taskTitle and title
      description: data.description || data.taskDescription || undefined,
      order: data.order ?? 0,
      required: data.required ?? false,
    };
  }) as CatalogTask[];
}

/**
 * Get templates filtered by project type
 */
export async function getTemplatesByType(projectType: string): Promise<CatalogTemplate[]> {
  // Note: This requires a composite index if filtering by projectType
  // For now, we'll fetch all and filter client-side, or you can add the index
  const templatesRef = collection(db, 'catalogTemplates');
  const snapshot = await getDocs(templatesRef);
  
  return snapshot.docs
    .map(doc => ({
      id: doc.id,
      ...doc.data(),
    }))
    .filter(template => template.projectType === projectType) as CatalogTemplate[];
}
