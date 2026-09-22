import { Link, useLocation, useNavigate } from 'react-router-dom';
import Logo from './Logo.jsx';

const links = [
  { to: '/', label: 'จองคิว', icon: '＋' },
  { to: '/display', label: 'จอแสดงผล', icon: '▣' },
  { to: '/admin', label: 'Dashboard', icon: '▤' },
  { to: '/admin/manage', label: 'จัดการระบบ', icon: '⚙' },
];

export default function AdminTopNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const role = sessionStorage.getItem('admin-role') || 'ADMIN';
  const visibleLinks = role === 'MANAGER' ? links.filter((link) => link.to !== '/admin/manage') : links;

  const logout = () => {
    sessionStorage.removeItem('admin-auth');
    sessionStorage.removeItem('admin-role');
    sessionStorage.removeItem('admin-username');
    navigate('/admin/login', { replace: true });
  };

  return (
    <header className="sticky top-0 z-30 border-b border-primary/10 bg-surface/95 shadow-sm backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <Logo />
        <nav aria-label="เมนูผู้ดูแลระบบ" className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:justify-end">
          {visibleLinks.map((link) => {
            const isActive = link.to === '/admin'
              ? location.pathname === '/admin'
              : location.pathname === link.to;
            return (
              <Link
                key={link.to}
                to={link.to}
                aria-current={isActive ? 'page' : undefined}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-primary hover:bg-primary/10'
                }`}
              >
                <span aria-hidden="true" className="text-base leading-none">{link.icon}</span>
                {link.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center gap-1.5 rounded-lg border border-danger/25 px-3 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/10"
          >
            <span aria-hidden="true" className="text-base leading-none">↪</span>
            ออกจากระบบ
          </button>
        </nav>
      </div>
    </header>
  );
}
