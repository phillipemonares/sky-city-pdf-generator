'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="bg-white shadow-md">
      <div className="max-w-6xl mx-auto px-4 py-4">
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
            <Link
              href="/"
              className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${
                pathname === '/'
                  ? 'border-blue-600 text-blue-600 bg-blue-50'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              Quarterly Statements
            </Link>
            <Link
              href="/no-play"
              className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${
                pathname === '/no-play'
                  ? 'border-blue-600 text-blue-600 bg-blue-50'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              No-Play - Pre Commitment
            </Link>
            <Link
              href="/members"
              className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${
                pathname === '/members'
                  ? 'border-blue-600 text-blue-600 bg-blue-50'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              Members
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}

