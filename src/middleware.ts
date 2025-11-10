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

  // Validate session token by calling the validation API
  // Note: Middleware runs in Edge Runtime which doesn't support MySQL directly
  // So we validate by calling an API endpoint that has database access
  try {
    const baseUrl = new URL(request.url);
    const validateUrl = new URL('/api/validate-session', baseUrl.origin);
    
    const validateResponse = await fetch(validateUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': request.headers.get('cookie') || '',
      },
      body: JSON.stringify({ token: sessionCookie.value }),
    });

    if (!validateResponse.ok) {
      throw new Error('Validation request failed');
    }

    const validationResult = await validateResponse.json();
    
    if (!validationResult.valid) {
      console.log('Middleware: Session not found or expired for token:', sessionCookie.value.substring(0, 10) + '...');
      // Invalid or expired session, redirect to login
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      const response = NextResponse.redirect(loginUrl);
      // Clear invalid cookie
      response.cookies.delete('skycity_session');
      return response;
    }

    console.log('Middleware: Session validated for user:', validationResult.username);
    return NextResponse.next();
  } catch (error) {
    // If validation fails, redirect to login for security
    console.log('Middleware: Session validation failed:', error);
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete('skycity_session');
    return response;
  }
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

