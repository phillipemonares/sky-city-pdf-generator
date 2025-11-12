import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export async function GET(request: NextRequest) {
  try {
    // Create a new workbook
    const workbook = XLSX.utils.book_new();
    
    // Define the template headers based on CSVRow interface
    // First, the basic player info and totals
    const baseHeaders = [
      'Player Account',
      'PlayerSalutation',
      'Player First Name',
      'Player Last Name',
      'Player Email Address',
      'Player Postal Address1',
      'Player Postal Address2',
      'Suburb',
      'State',
      'PostCode',
      'Country',
      'Player Type',
      'Club State',
      'Statement Month',
      'Statement Year',
      'Total Cash to Card',
      'Total Game Credit to Card',
      'Total Card Credit to Game',
      'Total Bets Placed',
      'Total Device Win',
      'Total Net Win Loss'
    ];

    // Add daily transaction columns (for up to 31 days)
    const dailyHeaders: string[] = [];
    for (let i = 1; i <= 31; i++) {
      dailyHeaders.push(
        `Gaming Date${i}`,
        `Cash to Card${i}`,
        `Game Credit to Card${i}`,
        `Card Credit to Game${i}`,
        `Bets Placed${i}`,
        `Device Win${i}`,
        `Net Win Loss${i}`
      );
    }

    const headers = [...baseHeaders, ...dailyHeaders];

    // Create sample data rows (showing first few days with data)
    const sampleRows = [
      [
        '111',              // Player Account
        'Mr',               // PlayerSalutation
        'John',             // Player First Name
        'Doe',              // Player Last Name
        'john.doe@example.com', // Player Email Address
        '123 Main Street',  // Player Postal Address1
        '',                 // Player Postal Address2
        'Adelaide',         // Suburb
        'SA',               // State
        '5000',             // PostCode
        'Australia',        // Country
        'Standard',         // Player Type
        'SA',               // Club State
        '1',                // Statement Month
        '2025',             // Statement Year
        '1500.50',          // Total Cash to Card
        '800.25',           // Total Game Credit to Card
        '1200.75',          // Total Card Credit to Game
        '3500.00',          // Total Bets Placed
        '250.50',           // Total Device Win
        '-1250.50',         // Total Net Win Loss
        // Day 1
        '2025-01-15',       // Gaming Date1
        '500.00',           // Cash to Card1
        '250.00',           // Game Credit to Card1
        '400.00',           // Card Credit to Game1
        '1000.00',          // Bets Placed1
        '80.00',            // Device Win1
        '-320.00',          // Net Win Loss1
        // Day 2
        '2025-01-18',       // Gaming Date2
        '600.00',           // Cash to Card2
        '300.00',           // Game Credit to Card2
        '450.00',           // Card Credit to Game2
        '1500.00',          // Bets Placed2
        '100.00',           // Device Win2
        '-450.00',          // Net Win Loss2
        // Day 3
        '2025-01-22',       // Gaming Date3
        '400.50',           // Cash to Card3
        '250.25',           // Game Credit to Card3
        '350.75',           // Card Credit to Game3
        '1000.00',          // Bets Placed3
        '70.50',            // Device Win3
        '-480.50',          // Net Win Loss3
        // Fill remaining days with empty strings (or you can leave some empty)
        ...Array(28 * 7).fill('') // 28 more days * 7 columns each = 196 empty cells
      ],
      [
        '222',
        'Ms',
        'Jane',
        'Smith',
        'jane.smith@example.com',
        '456 Oak Avenue',
        '',
        'Adelaide',
        'SA',
        '5001',
        'Australia',
        'Premium',
        'SA',
        '2',
        '2025',
        '2000.75',
        '1000.50',
        '1800.25',
        '5000.00',
        '400.25',
        '-1800.75',
        // Day 1
        '2025-02-10',
        '800.00',
        '400.00',
        '600.00',
        '2000.00',
        '150.00',
        '-650.00',
        // Day 2
        '2025-02-15',
        '700.00',
        '350.00',
        '550.00',
        '1800.00',
        '130.00',
        '-620.00',
        // Day 3
        '2025-02-20',
        '500.75',
        '250.50',
        '650.25',
        '1200.00',
        '120.25',
        '-530.75',
        // Fill remaining days
        ...Array(28 * 7).fill('')
      ]
    ];

    // Create worksheet data
    const worksheetData = [headers, ...sampleRows];
    
    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    
    // Set column widths - make base columns wider, daily columns narrower
    const colWidths = [
      ...baseHeaders.map((_, i) => {
        if (i === 4) return { wch: 30 }; // Email
        if (i === 5) return { wch: 25 }; // Address1
        return { wch: 18 };
      }),
      ...dailyHeaders.map(() => ({ wch: 12 })) // Daily transaction columns
    ];
    
    worksheet['!cols'] = colWidths;
    
    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Monthly Cashless Data');
    
    // Generate Excel file buffer
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    // Return Excel file
    return new NextResponse(excelBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="Monthly_Cashless_Template.xlsx"',
        'Content-Length': excelBuffer.length.toString(),
      },
    });

  } catch (error) {
    console.error('Error generating Monthly Cashless CSV template:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate Monthly Cashless CSV template' },
      { status: 500 }
    );
  }
}





