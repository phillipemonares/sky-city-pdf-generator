import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Allow access to login page
  if (pathname === '/login') {
    return NextResponse.next();
  }

  // Allow all API routes (they handle their own authentication if needed)
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Check for session cookie
  const sessionCookie = request.cookies.get('skycity_session');
  
  // If no session cookie, redirect to login
  if (!sessionCookie) {
    console.log('Middleware: No session cookie found, redirecting to login');
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Cookie exists, allow through
  // Full validation happens in the pages via check-auth API call
  // This avoids middleware trying to make HTTP requests to itself
  console.log('Middleware: Session cookie found, allowing request');
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

