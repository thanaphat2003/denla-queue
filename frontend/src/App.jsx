import { Routes, Route, Link } from 'react-router-dom';
import BookingPage from './pages/BookingPage.jsx';
import TicketPage from './pages/TicketPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import AdminLoginPage from './pages/AdminLoginPage.jsx';
import AdminManagementPage from './pages/AdminManagementPage.jsx';
import DisplayPage from './pages/DisplayPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<BookingPage />} />
      <Route path="/track/:id" element={<TicketPage />} />
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/admin/manage" element={<AdminManagementPage />} />
      <Route path="/display" element={<DisplayPage />} />
      <Route
        path="*"
        element={
          <div className="min-h-screen flex items-center justify-center flex-col gap-3 font-body">
            <p className="text-ink-muted">ไม่พบหน้านี้</p>
            <Link to="/" className="text-primary underline">
              กลับหน้าจองคิว
            </Link>
          </div>
        }
      />
    </Routes>
  );
}
