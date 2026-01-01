'use client';

import { useState, useEffect } from 'react';
import { ActivityStatementRow, PreCommitmentPlayer, PlayerData, QuarterlyData, DailyTransaction } from '@/types/player-data';

interface EditMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: string;
  batchId: string;
  onSave?: () => void;
}

export default function EditMemberModal({ isOpen, onClose, account, batchId, onSave }: EditMemberModalProps) {
  const [activeTab, setActiveTab] = useState<'activity' | 'precommitment' | 'cashless'>('activity');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Data states
  const [activity, setActivity] = useState<ActivityStatementRow | null>(null);
  const [preCommitment, setPreCommitment] = useState<PreCommitmentPlayer | null>(null);
  const [cashless, setCashless] = useState<PlayerData | null>(null);
  const [quarterlyData, setQuarterlyData] = useState<QuarterlyData | null>(null);

  // Cashless transactions state
  const [dailyTransactions, setDailyTransactions] = useState<DailyTransaction[]>([]);

  useEffect(() => {
    if (isOpen && account && batchId) {
      loadMemberData();
    }
  }, [isOpen, account, batchId]);

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
    if (cashless) {
      // Sort transactions by date (latest first)
      const sorted = [...cashless.dailyTransactions].sort((a, b) => {
        const dateA = parseDateForSort(a.gamingDate);
        const dateB = parseDateForSort(b.gamingDate);
        // Sort descending (newest first)
        return dateB.getTime() - dateA.getTime();
      });
      setDailyTransactions(sorted);
    }
  }, [cashless]);

  const parseDateForSort = (dateStr: string): Date => {
    if (!dateStr) return new Date(0); // Put empty dates at the end
    
    // Try to parse DD/MM/YYYY format
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
      const year = parseInt(parts[2], 10);
      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        return new Date(year, month, day);
      }
    }
    
    // Fallback to standard date parsing
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? new Date(0) : parsed;
  };

  const loadMemberData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/member-data/${encodeURIComponent(account)}/${batchId}`);
      const data = await response.json();
      
      if (data.success) {
        setActivity(data.data.activity);
        setPreCommitment(data.data.preCommitment);
        setCashless(data.data.cashless);
        setQuarterlyData(data.data.quarterlyData);
      } else {
        setError(data.error || 'Failed to load member data');
      }
    } catch (err) {
      setError('Failed to load member data');
      console.error('Error loading member data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    
    try {
      // Update cashless with edited transactions
      let updatedCashless = cashless;
      if (cashless && dailyTransactions) {
        updatedCashless = {
          ...cashless,
          dailyTransactions: dailyTransactions,
        };
      }

      const response = await fetch(`/api/member-data/${encodeURIComponent(account)}/${batchId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          activity,
          preCommitment,
          cashless: updatedCashless,
          quarterlyData,
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        if (onSave) {
          onSave();
        }
        onClose();
        alert('Member data saved successfully');
      } else {
        setError(data.error || 'Failed to save member data');
      }
    } catch (err) {
      setError('Failed to save member data');
      console.error('Error saving member data:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleActivityChange = (field: keyof ActivityStatementRow, value: string) => {
    if (activity) {
      setActivity({ ...activity, [field]: value });
    }
  };

  const handlePreCommitmentChange = (field: keyof PreCommitmentPlayer, value: string) => {
    if (preCommitment) {
      setPreCommitment({ ...preCommitment, [field]: value });
    }
  };

  const handleTransactionChange = (index: number, field: keyof DailyTransaction, value: string | number) => {
    const updated = [...dailyTransactions];
    updated[index] = { ...updated[index], [field]: value };
    
    // If date field changed, re-sort the transactions
    if (field === 'gamingDate') {
      updated.sort((a, b) => {
        const dateA = parseDateForSort(a.gamingDate);
        const dateB = parseDateForSort(b.gamingDate);
        return dateB.getTime() - dateA.getTime();
      });
    }
    
    setDailyTransactions(updated);
  };

  const handleAddTransaction = () => {
    const newTransaction: DailyTransaction = {
      gamingDate: '',
      cashToCard: 0,
      gameCreditToCard: 0,
      cardCreditToGame: 0,
      betsPlaced: 0,
      deviceWin: 0,
      netWinLoss: 0,
    };
    // Add new transaction at the beginning (top) since we sort by latest first
    setDailyTransactions([newTransaction, ...dailyTransactions]);
  };

  const handleDeleteTransaction = (index: number) => {
    if (confirm('Are you sure you want to delete this transaction?')) {
      const updated = dailyTransactions.filter((_, i) => i !== index);
      setDailyTransactions(updated);
    }
  };

  const formatNumber = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return '';
    return value.toString();
  };

  const parseNumber = (value: string): number => {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0 : parsed;
  };

  const validateDate = (date: string): boolean => {
    if (!date) return true; // Allow empty dates
    // Check DD/MM/YYYY format
    const dateRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
    if (!dateRegex.test(date)) return false;
    const [, day, month, year] = date.match(dateRegex)!;
    const d = parseInt(day, 10);
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    if (m < 1 || m > 12) return false;
    if (d < 1 || d > 31) return false;
    return true;
  };

  const validateNumericField = (value: string): boolean => {
    if (!value) return true; // Allow empty values
    return !isNaN(parseFloat(value));
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
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-xl font-semibold">Edit Member Data - Account {account}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6">
            <button
              onClick={() => setActiveTab('activity')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'activity'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Activity Statement
            </button>
            <button
              onClick={() => setActiveTab('precommitment')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'precommitment'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Pre-Commitment
            </button>
            <button
              onClick={() => setActiveTab('cashless')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'cashless'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Cashless Statement
            </button>
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="text-center py-12">
              <p className="text-gray-500">Loading member data...</p>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-800">{error}</p>
            </div>
          ) : (
            <>
              {/* Activity Statement Tab */}
              {activeTab === 'activity' && activity && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold mb-4">Activity Statement Data</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {Object.keys(activity).map((key) => (
                      <div key={key}>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                        </label>
                        <input
                          type="text"
                          value={activity[key as keyof ActivityStatementRow] || ''}
                          onChange={(e) => handleActivityChange(key as keyof ActivityStatementRow, e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Pre-Commitment Tab */}
              {activeTab === 'precommitment' && preCommitment && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold mb-4">Pre-Commitment Data</h3>
                  
                  {/* Player Info */}
                  <div className="mb-6">
                    <h4 className="text-md font-semibold mb-3">Player Information</h4>
                    <div className="grid grid-cols-2 gap-4">
                      {preCommitment.playerInfo && Object.keys(preCommitment.playerInfo).map((key) => (
                        <div key={key}>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                          </label>
                          <input
                            type="text"
                            value={preCommitment.playerInfo[key as keyof typeof preCommitment.playerInfo] || ''}
                            onChange={(e) => {
                              setPreCommitment({
                                ...preCommitment,
                                playerInfo: {
                                  ...preCommitment.playerInfo,
                                  [key]: e.target.value,
                                },
                              });
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Pre-Commitment Fields */}
                  <div className="grid grid-cols-2 gap-4">
                    {Object.keys(preCommitment)
                      .filter(key => key !== 'playerInfo' && key !== 'sessionSummaries')
                      .map((key) => {
                        const value = preCommitment[key as keyof PreCommitmentPlayer];
                        // Convert to string, handling null/undefined
                        const stringValue = value != null ? String(value) : '';
                        return (
                          <div key={key}>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                            </label>
                            <input
                              type="text"
                              value={stringValue}
                              onChange={(e) => handlePreCommitmentChange(key as keyof PreCommitmentPlayer, e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Cashless Statement Tab */}
              {activeTab === 'cashless' && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold">Cashless Statement - Daily Transactions</h3>
                    <button
                      onClick={handleAddTransaction}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
                    >
                      Add Row
                    </button>
                  </div>

                  {dailyTransactions.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <p>No transactions found. Click "Add Row" to add a transaction.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full border border-gray-200 text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left border border-gray-200 font-semibold">Date</th>
                            <th className="px-3 py-2 text-left border border-gray-200 font-semibold">Cashless Card Deposit</th>
                            <th className="px-3 py-2 text-left border border-gray-200 font-semibold">Credits From Card to Game</th>
                            <th className="px-3 py-2 text-left border border-gray-200 font-semibold">Credits From Game to Card</th>
                            <th className="px-3 py-2 text-left border border-gray-200 font-semibold">Total Amount Bet</th>
                            <th className="px-3 py-2 text-left border border-gray-200 font-semibold">Total Amount Won</th>
                            <th className="px-3 py-2 text-left border border-gray-200 font-semibold">Net Amount Won or -(Lost)</th>
                            <th className="px-3 py-2 text-left border border-gray-200 font-semibold">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dailyTransactions.map((transaction, index) => (
                            <tr key={index} className="hover:bg-gray-50">
                              <td className="px-3 py-2 border border-gray-200">
                                <input
                                  type="text"
                                  value={transaction.gamingDate}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    if (validateDate(value) || !value) {
                                      handleTransactionChange(index, 'gamingDate', value);
                                    }
                                  }}
                                  placeholder="DD/MM/YYYY"
                                  className={`w-full px-2 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                                    transaction.gamingDate && !validateDate(transaction.gamingDate)
                                      ? 'border-red-500'
                                      : 'border-gray-300'
                                  }`}
                                />
                                {transaction.gamingDate && !validateDate(transaction.gamingDate) && (
                                  <p className="text-xs text-red-500 mt-1">Invalid date format (DD/MM/YYYY)</p>
                                )}
                              </td>
                              <td className="px-3 py-2 border border-gray-200">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={formatNumber(transaction.cashToCard)}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    if (validateNumericField(value) || !value) {
                                      handleTransactionChange(index, 'cashToCard', parseNumber(value));
                                    }
                                  }}
                                  className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              </td>
                              <td className="px-3 py-2 border border-gray-200">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={formatNumber(transaction.cardCreditToGame)}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    if (validateNumericField(value) || !value) {
                                      handleTransactionChange(index, 'cardCreditToGame', parseNumber(value));
                                    }
                                  }}
                                  className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              </td>
                              <td className="px-3 py-2 border border-gray-200">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={formatNumber(transaction.gameCreditToCard)}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    if (validateNumericField(value) || !value) {
                                      handleTransactionChange(index, 'gameCreditToCard', parseNumber(value));
                                    }
                                  }}
                                  className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              </td>
                              <td className="px-3 py-2 border border-gray-200">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={formatNumber(transaction.betsPlaced)}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    if (validateNumericField(value) || !value) {
                                      handleTransactionChange(index, 'betsPlaced', parseNumber(value));
                                    }
                                  }}
                                  className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              </td>
                              <td className="px-3 py-2 border border-gray-200">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={formatNumber(transaction.deviceWin)}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    if (validateNumericField(value) || !value) {
                                      handleTransactionChange(index, 'deviceWin', parseNumber(value));
                                    }
                                  }}
                                  className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              </td>
                              <td className="px-3 py-2 border border-gray-200">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={formatNumber(transaction.netWinLoss)}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    if (validateNumericField(value) || !value) {
                                      handleTransactionChange(index, 'netWinLoss', parseNumber(value));
                                    }
                                  }}
                                  className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              </td>
                              <td className="px-3 py-2 border border-gray-200">
                                <button
                                  onClick={() => handleDeleteTransaction(index)}
                                  className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition-colors"
                                  title="Delete row"
                                >
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-5 w-5"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                    />
                                  </svg>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'activity' && !activity && (
                <div className="text-center py-12 text-gray-500">
                  <p>No activity statement data available for this member.</p>
                </div>
              )}

              {activeTab === 'precommitment' && !preCommitment && (
                <div className="text-center py-12 text-gray-500">
                  <p>No pre-commitment data available for this member.</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}


















