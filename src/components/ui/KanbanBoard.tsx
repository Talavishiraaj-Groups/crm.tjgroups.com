import React from 'react';
import { Project, ProjectStatus } from '../../types';

interface KanbanBoardProps {
  projects: Project[];
}

const STAGES: ProjectStatus[] = ['Onboarding', 'InProgress', 'Completed'];

export const KanbanBoard: React.FC<KanbanBoardProps> = ({ projects }) => {
  return (
    <div className="flex gap-lg h-full overflow-x-auto pb-lg">
      {STAGES.map((stage) => (
        <div key={stage} className="flex-1 min-w-[300px] flex flex-col gap-md">
          <div className="flex justify-between items-center px-sm">
            <h3 className="text-xs font-bold uppercase tracking-widest text-tj-black/40">{stage}</h3>
            <span className="text-[10px] font-bold bg-tj-surface px-md py-xs rounded-full">
              {projects.filter(p => p.status === stage).length}
            </span>
          </div>
          
          <div className="flex-1 bg-tj-surface/30 rounded-tj p-md flex flex-col gap-md border border-dashed border-tj-surface">
            {projects
              .filter((p) => p.status === stage)
              .map((project) => (
                <div key={project.id} className="tj-card bg-white p-lg shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                  <h4 className="text-sm font-bold text-tj-black">{project.clientName}</h4>
                  <div className="flex justify-between items-center mt-md pt-md border-t border-tj-surface">
                    <span className="text-[10px] text-tj-black/40">Due {new Date(project.dueDate).toLocaleDateString()}</span>
                    <div className="w-6 h-6 rounded-full bg-tj-surface flex items-center justify-center text-[10px] font-bold">
                      {project.ownerRepId.split('_')[1]}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
};
