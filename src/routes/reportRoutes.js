// src/routes/reportRoutes.js
const express = require('express');
const router = express.Router();
const {
    getItemWiseSaleReport,
    getCustomerWiseSaleReport,
    getItemWisePurchaseReport,
    getSupplierWisePurchaseReport,
    getProfitLossReport,
} = require('../controllers/reportController');
const { protect } = require('../middleware/authMiddleware');

router.get('/item-wise-sale',       protect, getItemWiseSaleReport);
router.get('/customer-wise-sale',   protect, getCustomerWiseSaleReport);
router.get('/item-wise-purchase',   protect, getItemWisePurchaseReport);
router.get('/supplier-wise-purchase', protect, getSupplierWisePurchaseReport);
router.get('/profit-loss',          protect, getProfitLossReport);

module.exports = router;