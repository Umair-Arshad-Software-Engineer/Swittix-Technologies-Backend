const express = require('express');
const router = express.Router();
const {
    getAllSales,
    getSale,
    createSale,
    updateSale,
    deleteSale,
    getSalesReport
} = require('../controllers/saleController');
const { protect, adminOrSuperAdmin } = require('../middleware/authMiddleware');

router.get('/', protect, getAllSales);
router.get('/report', protect, getSalesReport);
router.get('/:id', protect, getSale);
router.post('/', protect, createSale);
router.put('/:id',    protect, adminOrSuperAdmin, updateSale);
router.delete('/:id', protect, adminOrSuperAdmin, deleteSale);

module.exports = router;