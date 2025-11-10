/**
 * Script to seed the default user into the database
 * Run this after creating the users table
 * 
 * Usage: node scripts/seed-default-user.js
 */

// Load environment variables from .env file
require('dotenv').config();

const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');

const DEFAULT_USERNAME = 'stephen@dailypress.com.au';
const DEFAULT_PASSWORD = 'Nfx07BoJ83jc';

async function seedDefaultUser() {
  // Database connection configuration
  const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'dp-skycity',
  };

  let connection;
  
  try {
    connection = await mysql.createConnection(dbConfig);
    
    // Check if user already exists
    const [existing] = await connection.execute(
      'SELECT id FROM users WHERE username = ?',
      [DEFAULT_USERNAME]
    );

    if (existing.length > 0) {
      console.log('Default user already exists. Skipping seed.');
      return;
    }

    // Hash the password
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    
    // Generate UUID for user
    const userId = randomUUID();

    // Insert default user
    await connection.execute(
      'INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)',
      [userId, DEFAULT_USERNAME, passwordHash]
    );

    console.log('Default user created successfully!');
    console.log(`Username: ${DEFAULT_USERNAME}`);
    console.log(`Password: ${DEFAULT_PASSWORD}`);
    
  } catch (error) {
    console.error('Error seeding default user:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

seedDefaultUser();

