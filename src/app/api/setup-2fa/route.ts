import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { generateTotpSecret, generateTotpUrl } from '@/lib/auth';
import QRCode from 'qrcode';

export async function GET(request: NextRequest) {
  try {
    // Check if user is authenticated
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Generate TOTP secret
    const { secret, base32 } = generateTotpSecret();
    
    // Generate TOTP URL
    const totpUrl = generateTotpUrl(base32, currentUser.username);
    
    // Generate QR code as data URL
    const qrCodeDataUrl = await QRCode.toDataURL(totpUrl);

    return NextResponse.json({
      success: true,
      secret: base32,
      qrCode: qrCodeDataUrl,
      totpUrl: totpUrl,
    });
  } catch (error) {
    console.error('Error setting up 2FA:', error);
    return NextResponse.json(
      { success: false, error: 'An error occurred while setting up 2FA' },
      { status: 500 }
    );
  }
}




