// src/routes/customerRoutes.js
const express = require('express');
const router = express.Router();
const {
    getAllCustomers,
    getCustomer,
    createCustomer,
    updateCustomer,
    deleteCustomer,
    getCustomerLedger,
} = require('../controllers/customerController');

router.get('/', getAllCustomers);
router.get('/:id', getCustomer);
router.post('/', createCustomer);
router.put('/:id', updateCustomer);
router.delete('/:id', deleteCustomer);
router.get('/:id/ledger', getCustomerLedger);

module.exports = router;