import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import Tasks from './pages/Tasks';

const MainApp = () => {
  const { token } = useAuth();
  const [authView, setAuthView] = useState('login'); // 'login' | 'register'
  const [currentTab, setCurrentTab] = useState('dashboard'); // 'dashboard' | 'projects' | 'tasks'

  if (!token) {
    return authView === 'login' ? (
      <Login onSwitchToRegister={() => setAuthView('register')} />
    ) : (
      <Register onSwitchToLogin={() => setAuthView('login')} />
    );
  }

  switch (currentTab) {
    case 'projects':
      return <Projects onNavigate={setCurrentTab} />;
    case 'tasks':
      return <Tasks onNavigate={setCurrentTab} />;
    case 'dashboard':
    default:
      return <Dashboard onNavigate={setCurrentTab} />;
  }
};

function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}

export default App;
