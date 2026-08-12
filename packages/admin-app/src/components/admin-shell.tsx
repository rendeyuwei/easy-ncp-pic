import { Link, Outlet } from '@tanstack/react-router';
import { LogOut, Menu, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '../session/session-provider';
import { useTheme } from '../theme/theme-provider';
import { useNotifications } from './notification-provider';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';

const links = [
  { to: '/filters', label: '滤镜' },
  { to: '/categories', label: '分类' },
] as const;

function NavigationLinks({ close }: { close?: () => void }) {
  return links.map((link) => (
    <Link
      key={link.to}
      to={link.to}
      activeOptions={{ exact: true }}
      activeProps={{ 'aria-current': 'page' }}
      onClick={close}
    >
      {link.label}
    </Link>
  ));
}

export function AdminShell() {
  const { logout } = useSession();
  const { theme, toggleTheme } = useTheme();
  const { notify } = useNotifications();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    try {
      await logout();
    } catch {
      notify('退出登录失败，请重试', 'failure');
    }
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand"><span aria-hidden="true">EP</span><strong>EasyPic 管理</strong></div>
        <nav className="admin-nav" aria-label="主管理导航"><NavigationLinks /></nav>
      </aside>
      <div className="admin-workspace">
        <header className="admin-header">
          <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
            <DialogTrigger asChild>
              <Button className="mobile-menu-button" variant="ghost" size="icon" aria-label="打开导航菜单">
                <Menu aria-hidden="true" />
              </Button>
            </DialogTrigger>
            <DialogContent className="mobile-navigation-dialog">
              <DialogHeader>
                <DialogTitle>管理导航</DialogTitle>
                <DialogDescription>选择管理区域。</DialogDescription>
              </DialogHeader>
              <nav className="mobile-nav" aria-label="移动管理导航">
                <NavigationLinks close={() => setMobileOpen(false)} />
              </nav>
            </DialogContent>
          </Dialog>
          <div className="admin-header__brand">EasyPic 管理</div>
          <div className="admin-header__actions">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? '切换为浅色主题' : '切换为深色主题'}
            >
              {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            </Button>
            <Button variant="ghost" onClick={() => void handleLogout()}>
              <LogOut aria-hidden="true" />
              退出登录
            </Button>
          </div>
        </header>
        <main className="admin-main"><Outlet /></main>
      </div>
    </div>
  );
}
