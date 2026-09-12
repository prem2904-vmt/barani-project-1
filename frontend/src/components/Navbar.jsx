import React from 'react';
import { useAuth } from '../context/AuthContext';
import { LayoutDashboard, FolderKanban, CheckSquare, LogOut } from 'lucide-react';

const Navbar = ({ activeTab, onNavigate }) => {
  const { user, logout } = useAuth();

  return (
    <header className="navbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
        <div className="nav-brand" style={{ cursor: 'pointer' }} onClick={() => onNavigate('dashboard')}>
          <LayoutDashboard size={24} color="#818cf8" />
          <span>ProjectHub</span>
        </div>

        {user && (
          <nav style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className={`nav-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => onNavigate('dashboard')}
            >
              <LayoutDashboard size={16} />
              <span>Dashboard</span>
            </button>

            <button
              className={`nav-tab ${activeTab === 'projects' ? 'active' : ''}`}
              onClick={() => onNavigate('projects')}
            >
              <FolderKanban size={16} />
              <span>Projects</span>
            </button>

            <button
              className={`nav-tab ${activeTab === 'tasks' ? 'active' : ''}`}
              onClick={() => onNavigate('tasks')}
            >
              <CheckSquare size={16} />
              <span>Tasks</span>
            </button>
          </nav>
        )}
      </div>

      {user && (
        <div className="nav-user">
          <span className="user-badge">{user.full_name}</span>
          <button className="btn-logout" onClick={logout}>
            <LogOut size={16} />
            <span>Logout</span>
          </button>
        </div>
      )}
    </header>
  );
};

export default Navbar;
