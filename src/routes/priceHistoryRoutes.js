// src/routes/priceHistory.js
const express = require('express');
const router = express.Router();
const {
    getPriceHistory,
    createPriceHistory,
} = require('../controllers/priceHistoryController');

router.get('/',  getPriceHistory);
router.post('/', createPriceHistory);     // ✅ NEW
// add GET /:id, PUT /:id, DELETE /:id if you want full CRUD

module.exports = router;    