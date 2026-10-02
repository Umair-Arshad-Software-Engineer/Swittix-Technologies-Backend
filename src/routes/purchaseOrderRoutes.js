// src/routes/purchaseOrderRoutes.js
const express = require('express');
const router = express.Router();
const {
    getAllPurchaseOrders,
    getPurchaseOrder,
    createPurchaseOrder,
    updatePurchaseOrder,
    deletePurchaseOrder,
    createDirectPurchase,
} = require('../controllers/purchaseOrderController');
const { protect } = require('../middleware/authMiddleware');

router.get('/', protect, getAllPurchaseOrders);
router.get('/:id', protect, getPurchaseOrder);
router.post('/', protect, createPurchaseOrder);
router.post('/direct', protect, createDirectPurchase);
router.put('/:id', protect, updatePurchaseOrder);
router.delete('/:id', protect, deletePurchaseOrder);

module.exports = router;