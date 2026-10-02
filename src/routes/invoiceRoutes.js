// src/routes/invoiceRoutes.js
const express = require('express');
const router = express.Router();
const {
    getAllInvoices,
    getInvoice,
    getNextInvoiceNumber,
    createInvoice,
    updateInvoice,
    deleteInvoice,
} = require('../controllers/invoiceController');

// IMPORTANT: register `/next-number` BEFORE `/:id`
router.get('/', getAllInvoices);
router.get('/next-number', getNextInvoiceNumber);
router.get('/:id', getInvoice);
router.post('/', createInvoice);
router.put('/:id', updateInvoice);
router.delete('/:id', deleteInvoice);

module.exports = router;