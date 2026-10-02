// src/routes/supplierRoutes.js
const express = require('express');
const router = express.Router();
const {
    getAllSuppliers,
    getSupplier,
    createSupplier,
    updateSupplier,
    deleteSupplier,
    getSupplierLedger,
} = require('../controllers/supplierController');

router.get('/',        getAllSuppliers);
router.get('/:id',     getSupplier);
router.post('/',       createSupplier);
router.put('/:id',     updateSupplier);
router.delete('/:id',  deleteSupplier);
router.get('/:id/ledger', getSupplierLedger);

module.exports = router;