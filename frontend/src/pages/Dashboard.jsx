import React, { useState, useEffect } from 'react';
import API from '../services/api';
import Navbar from '../components/Navbar';
import StatCard from '../components/StatCard';
import {
  FolderKanban,
  ListTodo,
  CheckCircle2,
  Clock,
  Activity,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

const Dashboard = ({ onNavigate }) => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDashboardStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await API.get('/dashboard');
      if (response.data && response.data.success) {
        setStats(response.data.data);
      } else {
        setError('Failed to fetch dashboard statistics.');
      }
    } catch (err) {
      const msg = err.response?.data?.message || 'An error occurred while loading the dashboard.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardStats();
  }, []);

  return (
    <div className="app-container">
      <Navbar activeTab="dashboard" onNavigate={onNavigate} />
      <main className="dashboard-page">
        <div className="dashboard-header">
          <h1 className="dashboard-title">Dashboard Overview</h1>
          <p className="dashboard-subtitle">
            Real-time project performance metrics & status breakdown
          </p>
        </div>

        {loading ? (
          <div className="stats-grid">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="stat-card-skeleton" />
            ))}
          </div>
        ) : error ? (
          <div className="error-container">
            <AlertCircle size={32} style={{ margin: '0 auto 0.75rem auto' }} />
            <p>{error}</p>
            <button className="btn-retry" onClick={fetchDashboardStats}>
              <RefreshCw size={14} style={{ display: 'inline', marginRight: '0.4rem' }} />
              Retry Loading
            </button>
          </div>
        ) : (
          <div className="stats-grid">
            <StatCard
              title="Total Projects"
              value={stats?.totalProjects ?? 0}
              icon={FolderKanban}
              theme="indigo"
            />
            <StatCard
              title="Total Tasks"
              value={stats?.totalTasks ?? 0}
              icon={ListTodo}
              theme="violet"
            />
            <StatCard
              title="Completed Tasks"
              value={stats?.completedTasks ?? 0}
              icon={CheckCircle2}
              theme="emerald"
            />
            <StatCard
              title="Pending Tasks"
              value={stats?.pendingTasks ?? 0}
              icon={Clock}
              theme="amber"
            />
            <StatCard
              title="Projects In Progress"
              value={stats?.projectsInProgress ?? 0}
              icon={Activity}
              theme="sky"
            />
          </div>
        )}
      </main>
    </div>
  );
};

export default Dashboard;
