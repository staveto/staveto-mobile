/**
 * Example usage of the services
 * This file demonstrates how to use the implemented functions
 */

import { instantiateTemplate } from './projectFactory';
import { updateTaskStatus, assignTask } from './taskService';
import { getProjectOverview } from './projectOverviewService';
import { getMyProjects } from './projectOverviewService';
import type { ProjectType } from '../lib/types';

/**
 * Example: Create a new project from template
 */
export async function exampleCreateProject() {
  const userId = 'user123'; // Get from auth.currentUser.uid
  
  try {
    const projectId = await instantiateTemplate({
      ownerId: userId,
      projectType: 'BUILD',
      templateId: 'eu-construction-v1',
      name: 'Môj nový projekt',
    });
    
    console.log('Project created:', projectId);
    return projectId;
  } catch (error) {
    console.error('Error creating project:', error);
    throw error;
  }
}

/**
 * Example: Update task status
 */
export async function exampleUpdateTaskStatus(
  projectId: string,
  taskId: string
) {
  try {
    // Mark task as DONE
    await updateTaskStatus(projectId, taskId, 'DONE');
    console.log('Task marked as DONE');
    
    // Later, revert to OPEN
    await updateTaskStatus(projectId, taskId, 'OPEN');
    console.log('Task reverted to OPEN (doneAt cleared)');
  } catch (error) {
    console.error('Error updating task status:', error);
    throw error;
  }
}

/**
 * Example: Assign task to user
 */
export async function exampleAssignTask(
  projectId: string,
  taskId: string,
  userId: string
) {
  try {
    await assignTask(projectId, taskId, userId);
    console.log('Task assigned to user');
    
    // Unassign task
    await assignTask(projectId, taskId, null);
    console.log('Task unassigned');
  } catch (error) {
    console.error('Error assigning task:', error);
    throw error;
  }
}

/**
 * Example: Get project overview with statistics
 */
export async function exampleGetProjectOverview(projectId: string) {
  try {
    const overview = await getProjectOverview(projectId);
    
    console.log('Phases:', overview.phases.length);
    console.log('Tasks:', overview.tasks.length);
    console.log('Project completion:', overview.projectStats.completionPercentage + '%');
    
    // Display phase statistics
    overview.phases.forEach(phase => {
      const stats = overview.phaseStats[phase.id];
      console.log(`Phase ${phase.name}: ${stats.completionPercentage}% (${stats.doneTasks}/${stats.totalTasks})`);
    });
    
    return overview;
  } catch (error) {
    console.error('Error getting project overview:', error);
    throw error;
  }
}

/**
 * Example: Get user's projects
 */
export async function exampleGetMyProjects(userId: string) {
  try {
    const projectIds = await getMyProjects(userId);
    console.log('My projects:', projectIds);
    return projectIds;
  } catch (error) {
    console.error('Error getting my projects:', error);
    throw error;
  }
}

/**
 * Complete example: Create project and view overview
 */
export async function exampleCompleteFlow() {
  const userId = 'user123';
  
  // 1. Create project from template
  const projectId = await instantiateTemplate({
    ownerId: userId,
    projectType: 'BUILD',
    templateId: 'eu-construction-v1',
    name: 'Test Project',
  });
  
  // 2. Get overview
  const overview = await getProjectOverview(projectId);
  
  // 3. Assign first task to user
  if (overview.tasks.length > 0) {
    const firstTask = overview.tasks[0];
    await assignTask(projectId, firstTask.id, userId);
    
    // 4. Mark task as DONE
    await updateTaskStatus(projectId, firstTask.id, 'DONE');
    
    // 5. Get updated overview
    const updatedOverview = await getProjectOverview(projectId);
    console.log('Updated completion:', updatedOverview.projectStats.completionPercentage + '%');
  }
  
  return projectId;
}
