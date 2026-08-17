import React from 'react';
import { Routes, Route } from 'react-router-dom';
import TicketListPage from './pages/TicketListPage';
import TicketDetailPage from './pages/TicketDetailPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<TicketListPage />} />
      <Route path="/ticket/:id" element={<TicketDetailPage />} />
    </Routes>
  );
}