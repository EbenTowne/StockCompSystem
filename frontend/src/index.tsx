import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import AuthContextProvider from './context/AuthContext';
import Header from './components/Header';
import AppRoutes from './routes/AppRoutes';
import { Toaster } from 'react-hot-toast';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthContextProvider>
        <Header />
        <AppRoutes />
        <Toaster position="top-right" />
      </AuthContextProvider>
    </BrowserRouter>
  </React.StrictMode>
);
