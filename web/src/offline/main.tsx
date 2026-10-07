import React from 'react';
import ReactDOM from 'react-dom/client';
import '../i18n';
import '../index.css';
import OfflineApp from './OfflineApp';

// No profile to read a theme from: follow the phone.
const dark = window.matchMedia?.('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.classList.toggle('dark', !!dark?.matches);
applyTheme();
dark?.addEventListener('change', applyTheme);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OfflineApp />
  </React.StrictMode>,
);
