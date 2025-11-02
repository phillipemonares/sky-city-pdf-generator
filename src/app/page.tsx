'use client';

import { useState, useCallback, useMemo } from 'react';
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

export default function UploadInterface() {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [activityUpload, setActivityUpload] = useState<ActivityUpload | null>(null);
  const [preCommitmentUpload, setPreCommitmentUpload] = useState<PreCommitmentUpload | null>(null);
  const [quarterlyData, setQuarterlyData] = useState<QuarterlyData | null>(null);
  const [generatingAccount, setGeneratingAccount] = useState<string | null>(null);
  const [previewingAccount, setPreviewingAccount] = useState<string | null>(null);
  const [generationStatus, setGenerationStatus] = useState<string>('');

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

  const isGenerating = generatingAccount !== null;
  const isPreviewing = previewingAccount !== null;

  const onMonthlyDrop = useCallback((acceptedFiles: File[]) => {
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
      .then(rows => {
        setActivityUpload({
          file,
          rows,
          errors: [],
        });
        setGenerationStatus(`Loaded activity statement for ${rows.length} accounts`);
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
    setGenerationStatus(`Generating preview for ${accountLabel}...`);

    try {
      const response = await fetch('/api/preview-pdf', {
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
        throw new Error('Failed to generate preview');
      }

      const html = await response.text();
      
      // Open preview in new window
      const previewWindow = window.open('', '_blank');
      if (previewWindow) {
        previewWindow.document.write(html);
        previewWindow.document.close();
      }

      setGenerationStatus(`Preview generated successfully for ${accountLabel}!`);
    } catch (error) {
      console.error('Error generating preview:', error);
      setGenerationStatus(`Error generating preview for ${accountLabel}`);
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
    } catch (error) {
      console.error('Error generating PDF:', error);
      setGenerationStatus(`Error generating ${noun} for ${accountLabel}`);
    } finally {
      setGeneratingAccount(null);
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
        </div>

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
                <p className="text-lg font-medium">{quarterlyData.players.length}</p>
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
                <p className="text-sm text-gray-600">Preview or download individual annotated statements.</p>
              </div>
              <p className="text-sm text-gray-600">
                {annotatedPlayers.length} {annotatedPlayers.length === 1 ? 'account' : 'accounts'} matched across uploads
              </p>
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {annotatedPlayers.map(player => {
                const fullName = [player.activity?.firstName, player.activity?.lastName]
                  .filter(Boolean)
                  .join(' ')
                  .trim();
                const email = player.activity?.email ?? '';
                const hasActivity = Boolean(player.activity);
                const hasPreCommitment = Boolean(player.preCommitment);
                const hasCashless = Boolean(player.cashless);
                const isAccountPreviewing = previewingAccount === player.account || previewingAccount === 'ALL';
                const isAccountGenerating = generatingAccount === player.account || generatingAccount === 'ALL';

                return (
                  <div
                    key={player.account}
                    className="border border-gray-200 rounded-lg p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Member #{player.account}</p>
                      <p className="text-sm text-gray-700">
                        {fullName || 'Name unavailable'}
                        {email ? ` • ${email}` : ''}
                      </p>
                      <div className="flex flex-wrap gap-2 mt-2 text-xs">
                        <span
                          className={`px-2 py-1 rounded-full ${hasActivity ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                        >
                          Activity
                        </span>
                        <span
                          className={`px-2 py-1 rounded-full ${hasPreCommitment ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                        >
                          Pre-commitment
                        </span>
                        <span
                          className={`px-2 py-1 rounded-full ${hasCashless ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                        >
                          Cashless
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => previewPDF(player.account)}
                        disabled={isGenerating || isPreviewing}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors text-white ${
                          isPreviewing
                            ? 'bg-gray-400 cursor-not-allowed'
                            : 'bg-emerald-600 hover:bg-emerald-700'
                        }`}
                      >
                        {isPreviewing && isAccountPreviewing ? 'Generating Preview...' : 'Preview PDF'}
                      </button>
                      <button
                        onClick={() => generatePDFs(player.account)}
                        disabled={isGenerating || isPreviewing}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors text-white ${
                          isGenerating
                            ? 'bg-gray-400 cursor-not-allowed'
                            : 'bg-blue-600 hover:bg-blue-700'
                        }`}
                      >
                        {isGenerating && isAccountGenerating ? 'Generating PDF...' : 'Download PDF'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Preview and Generate PDF Buttons */}
        {activityUpload && preCommitmentUpload && quarterlyData && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                onClick={() => previewPDF()}
                disabled={isPreviewing || isGenerating}
                className={`py-3 px-6 rounded-lg font-medium ${
                  isPreviewing || isGenerating
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-green-600 hover:bg-green-700'
                } text-white transition-colors`}
              >
                {isPreviewing ? 'Generating Preview...' : 'Preview First Matched Account'}
              </button>
              
              <button
                onClick={() => generatePDFs()}
                disabled={isGenerating || isPreviewing}
                className={`py-3 px-6 rounded-lg font-medium ${
                  isGenerating || isPreviewing
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700'
                } text-white transition-colors`}
              >
                {isGenerating ? 'Generating PDF...' : 'Download First Matched PDF'}
              </button>
            </div>
          </div>
        )}

        {generationStatus && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <p className={`text-center ${
              generationStatus.includes('Error') ? 'text-red-600' : 'text-green-600'
            }`}>
              {generationStatus}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
