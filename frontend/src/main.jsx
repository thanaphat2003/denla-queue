import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';
import { getAdminSettings } from './api.js';

getAdminSettings()
  .then((settings) => {
    const titleSetting = settings.find((item) => item.key === 'siteTitle');
    if (titleSetting?.value) {
      document.title = titleSetting.value;
    }
  })
  .catch(() => {
    document.title = 'School Queue System';
  });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
