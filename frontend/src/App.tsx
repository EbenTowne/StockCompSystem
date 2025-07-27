// src/App.tsx
import React from 'react';
import Header from './components/Header';
import AppRoutes from './routes/AppRoutes';

export default function App() {
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <main className="container mx-auto p-4">
        <AppRoutes />
      </main>
    </div>
  );
}