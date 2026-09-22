import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { loginAdmin } from '../api.js';
import Logo from '../components/Logo.jsx';

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (sessionStorage.getItem('admin-auth') === 'true') {
      navigate('/admin', { replace: true });
    }
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const result = await loginAdmin({ username, password });
      if (result?.ok) {
        const role = result?.user?.role || 'ADMIN';
        sessionStorage.setItem('admin-auth', 'true');
        sessionStorage.setItem('admin-role', role);
        sessionStorage.setItem('admin-username', result?.user?.username || username);
        navigate('/admin', { replace: true });
        return;
      }
    } catch (err) {
      setError(err?.response?.data?.error || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
      return;
    }
    setError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  };

  return (
    <div className="min-h-screen bg-canvas font-body flex items-center justify-center px-5">
      <div className="w-full max-w-md bg-surface rounded-3xl border border-primary/10 shadow-sm p-8">
        <div className="mb-6">
          <Logo />
        </div>
        <div className="mb-6">
          <p className="text-accent font-display font-semibold tracking-widest text-xs mb-2">ADMIN LOGIN</p>
          <h1 className="font-display font-semibold text-2xl text-primary">เข้าสู่ระบบผู้ดูแล</h1>
          <p className="text-sm text-ink-muted mt-2">กรุณาเข้าสู่ระบบก่อนเข้าหน้า Admin</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="text-xs text-ink-muted mb-1 block">ชื่อผู้ใช้</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs text-ink-muted mb-1 block">รหัสผ่าน</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm"
            />
          </label>
          {error && <p className="text-danger text-sm">{error}</p>}
          <button type="submit" className="w-full bg-primary text-white rounded-2xl py-3 font-display font-medium">
            เข้าสู่ระบบ
          </button>
        </form>

        <div className="mt-5 text-center text-sm text-ink-muted">
          <Link to="/" className="text-primary underline">กลับหน้าจองคิว</Link>
        </div>
      </div>
    </div>
  );
}
