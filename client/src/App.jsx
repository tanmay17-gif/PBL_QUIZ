import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Main from './pages/Main.jsx';
import Play from './pages/Play.jsx';
import Admin from './pages/Admin.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Main event screen — project this in Chrome. No separate projector page. */}
        <Route path="/" element={<Main />} />
        <Route path="/play" element={<Play />} />
        <Route path="/admin" element={<Admin />} />
        {/* Legacy redirects from the old 4-route layout */}
        <Route path="/projector" element={<Navigate to="/" replace />} />
        <Route path="/host" element={<Navigate to="/admin" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
