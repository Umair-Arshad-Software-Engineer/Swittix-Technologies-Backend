// src/routes/customerPriceRoutes.js
const express = require('express');
const router = express.Router();
const {
    getAllCustomerPrices,
    getCustomerPrice,
    createCustomerPrice,
    updateCustomerPrice,
    deleteCustomerPrice,
    resolveCustomerPrice,
} = require('../controllers/customerPriceController');

// IMPORTANT: register `/resolve` BEFORE `/:id`,
// otherwise Express treats "resolve" as an :id value.
router.get('/',        getAllCustomerPrices);
router.get('/resolve', resolveCustomerPrice);
router.get('/:id',     getCustomerPrice);
router.post('/',       createCustomerPrice);
router.put('/:id',     updateCustomerPrice);
router.delete('/:id',  deleteCustomerPrice);

module.exports = router;