import { NextRequest, NextResponse } from 'next/server';
import { createUser } from '@/lib/db';
import { hashPassword } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: 'Username and password are required' },
        { status: 400 }
      );
    }

    if (password.length < 14) {
      return NextResponse.json(
        { success: false, error: 'Password must be at least 14 characters long' },
        { status: 400 }
      );
    }

    // Hash the password
    const passwordHash = await hashPassword(password);

    // Create user in database
    const userId = await createUser(username, passwordHash);

    return NextResponse.json({
      success: true,
      message: 'User created successfully',
      userId,
    });
  } catch (error) {
    console.error('Error creating user:', error);
    
    if (error instanceof Error && error.message === 'User already exists') {
      return NextResponse.json(
        { success: false, error: 'A user with this username already exists' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to create user' },
      { status: 500 }
    );
  }
}

