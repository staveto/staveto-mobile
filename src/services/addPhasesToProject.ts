/**
 * Utility function to add phases and tasks from a template to an existing project
 * Useful for projects that were created without a template
 */

import { doc, getDoc, writeBatch, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { paths } from '../lib/firestorePaths';
import { getTemplatePhases, getTemplateTasks } from './templateService';

/**
 * Add phases and tasks from a template to an existing project
 */
export async function addPhasesToProject(
  projectId: string,
  templateId: string
): Promise<void> {
  const currentUser = auth.currentUser;
  
  if (!currentUser || !currentUser.uid) {
    throw new Error('Musíte byť prihlásený.');
  }
  
  // Verify project exists and user is owner
  const projectRef = doc(db, paths.project(projectId));
  const projectSnap = await getDoc(projectRef);
  
  if (!projectSnap.exists()) {
    throw new Error(`Projekt ${projectId} neexistuje.`);
  }
  
  const projectData = projectSnap.data();
  if (projectData.ownerId !== currentUser.uid) {
    throw new Error('Nemáte oprávnenie upravovať tento projekt.');
  }
  
  // Load template phases and tasks
  console.log(`[addPhasesToProject] Loading template ${templateId}...`);
  const [phases, tasks] = await Promise.all([
    getTemplatePhases(templateId),
    getTemplateTasks(templateId),
  ]);
  
  console.log(`[addPhasesToProject] Template loaded: ${phases.length} phases, ${tasks.length} tasks`);
  
  if (phases.length === 0 && tasks.length === 0) {
    throw new Error(`Template ${templateId} je prázdny (žiadne phases/tasks).`);
  }
  
  // Create batch for phases and tasks
  const batch = writeBatch(db);
  const ownerId = currentUser.uid;
  
  // Add phases
  phases.forEach((phase, index) => {
    if (!phase.id) {
      throw new Error(`Phase at index ${index} is missing id`);
    }
    
    const phaseRef = doc(db, paths.projectPhase(projectId, phase.id));
    batch.set(phaseRef, {
      projectId,
      ownerId,
      name: phase.name || '',
      order: phase.order ?? index,
      status: 'ACTIVE',
    });
  });
  
  // Add tasks
  tasks.forEach((task, index) => {
    if (!task.id) {
      throw new Error(`Task at index ${index} is missing id`);
    }
    
    const taskRef = doc(db, paths.projectTask(projectId, task.id));
    batch.set(taskRef, {
      projectId,
      ownerId,
      phaseId: task.phaseId || '',
      order: task.order ?? index,
      title: task.title || '',
      description: task.description || null,
      status: 'OPEN',
      required: task.required ?? false,
      assigneeId: null,
      assigneeName: null,
      assignedTrade: null,
      updatedAt: serverTimestamp(),
      doneAt: null,
      createdAt: serverTimestamp(),
    });
  });
  
  // Commit batch
  await batch.commit();
  console.log(`[addPhasesToProject] ✅ Successfully added ${phases.length} phases and ${tasks.length} tasks to project ${projectId}`);
  
  // Update project templateId if it's empty
  const projectSnapAfter = await getDoc(projectRef);
  if (projectSnapAfter.exists() && !projectSnapAfter.data().templateId) {
    await updateDoc(projectRef, {
      templateId: templateId,
      updatedAt: serverTimestamp(),
    });
    console.log(`[addPhasesToProject] ✅ Updated project templateId to ${templateId}`);
  }
}
