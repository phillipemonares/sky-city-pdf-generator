'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import Setup2FAModal from '@/components/Setup2FAModal';

export default function SettingsPage() {
  const router = useRouter();
  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [disabling, setDisabling] = useState(false);

  useEffect(() => {
    fetch2FAStatus();
  }, []);

  const fetch2FAStatus = async () => {
    try {
      const response = await fetch('/api/get-2fa-status');
      const data = await response.json();

      if (data.success) {
        setTotpEnabled(data.totpEnabled);
      } else {
        if (response.status === 401) {
          router.push('/login');
          return;
        }
        setError(data.error || 'Failed to fetch 2FA status');
      }
    } catch (error) {
      console.error('Error fetching 2FA status:', error);
      setError('An error occurred while fetching 2FA status');
    } finally {
      setLoading(false);
    }
  };

  const handleDisable2FA = async () => {
    if (!confirm('Are you sure you want to disable 2FA? This will make your account less secure.')) {
      return;
    }

    setDisabling(true);
    setError('');

    try {
      const response = await fetch('/api/disable-2fa', {
        method: 'POST',
      });

      const data = await response.json();

      if (data.success) {
        setTotpEnabled(false);
      } else {
        setError(data.error || 'Failed to disable 2FA');
      }
    } catch (error) {
      console.error('Error disabling 2FA:', error);
      setError('An error occurred while disabling 2FA');
    } finally {
      setDisabling(false);
    }
  };

  const handleSetupSuccess = () => {
    setTotpEnabled(true);
    setShowSetupModal(false);
  };

  if (loading) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading settings...</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navigation />
      <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Settings</h1>

        <div className="bg-white shadow rounded-lg">
          <div className="px-6 py-5 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Two-Factor Authentication</h2>
          </div>

          <div className="px-6 py-5">
            {error && (
              <div className="mb-4 rounded-md bg-red-50 p-4">
                <div className="flex">
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-red-800">{error}</h3>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">Status</p>
                  <p className="text-sm text-gray-500">
                    {totpEnabled
                      ? 'Two-factor authentication is enabled'
                      : 'Two-factor authentication is not enabled'}
                  </p>
                </div>
                <div className="flex items-center">
                  <span
                    className={`px-3 py-1 text-sm font-medium rounded-full ${
                      totpEnabled
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {totpEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-200">
                {totpEnabled ? (
                  <div className="space-y-3">
                    <button
                      onClick={() => setShowSetupModal(true)}
                      className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors"
                    >
                      Re-setup 2FA
                    </button>
                    <button
                      onClick={handleDisable2FA}
                      disabled={disabling}
                      className={`ml-3 px-4 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100 transition-colors ${
                        disabling ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                    >
                      {disabling ? 'Disabling...' : 'Disable 2FA'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowSetupModal(true)}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
                  >
                    Enable 2FA
                  </button>
                )}
              </div>

              <div className="pt-4 border-t border-gray-200">
                <p className="text-xs text-gray-500">
                  Two-factor authentication adds an extra layer of security to your account.
                  You'll need to enter a code from your authenticator app every time you log in.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Setup2FAModal
        isOpen={showSetupModal}
        onClose={() => setShowSetupModal(false)}
        onSuccess={handleSetupSuccess}
      />
      </div>
    </>
  );
}




