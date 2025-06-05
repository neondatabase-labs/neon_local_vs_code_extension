import { NeonOrg, NeonProject, NeonBranch } from '../types';

export class NeonService {
  async getOrgs(): Promise<NeonOrg[]> {
    // TODO: Implement actual API call
    return [
      { id: '', name: 'Personal account' },
      { id: 'org-1', name: 'Organization 1' },
      { id: 'org-2', name: 'Organization 2' }
    ];
  }

  async getProjects(orgId: string): Promise<NeonProject[]> {
    // TODO: Implement actual API call
    return [
      { id: 'project-1', name: 'Project 1', org_id: orgId },
      { id: 'project-2', name: 'Project 2', org_id: orgId }
    ];
  }

  async getBranches(projectId: string): Promise<NeonBranch[]> {
    // TODO: Implement actual API call
    return [
      { id: 'branch-1', name: 'main', project_id: projectId, parent_id: null },
      { id: 'branch-2', name: 'dev', project_id: projectId, parent_id: 'branch-1' }
    ];
  }
} 