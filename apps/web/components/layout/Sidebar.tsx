'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Megaphone, Users, PhoneCall,
  CalendarCheck, Activity, Settings, LogOut, Bot, HelpCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';

const NAV = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { type: 'divider', label: 'OPERATIONS' },
  { label: 'Campaigns', href: '/campaigns', icon: Megaphone },
  { label: 'Leads', href: '/leads', icon: Users },
  { label: 'Activity', href: '/activity', icon: PhoneCall },
  { label: 'Meetings', href: '/meetings', icon: CalendarCheck },
  { type: 'divider', label: 'SYSTEM' },
  { label: 'Queue Monitor', href: '/queues', icon: Activity },
  { label: 'Settings', href: '/settings', icon: Settings },
  { label: 'Help & Guide', href: '/help', icon: HelpCircle },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <aside className="fixed inset-y-0 left-0 w-64 bg-slate-900 flex flex-col z-20">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-800">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-blue-600 shrink-0">
          <Bot className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-white font-semibold text-sm leading-none truncate">AirRetail SDR</p>
          <p className="text-slate-500 text-xs mt-0.5">AI Sales Platform</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
        {NAV.map((item, i) => {
          if ('type' in item && item.type === 'divider') {
            return (
              <p key={i} className="text-[10px] font-semibold text-slate-600 tracking-widest uppercase px-3 pt-4 pb-1">
                {item.label}
              </p>
            );
          }
          const navItem = item as { label: string; href: string; icon: React.ElementType };
          const isActive = pathname === navItem.href || pathname.startsWith(`${navItem.href}/`);
          return (
            <Link
              key={navItem.href}
              href={navItem.href}
              className={cn('sidebar-link', isActive && 'active')}
            >
              <navItem.icon className="w-4.5 h-4.5 shrink-0" />
              {navItem.label}
            </Link>
          );
        })}
      </nav>

      {/* Sign out */}
      <div className="px-3 py-4 border-t border-slate-800">
        <button
          onClick={handleSignOut}
          className="sidebar-link w-full text-left text-red-400 hover:text-red-300 hover:bg-red-900/30"
        >
          <LogOut className="w-4.5 h-4.5 shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
