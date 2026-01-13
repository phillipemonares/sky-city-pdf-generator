import { NextRequest, NextResponse } from 'next/server';
import { updateUser, getUserById } from '@/lib/db';
import { hashPassword, requireAdmin } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    // Check if user is admin
    const adminCheck = await requireAdmin(request);
    if (!adminCheck.authorized) {
      return adminCheck.response || NextResponse.json(
        { success: false, error: 'Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { userId, email, password, role } = body;

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'User ID is required' },
        { status: 400 }
      );
    }

    // Check if user exists
    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // Build update object
    const updates: {
      username?: string;
      passwordHash?: string;
      role?: 'admin' | 'team_member';
    } = {};

    // Update email/username if provided
    if (email !== undefined && email !== null && email !== '') {
      updates.username = email;
    }

    // Update password if provided
    if (password !== undefined && password !== null && password !== '') {
      if (password.length < 14) {
        return NextResponse.json(
          { success: false, error: 'Password must be at least 14 characters long' },
          { status: 400 }
        );
      }
      updates.passwordHash = await hashPassword(password);
    }

    // Update role if provided
    if (role !== undefined && role !== null) {
      updates.role = role === 'admin' ? 'admin' : 'team_member';
    }

    // Check if there are any updates
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No updates provided' },
        { status: 400 }
      );
    }

    // Update user
    await updateUser(userId, updates);

    return NextResponse.json({
      success: true,
      message: 'User updated successfully',
    });
  } catch (error) {
    console.error('Error updating user:', error);
    
    if (error instanceof Error) {
      if (error.message === 'User not found') {
        return NextResponse.json(
          { success: false, error: 'User not found' },
          { status: 404 }
        );
      }
      if (error.message === 'A user with this username already exists') {
        return NextResponse.json(
          { success: false, error: 'A user with this email already exists' },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { success: false, error: 'Failed to update user' },
      { status: 500 }
    );
  }
}




















