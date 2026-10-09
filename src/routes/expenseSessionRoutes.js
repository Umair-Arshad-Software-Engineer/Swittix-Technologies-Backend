// src/routes/expenseSessionRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/expenseSessionController');

// Sessions
router.get('/today', ctrl.getTodaySession);
router.get('/by-date', ctrl.getSessionByDate);
router.get('/', ctrl.listSessions);
router.post('/', ctrl.createSession);
router.get('/:id', ctrl.getSession);
router.patch('/:id/opening-balance', ctrl.updateOpeningBalance);
router.post('/:id/close', ctrl.closeSession);

// Entries
router.post('/:id/expenses', ctrl.addExpense);
router.post('/:id/supplier-payments', ctrl.addSupplierPayment);
router.post('/:id/bill-payments', ctrl.addBillPayment);
router.delete('/:id/entries/:entryId', ctrl.deleteEntry);

// Standalone bill-payment list (for Bill History screen)
router.get('/bills', ctrl.listBillPayments);   // NOTE: register this BEFORE /:id routes if you put it in this router

module.exports = router;