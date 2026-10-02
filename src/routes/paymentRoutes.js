// src/routes/paymentRoutes.js
const express = require('express');
const router = express.Router();

const {
    receiveCustomerPayment,
    getCashBook,
    getBankTransactions,
    updateChequeStatus,
    getCustomerLedgerWithPayments,
    createManualCashBookEntry,
    updateManualCashBookEntry,
    deleteManualCashBookEntry,
    getCheques,
    getBankAccounts,        // ✅ NEW
    transferBetweenBanks,   // ✅ NEW
    createManualBankTransaction,
    deleteBankTransaction,
    getCustomerPayments,
    deleteCustomerPayment,
    getAllCustomerLedger,
    paySupplier,
    getSupplierPayments,
    deleteSupplierPayment,
    getAllSupplierLedger,
} = require('../controllers/paymentController');

const { protect } = require('../middleware/authMiddleware');

router.use(protect);
router.post('/receive', receiveCustomerPayment);
router.get('/cash-book', getCashBook);
router.get('/cheques', getCheques);

router.post('/cash-book/manual', createManualCashBookEntry);
router.put('/cash-book/:id', updateManualCashBookEntry);
router.delete('/cash-book/:id', deleteManualCashBookEntry);

router.get('/bank-accounts', getBankAccounts);          // ✅ NEW
router.post('/bank-transfer', transferBetweenBanks);    // ✅ NEW
router.post('/bank-transaction', createManualBankTransaction);   // ✅ NEW
router.delete('/bank-transaction/:id', deleteBankTransaction); // ✅ NEW
router.get('/bank-transactions', getBankTransactions);
router.put('/cheque/:id/status', updateChequeStatus);
router.get('/customer/:id/ledger', getCustomerLedgerWithPayments);

router.get('/customer-payments', getCustomerPayments);        // ✅ NEW
router.delete('/customer-payments/:id', deleteCustomerPayment); // ✅ NEW

router.get('/customer-ledger', getAllCustomerLedger);

// ─── SUPPLIER PAYMENT ROUTES ─────────────────────────────────────────
router.post('/pay-supplier', paySupplier);
router.get('/supplier-payments', getSupplierPayments);
router.delete('/supplier-payments/:id', deleteSupplierPayment);
router.get('/supplier-ledger', getAllSupplierLedger);

module.exports = router;