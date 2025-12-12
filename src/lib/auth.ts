import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getUserByUsername, createSession as createDbSession, getSessionByToken, deleteSession as deleteDbSession } from './db';
import { randomBytes } from 'crypto';
import speakeasy from 'speakeasy';

const SESSION_COOKIE_NAME = 'skycity_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Create a session token
 */
export function createSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Set session cookie
 */
export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });
}

/**
 * Get session token from cookie
 */
export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE_NAME);
  return session?.value || null;
}

/**
 * Clear session cookie
 */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

/**
 * Create a session in the database
 */
export async function createSession(token: string, username: string): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000);
  await createDbSession(token, username, expiresAt);
  console.log('Session created:', { token: token.substring(0, 10) + '...', username, expiresAt });
}

/**
 * Get session data from database
 */
export async function getSession(token: string | null): Promise<{ username: string } | null> {
  if (!token) {
    console.log('getSession: No token provided');
    return null;
  }
  
  console.log('getSession: Looking for token:', token.substring(0, 10) + '...');
  const session = await getSessionByToken(token);
  if (!session) {
    console.log('getSession: Session not found in database');
    return null;
  }
  
  console.log('getSession: Session found for user:', session.username);
  return { username: session.username };
}

/**
 * Delete a session from database
 */
export async function deleteSession(token: string): Promise<void> {
  await deleteDbSession(token);
}

/**
 * Authenticate user with username and password
 */
export async function authenticateUser(username: string, password: string): Promise<boolean> {
  try {
    const user = await getUserByUsername(username);
    if (!user) {
      return false;
    }
    
    const isValid = await verifyPassword(password, user.password_hash);
    return isValid;
  } catch (error) {
    console.error('Error authenticating user:', error);
    return false;
  }
}

/**
 * Middleware to check if user is authenticated
 */
export async function requireAuth(request: NextRequest): Promise<{ authenticated: boolean; response?: NextResponse }> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  
  if (!sessionToken) {
    return { authenticated: false, response: NextResponse.redirect(new URL('/login', request.url)) };
  }
  
  const session = await getSession(sessionToken);
  if (!session) {
    return { authenticated: false, response: NextResponse.redirect(new URL('/login', request.url)) };
  }
  
  return { authenticated: true };
}

/**
 * Get current authenticated user
 */
export async function getCurrentUser(): Promise<{ username: string } | null> {
  const sessionToken = await getSessionToken();
  if (!sessionToken) {
    return null;
  }
  
  return await getSession(sessionToken);
}

/**
 * Get current authenticated user with role
 */
export async function getCurrentUserWithRole(): Promise<{ username: string; role: 'admin' | 'team_member' } | null> {
  const sessionToken = await getSessionToken();
  if (!sessionToken) {
    return null;
  }
  
  const session = await getSession(sessionToken);
  if (!session) {
    return null;
  }
  
  const user = await getUserByUsername(session.username);
  if (!user) {
    return null;
  }
  
  return {
    username: user.username,
    role: user.role,
  };
}

/**
 * Check if current user is admin
 */
export async function isAdmin(): Promise<boolean> {
  const user = await getCurrentUserWithRole();
  return user?.role === 'admin';
}

/**
 * Require admin role - returns error response if not admin
 */
export async function requireAdmin(request: NextRequest): Promise<{ authorized: boolean; response?: NextResponse }> {
  const authResult = await requireAuth(request);
  if (!authResult.authenticated) {
    return {
      authorized: false,
      response: authResult.response,
    };
  }
  
  const user = await getCurrentUserWithRole();
  if (!user || user.role !== 'admin') {
    return {
      authorized: false,
      response: NextResponse.json(
        { success: false, error: 'Admin access required' },
        { status: 403 }
      ),
    };
  }
  
  return { authorized: true };
}

/**
 * Generate a TOTP secret for a user
 */
export function generateTotpSecret(): { secret: string; base32: string } {
  const secret = speakeasy.generateSecret({
    name: process.env.TOTP_ISSUER || 'SkyCity Adelaide',
    length: 32,
  });
  
  return {
    secret: secret.base32 || '',
    base32: secret.base32 || '',
  };
}

/**
 * Generate TOTP URL for QR code
 */
export function generateTotpUrl(secret: string, username: string): string {
  const issuer = process.env.TOTP_ISSUER || 'SkyCity Adelaide';
  return speakeasy.otpauthURL({
    secret: secret,
    label: username,
    issuer: issuer,
    encoding: 'base32',
  });
}

/**
 * Verify a TOTP token against a secret
 */
export function verifyTotpToken(secret: string, token: string): boolean {
  try {
    const verified = speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: token,
      window: 1, // Allow ±1 time step (30 seconds) for clock drift
    });
    return verified === true;
  } catch (error) {
    console.error('Error verifying TOTP token:', error);
    return false;
  }
}

