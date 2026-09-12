import React, { useState, useEffect } from 'react';
import API from '../services/api';
import Navbar from '../components/Navbar';
import {
  Search,
  Plus,
  RotateCcw,
  FolderKanban,
  Edit2,
  Trash2,
  Calendar,
  AlertCircle,
} from 'lucide-react';

const Projects = ({ onNavigate }) => {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    status: 'Not Started',
    start_date: '',
    end_date: '',
  });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchProjects = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (search.trim() !== '') params.search = search.trim();
      if (statusFilter !== '') params.status = statusFilter;

      const response = await API.get('/projects', { params });
      if (response.data && response.data.success) {
        setProjects(response.data.data);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch projects');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, [search, statusFilter]);

  const handleClearFilters = () => {
    setSearch('');
    setStatusFilter('');
  };

  const handleOpenModal = (project = null) => {
    setFormError('');
    if (project) {
      setEditingProject(project);
      setFormData({
        name: project.name || '',
        description: project.description || '',
        status: project.status || 'Not Started',
        start_date: project.start_date ? project.start_date.substring(0, 10) : '',
        end_date: project.end_date ? project.end_date.substring(0, 10) : '',
      });
    } else {
      setEditingProject(null);
      setFormData({
        name: '',
        description: '',
        status: 'Not Started',
        start_date: '',
        end_date: '',
      });
    }
    setIsModalOpen(true);
  };

  const handleSubmitForm = async (e) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);

    try {
      if (editingProject) {
        await API.put(`/projects/${editingProject.id}`, formData);
      } else {
        await API.post('/projects', formData);
      }
      setIsModalOpen(false);
      fetchProjects();
    } catch (err) {
      setFormError(err.response?.data?.message || 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteProject = async (id) => {
    if (window.confirm('Are you sure you want to delete this project? Associated tasks will also be deleted.')) {
      try {
        await API.delete(`/projects/${id}`);
        fetchProjects();
      } catch (err) {
        alert(err.response?.data?.message || 'Failed to delete project');
      }
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'In Progress':
        return <span className="badge badge-in-progress">In Progress</span>;
      case 'Completed':
        return <span className="badge badge-completed">Completed</span>;
      default:
        return <span className="badge badge-not-started">Not Started</span>;
    }
  };

  return (
    <div className="app-container">
      <Navbar activeTab="projects" onNavigate={onNavigate} />
      <main className="page-container">
        <div className="page-header">
          <div>
            <h1 className="page-title">Projects</h1>
            <p className="page-subtitle">Manage, search, and track all your active projects</p>
          </div>
          <button className="btn-action" onClick={() => handleOpenModal(null)}>
            <Plus size={18} />
            <span>New Project</span>
          </button>
        </div>

        {/* Filter Control Bar */}
        <div className="filter-bar">
          <div className="search-input-wrapper">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="Not Started">Not Started</option>
            <option value="In Progress">In Progress</option>
            <option value="Completed">Completed</option>
          </select>

          {(search !== '' || statusFilter !== '') && (
            <button className="btn-secondary" onClick={handleClearFilters}>
              <RotateCcw size={14} />
              <span>Clear Filters</span>
            </button>
          )}
        </div>

        {/* Project List / Grid */}
        {loading ? (
          <div className="card-grid">
            {[1, 2, 3].map((i) => (
              <div key={i} className="stat-card-skeleton" />
            ))}
          </div>
        ) : error ? (
          <div className="error-container">
            <AlertCircle size={32} style={{ margin: '0 auto 0.75rem auto' }} />
            <p>{error}</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="empty-state">
            <FolderKanban size={48} color="#94a3b8" />
            <h3>No projects found matching your filters</h3>
            <p>Try adjusting your search query or status filter.</p>
          </div>
        ) : (
          <div className="card-grid">
            {projects.map((project) => (
              <div key={project.id} className="item-card">
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <h3 className="item-title">{project.name}</h3>
                    {getStatusBadge(project.status)}
                  </div>
                  <p className="item-desc">{project.description || 'No description provided.'}</p>
                </div>

                <div className="item-footer">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Calendar size={14} />
                    <span>
                      {project.start_date ? project.start_date.substring(0, 10) : 'N/A'} -{' '}
                      {project.end_date ? project.end_date.substring(0, 10) : 'N/A'}
                    </span>
                  </div>

                  <div className="item-actions">
                    <button
                      className="btn-icon"
                      title="Edit Project"
                      onClick={() => handleOpenModal(project)}
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      className="btn-icon danger"
                      title="Delete Project"
                      onClick={() => handleDeleteProject(project.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create / Edit Project Modal */}
        {isModalOpen && (
          <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
            <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
              <h2 className="modal-title">
                {editingProject ? 'Edit Project' : 'Create New Project'}
              </h2>

              {formError && (
                <div style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: '#fca5a5',
                  padding: '0.6rem 0.8rem',
                  borderRadius: '0.5rem',
                  fontSize: '0.85rem',
                  marginBottom: '1rem'
                }}>
                  {formError}
                </div>
              )}

              <form onSubmit={handleSubmitForm}>
                <div className="form-group">
                  <label>Project Name *</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. Website Redesign"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Description</label>
                  <textarea
                    className="form-control"
                    rows="3"
                    placeholder="Describe the goals of this project..."
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>Status</label>
                  <select
                    className="form-control"
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  >
                    <option value="Not Started">Not Started</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Start Date</label>
                    <input
                      type="date"
                      className="form-control"
                      value={formData.start_date}
                      onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label>End Date</label>
                    <input
                      type="date"
                      className="form-control"
                      value={formData.end_date}
                      onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ flex: 1, justifyContent: 'center' }}
                    onClick={() => setIsModalOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-action"
                    style={{ flex: 1, justifyContent: 'center' }}
                    disabled={submitting}
                  >
                    {submitting ? 'Saving...' : editingProject ? 'Update' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Projects;
