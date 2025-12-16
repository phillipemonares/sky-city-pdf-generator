'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<'admin' | 'team_member' | null>(null);
  const [loading, setLoading] = useState(true);
  const [isReportDropdownOpen, setIsReportDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/check-auth');
        const data = await response.json();
        if (data.authenticated) {
          setUsername(data.username);
          setUserRole(data.role || 'team_member');
        } else {
          // Not authenticated - redirect to login
          window.location.href = `/login?redirect=${encodeURIComponent(pathname)}`;
        }
      } catch (error) {
        console.error('Error checking auth:', error);
        // On error, redirect to login for security
        window.location.href = `/login?redirect=${encodeURIComponent(pathname)}`;
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [pathname]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsReportDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    try {
      const response = await fetch('/api/logout', {
        method: 'POST',
      });
      
      if (response.ok) {
        router.push('/login');
        router.refresh();
      }
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  return (
    <nav className="bg-white shadow-md">
      <div className="w-full px-6 py-4">
        <div className="flex items-center gap-8">
          {/* SkyCity Logo */}
          <Link href="/" className="flex items-center hover:opacity-80 transition-opacity flex-shrink-0">
            <img
              src="/skycity-logo.png"
              alt="SkyCity Adelaide"
              className="h-10 w-auto object-contain"
            />
          </Link>

          {/* Navigation Tabs */}
          <div className="flex gap-1 border-b border-gray-200 flex-1">
            {/* Report Statement Dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setIsReportDropdownOpen(!isReportDropdownOpen)}
                className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 flex items-center gap-2 ${
                  pathname === '/' || pathname === '/no-play' || pathname === '/export-history'
                    ? 'border-blue-600 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                }`}
              >
                Report Statement
                <svg
                  className={`w-4 h-4 transition-transform ${isReportDropdownOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              
              {isReportDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
                  <Link
                    href="/"
                    onClick={() => setIsReportDropdownOpen(false)}
                    className={`block px-4 py-3 text-sm transition-colors ${
                      pathname === '/'
                        ? 'bg-blue-50 text-blue-600 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    Quarterly Statements
                  </Link>
                  <Link
                    href="/no-play"
                    onClick={() => setIsReportDropdownOpen(false)}
                    className={`block px-4 py-3 text-sm transition-colors ${
                      pathname === '/no-play'
                        ? 'bg-blue-50 text-blue-600 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    Play & No-Play Pre-Commitment
                  </Link>
                  <Link
                    href="/export-history"
                    onClick={() => setIsReportDropdownOpen(false)}
                    className={`block px-4 py-3 text-sm transition-colors ${
                      pathname === '/export-history'
                        ? 'bg-blue-50 text-blue-600 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    Export History
                  </Link>
                </div>
              )}
            </div>

            <Link
              href="/members"
              className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${
                pathname === '/members'
                  ? 'border-blue-600 text-blue-600 bg-blue-50'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              Member Information
            </Link>

            {userRole === 'admin' && (
              <Link
                href="/users"
                className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${
                  pathname === '/users'
                    ? 'border-blue-600 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                }`}
              >
                Users
              </Link>
            )}

            <Link
              href="/settings"
              className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${
                pathname === '/settings'
                  ? 'border-blue-600 text-blue-600 bg-blue-50'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              Settings
            </Link>
          </div>

          {/* User Info and Logout */}
          {!loading && username && (
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">{username}</span>
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

