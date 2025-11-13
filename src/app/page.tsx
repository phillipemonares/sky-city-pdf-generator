'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import Navigation from '@/components/Navigation';
import {
  parseCSVFile as parseMonthlyCSVFile,
  transformCSVToPlayerData,
  aggregateQuarterlyData,
  validateCSVStructure,
} from '@/lib/csv-parser';
import {
  parseActivityExcel,
  parseActivityCSV,
  validateActivityFile,
} from '@/lib/activity-parser';
import {
  parseExcelFile as parsePreCommitmentExcel,
  parseCSVFile as parsePreCommitmentCSV,
  validatePreCommitmentFile,
} from '@/lib/pc-parser';
import { buildAnnotatedPlayers } from '@/lib/annotated-pdf-template';
import {
  PlayerData,
  QuarterlyData,
  ActivityStatementRow,
  PreCommitmentPlayer,
  AnnotatedStatementPlayer,
} from '@/types/player-data';

interface UploadedFile {
  file: File;
  content: string;
  month: number;
  year: number;
  data: PlayerData[];
  errors: string[];
}

interface ActivityUpload {
  file: File;
  rows: ActivityStatementRow[];
  errors: string[];
}

interface PreCommitmentUpload {
  file: File;
  players: PreCommitmentPlayer[];
  errors: string[];
}

interface GenerationBatch {
  id: string;
  quarter: number;
  year: number;
  generation_date: string;
  total_accounts: number;
  created_at: string;
  updated_at: string;
}

export default function UploadInterface() {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [activityUpload, setActivityUpload] = useState<ActivityUpload | null>(null);
  const [preCommitmentUpload, setPreCommitmentUpload] = useState<PreCommitmentUpload | null>(null);
  const [quarterlyData, setQuarterlyData] = useState<QuarterlyData | null>(null);
  const [generatingAccount, setGeneratingAccount] = useState<string | null>(null);
  const [previewingAccount, setPreviewingAccount] = useState<string | null>(null);
  const [sendingAccount, setSendingAccount] = useState<string | null>(null);
  const [generationStatus, setGenerationStatus] = useState<string>('');
  const [previousBatches, setPreviousBatches] = useState<GenerationBatch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState<boolean>(false);
  const [loadingBatch, setLoadingBatch] = useState<string | null>(null);
  const [savingBatch, setSavingBatch] = useState<boolean>(false);
  const [deletingBatch, setDeletingBatch] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'generation' | 'history'>('generation');
  const [loadedBatchId, setLoadedBatchId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);

  const annotatedPlayers = useMemo<AnnotatedStatementPlayer[]>(() => {
    if (!activityUpload || !preCommitmentUpload || !quarterlyData) {
      return [];
    }

    return buildAnnotatedPlayers(
      activityUpload.rows,
      preCommitmentUpload.players,
      quarterlyData
    );
  }, [activityUpload, preCommitmentUpload, quarterlyData]);

  // Pagination calculations
  const totalAccounts = annotatedPlayers.length;
  const totalPages = Math.ceil(totalAccounts / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedPlayers = annotatedPlayers.slice(startIndex, endIndex);

  // Reset to page 1 when annotatedPlayers changes
  useEffect(() => {
    setCurrentPage(1);
  }, [annotatedPlayers]);

  const isGenerating = generatingAccount !== null;
  const isPreviewing = previewingAccount !== null;
  const isSending = sendingAccount !== null;

  // Load previous batches on component mount
  useEffect(() => {
    loadPreviousBatches();
  }, []);

  const loadPreviousBatches = async () => {
    try {
      setLoadingBatches(true);
      const response = await fetch('/api/list-batches');
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setPreviousBatches(data.batches);
        }
      }
    } catch (error) {
      console.error('Error loading batches:', error);
    } finally {
      setLoadingBatches(false);
    }
  };

  const loadBatch = async (batchId: string) => {
    try {
      setLoadingBatch(batchId);
      setGenerationStatus(`Loading batch ${batchId}...`);
      
      const response = await fetch(`/api/load-batch?batchId=${batchId}`);
      if (!response.ok) {
        throw new Error('Failed to load batch');
      }

      const data = await response.json();
      if (data.success) {
        // Set the loaded batch ID to prevent duplicate saves
        setLoadedBatchId(batchId);
        
        // Set the loaded data
        if (data.activityRows && data.activityRows.length > 0) {
          setActivityUpload({
            file: new File([], 'loaded-from-database'),
            rows: data.activityRows,
            errors: [],
          });
        }

        if (data.preCommitmentPlayers && data.preCommitmentPlayers.length > 0) {
          setPreCommitmentUpload({
            file: new File([], 'loaded-from-database'),
            players: data.preCommitmentPlayers,
            errors: [],
          });
        }

        if (data.quarterlyData) {
          setQuarterlyData(data.quarterlyData);
        }

        setGenerationStatus(`Loaded batch: Q${data.batch.quarter} ${data.batch.year} with ${data.batch.total_accounts} accounts`);
      }
    } catch (error) {
      console.error('Error loading batch:', error);
      setGenerationStatus('Error loading batch');
    } finally {
      setLoadingBatch(null);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const saveBatch = async () => {
    // Prevent saving if a batch is already loaded (to avoid duplicates)
    if (loadedBatchId) {
      alert('This batch is already saved. Loading a batch from history prevents duplicate saves. Upload new files to create a new batch.');
      return;
    }

    if (!activityUpload || activityUpload.rows.length === 0) {
      alert('Upload an activity statement before saving');
      return;
    }

    if (!preCommitmentUpload || preCommitmentUpload.players.length === 0) {
      alert('Upload the pre-commitment workbook before saving');
      return;
    }

    if (!quarterlyData || quarterlyData.players.length === 0) {
      alert('Upload the three monthly cashless CSV files before saving');
      return;
    }

    if (annotatedPlayers.length === 0) {
      alert('No matched accounts to save');
      return;
    }

    try {
      setSavingBatch(true);
      setGenerationStatus('Saving batch to database...');

      const response = await fetch('/api/save-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          activityRows: activityUpload.rows,
          preCommitmentPlayers: preCommitmentUpload.players,
          quarterlyData,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save batch');
      }

      const data = await response.json();
      if (data.success) {
        // Set the loaded batch ID to the newly saved batch
        setLoadedBatchId(data.batchId);
        setGenerationStatus(
          `Batch saved successfully! Q${data.quarter} ${data.year} with ${data.totalAccounts} accounts`
        );
        // Reload batches list to show the new batch
        loadPreviousBatches();
      }
    } catch (error) {
      console.error('Error saving batch:', error);
      setGenerationStatus('Error saving batch to database');
    } finally {
      setSavingBatch(false);
    }
  };

  const deleteBatch = async (batchId: string) => {
    if (!confirm('Are you sure you want to delete this batch? This action cannot be undone.')) {
      return;
    }

    try {
      setDeletingBatch(batchId);
      setGenerationStatus('Deleting batch...');

      const response = await fetch(`/api/delete-batch?batchId=${batchId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete batch');
      }

      const data = await response.json();
      if (data.success) {
        setGenerationStatus('Batch deleted successfully');
        // Reload batches list to remove the deleted batch
        loadPreviousBatches();
      }
    } catch (error) {
      console.error('Error deleting batch:', error);
      setGenerationStatus('Error deleting batch');
    } finally {
      setDeletingBatch(null);
    }
  };

  const onMonthlyDrop = useCallback((acceptedFiles: File[]) => {
    // Clear loaded batch ID when new files are uploaded
    setLoadedBatchId(null);
    
    const csvFiles = acceptedFiles.filter(file => 
      file.type === 'text/csv' || file.name.endsWith('.csv')
    );

    if (csvFiles.length === 0) {
      alert('Please upload CSV files only');
      return;
    }

    csvFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        
        try {
          const csvRows = parseMonthlyCSVFile(content);
          const validation = validateCSVStructure(csvRows);
          
          if (!validation.isValid) {
            setUploadedFiles(prev => [...prev, {
              file,
              content,
              month: 0,
              year: 0,
              data: [],
              errors: validation.errors
            }]);
            return;
          }

          const playerData = transformCSVToPlayerData(csvRows, file.name);
          const month = playerData[0]?.monthlyTotals.statementMonth || 0;
          const year = playerData[0]?.monthlyTotals.statementYear || 0;

          setUploadedFiles(prev => {
            const newFiles = [...prev, {
              file,
              content,
              month,
              year,
              data: playerData,
              errors: []
            }];

            // Aggregate quarterly data
            const monthlyData = newFiles.map(f => ({
              month: f.month,
              year: f.year,
              data: f.data
            }));

            if (monthlyData.length > 0) {
              try {
                const quarterly = aggregateQuarterlyData(monthlyData);
                setQuarterlyData(quarterly);
              } catch (error) {
                console.error('Error aggregating quarterly data:', error);
              }
            }

            return newFiles;
          });
        } catch (error) {
          console.error('Error processing file:', error);
          setUploadedFiles(prev => [...prev, {
            file,
            content,
            month: 0,
            year: 0,
            data: [],
            errors: [`Error processing file: ${error}`]
          }]);
        }
      };
      reader.readAsText(file);
    });
  }, []);

  const onActivityDrop = useCallback((acceptedFiles: File[]) => {
    // Clear loaded batch ID when new files are uploaded
    setLoadedBatchId(null);
    
    const file = acceptedFiles[0];
    if (!file) {
      alert('Please upload the activity statement file');
      return;
    }

    const validation = validateActivityFile(file);
    if (!validation.isValid) {
      alert(`Activity file validation failed: ${validation.errors.join(', ')}`);
      return;
    }

    const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    const parseFile = extension === '.xlsx' ? parseActivityExcel : parseActivityCSV;

    parseFile(file)
      .then(async rows => {
        setActivityUpload({
          file,
          rows,
          errors: [],
        });
        setGenerationStatus(`Loaded activity statement for ${rows.length} accounts. Saving members to database...`);
        
        // Automatically save/update members in the database
        try {
          const response = await fetch('/api/save-members', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              activityRows: rows,
            }),
          });

          if (response.ok) {
            const data = await response.json();
            if (data.success) {
              setGenerationStatus(
                `Loaded activity statement for ${rows.length} accounts. ` +
                `Saved ${data.savedCount} new members and updated ${data.updatedCount} existing members.`
              );
            } else {
              console.error('Error saving members:', data.error);
              setGenerationStatus(`Loaded activity statement for ${rows.length} accounts. Warning: Failed to save members.`);
            }
          } else {
            console.error('Failed to save members:', response.statusText);
            setGenerationStatus(`Loaded activity statement for ${rows.length} accounts. Warning: Failed to save members.`);
          }
        } catch (error) {
          console.error('Error saving members:', error);
          setGenerationStatus(`Loaded activity statement for ${rows.length} accounts. Warning: Failed to save members.`);
        }
      })
      .catch(error => {
        console.error('Error parsing activity statement:', error);
        setActivityUpload({
          file,
          rows: [],
          errors: [`Error parsing activity statement: ${error.message ?? error}`],
        });
        setGenerationStatus('Error parsing activity statement');
      });
  }, []);

  const onPreCommitmentDrop = useCallback((acceptedFiles: File[]) => {
    // Clear loaded batch ID when new files are uploaded
    setLoadedBatchId(null);
    
    const file = acceptedFiles[0];
    if (!file) {
      alert('Please upload the pre-commitment workbook');
      return;
    }

    const validation = validatePreCommitmentFile(file);
    if (!validation.isValid) {
      alert(`Pre-commitment file validation failed: ${validation.errors.join(', ')}`);
      return;
    }

    const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    const parseFile = extension === '.xlsx'
      ? (f: File) => parsePreCommitmentExcel(f, { filterNoPlay: false })
      : (f: File) => parsePreCommitmentCSV(f, { filterNoPlay: false });

    parseFile(file)
      .then(players => {
        setPreCommitmentUpload({
          file,
          players,
          errors: [],
        });
        setGenerationStatus(`Loaded pre-commitment limits for ${players.length} accounts`);
      })
      .catch(error => {
        console.error('Error parsing pre-commitment workbook:', error);
        setPreCommitmentUpload({
          file,
          players: [],
          errors: [`Error parsing pre-commitment workbook: ${error.message ?? error}`],
        });
        setGenerationStatus('Error parsing pre-commitment workbook');
      });
  }, []);

  const { getRootProps: getMonthlyRootProps, getInputProps: getMonthlyInputProps, isDragActive: isMonthlyDragActive } = useDropzone({
    onDrop: onMonthlyDrop,
    accept: {
      'text/csv': ['.csv']
    },
    multiple: true
  });

  const { getRootProps: getActivityRootProps, getInputProps: getActivityInputProps, isDragActive: isActivityDragActive } = useDropzone({
    onDrop: onActivityDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/csv': ['.csv'],
    },
    multiple: false,
  });

  const { getRootProps: getPreCommitmentRootProps, getInputProps: getPreCommitmentInputProps, isDragActive: isPreCommitmentDragActive } = useDropzone({
    onDrop: onPreCommitmentDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/csv': ['.csv'],
    },
    multiple: false,
  });

  const previewPDF = async (account?: string) => {
    if (!activityUpload || activityUpload.rows.length === 0) {
      alert('Upload an activity statement before generating a preview');
      return;
    }

    if (!preCommitmentUpload || preCommitmentUpload.players.length === 0) {
      alert('Upload the pre-commitment workbook before generating a preview');
      return;
    }

    if (!quarterlyData || quarterlyData.players.length === 0) {
      alert('Upload the three monthly cashless CSV files before generating a preview');
      return;
    }

    const previewAccount = account ?? annotatedPlayers[0]?.account ?? 'ALL';
    const accountLabel = account
      ? `account ${account}`
      : previewAccount !== 'ALL'
        ? `account ${previewAccount}`
        : 'the first matched account';
    setPreviewingAccount(previewAccount);
    setGenerationStatus(`Preparing preview for ${accountLabel}...`);

    try {
      // Auto-save batch if not already saved
      let batchId = loadedBatchId;
      
      if (!batchId) {
        setGenerationStatus(`Saving data for preview...`);
        
        const saveResponse = await fetch('/api/save-batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            activityRows: activityUpload.rows,
            preCommitmentPlayers: preCommitmentUpload.players,
            quarterlyData,
          }),
        });

        if (!saveResponse.ok) {
          throw new Error('Failed to save batch for preview');
        }

        const saveData = await saveResponse.json();
        if (!saveData.success) {
          throw new Error(saveData.error || 'Failed to save batch for preview');
        }

        batchId = saveData.batchId;
        setLoadedBatchId(batchId);
        
        // Update batches list asynchronously (don't wait for it)
        loadPreviousBatches().catch(error => 
          console.warn('Failed to reload batches list:', error)
        );
      }

      setGenerationStatus(`Generating preview for ${accountLabel}...`);

      // Use the new batch-based preview endpoint
      if (!batchId) {
        throw new Error('No batch ID available for preview');
      }
      
      const previewUrl = `/api/preview-batch-pdf?batchId=${encodeURIComponent(batchId)}${account ? `&account=${encodeURIComponent(account)}` : ''}`;
      console.log('Preview URL:', previewUrl);
      
      const response = await fetch(previewUrl);

      if (!response.ok) {
        console.error('Preview API error:', response.status, response.statusText);
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Preview API error data:', errorData);
        const errorMessage = errorData.error || `HTTP ${response.status}: ${response.statusText}`;
        throw new Error(errorMessage);
      }

      // Get the HTML content and display directly in new window
      const html = await response.text();
      
      // Check if HTML response is valid
      if (!html || html.length < 100) {
        throw new Error('Invalid or empty HTML response from preview API');
      }
      
      const previewWindow = window.open('', '_blank');
      if (previewWindow) {
        // Use document.open() to clear any existing content
        // This ensures it works even when navigating back in history
        previewWindow.document.open();
        previewWindow.document.write(html);
        previewWindow.document.close();
        
        // Ensure the window is focused
        previewWindow.focus();
      } else {
        throw new Error('Failed to open preview window. Please check popup blocker settings.');
      }

      setGenerationStatus(`Preview generated successfully for ${accountLabel}!`);
    } catch (error) {
      console.error('Error generating preview:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setGenerationStatus(`Error generating preview for ${accountLabel}: ${errorMessage}`);
    } finally {
      setPreviewingAccount(null);
    }
  };

  const generatePDFs = async (account?: string) => {
    if (!activityUpload || activityUpload.rows.length === 0) {
      alert('Upload an activity statement before generating PDFs');
      return;
    }

    if (!preCommitmentUpload || preCommitmentUpload.players.length === 0) {
      alert('Upload the pre-commitment workbook before generating PDFs');
      return;
    }

    if (!quarterlyData || quarterlyData.players.length === 0) {
      alert('Upload the three monthly cashless CSV files before generating PDFs');
      return;
    }

    const targetAccount = account ?? annotatedPlayers[0]?.account ?? 'ALL';
    const accountLabel = account
      ? `account ${account}`
      : targetAccount !== 'ALL'
        ? `account ${targetAccount}`
        : 'the first matched account';
    const noun = 'PDF';
    setGeneratingAccount(targetAccount);
    setGenerationStatus(`Generating ${noun} for ${accountLabel}...`);

    try {
      const response = await fetch('/api/generate-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          activityRows: activityUpload.rows,
          preCommitmentPlayers: preCommitmentUpload.players,
          quarterlyData,
          account,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate PDFs');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      if (account) {
        const sanitizedAccount = account.replace(/[^a-zA-Z0-9_-]/g, '') || 'member';
        a.download = `Annotated_Statement_${sanitizedAccount}.pdf`;
      } else {
        a.download = `skycity-quarterly-statements-q${quarterlyData.quarter}-${quarterlyData.year}.pdf`;
      }
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setGenerationStatus(`${noun} generated successfully for ${accountLabel}!`);
      
      // Reload batches list if we generated for all accounts (new batch was saved)
      if (!account) {
        loadPreviousBatches();
      }
    } catch (error) {
      console.error('Error generating PDF:', error);
      setGenerationStatus(`Error generating ${noun} for ${accountLabel}`);
    } finally {
      setGeneratingAccount(null);
    }
  };

  const sendPDF = async (account?: string) => {
    if (!activityUpload || activityUpload.rows.length === 0) {
      alert('Upload an activity statement before sending PDFs');
      return;
    }

    if (!preCommitmentUpload || preCommitmentUpload.players.length === 0) {
      alert('Upload the pre-commitment workbook before sending PDFs');
      return;
    }

    if (!quarterlyData || quarterlyData.players.length === 0) {
      alert('Upload the three monthly cashless CSV files before sending PDFs');
      return;
    }

    const targetAccount = account ?? annotatedPlayers[0]?.account ?? 'ALL';
    const targetPlayer = annotatedPlayers.find(p => p.account === targetAccount);
    
    if (!targetPlayer || !targetPlayer.activity?.email) {
      alert('No email address found for this account. Cannot send PDF.');
      return;
    }

    const accountLabel = account
      ? `account ${account}`
      : targetAccount !== 'ALL'
        ? `account ${targetAccount}`
        : 'the first matched account';
    
    setSendingAccount(targetAccount);
    setGenerationStatus(`Sending PDF to ${targetPlayer.activity.email} for ${accountLabel}...`);

    try {
      const response = await fetch('/api/send-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          activityRows: activityUpload.rows,
          preCommitmentPlayers: preCommitmentUpload.players,
          quarterlyData,
          account,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to send PDF');
      }

      const data = await response.json();
      if (data.success) {
        setGenerationStatus(`PDF sent successfully to ${targetPlayer.activity.email} for ${accountLabel}!`);
      } else {
        throw new Error(data.error || 'Failed to send PDF');
      }
    } catch (error) {
      console.error('Error sending PDF:', error);
      setGenerationStatus(`Error sending PDF for ${accountLabel}`);
    } finally {
      setSendingAccount(null);
    }
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => {
      const newFiles = prev.filter((_, i) => i !== index);
      setGenerationStatus('');
      
      // Re-aggregate quarterly data
      if (newFiles.length > 0) {
        const monthlyData = newFiles.map(f => ({
          month: f.month,
          year: f.year,
          data: f.data
        }));
        
        try {
          const quarterly = aggregateQuarterlyData(monthlyData);
          setQuarterlyData(quarterly);
        } catch (error) {
          setQuarterlyData(null);
        }
      } else {
        setQuarterlyData(null);
      }
      
      return newFiles;
    });
  };

  const downloadActivityTemplate = async () => {
    try {
      const response = await fetch('/api/download-activity-template');
      
      if (!response.ok) {
        throw new Error('Failed to download template');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Activity_Statement_Template.xlsx';
      document.body.appendChild(link);
      link.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(link);
    } catch (error) {
      console.error('Error downloading template:', error);
      alert('Failed to download template. Please try again.');
    }
  };

  const downloadPreCommitmentTemplate = async () => {
    try {
      const response = await fetch('/api/download-template');
      
      if (!response.ok) {
        throw new Error('Failed to download template');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'PreCommitment_Template.xlsx';
      document.body.appendChild(link);
      link.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(link);
    } catch (error) {
      console.error('Error downloading template:', error);
      alert('Failed to download template. Please try again.');
    }
  };

  const downloadCSVTemplate = async () => {
    try {
      const response = await fetch('/api/download-csv-template');
      
      if (!response.ok) {
        throw new Error('Failed to download template');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Monthly_Cashless_Template.xlsx';
      document.body.appendChild(link);
      link.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(link);
    } catch (error) {
      console.error('Error downloading template:', error);
      alert('Failed to download template. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Quarterly Statements PDF Generator
          </h1>
          
          {/* Tabs */}
          <div className="border-b border-gray-200 mb-6">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('generation')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'generation'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Generation
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'history'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                History
              </button>
            </nav>
          </div>
        </div>

        {/* Generation Status */}
        {generationStatus && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8">
            <p className="text-sm text-blue-800">{generationStatus}</p>
          </div>
        )}

        {/* Generation Tab */}
        {activeTab === 'generation' && (
          <div>
            {/* Activity Statement Upload */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="text-xl font-semibold">Activity Statement (Pages 1-2)</h2>
              <p className="text-sm text-gray-600">Upload the quarterly activity workbook exported from the template.</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={downloadActivityTemplate}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
              >
                📥 Download Template
              </button>
              {activityUpload && (
                <button
                  onClick={() => {
                    setActivityUpload(null);
                    setGenerationStatus('');
                  }}
                  className="text-red-600 hover:text-red-800"
                >
                  Remove
                </button>
              )}
            </div>
          </div>

          <div
            {...getActivityRootProps()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              isActivityDragActive
                ? 'border-blue-400 bg-blue-50'
                : 'border-gray-300 hover:border-gray-400'
            }`}
          >
            <input {...getActivityInputProps()} />
            <div className="text-gray-600">
              {isActivityDragActive ? (
                <p>Drop the activity statement here...</p>
              ) : (
                <div>
                  <p className="text-lg mb-2">Drag & drop the activity workbook, or click to select</p>
                  <p className="text-sm text-gray-500">
                    Supports .xlsx or .csv exports that match the Activity Statement template headers.
                  </p>
                </div>
              )}
            </div>
          </div>

          {activityUpload && (
            <div className="mt-4">
              <h3 className="font-medium">{activityUpload.file.name}</h3>
              <p className="text-sm text-gray-600">Accounts detected: {activityUpload.rows.length}</p>
              {activityUpload.errors.length > 0 && (
                <div className="text-red-600 text-sm mt-2">
                  <p>Errors:</p>
                  <ul className="list-disc list-inside">
                    {activityUpload.errors.map((error, i) => (
                      <li key={i}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Pre-commitment Upload */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="text-xl font-semibold">Pre-commitment Template (Pages 3-4)</h2>
              <p className="text-sm text-gray-600">Upload the pre-commitment workbook with the Session Summary worksheet.</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={downloadPreCommitmentTemplate}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
              >
                📥 Download Template
              </button>
              {preCommitmentUpload && (
                <button
                  onClick={() => {
                    setPreCommitmentUpload(null);
                    setGenerationStatus('');
                  }}
                  className="text-red-600 hover:text-red-800"
                >
                  Remove
                </button>
              )}
            </div>
          </div>

          <div
            {...getPreCommitmentRootProps()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              isPreCommitmentDragActive
                ? 'border-blue-400 bg-blue-50'
                : 'border-gray-300 hover:border-gray-400'
            }`}
          >
            <input {...getPreCommitmentInputProps()} />
            <div className="text-gray-600">
              {isPreCommitmentDragActive ? (
                <p>Drop the pre-commitment workbook here...</p>
              ) : (
                <div>
                  <p className="text-lg mb-2">Drag & drop the pre-commitment workbook, or click to select</p>
                  <p className="text-sm text-gray-500">
                    Supports .xlsx or .csv exports. Ensure the Session Summary sheet is included.
                  </p>
                </div>
              )}
            </div>
          </div>

          {preCommitmentUpload && (
            <div className="mt-4">
              <h3 className="font-medium">{preCommitmentUpload.file.name}</h3>
              <p className="text-sm text-gray-600">Accounts detected: {preCommitmentUpload.players.length}</p>
              {preCommitmentUpload.errors.length > 0 && (
                <div className="text-red-600 text-sm mt-2">
                  <p>Errors:</p>
                  <ul className="list-disc list-inside">
                    {preCommitmentUpload.errors.map((error, i) => (
                      <li key={i}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Monthly Cashless Upload */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <div className="flex justify-between items-start mb-4">
            <h2 className="text-xl font-semibold">Monthly Cashless CSVs (Cashless Pages)</h2>
            <button
              onClick={downloadCSVTemplate}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              📥 Download Template
            </button>
          </div>
          
          <div
            {...getMonthlyRootProps()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              isMonthlyDragActive
                ? 'border-blue-400 bg-blue-50'
                : 'border-gray-300 hover:border-gray-400'
            }`}
          >
            <input {...getMonthlyInputProps()} />
            <div className="text-gray-600">
              {isMonthlyDragActive ? (
                <p>Drop the CSV files here...</p>
              ) : (
                <div>
                  <p className="text-lg mb-2">Drag & drop CSV files here, or click to select</p>
                  <p className="text-sm text-gray-500">
                    Upload the three monthly cashless files that make up the quarter.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Uploaded Files */}
        {uploadedFiles.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-8">
            <h2 className="text-xl font-semibold mb-4">Uploaded Files</h2>
            <div className="space-y-4">
              {uploadedFiles.map((fileData, index) => (
                <div key={index} className="border rounded-lg p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-medium">{fileData.file.name}</h3>
                      <p className="text-sm text-gray-600">
                        Month: {fileData.month}, Year: {fileData.year}
                      </p>
                      <p className="text-sm text-gray-600">
                        Players: {fileData.data.length}
                      </p>
                      {fileData.errors.length > 0 && (
                        <div className="text-red-600 text-sm mt-2">
                          <p>Errors:</p>
                          <ul className="list-disc list-inside">
                            {fileData.errors.map((error, i) => (
                              <li key={i}>{error}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => removeFile(index)}
                      className="text-red-600 hover:text-red-800"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quarterly Data Summary */}
        {quarterlyData && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-8">
            <h2 className="text-xl font-semibold mb-4">Quarterly Summary</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-600">Quarter</p>
                <p className="text-lg font-medium">Q{quarterlyData.quarter} {quarterlyData.year}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Total Players</p>
                <p className="text-lg font-medium">{annotatedPlayers.length}</p>
              </div>
            </div>
          </div>
        )}

        {/* Matched Players */}
        {annotatedPlayers.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-8">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-4">
              <div>
                <h2 className="text-xl font-semibold">Matched Accounts</h2>
                <p className="text-sm text-gray-600">
                  {totalPages > 1 
                    ? `Showing ${startIndex + 1} to ${Math.min(endIndex, totalAccounts)} of ${totalAccounts.toLocaleString()} matched accounts (Page ${currentPage} of ${totalPages})`
                    : `Preview or download individual annotated statements.`
                  }
                </p>
              </div>
              <div className="flex flex-col md:flex-row items-center gap-3">
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1); // Reset to first page when changing page size
                  }}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  disabled={isGenerating || isPreviewing || isSending}
                >
                  <option value="25">25 per page</option>
                  <option value="50">50 per page</option>
                  <option value="100">100 per page</option>
                </select>
                <button
                  onClick={() => generatePDFs()}
                  disabled={isGenerating || isPreviewing || isSending}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors text-white ${
                    isGenerating || isPreviewing || isSending
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-purple-600 hover:bg-purple-700'
                  }`}
                >
                  {isGenerating && generatingAccount === null ? 'Exporting...' : `Export All (${totalAccounts})`}
                </button>
                {!loadedBatchId && (
                  <button
                    onClick={saveBatch}
                    disabled={savingBatch || isGenerating || isPreviewing}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors text-white ${
                      savingBatch || isGenerating || isPreviewing
                        ? 'bg-gray-400 cursor-not-allowed'
                        : 'bg-indigo-600 hover:bg-indigo-700'
                    }`}
                  >
                    {savingBatch ? 'Saving...' : 'Save Batch'}
                  </button>
                )}
                {loadedBatchId && (
                  <div className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm">
                    Batch already saved (loaded from history)
                  </div>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full border border-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left border border-gray-200 font-semibold">Account</th>
                    <th className="px-4 py-3 text-left border border-gray-200 font-semibold">Name</th>
                    <th className="px-4 py-3 text-left border border-gray-200 font-semibold">Email</th>
                    <th className="px-4 py-3 text-left border border-gray-200 font-semibold">Data Sources</th>
                    <th className="px-4 py-3 text-left border border-gray-200 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedPlayers.map(player => {
                    const fullName = [player.activity?.firstName, player.activity?.lastName]
                      .filter(Boolean)
                      .join(' ')
                      .trim();
                    const email = player.activity?.email ?? '-';
                    const hasActivity = Boolean(player.activity);
                    const hasPreCommitment = Boolean(player.preCommitment);
                    const hasCashless = Boolean(player.cashless);
                    const isAccountPreviewing = previewingAccount === player.account || previewingAccount === 'ALL';
                    const isAccountGenerating = generatingAccount === player.account || generatingAccount === 'ALL';
                    const isAccountSending = sendingAccount === player.account || sendingAccount === 'ALL';

                    return (
                      <tr key={player.account} className="hover:bg-gray-50">
                        <td className="px-4 py-2 border border-gray-200">{player.account}</td>
                        <td className="px-4 py-2 border border-gray-200">{fullName || 'Name unavailable'}</td>
                        <td className="px-4 py-2 border border-gray-200">{email}</td>
                        <td className="px-4 py-2 border border-gray-200">
                          <div className="flex flex-wrap gap-1">
                            <span
                              className={`px-2 py-1 rounded-full text-xs ${hasActivity ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                            >
                              Activity
                            </span>
                            <span
                              className={`px-2 py-1 rounded-full text-xs ${hasPreCommitment ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                            >
                              Pre-commitment
                            </span>
                            <span
                              className={`px-2 py-1 rounded-full text-xs ${hasCashless ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                            >
                              Cashless
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2 border border-gray-200">
                          <div className="flex gap-2">
                            <button
                              onClick={() => previewPDF(player.account)}
                              disabled={isGenerating || isPreviewing || isSending}
                              className={`px-3 py-1 rounded text-sm font-medium transition-colors text-white ${
                                isPreviewing || isGenerating || isSending
                                  ? 'bg-gray-400 cursor-not-allowed'
                                  : 'bg-emerald-600 hover:bg-emerald-700'
                              }`}
                            >
                              {isPreviewing && isAccountPreviewing ? 'Previewing...' : 'Preview'}
                            </button>
                            <button
                              onClick={() => generatePDFs(player.account)}
                              disabled={isGenerating || isPreviewing || isSending}
                              className={`px-3 py-1 rounded text-sm font-medium transition-colors text-white ${
                                isGenerating || isPreviewing || isSending
                                  ? 'bg-gray-400 cursor-not-allowed'
                                  : 'bg-blue-600 hover:bg-blue-700'
                              }`}
                            >
                              {isGenerating && isAccountGenerating ? 'Exporting...' : 'Export'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    First
                  </button>
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    Previous
                  </button>
                  <span className="px-4 py-2 text-sm text-gray-700">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    Next
                  </button>
                  <button
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                  >
                    Last
                  </button>
                </div>
                <div className="text-sm text-gray-600">
                  Showing {startIndex + 1} to {Math.min(endIndex, totalAccounts)} of {totalAccounts.toLocaleString()} accounts
                </div>
              </div>
            )}
          </div>
        )}
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div>
            <div className="bg-white rounded-lg shadow-md p-6 mb-8">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h2 className="text-xl font-semibold">Previous Generation Batches</h2>
                  <p className="text-sm text-gray-600">Load a previous batch to regenerate PDFs</p>
                </div>
                <button
                  onClick={loadPreviousBatches}
                  disabled={loadingBatches}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium disabled:bg-gray-400"
                >
                  {loadingBatches ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>

              {previousBatches.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <p className="text-lg mb-2">No previous batches found</p>
                  <p className="text-sm">Generate PDFs to create batches that will appear here</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                  {previousBatches.map(batch => {
                    const isLoading = loadingBatch === batch.id;
                    const isDeleting = deletingBatch === batch.id;
                    return (
                      <div
                        key={batch.id}
                        className="border border-gray-200 rounded-lg p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
                      >
                        <div>
                          <p className="text-sm font-semibold text-gray-900">
                            Q{batch.quarter} {batch.year} - {batch.total_accounts} {batch.total_accounts === 1 ? 'account' : 'accounts'}
                          </p>
                          <p className="text-xs text-gray-600 mt-1">
                            Generated: {formatDate(batch.generation_date)}
                          </p>
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              loadBatch(batch.id);
                              setActiveTab('generation');
                            }}
                            disabled={isLoading || isDeleting || isGenerating || isPreviewing}
                            className={`px-4 py-2 rounded-lg font-medium transition-colors text-white ${
                              isLoading || isDeleting || isGenerating || isPreviewing
                                ? 'bg-gray-400 cursor-not-allowed'
                                : 'bg-purple-600 hover:bg-purple-700'
                            }`}
                          >
                            {isLoading ? 'Loading...' : 'Load & Switch to Generation'}
                          </button>
                          <button
                            onClick={() => deleteBatch(batch.id)}
                            disabled={isLoading || isDeleting || isGenerating || isPreviewing}
                            className={`px-4 py-2 rounded-lg font-medium transition-colors text-white ${
                              isDeleting || isGenerating || isPreviewing
                                ? 'bg-gray-400 cursor-not-allowed'
                                : 'bg-red-600 hover:bg-red-700'
                            }`}
                          >
                            {isDeleting ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
