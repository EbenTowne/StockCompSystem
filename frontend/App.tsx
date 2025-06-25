// src/App.tsx
import React from 'react';
import GuidedTour from './components/GuidedTour';

const App: React.FC = () => {
  return (
    <div className="app">
      <GuidedTour />

      <header className="header">
        <h1>🚀 My App</h1>
      </header>

      <main className="main">
        <section id="dashboard-placeholder" className="section">
          <h2>📊 Dashboard</h2>
          <p>This is where your metrics will appear.</p>
        </section>

        <section id="profile-icon" className="section">
          <h2>👤 Profile</h2>
          <p>Update your account details here.</p>
        </section>

        <section id="help-center" className="section">
          <h2>❓ Help Center</h2>
          <p>Get help, view FAQs, or contact support.</p>
        </section>
      </main>
    </div>
  );
};

export default App;
