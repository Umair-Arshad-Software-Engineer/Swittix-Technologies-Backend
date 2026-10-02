// index.js
process.env.TZ = 'Asia/Karachi';

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { sequelize, initializeDatabase } = require('./src/config/db');
const db = require('./src/models');
const authRoutes = require('./src/routes/authRoutes');
const productRoutes = require('./src/routes/productRoutes');
const saleRoutes = require('./src/routes/saleRoutes');
const categoryRoutes = require('./src/routes/categoryRoutes');
const brandRoutes = require('./src/routes/brandRoutes');
const unitRoutes = require('./src/routes/unitRoutes');
const branchRoutes = require('./src/routes/branchRoutes');
const customerRoutes = require('./src/routes/customerRoutes');
const supplierRoutes = require('./src/routes/supplierRoutes');
const customerPriceRoutes = require('./src/routes/customerPriceRoutes');
const priceHistoryRoutes = require('./src/routes/priceHistoryRoutes');
const invoiceRoutes = require('./src/routes/invoiceRoutes');
const paymentRoutes = require('./src/routes/paymentRoutes');
const purchaseOrderRoutes = require('./src/routes/purchaseOrderRoutes');
const goodsReceiptRoutes = require('./src/routes/goodsReceiptRoutes');
const reportRoutes = require('./src/routes/reportRoutes');


const { startOfPktDay } = require('./src/utils/dates');
const { createSuperAdmin, createDefaultUsers } = require('./src/controllers/authController');
const { protect, adminOnly, superAdminOnly } = require('./src/middleware/authMiddleware');

dotenv.config();

const app = express();

const PORT = process.env.PORT || 3009;

app.use(cors({
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', protect, productRoutes);
app.use('/api/categories', protect, categoryRoutes);
app.use('/api/brands', protect, brandRoutes);
app.use('/api/units', protect, unitRoutes);
app.use('/api/sales', protect, saleRoutes);
app.use('/api', protect, branchRoutes);
app.use('/api/customers', protect, customerRoutes);
app.use('/api/suppliers', protect, supplierRoutes);
app.use('/api/customer-prices', customerPriceRoutes);
app.use('/api/price-history', protect, priceHistoryRoutes);
app.use('/api/invoices', protect, invoiceRoutes);
app.use('/api/payments', protect, paymentRoutes);
app.use('/api/purchase-orders', protect, purchaseOrderRoutes);
app.use('/api/goods-receipts', protect, goodsReceiptRoutes);
app.use('/api/reports', protect, reportRoutes);

// Verify token
app.get('/api/auth/verify-token', protect, (req, res) => {
    res.json({
        success: true,
        message: 'Token is valid',
        user: req.user
    });
});

// Dashboard stats
app.get('/api/dashboard/stats', protect, async (req, res) => {
    try {
        const totalProducts = await db.Product.count();

        const today = startOfPktDay();

        const todaySales = await db.Sale.findAll({
            where: {
                sale_date: {
                    [db.sequelize.Sequelize.Op.gte]: today
                }
            }
        });

        const todayRevenue = todaySales.reduce(
            (sum, sale) => sum + parseFloat(sale.total_price), 0
        );

        const totalRevenue = await db.Sale.sum('total_price') || 0;

        const recentSales = await db.Sale.findAll({
            limit: 5,
            order: [['sale_date', 'DESC']],
            include: [
                { association: 'seller', attributes: ['name'] }
            ]
        });

        res.json({
            success: true,
            stats: {
                totalProducts,
                todaySales: todaySales.length,
                todayRevenue,
                totalRevenue: parseFloat(totalRevenue),
                recentSales
            }
        });
    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({
        success: true,
        message: 'API is working',
        timestamp: new Date().toISOString()
    });
});

// Root
app.get('/', (req, res) => {
    res.json({
        message: 'POS Management System API',
        version: '2.0.0',
        endpoints: {
            auth: {
                register: 'POST /api/auth/register',
                login: 'POST /api/auth/login',
                profile: 'GET /api/auth/me',
                users: 'GET /api/auth/users',
                verifyToken: 'GET /api/auth/verify-token'
            },
            products: {
                list: 'GET /api/products',
                create: 'POST /api/products',
                update: 'PUT /api/products/:id',
                delete: 'DELETE /api/products/:id'
            },
            categories: {
                list: 'GET /api/categories',
                create: 'POST /api/categories',
                update: 'PUT /api/categories/:id',
                delete: 'DELETE /api/categories/:id'
            },
            brands: {
                list: 'GET /api/brands',
                create: 'POST /api/brands',
                update: 'PUT /api/brands/:id',
                delete: 'DELETE /api/brands/:id'
            },
            units: {
                list: 'GET /api/units',
                create: 'POST /api/units',
                update: 'PUT /api/units/:id',
                delete: 'DELETE /api/units/:id'
            },
            branches: {
                list: 'GET /api/branches',
                create: 'POST /api/branches',
                update: 'PUT /api/branches/:id',
                delete: 'DELETE /api/branches/:id'
            },
            sales: {
                list: 'GET /api/sales',
                create: 'POST /api/sales',
                update: 'PUT /api/sales/:id',
                delete: 'DELETE /api/sales/:id',
                report: 'GET /api/sales/report'
            },
            dashboard: { stats: 'GET /api/dashboard/stats' }
        }
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err.stack);

    if (err.type === 'entity.too.large') {
        return res.status(413).json({
            success: false,
            message: 'Request payload too large. Maximum allowed is 5 MB.',
        });
    }
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({
            success: false,
            message: 'Malformed request body.',
        });
    }

    res.status(500).json({ success: false, message: 'Something went wrong!' });
});

// 404
app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Endpoint not found' });
});

// Start server
const startServer = async () => {
    try {
        const dbInitialized = await initializeDatabase();
        if (!dbInitialized) {
            console.error('❌ Failed to initialize database');
            process.exit(1);
        }

        await createSuperAdmin();

        app.listen(PORT, '0.0.0.0', () => {
            console.log('\n🚀 POS Management System Server is running!');
            console.log(`📡 Server URL: http://localhost:${PORT}`);
            console.log(`📡 Access from: http://72.60.40.108:${PORT}`);

            console.log('\n🔐 Super Admin Credentials:');
            console.log('   Email: swittix@gmail.com');
            console.log('   Password: 498800');

            console.log('\n📌 Note: Super Admin creates branches and all other users.');
            console.log('\n✨ Server is ready to accept requests!\n');
        });

    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
};

process.on('SIGINT', async () => {
    console.log('\n⚠️  Shutting down server...');
    try {
        await sequelize.close();
        console.log('✅ Database connection closed');
        process.exit(0);
    } catch (error) {
        console.error('Error closing database:', error);
        process.exit(1);
    }
});

startServer();