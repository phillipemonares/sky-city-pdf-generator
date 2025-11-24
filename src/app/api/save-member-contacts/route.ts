import { NextRequest, NextResponse } from 'next/server';
import { saveMembersFromMemberContact } from '@/lib/db';
import { MemberContactData } from '@/lib/pc-parser';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { memberContacts } = body;

    if (!memberContacts || !Array.isArray(memberContacts) || memberContacts.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No member contact data provided' },
        { status: 400 }
      );
    }

    // Validate member contact data structure
    const validContacts: MemberContactData[] = memberContacts.filter((contact: any) => {
      return contact && contact.accountNumber;
    });

    if (validContacts.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid member contact data found' },
        { status: 400 }
      );
    }

    // Save members to database
    const savedCount = await saveMembersFromMemberContact(validContacts);

    // Calculate updated count (total - new)
    const updatedCount = validContacts.length - savedCount;

    return NextResponse.json({
      success: true,
      savedCount,
      updatedCount,
      totalProcessed: validContacts.length,
    });
  } catch (error) {
    console.error('Error saving member contacts:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save member contacts to database' },
      { status: 500 }
    );
  }
}









