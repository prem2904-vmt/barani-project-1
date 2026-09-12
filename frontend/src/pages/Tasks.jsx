import React, { useState, useEffect } from 'react';
import API from '../services/api';
import Navbar from '../components/Navbar';
import {
  Search,
  Plus,
  RotateCcw,
  CheckSquare,
  CheckCircle2,
  Edit2,
  Trash2,
  Calendar,
  FolderKanban,
  AlertCircle,
} from 'lucide-react';

const Tasks = ({ onNavigate }) => {
  const [tasks, setTasks] = useState([]);
  const [userProjects, setUserProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [projectIdFilter, setProjectIdFilter] = useState('');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [formData, setFormData] = useState({
    project_id: '',
    name: '',
    description: '',
    priority: 'Medium',
    status: 'Pending',
    due_date: '',
  });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Fetch Projects for dropdown selection
  const fetchUserProjects = async () => {
    try {
      const res = await API.get('/projects');
      if (res.data && res.data.success) {
        setUserProjects(res.data.data);
      }
    } catch (err) {
      // Ignore
    }
  };

  const fetchTasks = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (search.trim() !== '') params.search = search.trim();
      if (statusFilter !== '') params.status = statusFilter;
      if (priorityFilter !== '') params.priority = priorityFilter;
      if (projectIdFilter !== '') params.project_id = projectIdFilter;

      const response = await API.get('/tasks', { params });
      if (response.data && response.data.success) {
        setTasks(response.data.data);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch tasks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUserProjects();
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [search, statusFilter, priorityFilter, projectIdFilter]);

  const handleClearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setPriorityFilter('');
    setProjectIdFilter('');
  };

  const handleOpenModal = (task = null) => {
    setFormError('');
    if (task) {
      setEditingTask(task);
      setFormData({
        project_id: task.project_id || '',
        name: task.name || '',
        description: task.description || '',
        priority: task.priority || 'Medium',
        status: task.status || 'Pending',
        due_date: task.due_date ? task.due_date.substring(0, 10) : '',
      });
    } else {
      setEditingTask(null);
      setFormData({
        project_id: userProjects.length > 0 ? userProjects[0].id : '',
        name: '',
        description: '',
        priority: 'Medium',
        status: 'Pending',
        due_date: '',
      });
    }
    setIsModalOpen(true);
  };

  const handleSubmitForm = async (e) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);

    try {
      if (editingTask) {
        await API.put(`/tasks/${editingTask.id}`, formData);
      } else {
        await API.post('/tasks', formData);
      }
      setIsModalOpen(false);
      fetchTasks();
    } catch (err) {
      setFormError(err.response?.data?.message || 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMarkCompleted = async (taskId) => {
    try {
      await API.put(`/tasks/${taskId}`, { status: 'Completed' });
      fetchTasks();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to mark task as completed');
    }
  };

  const handleDeleteTask = async (id) => {
    if (window.confirm('Are you sure you want to delete this task?')) {
      try {
        await API.delete(`/tasks/${id}`);
        fetchTasks();
      } catch (err) {
        alert(err.response?.data?.message || 'Failed to delete task');
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
        return <span className="badge badge-pending">Pending</span>;
    }
  };

  const getPriorityBadge = (priority) => {
    switch (priority) {
      case 'High':
        return <span className="badge badge-priority-high">High Priority</span>;
      case 'Medium':
        return <span className="badge badge-priority-medium">Medium Priority</span>;
      default:
        return <span className="badge badge-priority-low">Low Priority</span>;
    }
  };

  return (
    <div className="app-container">
      <Navbar activeTab="tasks" onNavigate={onNavigate} />
      <main className="page-container">
        <div className="page-header">
          <div>
            <h1 className="page-title">Tasks</h1>
            <p className="page-subtitle">Organize, filter, and track all your deliverables</p>
          </div>
          <button className="btn-action" onClick={() => handleOpenModal(null)}>
            <Plus size={18} />
            <span>New Task</span>
          </button>
        </div>

        {/* Filter Control Bar */}
        <div className="filter-bar">
          <div className="search-input-wrapper">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search tasks..."
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
            <option value="Pending">Pending</option>
            <option value="In Progress">In Progress</option>
            <option value="Completed">Completed</option>
          </select>

          <select
            className="filter-select"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
          >
            <option value="">All Priorities</option>
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
          </select>

          <select
            className="filter-select"
            value={projectIdFilter}
            onChange={(e) => setProjectIdFilter(e.target.value)}
          >
            <option value="">All Projects</option>
            {userProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {(search !== '' || statusFilter !== '' || priorityFilter !== '' || projectIdFilter !== '') && (
            <button className="btn-secondary" onClick={handleClearFilters}>
              <RotateCcw size={14} />
              <span>Clear Filters</span>
            </button>
          )}
        </div>

        {/* Task List / Grid */}
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
        ) : tasks.length === 0 ? (
          <div className="empty-state">
            <CheckSquare size={48} color="#94a3b8" />
            <h3>No tasks found matching your filters</h3>
            <p>Try adjusting your search query, status, or priority filter.</p>
          </div>
        ) : (
          <div className="card-grid">
            {tasks.map((task) => (
              <div key={task.id} className="item-card">
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                    <h3 className="item-title">{task.name}</h3>
                    {getStatusBadge(task.status)}
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                    {getPriorityBadge(task.priority)}
                    {task.project_name && (
                      <span className="badge" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#a5b4fc' }}>
                        <FolderKanban size={12} /> {task.project_name}
                      </span>
                    )}
                  </div>

                  <p className="item-desc">{task.description || 'No description provided.'}</p>
                </div>

                <div className="item-footer">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Calendar size={14} />
                    <span>Due: {task.due_date ? task.due_date.substring(0, 10) : 'No deadline'}</span>
                  </div>

                  <div className="item-actions">
                    {task.status !== 'Completed' && (
                      <button
                        className="btn-icon"
                        title="Mark as Completed"
                        style={{ color: '#34d399' }}
                        onClick={() => handleMarkCompleted(task.id)}
                      >
                        <CheckCircle2 size={16} />
                      </button>
                    )}
                    <button
                      className="btn-icon"
                      title="Edit Task"
                      onClick={() => handleOpenModal(task)}
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      className="btn-icon danger"
                      title="Delete Task"
                      onClick={() => handleDeleteTask(task.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create / Edit Task Modal */}
        {isModalOpen && (
          <div className="modal-backdrop" onClick={() => setIsModalOpen(false)}>
            <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
              <h2 className="modal-title">
                {editingTask ? 'Edit Task' : 'Create New Task'}
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
                {!editingTask && (
                  <div className="form-group">
                    <label>Select Project *</label>
                    <select
                      className="form-control"
                      value={formData.project_id}
                      onChange={(e) => setFormData({ ...formData, project_id: e.target.value })}
                      required
                    >
                      {userProjects.length === 0 ? (
                        <option value="">No projects available (Create a project first)</option>
                      ) : (
                        userProjects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                )}

                <div className="form-group">
                  <label>Task Name *</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. Build authentication route"
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
                    placeholder="Details about task requirements..."
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Priority</label>
                    <select
                      className="form-control"
                      value={formData.priority}
                      onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                    >
                      <option value="Low">Low</option>
                      <option value="Medium">Medium</option>
                      <option value="High">High</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Status</label>
                    <select
                      className="form-control"
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    >
                      <option value="Pending">Pending</option>
                      <option value="In Progress">In Progress</option>
                      <option value="Completed">Completed</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label>Due Date</label>
                  <input
                    type="date"
                    className="form-control"
                    value={formData.due_date}
                    onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                  />
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
                    disabled={submitting || (!editingTask && userProjects.length === 0)}
                  >
                    {submitting ? 'Saving...' : editingTask ? 'Update Task' : 'Create Task'}
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

export default Tasks;
