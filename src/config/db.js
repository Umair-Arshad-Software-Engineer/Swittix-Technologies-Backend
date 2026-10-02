// src/config/db.js
const { Sequelize } = require('sequelize');
require('dotenv').config();

const DB_NAME = process.env.DB_NAME || 'pos_db';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || 3306;

const sequelize = new Sequelize(
    DB_NAME,
    DB_USER,
    DB_PASSWORD,
    {
        host: DB_HOST,
        port: DB_PORT,
        dialect: 'mysql',
        timezone: '+05:00',
        // Enable SQL logging temporarily while checking the VPS.
        // Change to false after everything is working.
        // logging: console.log,
        logging: false,

        pool: {
            max: 10,
            min: 0,
            acquire: 30000,
            idle: 10000
        },

        define: {
            underscored: false,
            timestamps: true,
            createdAt: 'createdAt',
            updatedAt: 'updatedAt'
        }
    }
);


// Test database connection
const testConnection = async () => {
    try {
        await sequelize.authenticate();

        console.log('======================================');
        console.log('✅ Database connection established');
        console.log(`📦 Database: ${DB_NAME}`);
        console.log(`👤 User: ${DB_USER}`);
        console.log(`🖥️ Host: ${DB_HOST}:${DB_PORT}`);
        console.log('======================================');

        return true;
    } catch (error) {
        console.error('❌ Unable to connect to the database:');
        console.error(error);

        return false;
    }
};


// Initialize and synchronize database
const initializeDatabase = async () => {
    try {
        console.log('\n🔄 Initializing database...');
        console.log(`📦 Database: ${DB_NAME}`);

        // First check the connection
        await sequelize.authenticate();

        console.log('✅ MySQL connection successful');

        /*
         * IMPORTANT:
         *
         * Models are loaded by src/models/index.js before
         * initializeDatabase() is called from index.js.
         *
         * Therefore sequelize.sync() knows about all models.
         */

        const alterSchema = process.env.DB_SYNC_ALTER === 'true';

        console.log(
            alterSchema
                ? '🔄 Synchronizing database with ALTER enabled...'
                : '🔄 Synchronizing database...'
        );

        await sequelize.sync({
            alter: alterSchema
        });

        console.log('======================================');

        if (alterSchema) {
            console.log('✅ Database tables created/updated successfully');
        } else {
            console.log('✅ Database tables synchronized successfully');
        }

        console.log('======================================');

        return true;

    } catch (error) {
        console.error('======================================');
        console.error('❌ DATABASE INITIALIZATION ERROR');
        console.error('======================================');

        console.error(error);

        if (error.original) {
            console.error('\nMySQL Error:');
            console.error(error.original);
        }

        return false;
    }
};


module.exports = {
    sequelize,
    testConnection,
    initializeDatabase
};