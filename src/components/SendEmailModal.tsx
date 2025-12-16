'use client';

import { useState, useEffect } from 'react';

interface SendEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: string;
  batchId: string;
  memberName: string;
  memberEmail: string;
  type?: 'quarterly' | 'play' | 'no-play';
  onSuccess?: () => void;
}

export default function SendEmailModal({ 
  isOpen, 
  onClose, 
  account, 
  batchId, 
  memberName,
  memberEmail,
  type = 'quarterly',
  onSuccess 
}: SendEmailModalProps) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      // Reset state when modal closes
      setError(null);
      setSuccess(false);
      setSending(false);
    }
  }, [isOpen]);

  const handleSend = async () => {
    setSending(true);
    setError(null);
    setSuccess(false);

    try {
      // Determine API endpoint based on type
      const apiEndpoint = 
        type === 'play' ? '/api/send-play-member-pdf' :
        type === 'no-play' ? '/api/send-no-play-member-pdf' :
        '/api/send-member-pdf';

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          account,
          batchId,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(true);
        // Close modal after 2 seconds
        setTimeout(() => {
          onClose();
          if (onSuccess) {
            onSuccess();
          }
        }, 2000);
      } else {
        setError(data.error || 'Failed to send email');
      }
    } catch (err) {
      setError('Failed to send email. Please try again.');
      console.error('Error sending email:', err);
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-xl font-semibold">Send Email</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl"
            disabled={sending}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          {success ? (
            <div className="text-center py-4">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 mb-4">
                <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Email Sent Successfully!</h3>
              <p className="text-sm text-gray-500">The PDF has been sent to {memberEmail}</p>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <p className="text-sm text-gray-600 mb-4">
                  Are you sure you want to send the {
                    type === 'play' ? 'Play Pre-Commitment' :
                    type === 'no-play' ? 'No-Play Pre-Commitment' :
                    'quarterly statement'
                  } PDF to this member?
                </p>
                
                <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                  <div>
                    <span className="text-xs font-medium text-gray-500">Account Number:</span>
                    <p className="text-sm text-gray-900">{account}</p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-gray-500">Member Name:</span>
                    <p className="text-sm text-gray-900">{memberName || 'N/A'}</p>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-gray-500">Email Address:</span>
                    <p className="text-sm text-gray-900">{memberEmail}</p>
                  </div>
                </div>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!success && (
          <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              disabled={sending}
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={sending}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? (
                <span className="flex items-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Sending...
                </span>
              ) : (
                'Send Email'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

