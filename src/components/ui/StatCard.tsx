import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: string;
  icon?: React.ReactNode;
}

export const StatCard: React.FC<StatCardProps> = ({ label, value, trend, icon }) => {
  return (
    <div className="tj-card p-lg bg-white flex flex-col gap-sm shadow-sm hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start">
        <span className="text-[10px] font-bold text-tj-black/40 uppercase tracking-widest">{label}</span>
        {icon && <div className="text-tj-black/20">{icon}</div>}
      </div>
      <div className="flex items-baseline gap-md">
        <span className="text-2xl font-bold text-tj-black tracking-tight">{value}</span>
        {trend && <span className="text-[10px] font-bold text-green-600">{trend}</span>}
      </div>
    </div>
  );
};
