# Sky City Adelaide PDF Generator

A Next.js application for generating quarterly PDF statements from CSV data files.

## Features

- **Multi-file CSV Upload**: Upload 3 monthly CSV files (July, August, September) for quarterly processing
- **Data Validation**: Validates CSV structure and required columns
- **Number Formatting**: Applies Sky City specific formatting rules:
  - Negative numbers: `-(3.13)` format
  - Round numbers: append `.00`
  - Thousands separator: `1,350.00`
  - Empty values: display `-`
- **PDF Generation**: Uses Puppeteer to generate professional PDF statements
- **Activity Summary**: Includes player information, monthly totals, and daily transactions
- **Cashless Section**: Quarterly cashless gaming transactions summary

## Project Structure

```
src/
├── app/
│   ├── api/generate-pdf/route.ts  # Puppeteer PDF generation API
│   ├── globals.css                # Tailwind CSS styles
│   ├── layout.tsx                 # Root layout component
│   └── page.tsx                   # Main upload interface
├── lib/
│   ├── csv-parser.ts              # CSV parsing and aggregation logic
│   ├── number-formatter.ts        # Number formatting utilities
│   └── pdf-template.ts           # HTML template for PDF generation
└── types/
    └── player-data.ts             # TypeScript interfaces
```

## Getting Started

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Set Up Database**:
   - Create the database tables by running the SQL migrations:
     ```bash
     mysql -u root -p dp-skycity < schema.sql
     mysql -u root -p dp-skycity < migrations/create_users_table.sql
     ```
   - Or run the migrations manually in your MySQL client

3. **Seed Default User**:
   - After creating the users table, seed the default user by either:
     - Running the seed script: `node scripts/seed-default-user.js`
     - Or calling the API endpoint: `POST /api/seed-user`
   
   Default credentials:
   - Username: `stephen@dailypress.com.au`
   - Password: `Nfx07BoJ83jc`

4. **Start Development Server**:
   ```bash
   npm run dev
   ```

5. **Open Application**:
   Navigate to `http://localhost:3000` - you will be redirected to the login page

## Usage

1. **Upload CSV Files**: Drag and drop or select 3 monthly CSV files
2. **Review Data**: Check the uploaded files and quarterly summary
3. **Generate PDFs**: Click "Generate PDF Statements" to create PDFs
4. **Download**: PDFs will be automatically downloaded

## CSV File Format

The application expects CSV files with the following structure:

- **Player Information**: Account, Name, Email, Address, Player Type
- **Monthly Totals**: Cash to Card, Game Credit to Card, Card Credit to Game, Bets Placed, Device Win, Net Win/Loss
- **Daily Transactions**: Up to 31 daily transaction records per month

## Authentication

The application uses a login-only authentication system (no registration). Users must be created manually in the database.

### Default User
- **Username**: `stephen@dailypress.com.au`
- **Password**: `Nfx07BoJ83jc`

### Creating New Users
Users can be created programmatically using the `createUser` function in `src/lib/db.ts` or by directly inserting into the `users` table with a bcrypt-hashed password.

### Session Management
- Sessions are stored in-memory (for development)
- Session cookies expire after 7 days
- All routes except `/login` and `/api/*` require authentication

## API Endpoints

### Authentication
- `POST /api/login`: Authenticate user and create session
- `POST /api/logout`: Destroy session and log out
- `GET /api/check-auth`: Check if user is authenticated
- `POST /api/seed-user`: Seed the default user (run once after creating users table)

### PDF Generation
- `POST /api/generate-pdf`: Generates PDF statements from quarterly data

## Dependencies

- **Next.js 14**: React framework with App Router
- **TypeScript**: Type safety and development experience
- **Tailwind CSS**: Utility-first CSS framework
- **Puppeteer**: PDF generation from HTML
- **PapaParse**: CSV parsing library
- **React Dropzone**: File upload interface

## Testing

Test files are provided in the `test/` directory:
- `july.csv` - July 2024 data
- `august.csv` - August 2024 data  
- `september.csv` - September 2024 data

## PDF Template

The PDF template includes:
- **Header**: Sky City Adelaide branding
- **Player Information**: Complete player details
- **Activity Summary**: Quarterly totals table
- **Daily Transactions**: Detailed transaction history
- **Cashless Section**: Cashless gaming summary
- **Footer**: Statement metadata

## Development Notes

- The application processes all players from uploaded CSVs
- Currently generates individual PDFs (can be extended to create ZIP files)
- Supports A4 Letter format as specified in requirements
- Matches the layout structure from the provided template PDFs

