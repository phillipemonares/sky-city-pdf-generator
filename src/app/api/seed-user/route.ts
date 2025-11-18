import { NextRequest, NextResponse } from 'next/server';
import { createUser, getUserByUsername } from '@/lib/db';
import { hashPassword } from '@/lib/auth';

const DEFAULT_USERNAME = 'stephen@dailypress.com.au';
const DEFAULT_PASSWORD = 'Nfx07BoJ83jc';

/**
 * API route to seed the default user
 * This should only be run once after creating the users table
 * In production, you might want to add additional security checks
 */
export async function POST(request: NextRequest) {
  try {
    // Check if user already exists
    const existing = await getUserByUsername(DEFAULT_USERNAME);
    
    if (existing) {
      return NextResponse.json(
        { success: false, error: 'Default user already exists' },
        { status: 400 }
      );
    }

    // Hash the password
    const passwordHash = await hashPassword(DEFAULT_PASSWORD);

    // Create the user
    await createUser(DEFAULT_USERNAME, passwordHash);

    return NextResponse.json({
      success: true,
      message: 'Default user created successfully',
      username: DEFAULT_USERNAME,
    });
  } catch (error: any) {
    console.error('Error seeding default user:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'An error occurred while seeding the user' },
      { status: 500 }
    );
  }
}






