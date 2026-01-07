'use client';

import { useState, useEffect } from 'react';

interface Setup2FAModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function Setup2FAModal({ isOpen, onClose, onSuccess }: Setup2FAModalProps) {
  const [qrCode, setQrCode] = useState<string>('');
  const [secret, setSecret] = useState<string>('');
  const [verificationCode, setVerificationCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Fetch 2FA setup data when modal opens
      fetchSetupData();
    } else {
      // Reset state when modal closes
      setQrCode('');
      setSecret('');
      setVerificationCode('');
      setError('');
    }
  }, [isOpen]);

  const fetchSetupData = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/setup-2fa');
      const data = await response.json();

      if (data.success) {
        setQrCode(data.qrCode);
        setSecret(data.secret);
      } else {
        setError(data.error || 'Failed to generate 2FA setup');
      }
    } catch (error) {
      console.error('Error fetching 2FA setup:', error);
      setError('An error occurred while setting up 2FA');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setVerifying(true);

    try {
      const response = await fetch('/api/verify-2fa-setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ secret, token: verificationCode }),
      });

      const data = await response.json();

      if (data.success) {
        onSuccess();
        onClose();
      } else {
        setError(data.error || 'Invalid verification code');
      }
    } catch (error) {
      console.error('Error verifying 2FA setup:', error);
      setError('An error occurred while verifying 2FA setup');
    } finally {
      setVerifying(false);
    }
  };

  const copySecret = () => {
    navigator.clipboard.writeText(secret);
    // You could add a toast notification here
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Set Up Two-Factor Authentication</h2>

        {loading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Generating QR code...</p>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-4">
                  Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
                </p>
                <div className="flex justify-center bg-white p-4 rounded-lg border-2 border-gray-200">
                  {qrCode && (
                    <img
                      src={qrCode}
                      alt="2FA QR Code"
                      className="w-48 h-48"
                    />
                  )}
                </div>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm font-medium text-gray-700 mb-2">Manual Entry (if you can't scan)</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-white px-3 py-2 rounded border border-gray-300 font-mono break-all">
                    {secret}
                  </code>
                  <button
                    onClick={copySecret}
                    className="px-3 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div className="border-t pt-4">
                <p className="text-sm text-gray-600 mb-3">
                  After scanning, enter the 6-digit code from your app to verify:
                </p>
                <form onSubmit={handleVerify}>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-center text-2xl tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="000000"
                    required
                    autoFocus
                  />
                  {error && (
                    <div className="mt-2 text-sm text-red-600">{error}</div>
                  )}
                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      onClick={onClose}
                      className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={verifying || verificationCode.length !== 6}
                      className={`flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors ${
                        verifying || verificationCode.length !== 6 ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                    >
                      {verifying ? 'Verifying...' : 'Verify & Enable'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}





















