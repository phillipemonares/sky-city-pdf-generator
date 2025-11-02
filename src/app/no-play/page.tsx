'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import Navigation from '@/components/Navigation';
import { parseExcelFile, parseCSVFile, validatePreCommitmentFile } from '@/lib/pc-parser';
import { PreCommitmentPlayer } from '@/types/player-data';

interface UploadedFile {
  file: File;
  players: PreCommitmentPlayer[];
  errors: string[];
}

export default function NoPlayPage() {
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<string>('');

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    
    if (!file) {
      alert('Please upload a file');
      return;
    }

    const validation = validatePreCommitmentFile(file);
    if (!validation.isValid) {
      alert(`File validation failed: ${validation.errors.join(', ')}`);
      return;
    }

    const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    
    const parseFile = fileExtension === '.xlsx' ? parseExcelFile : parseCSVFile;
    
    parseFile(file)
      .then(players => {
        setUploadedFile({
          file,
          players,
          errors: []
        });
        setGenerationStatus(`Successfully parsed ${players.length} players with "No Play" status`);
      })
      .catch(error => {
        console.error('Error parsing file:', error);
        setUploadedFile({
          file,
          players: [],
          errors: [`Error parsing file: ${error.message}`]
        });
        setGenerationStatus('Error parsing file');
      });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/csv': ['.csv']
    },
    multiple: false
  });

  const previewPDF = async (player: PreCommitmentPlayer) => {
    setIsPreviewing(true);
    setGenerationStatus('Generating preview...');

    try {
      const response = await fetch('/api/preview-pc-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          players: [player]
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

      setGenerationStatus('Preview generated successfully!');
    } catch (error) {
      console.error('Error generating preview:', error);
      setGenerationStatus('Error generating preview');
    } finally {
      setIsPreviewing(false);
    }
  };

  const generatePDF = async (player: PreCommitmentPlayer) => {
    setIsGenerating(true);
    setGenerationStatus('Generating PDF...');

    try {
      const response = await fetch('/api/generate-pc-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          players: [player]
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate PDF');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `skycity-precommitment-${player.playerInfo.playerAccount}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setGenerationStatus('PDF generated successfully!');
    } catch (error) {
      console.error('Error generating PDF:', error);
      setGenerationStatus('Error generating PDF');
    } finally {
      setIsGenerating(false);
    }
  };

  const generateAllPDFs = async () => {
    if (!uploadedFile || uploadedFile.players.length === 0) {
      alert('No players to generate PDFs for');
      return;
    }

    setIsGenerating(true);
    setGenerationStatus('Generating PDFs for all players...');

    try {
      // Generate PDFs one by one
      for (let i = 0; i < uploadedFile.players.length; i++) {
        const player = uploadedFile.players[i];
        setGenerationStatus(`Generating PDF ${i + 1} of ${uploadedFile.players.length}...`);
        
        const response = await fetch('/api/generate-pc-pdf', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            players: [player]
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to generate PDF for player ${player.playerInfo.playerAccount}`);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `skycity-precommitment-${player.playerInfo.playerAccount}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        // Small delay between downloads
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      setGenerationStatus('All PDFs generated successfully!');
    } catch (error) {
      console.error('Error generating PDFs:', error);
      setGenerationStatus('Error generating PDFs');
    } finally {
      setIsGenerating(false);
    }
  };

  const removeFile = () => {
    setUploadedFile(null);
    setGenerationStatus('');
  };

  const downloadTemplate = async () => {
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

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            No Play - Pre-commitment Statement Generator
          </h1>
        </div>

        {/* Upload Area */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="text-xl font-semibold">Upload File</h2>
              <p className="text-sm text-gray-600">Upload Excel (.xlsx) or CSV files to generate pre-commitment statements for players with "No Play" status.</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={downloadTemplate}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
              >
                📥 Download Template
              </button>
              {uploadedFile && (
                <button
                  onClick={removeFile}
                  className="text-red-600 hover:text-red-800"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
          
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              isDragActive
                ? 'border-blue-400 bg-blue-50'
                : 'border-gray-300 hover:border-gray-400'
            }`}
          >
            <input {...getInputProps()} />
            <div className="text-gray-600">
              {isDragActive ? (
                <p>Drop the file here...</p>
              ) : (
                <div>
                  <p className="text-lg mb-2">Drag & drop Excel or CSV file here, or click to select</p>
                  <p className="text-sm text-gray-500">
                    Supports .xlsx and .csv formats. Only players with "No Play" status will be processed.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Uploaded File Info */}
        {uploadedFile && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-8">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-semibold">Uploaded File</h2>
              <button
                onClick={removeFile}
                className="text-red-600 hover:text-red-800"
              >
                Remove
              </button>
            </div>
            
            <div className="mb-4">
              <h3 className="font-medium">{uploadedFile.file.name}</h3>
              <p className="text-sm text-gray-600">
                Players with "No Play" status: {uploadedFile.players.length}
              </p>
              {uploadedFile.errors.length > 0 && (
                <div className="text-red-600 text-sm mt-2">
                  <p>Errors:</p>
                  <ul className="list-disc list-inside">
                    {uploadedFile.errors.map((error, i) => (
                      <li key={i}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Players List */}
            {uploadedFile.players.length > 0 && (
              <div className="space-y-4">
                <h3 className="font-medium">Players Found:</h3>
                {uploadedFile.players.map((player, index) => (
                  <div key={index} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-medium">
                          Account: {player.playerInfo.playerAccount}
                        </h4>
                        <p className="text-sm text-gray-600">
                          Status: {player.noPlayStatus}
                        </p>
                        <p className="text-sm text-gray-600">
                          Statement Period: {player.statementPeriod}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => previewPDF(player)}
                          disabled={isPreviewing || isGenerating}
                          className={`px-4 py-2 rounded text-sm font-medium ${
                            isPreviewing || isGenerating
                              ? 'bg-gray-400 cursor-not-allowed'
                              : 'bg-green-600 hover:bg-green-700'
                          } text-white transition-colors`}
                        >
                          Preview
                        </button>
                        <button
                          onClick={() => generatePDF(player)}
                          disabled={isGenerating || isPreviewing}
                          className={`px-4 py-2 rounded text-sm font-medium ${
                            isGenerating || isPreviewing
                              ? 'bg-gray-400 cursor-not-allowed'
                              : 'bg-blue-600 hover:bg-blue-700'
                          } text-white transition-colors`}
                        >
                          Generate PDF
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Generate All Button */}
            {uploadedFile.players.length > 0 && (
              <div className="mt-6 pt-6 border-t">
                <button
                  onClick={generateAllPDFs}
                  disabled={isGenerating || isPreviewing}
                  className={`w-full py-3 px-6 rounded-lg font-medium ${
                    isGenerating || isPreviewing
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-purple-600 hover:bg-purple-700'
                  } text-white transition-colors`}
                >
                  {isGenerating ? 'Generating PDFs...' : `Generate All PDFs (${uploadedFile.players.length} players)`}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Status Message */}
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
