import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getUserByUsername, createSession as createDbSession, getSessionByToken, deleteSession as deleteDbSession } from './db';
import { randomBytes } from 'crypto';

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

