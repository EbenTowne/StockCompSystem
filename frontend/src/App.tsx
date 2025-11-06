// src/App.tsx
import React from 'react';
import AppRoutes from './routes/AppRoutes';
import ChatWidget from './components/ChatWidget';

export default function App() {
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <main className="container mx-auto p-4">
        <AppRoutes />
      </main>
      <ChatWidget />  {/* <= outside main so its fixed/z-index never get clipped */}
    </div>
  );
}