'use client';

import { useState, useEffect, useCallback } from 'react';
import Navigation from '@/components/Navigation';

interface EmailTracking {
  id: string;
  recipient_email: string;
  recipient_account: string | null;
  recipient_name: string | null;
  email_type: 'quarterly' | 'no-play' | 'play' | 'pre-commitment' | 'other';
  batch_id: string | null;
  subject: string;
  sendgrid_message_id: string | null;
  status: 'pending' | 'sent' | 'delivered' | 'bounced' | 'failed';
  sent_at: string | null;
  opened_at: string | null;
  open_count: number;
  last_opened_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export default function EmailReportsPage() {
  const [emailRecords, setEmailRecords] = useState<EmailTracking[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [total, setTotal] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize] = useState<number>(50);
  
  // Filters
  const [filters, setFilters] = useState({
    search: '',
    email_type: '',
    status: '',
    recipient_account: '',
    start_date: '',
    end_date: '',
  });

  const loadEmailRecords = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      
      if (filters.search) params.append('search', filters.search);
      if (filters.email_type) params.append('email_type', filters.email_type);
      if (filters.status) params.append('status', filters.status);
      if (filters.recipient_account) params.append('recipient_account', filters.recipient_account);
      if (filters.start_date) params.append('start_date', filters.start_date);
      if (filters.end_date) params.append('end_date', filters.end_date);
      
      params.append('limit', pageSize.toString());
      params.append('offset', ((currentPage - 1) * pageSize).toString());
      
      const response = await fetch(`/api/email-tracking?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setEmailRecords(data.records || []);
          setTotal(data.total || 0);
        }
      }
    } catch (error) {
      console.error('Error loading email records:', error);
    } finally {
      setLoading(false);
    }
  }, [filters, currentPage, pageSize]);

  useEffect(() => {
    loadEmailRecords();
  }, [loadEmailRecords]);

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setCurrentPage(1); // Reset to first page when filters change
  };

  const clearFilters = () => {
    setFilters({
      search: '',
      email_type: '',
      status: '',
      recipient_account: '',
      start_date: '',
      end_date: '',
    });
    setCurrentPage(1);
  };

  // Format recipient name: remove titles and fix duplicate last names
  const formatRecipientName = (name: string | null): string => {
    if (!name) return '';
    
    // Remove common titles (case-insensitive)
    let formatted = name
      .replace(/^(Mr\.?|Ms\.?|Mrs\.?|Miss|Dr\.?|Prof\.?|Sir|Madam)\s+/i, '')
      .trim();
    
    // Fix duplicate last names (e.g., "Monares Monares" -> "Monares")
    const parts = formatted.split(/\s+/);
    if (parts.length >= 2) {
      const lastPart = parts[parts.length - 1];
      const secondLastPart = parts[parts.length - 2];
      
      // If last two parts are the same, remove the duplicate
      if (lastPart.toLowerCase() === secondLastPart.toLowerCase()) {
        parts.pop(); // Remove the last duplicate
        formatted = parts.join(' ');
      }
    }
    
    return formatted;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'sent':
      case 'delivered':
        return 'bg-green-100 text-green-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'bounced':
      case 'failed':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getEmailTypeLabel = (type: string) => {
    switch (type) {
      case 'quarterly':
        return 'Quarterly';
      case 'no-play':
        return 'No-Play';
      case 'play':
        return 'Play';
      case 'pre-commitment':
        return 'Pre-Commitment';
      default:
        return type;
    }
  };

  // Calculate statistics
  const stats = {
    total: total,
    sent: emailRecords.filter(r => r.status === 'sent' || r.status === 'delivered').length,
    opened: emailRecords.filter(r => r.open_count > 0).length,
    bounced: emailRecords.filter(r => r.status === 'bounced').length,
    failed: emailRecords.filter(r => r.status === 'failed').length,
  };

  const openRate = stats.sent > 0 ? ((stats.opened / stats.sent) * 100).toFixed(1) : '0.0';

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <div className="w-full px-6 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Email Reports
          </h1>
          <p className="text-gray-600">
            Track email sends and opens
          </p>
        </div>

        {/* Statistics Summary */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-600 mb-1">Total Sent</div>
            <div className="text-2xl font-bold text-gray-900">{stats.total.toLocaleString()}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-600 mb-1">Delivered</div>
            <div className="text-2xl font-bold text-green-600">{stats.sent.toLocaleString()}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-600 mb-1">Opened</div>
            <div className="text-2xl font-bold text-blue-600">{stats.opened.toLocaleString()}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-600 mb-1">Open Rate</div>
            <div className="text-2xl font-bold text-purple-600">{openRate}%</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-600 mb-1">Bounced/Failed</div>
            <div className="text-2xl font-bold text-red-600">{(stats.bounced + stats.failed).toLocaleString()}</div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
              <input
                type="text"
                value={filters.search}
                onChange={(e) => handleFilterChange('search', e.target.value)}
                placeholder="Email, account, name..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email Type</label>
              <select
                value={filters.email_type}
                onChange={(e) => handleFilterChange('email_type', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="">All Types</option>
                <option value="quarterly">Quarterly</option>
                <option value="no-play">No-Play</option>
                <option value="play">Play</option>
                <option value="pre-commitment">Pre-Commitment</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={filters.status}
                onChange={(e) => handleFilterChange('status', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="sent">Sent</option>
                <option value="delivered">Delivered</option>
                <option value="bounced">Bounced</option>
                <option value="failed">Failed</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Account</label>
              <input
                type="text"
                value={filters.recipient_account}
                onChange={(e) => handleFilterChange('recipient_account', e.target.value)}
                placeholder="Account number"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
              <input
                type="date"
                value={filters.start_date}
                onChange={(e) => handleFilterChange('start_date', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
              <input
                type="date"
                value={filters.end_date}
                onChange={(e) => handleFilterChange('end_date', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
          </div>
          <div className="mt-4">
            <button
              onClick={clearFilters}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
            >
              Clear Filters
            </button>
          </div>
        </div>

        {/* Email Records Table */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading email records...</div>
          ) : emailRecords.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p className="text-lg mb-2">No email records found</p>
              <p className="text-sm">Email tracking records will appear here once emails are sent.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Recipient
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Account
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Subject
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Sent
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Opens
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Last Opened
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {emailRecords.map((record) => (
                      <tr key={record.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            {record.recipient_name 
                              ? formatRecipientName(record.recipient_name) 
                              : record.recipient_email}
                          </div>
                          <div className="text-sm text-gray-500">{record.recipient_email}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {record.recipient_account || '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {getEmailTypeLabel(record.email_type)}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate">
                          {record.subject}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(record.status)}`}>
                            {record.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {record.sent_at ? new Date(record.sent_at).toLocaleString() : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {record.open_count > 0 ? (
                            <span className="text-green-600 font-medium">{record.open_count}</span>
                          ) : (
                            <span className="text-gray-400">0</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {record.last_opened_at ? new Date(record.last_opened_at).toLocaleString() : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="bg-gray-50 px-6 py-4 flex items-center justify-between border-t border-gray-200">
                  <div className="text-sm text-gray-700">
                    Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, total)} of {total} records
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    <span className="px-4 py-2 text-sm text-gray-700">
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={currentPage === totalPages}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}







