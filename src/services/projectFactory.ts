import { 
  collection, 
  doc, 
  setDoc, 
  writeBatch,
  serverTimestamp
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { paths } from '../lib/firestorePaths';
import { getTemplatePhases, getTemplateTasks } from './templateService';
import type { ProjectType } from '../lib/types';

export type PhaseStatus = 'completed' | 'active' | 'later';

export interface PhaseCustomization {
  phaseId: string;
  enabled: boolean; // Whether to include this phase
  status: PhaseStatus; // Status for tasks in this phase
}

export interface CreateProjectFromTemplateParams {
  // ownerId removed - always uses auth.currentUser.uid internally
  projectType: ProjectType;
  templateId: string;
  name: string;
  addressText?: string; // Optional: project address
  phaseCustomizations?: PhaseCustomization[]; // Optional: customize phases
}

/**
 * Instantiate a template: create project and copy phases + tasks
 * This is the critical onboarding flow function
 * 
 * NOTE: Vytvára projekt a member v prvom batch, potom phases a tasks v druhom batch
 * aby Firestore rules fungovali správne
 */
export async function instantiateTemplate(
  params: CreateProjectFromTemplateParams
): Promise<string> {
  const { projectType, templateId, name } = params;
  
  // CRITICAL FIX: Always use auth.currentUser.uid, never trust ownerId from params
  // Use the exported auth instance from firebase.ts (not getAuth())
  // Wait a bit for auth state to be ready (React Native Firebase sometimes needs a moment)
  let currentUser = auth.currentUser;
  
  // If currentUser is null, wait a bit and check again (max 3 attempts, 100ms each)
  if (!currentUser) {
    console.warn(`[projectFactory] WARNING: auth.currentUser is null, waiting for auth state...`);
    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      currentUser = auth.currentUser;
      if (currentUser) {
        console.log(`[projectFactory] Auth state ready after ${i + 1} attempt(s)`);
        break;
      }
    }
  }
  
  console.log(`[projectFactory] DEBUG: auth object:`, auth);
  console.log(`[projectFactory] DEBUG: auth.currentUser:`, currentUser);
  console.log(`[projectFactory] DEBUG: auth.currentUser?.uid:`, currentUser?.uid);
  
  if (!currentUser || !currentUser.uid) {
    console.error(`[projectFactory] ERROR: auth.currentUser is null or uid is missing after waiting!`);
    console.error(`[projectFactory] ERROR: auth.currentUser =`, currentUser);
    console.error(`[projectFactory] ERROR: auth object =`, auth);
    throw new Error('Musíte byť prihlásený na vytvorenie projektu. auth.currentUser je null.');
  }
  
  // CRITICAL: Use the exact UID from auth.currentUser.uid (no modifications)
  const ownerId = currentUser.uid; // Always use auth.currentUser.uid directly
  
  // CRITICAL: Double-check that ownerId matches auth.currentUser.uid
  if (ownerId !== currentUser.uid) {
    console.error(`[projectFactory] CRITICAL ERROR: ownerId (${ownerId}) !== currentUser.uid (${currentUser.uid})`);
    throw new Error(`Interná chyba: ownerId sa nezhoduje s auth.currentUser.uid`);
  }
  
  // Verify UID format (should be 28 characters for Firebase Auth UID)
  if (ownerId.length < 20 || ownerId.length > 128) {
    console.error(`[projectFactory] CRITICAL ERROR: Invalid UID length: ${ownerId.length}`);
    throw new Error(`Interná chyba: Neplatná dĺžka UID`);
  }
  
  console.log(`[projectFactory] DEBUG: Using ownerId = "${ownerId}" (from auth.currentUser.uid)`);
  console.log(`[projectFactory] DEBUG: Verifying ownerId is valid Firebase Auth UID format: ${ownerId.length > 20 ? '✅ Looks valid' : '⚠️ Suspicious length'}`);
  console.log(`[projectFactory] DEBUG: ownerId type: ${typeof ownerId}, length: ${ownerId.length}`);
  console.log(`[projectFactory] DEBUG: ownerId exact value: "${ownerId}"`);
  
  // Validate inputs
  if (!name || !name.trim()) {
    throw new Error('Názov projektu je povinný');
  }
  
  console.log(`[projectFactory] Creating project: name="${name}", type="${projectType}", template="${templateId}"`);
  console.log(`[projectFactory] Using ownerId from auth.currentUser.uid: "${ownerId}"`);
  
  // 1. Create project document
  const projectRef = doc(collection(db, 'projects'));
  const projectId = projectRef.id;
  
  // CRITICAL: Use ownerId directly from currentUser.uid (no string manipulation, no conversion)
  // This ensures exact match with what Firestore rules expect
  const projectData: any = {
    ownerId: ownerId, // Direct assignment from currentUser.uid (no modifications)
    projectType,
    templateId,
    name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  
  // Add addressText if provided
  if (params.addressText && params.addressText.trim()) {
    projectData.addressText = params.addressText.trim();
  }
  
  // Final verification before write
  console.log(`[projectFactory] Final verification before Firestore write:`);
  console.log(`[projectFactory]   - projectData.ownerId: "${projectData.ownerId}"`);
  console.log(`[projectFactory]   - currentUser.uid: "${currentUser.uid}"`);
  console.log(`[projectFactory]   - Match: ${projectData.ownerId === currentUser.uid ? '✅ YES' : '❌ NO'}`);
  console.log(`[projectFactory]   - Type check: ${typeof projectData.ownerId} === ${typeof currentUser.uid} ? ${typeof projectData.ownerId === typeof currentUser.uid ? '✅' : '❌'}`);
  console.log(`[projectFactory]   - Length: ${projectData.ownerId.length} === ${currentUser.uid.length} ? ${projectData.ownerId.length === currentUser.uid.length ? '✅' : '❌'}`);
  console.log(`[projectFactory]   - Character-by-character match: ${projectData.ownerId.split('').every((c: string, i: number) => c === currentUser.uid[i]) ? '✅' : '❌'}`);
  
  if (projectData.ownerId !== currentUser.uid) {
    console.error(`[projectFactory] CRITICAL: ownerId mismatch detected!`);
    console.error(`  - projectData.ownerId: "${projectData.ownerId}" (length: ${projectData.ownerId.length})`);
    console.error(`  - currentUser.uid: "${currentUser.uid}" (length: ${currentUser.uid.length})`);
    throw new Error(`Interná chyba: ownerId sa nezhoduje s auth.currentUser.uid pred zápisom do Firestore`);
  }
  
  // 2. Load template phases and tasks BEFORE creating project
  // This way we can validate template exists and user has permission to read it
  let phases: any[] = [];
  let tasks: any[] = [];
  
  // Ak je templateId prázdny, preskočíme načítanie template
  if (templateId && templateId.trim()) {
    try {
      console.log(`[projectFactory] Loading template ${templateId}...`);
      console.log(`[projectFactory] DEBUG: templateId="${templateId}", projectType="${projectType}"`);
      
      const [loadedPhases, loadedTasks] = await Promise.all([
        getTemplatePhases(templateId),
        getTemplateTasks(templateId),
      ]);
      
      phases = loadedPhases || [];
      tasks = loadedTasks || [];
      
      // Log for debugging
      console.log(`[projectFactory] ✅ Template ${templateId} loaded: ${phases.length} phases, ${tasks.length} tasks`);
      
      if (phases.length > 0) {
        console.log(`[projectFactory] Phase IDs: ${phases.map(p => p.id).join(', ')}`);
        console.log(`[projectFactory] Phase names: ${phases.map(p => p.name).join(', ')}`);
      }
      
      if (tasks.length > 0) {
        console.log(`[projectFactory] Task IDs: ${tasks.slice(0, 5).map(t => t.id).join(', ')}${tasks.length > 5 ? '...' : ''}`);
        console.log(`[projectFactory] Tasks by phase: ${Object.entries(tasks.reduce((acc, t) => {
          acc[t.phaseId] = (acc[t.phaseId] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)).map(([pid, count]) => `${pid}:${count}`).join(', ')}`);
      }
      
      if (phases.length === 0 && tasks.length === 0) {
        console.warn(`[projectFactory] ⚠️ Template ${templateId} je prázdny (žiadne phases/tasks)`);
        console.warn(`[projectFactory] Skontrolujte, či template existuje v catalogTemplates/${templateId}`);
      }
    } catch (error: any) {
      console.error(`[projectFactory] ❌ Error loading template ${templateId}:`, error);
      const errorCode = error.code || '';
      const errorMessage = error.message || 'Neznáma chyba';
      
      // Ak je problém s oprávneniami pri čítaní template, vyhodíme error
      if (errorCode === 'permission-denied') {
        throw new Error(`Nemáte oprávnenie načítavať šablónu "${templateId}". Skontrolujte Firestore rules pre catalogTemplates.`);
      }
      
      // Pre iné chyby pokračujeme s prázdnymi arrays - projekt sa vytvorí aj bez phases/tasks
      console.warn(`[projectFactory] ⚠️ Pokračujem bez phases/tasks kvôli chybe: ${errorMessage}`);
      phases = [];
      tasks = [];
    }
  } else {
    console.log(`[projectFactory] ⚠️ No template ID provided (templateId="${templateId}"), creating project without phases/tasks`);
  }
  
  // 3. Create project using setDoc (NOT batch) - most reliable MVP approach
  // Dôvod: Firestore rules môžu pri zápise do subcollections volať get(project) ešte predtým,
  // než projekt existuje "na serveri" ak je v batchi. setDoc zabezpečí, že projekt existuje pred batch writes.
  console.log(`[projectFactory] Creating project using setDoc (not batch)...`);
  console.log(`[projectFactory] DEBUG: auth.currentUser.uid = "${currentUser.uid}"`);
  console.log(`[projectFactory] DEBUG: projectData.ownerId = "${projectData.ownerId}"`);
  console.log(`[projectFactory] DEBUG: Match? ${projectData.ownerId === currentUser.uid ? '✅ YES' : '❌ NO'}`);
  
  try {
    console.log(`[projectFactory] Setting project document...`);
    await setDoc(projectRef, projectData);
    console.log(`[projectFactory] ✅ Project document created successfully. Project ID: ${projectId}`);
  } catch (error: any) {
    console.error('[projectFactory] ❌ Error creating project document:', error);
    const errorCode = error.code || '';
    const errorMessage = error.message || 'Neznáma chyba';
    
    if (errorCode === 'permission-denied') {
      console.error(`[projectFactory] PERMISSION DENIED at: projects/${projectId} (project document)`);
      console.error(`  - auth.currentUser.uid: ${currentUser?.uid || 'NULL'}`);
      console.error(`  - projectData.ownerId: ${projectData.ownerId}`);
      console.error(`  - Match: ${projectData.ownerId === currentUser?.uid ? 'YES' : 'NO'}`);
      console.error(`  - Rule check: request.resource.data.ownerId == request.auth.uid`);
      throw new Error(`❌ Chyba pri vytváraní projektu: Nemáte oprávnenie vytvoriť projekt documents/projects/${projectId}. Skontrolujte Firestore rules - ownerId (${projectData.ownerId}) sa musí zhodovať s auth.currentUser.uid (${currentUser?.uid || 'NULL'}).`);
    }
    
    throw new Error(`❌ Chyba pri vytváraní projektu: ${errorMessage} (kód: ${errorCode})`);
  }
  
  // 3b. Batch 1b: Create owner as member (teraz už projekt existuje)
  console.log(`[projectFactory] Creating batch1b: member`);
  const batch1b = writeBatch(db);
  const memberRef = doc(db, paths.projectMember(projectId, ownerId));
  batch1b.set(memberRef, {
    userId: ownerId,
    role: 'owner',
    addedAt: serverTimestamp(),
  });
  
  try {
    console.log(`[projectFactory] Committing batch1b (member)...`);
    await batch1b.commit();
    console.log(`[projectFactory] ✅ Batch1b committed successfully. Member created.`);
  } catch (error: any) {
    console.error('[projectFactory] ⚠️ Error committing batch1b (member):', error);
    // Nevyhadzujme error - projekt bol vytvorený, member sa môže pridať neskôr
    console.warn(`[projectFactory] Projekt ${projectId} bol vytvorený, ale member sa nepodarilo pridať. Môže sa pridať neskôr.`);
  }
  
  // 4. Batch 2: Create phases and tasks (teraz už projekt existuje)
  // Skip if no phases/tasks to create
  if (phases.length === 0 && tasks.length === 0) {
    console.log(`[projectFactory] No phases/tasks to create, skipping batch2. Project ${projectId} created successfully.`);
    return projectId;
  }

  // 4a. Apply phase customizations if provided
  const phaseCustomizationsMap = new Map<string, PhaseCustomization>();
  if (params.phaseCustomizations) {
    params.phaseCustomizations.forEach(custom => {
      phaseCustomizationsMap.set(custom.phaseId, custom);
    });
  }

  // Filter phases based on customizations
  const phasesToCreate = phases.filter(phase => {
    const custom = phaseCustomizationsMap.get(phase.id);
    // If customizations provided, only include enabled phases
    if (params.phaseCustomizations) {
      return custom?.enabled ?? true; // Default to enabled if not specified
    }
    return true; // If no customizations, include all phases
  });

  // Filter tasks based on phase customizations
  const tasksToCreate = tasks.filter(task => {
    const custom = phaseCustomizationsMap.get(task.phaseId);
    // If customizations provided, only include tasks from enabled phases
    if (params.phaseCustomizations) {
      return custom?.enabled ?? true; // Default to enabled if not specified
    }
    return true; // If no customizations, include all tasks
  });
  
  console.log(`[projectFactory] Creating batch2: ${phasesToCreate.length} phases, ${tasksToCreate.length} tasks`);
  const batch2 = writeBatch(db);
  
  // Create phases
  phasesToCreate.forEach((phase, index) => {
    // Validate phase data
    if (!phase.id) {
      console.error('Phase missing id:', phase);
      throw new Error(`Phase at index ${index} is missing id`);
    }
    
    const phaseRef = doc(db, paths.projectPhase(projectId, phase.id));
    const phaseData: any = {
      projectId, // Required: reference to parent project
      ownerId, // Required: same as project owner
      name: phase.name || '',
      order: phase.order ?? index,
      status: 'ACTIVE',
    };
    
    // Remove undefined values
    Object.keys(phaseData).forEach(key => {
      if (phaseData[key] === undefined) {
        delete phaseData[key];
      }
    });
    
    batch2.set(phaseRef, phaseData);
  });
  
  // Create tasks based on phase status
  tasksToCreate.forEach((task, index) => {
    // Validate task data
    if (!task.id) {
      console.error('Task missing id:', task);
      throw new Error(`Task at index ${index} is missing id`);
    }

    const custom = phaseCustomizationsMap.get(task.phaseId);
    const phaseStatus = custom?.status ?? 'active'; // Default to active if not specified

    // Determine task status and isActive based on phase status
    let taskStatus: string;
    let taskIsActive: boolean;
    let taskDoneAt: any;

    if (phaseStatus === 'completed') {
      // Dokončená fáza → tasky sú DONE, isActive=false
      taskStatus = 'DONE';
      taskIsActive = false;
      taskDoneAt = serverTimestamp();
    } else if (phaseStatus === 'active') {
      // Aktívna fáza → tasky sú OPEN, isActive=true
      taskStatus = 'OPEN';
      taskIsActive = true;
      taskDoneAt = null;
    } else {
      // Neskôr fáza → tasky sú OPEN, isActive=false
      taskStatus = 'OPEN';
      taskIsActive = false;
      taskDoneAt = null;
    }
    
    const taskRef = doc(db, paths.projectTask(projectId, task.id));
    const taskData: any = {
      projectId, // Required: reference to parent project
      ownerId, // Required: same as project owner
      phaseId: task.phaseId || '',
      order: task.order ?? index,
      title: task.title || '',
      description: task.description || null,
      status: taskStatus,
      required: task.required ?? false,
      assigneeId: null, // Use assigneeId (consistent with types)
      assigneeName: null, // Optional: display name
      assignedTrade: null,
      updatedAt: serverTimestamp(),
      doneAt: taskDoneAt,
      createdAt: serverTimestamp(),
      // MVP additions
      origin: 'TEMPLATE', // Task comes from template
      templateTaskId: task.id, // Reference to template task ID
      isActive: taskIsActive,
    };
    
    // Remove undefined values
    Object.keys(taskData).forEach(key => {
      if (taskData[key] === undefined) {
        delete taskData[key];
      }
    });
    
    batch2.set(taskRef, taskData);
  });
  
  // Commit second batch: Create phases + tasks
  try {
    console.log(`[projectFactory] Committing batch2 (phases + tasks)...`);
    await batch2.commit();
    console.log(`[projectFactory] ✅ Batch2 committed successfully. Created ${phasesToCreate.length} phases and ${tasksToCreate.length} tasks`);
  } catch (error: any) {
    console.error('[projectFactory] ❌ Error committing batch2 (phases + tasks):', error);
    const errorCode = error.code || '';
    const errorMessage = error.message || 'Neznáma chyba';
    
    if (errorCode === 'permission-denied') {
      console.error(`[projectFactory] PERMISSION DENIED at: projects/${projectId}/phases or projects/${projectId}/tasks`);
      console.error(`  - Projekt ${projectId} bol vytvorený úspešne`);
      console.error(`  - Chyba pri vytváraní phases/tasks subkolekcií`);
      console.error(`  - Skontrolujte Firestore rules pre projects/{projectId}/{subcol}/{docId}`);
      throw new Error(`❌ Projekt bol vytvorený (ID: ${projectId}), ale nepodarilo sa pridať fázy/úlohy. Chyba: permission-denied pri projects/${projectId}/phases alebo projects/${projectId}/tasks. Skontrolujte Firestore rules.`);
    } else {
      throw new Error(`❌ Projekt bol vytvorený (ID: ${projectId}), ale nepodarilo sa pridať fázy/úlohy: ${errorMessage} (kód: ${errorCode})`);
    }
  }
  
  console.log(`[projectFactory] Project ${projectId} created successfully with ${phasesToCreate.length} phases and ${tasksToCreate.length} tasks`);
  return projectId;
}

/**
 * Create project from template (alias for instantiateTemplate)
 */
export async function createProjectFromTemplate(
  params: CreateProjectFromTemplateParams
): Promise<string> {
  return instantiateTemplate(params);
}
