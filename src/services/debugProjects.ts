/**
 * Debug utility to find and list all projects
 * Useful for troubleshooting missing projects
 */

import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { paths } from '../lib/firestorePaths';

/**
 * List all projects (for debugging - bypasses owner filter)
 * WARNING: This should only be used for debugging, not in production
 */
export async function debugListAllProjects(): Promise<any[]> {
  console.log('[debugProjects] Listing ALL projects (debug mode)...');
  
  const projectsRef = collection(db, 'projects');
  const q = query(projectsRef, orderBy('createdAt', 'desc'), limit(50));
  const snapshot = await getDocs(q);
  
  const projects = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      name: data.name || 'N/A',
      ownerId: data.ownerId || 'N/A',
      projectType: data.projectType || 'N/A',
      createdAt: data.createdAt ? (data.createdAt.toDate ? data.createdAt.toDate().toISOString() : data.createdAt) : 'N/A',
      updatedAt: data.updatedAt ? (data.updatedAt.toDate ? data.updatedAt.toDate().toISOString() : data.updatedAt) : 'N/A',
    };
  });
  
  console.log(`[debugProjects] Found ${projects.length} projects total`);
  projects.forEach((p, i) => {
    console.log(`[debugProjects] ${i + 1}. ${p.name} (ID: ${p.id})`);
    console.log(`  - ownerId: ${p.ownerId}`);
    console.log(`  - projectType: ${p.projectType}`);
    console.log(`  - createdAt: ${p.createdAt}`);
  });
  
  return projects;
}

/**
 * Find projects by date range
 */
export async function debugFindProjectsByDate(
  startDate: Date,
  endDate: Date
): Promise<any[]> {
  console.log(`[debugProjects] Finding projects between ${startDate.toISOString()} and ${endDate.toISOString()}...`);
  
  const allProjects = await debugListAllProjects();
  
  const filtered = allProjects.filter(p => {
    if (p.createdAt === 'N/A') return false;
    const createdAt = new Date(p.createdAt);
    return createdAt >= startDate && createdAt <= endDate;
  });
  
  console.log(`[debugProjects] Found ${filtered.length} projects in date range`);
  return filtered;
}

/**
 * Compare current user with project owners
 */
export async function debugCheckUserProjects(): Promise<void> {
  const currentUser = auth.currentUser;
  
  if (!currentUser) {
    console.warn('[debugProjects] No user logged in');
    return;
  }
  
  console.log('[debugProjects] Current user:');
  console.log(`  - UID: ${currentUser.uid}`);
  console.log(`  - Email: ${currentUser.email}`);
  
  const allProjects = await debugListAllProjects();
  
  console.log('\n[debugProjects] Projects owned by current user:');
  const myProjects = allProjects.filter(p => p.ownerId === currentUser.uid);
  console.log(`  Found ${myProjects.length} projects`);
  myProjects.forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.name} (created: ${p.createdAt})`);
  });
  
  console.log('\n[debugProjects] Projects NOT owned by current user:');
  const otherProjects = allProjects.filter(p => p.ownerId !== currentUser.uid);
  console.log(`  Found ${otherProjects.length} projects`);
  otherProjects.forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.name}`);
    console.log(`     - ownerId: ${p.ownerId} (current: ${currentUser.uid})`);
    console.log(`     - Match: ${p.ownerId === currentUser.uid ? 'YES' : 'NO'}`);
  });
}

/**
 * Find project created around specific time
 */
export async function debugFindProjectByTime(
  targetDate: Date,
  toleranceMinutes: number = 30
): Promise<any[]> {
  const startDate = new Date(targetDate.getTime() - toleranceMinutes * 60 * 1000);
  const endDate = new Date(targetDate.getTime() + toleranceMinutes * 60 * 1000);
  
  console.log(`[debugProjects] Looking for project created around ${targetDate.toISOString()}`);
  console.log(`  Tolerance: ±${toleranceMinutes} minutes`);
  
  return await debugFindProjectsByDate(startDate, endDate);
}
