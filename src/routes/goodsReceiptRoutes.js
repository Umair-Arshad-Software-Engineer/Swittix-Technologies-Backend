// src/routes/goodsReceiptRoutes.js
const express = require('express');
const router = express.Router();
const {
    getAllGoodsReceipts,
    getGoodsReceipt,
    createGoodsReceipt,
    deleteGoodsReceipt,
} = require('../controllers/goodsReceiptController');
const { protect } = require('../middleware/authMiddleware');

router.get('/', protect, getAllGoodsReceipts);
router.get('/:id', protect, getGoodsReceipt);
router.post('/', protect, createGoodsReceipt);
router.delete('/:id', protect, deleteGoodsReceipt);

module.exports = router;