import React from 'react';

const StatCard = ({ title, value, icon: Icon, theme = 'indigo' }) => {
  return (
    <div className={`stat-card theme-${theme}`}>
      <div className="stat-card-header">
        <span className="stat-card-title">{title}</span>
        <div className="stat-icon-wrapper">
          <Icon size={20} />
        </div>
      </div>
      <div className="stat-value">{value}</div>
    </div>
  );
};

export default StatCard;
