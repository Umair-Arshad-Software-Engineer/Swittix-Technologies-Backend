// src/controllers/paymentController.js
const { Op } = require('sequelize');
const db = require('../models');
const { sequelize } = require('../models');
const { canonicalBankName } = require('../utils/bankMatcher');
const { normalizeEntryDate, dayOnly } = require('../utils/dates');

// ─── Helper: latest cash balance ──────────────────────────────────────
const getLatestCashBalance = async (branchId = null, transaction = null) => {
    const where = branchId ? { branch_id: branchId } : {};
    const lastEntry = await db.CashBook.findOne({
        where,
        order: [['id', 'DESC']],
        transaction,
    });
    return lastEntry ? parseFloat(lastEntry.balance_after || 0) : 0;
};

// ─── Helper: latest bank balance ──────────────────────────────────────
// ✅ FIX: exact match on bank_name — the LIKE version could match the
// wrong bank (e.g. "HBL" matching "HBL Islamic") and cause balance drift.
const getLatestBankBalance = async (bankName, branchId = null, transaction = null) => {
    const where = {};
    if (bankName) where.bank_name = bankName;
    if (branchId) where.branch_id = branchId;

    const lastEntry = await db.BankTransaction.findOne({
        where,
        order: [['id', 'DESC']],
        transaction,
    });
    return lastEntry ? parseFloat(lastEntry.balance_after || 0) : 0;
};

// ─── Helper: map ledger ids -> cheque status ──────────────────────────
const getChequeStatusMap = async (
    ledgerRows,
    referenceType = 'customer_payment',
    transaction = null
) => {
    const chequeIds = ledgerRows
        .filter(r => r.payment_method === 'cheque' && r.entry_type === 'payment')
        .map(r => r.id);

    if (chequeIds.length === 0) return new Map();

    const txns = await db.BankTransaction.findAll({
        where: {
            reference_type: referenceType,
            reference_id: { [Op.in]: chequeIds },
        },
        attributes: [
            'reference_id', 'cheque_status', 'cheque_number',
            'cheque_date', 'cheque_status_date',
        ],
        raw: true,
        transaction,
    });

    return new Map(txns.map(t => [t.reference_id, t]));
};

// ─── Helper: resolve branch ───────────────────────────────────────────
const resolveBranchId = async (branchId, transaction = null) => {
    if (!branchId) return null;
    const branch = await db.Branch.findByPk(branchId, { transaction });
    return branch ? branch.id : null;
};

// ─── Helper: normalise cash entry type ────────────────────────────────
const normaliseCashType = (t) => {
    if (t === 'cash_in' || t === 'receipt') return { api: 'cash_in', db: 'receipt' };
    if (t === 'cash_out' || t === 'payment') return { api: 'cash_out', db: 'payment' };
    return null;
};

// ─── Recompute cash balances from a date forward ──────────────────────
const recomputeCashBookBalances = async (fromDate, branchId = null, transaction = null) => {
    if (!fromDate) return 0;
    const baseWhere = branchId ? { branch_id: branchId } : {};

    const seed = await db.CashBook.findOne({
        where: { ...baseWhere, entry_date: { [Op.lt]: fromDate } },
        order: [['entry_date', 'DESC'], ['id', 'DESC']],
        transaction,
    });
    let running = seed ? parseFloat(seed.balance_after || 0) : 0;

    const rows = await db.CashBook.findAll({
        where: { ...baseWhere, entry_date: { [Op.gte]: fromDate } },
        order: [['entry_date', 'ASC'], ['id', 'ASC']],
        transaction,
    });

    for (const row of rows) {
        const amt = parseFloat(row.amount || 0);
        running = row.entry_type === 'receipt' ? running + amt : running - amt;
        if (parseFloat(row.balance_after || 0) !== running) {
            await row.update({ balance_after: running }, { transaction });
        }
    }
    return running;
};

// ─── Recompute bank balances for one bank from a date forward ─────────
const recomputeBankBalances = async (bankName, fromDate, branchId = null, transaction = null) => {
    if (!bankName || !fromDate) return 0;
    const baseWhere = { bank_name: bankName };
    if (branchId) baseWhere.branch_id = branchId;

    const seed = await db.BankTransaction.findOne({
        where: { ...baseWhere, entry_date: { [Op.lt]: fromDate } },
        order: [['entry_date', 'DESC'], ['id', 'DESC']],
        transaction,
    });
    let running = seed ? parseFloat(seed.balance_after || 0) : 0;

    const rows = await db.BankTransaction.findAll({
        where: { ...baseWhere, entry_date: { [Op.gte]: fromDate } },
        order: [['entry_date', 'ASC'], ['id', 'ASC']],
        transaction,
    });

    const creditTypes = new Set(['deposit', 'cheque_in', 'transfer_in']);
    const debitTypes = new Set(['withdrawal', 'cheque_out', 'transfer_out']);

    for (const row of rows) {
        const amt = parseFloat(row.amount || 0);
        if (creditTypes.has(row.entry_type)) running += amt;
        else if (debitTypes.has(row.entry_type)) running -= amt;

        if (parseFloat(row.balance_after || 0) !== running) {
            await row.update({ balance_after: running }, { transaction });
        }
    }
    return running;
};

// ─── RECEIVE CUSTOMER PAYMENT ─────────────────────────────────────────
const receiveCustomerPayment = async (req, res) => {
    const t = await sequelize.transaction();

    try {
        const {
            customer_id,
            amount,
            payment_method,
            bank_name,
            account_number,
            cheque_number,
            cheque_date,
            description,
            entry_date,
            branch_id,
        } = req.body;

        if (!customer_id) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Customer ID is required' });
        }
        if (!amount || parseFloat(amount) <= 0) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Valid amount is required' });
        }
        if (!['cash', 'bank', 'cheque'].includes(payment_method)) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Invalid payment method' });
        }
        if ((payment_method === 'bank' || payment_method === 'cheque') && !bank_name) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Bank name is required for bank/cheque payments' });
        }
        if (payment_method === 'cheque' && (!cheque_number || !cheque_date)) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Cheque number and date are required' });
        }

        const canonicalBank = bank_name ? canonicalBankName(bank_name) : null;

        const customer = await db.Customer.findByPk(customer_id, { transaction: t });
        if (!customer) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        const payAmount = parseFloat(amount);
        const payDate = normalizeEntryDate(entry_date);
        const payDay = dayOnly(payDate);
        const userId = req.user.id;
        const scopedBranch = await resolveBranchId(branch_id || customer.branch_id, t);

        const currentBalance = parseFloat(customer.current_balance || 0);
        const newBalance = currentBalance - payAmount;
        await customer.update({ current_balance: newBalance }, { transaction: t });

        const ledgerEntry = await db.CustomerLedger.create({
            customer_id,
            entry_type: 'payment',
            reference_id: null,
            reference_number: null,
            debit: payAmount,
            credit: 0,
            balance_after: newBalance,
            description: description || `Payment received via ${payment_method}`,
            payment_method,
            bank: canonicalBank || null,
            entry_date: payDate,
            created_by: userId,
        }, { transaction: t });

        let cashBookEntry = null;
        if (payment_method === 'cash') {
            const currentCash = await getLatestCashBalance(scopedBranch, t);
            const newCashBalance = currentCash + payAmount;

            cashBookEntry = await db.CashBook.create({
                entry_type: 'receipt',
                amount: payAmount,
                balance_after: newCashBalance,
                description: description || `Payment from ${customer.name}`,
                reference_type: 'customer_payment',
                reference_id: ledgerEntry.id,
                reference_number: customer.name,
                entry_date: payDate,
                branch_id: scopedBranch,
                created_by: userId,
            }, { transaction: t });

            await recomputeCashBookBalances(payDay, scopedBranch, t);
        }

        let bankTransaction = null;
        if (payment_method === 'bank' || payment_method === 'cheque') {
            const currentBankBalance = await getLatestBankBalance(canonicalBank, scopedBranch, t);
            const newBankBalance = currentBankBalance + payAmount;

            bankTransaction = await db.BankTransaction.create({
                entry_type: payment_method === 'cheque' ? 'cheque_in' : 'deposit',
                amount: payAmount,
                balance_after: newBankBalance,
                bank_name: canonicalBank,
                account_number: account_number || null,
                cheque_number: cheque_number || null,
                cheque_date: cheque_date || null,
                cheque_status: payment_method === 'cheque' ? 'pending' : null,
                reference_type: 'customer_payment',
                reference_id: ledgerEntry.id,
                reference_number: customer.name,
                description: description || `Payment from ${customer.name}`,
                entry_date: payDate,
                branch_id: scopedBranch,
                created_by: userId,
            }, { transaction: t });

            await recomputeBankBalances(canonicalBank, payDay, scopedBranch, t);
        }

        await t.commit();

        res.status(201).json({
            success: true,
            message: 'Payment received successfully',
            data: {
                ledger_entry: {
                    id: ledgerEntry.id,
                    customer_id,
                    debit: payAmount,
                    balance_after: newBalance,
                    payment_method,
                    bank: canonicalBank || null,
                    entry_date: payDate,
                },
                cash_book: cashBookEntry,
                bank_transaction: bankTransaction,
                customer_new_balance: newBalance,
            },
        });
    } catch (error) {
        await t.rollback();
        console.error('receiveCustomerPayment error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// ─── GET CASH BOOK ─────────────────────────────────────────────────────
const getCashBook = async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.max(parseInt(req.query.limit, 10) || 50, 1);
        const offset = (page - 1) * limit;

        const where = {};
        if (req.query.branch_id) where.branch_id = req.query.branch_id;

        const startDate = req.query.start_date || req.query.from_date;
        const endDate = req.query.end_date || req.query.to_date;
        if (startDate && endDate) {
            where.entry_date = { [Op.between]: [startDate, `${endDate} 23:59:59`] };
        } else if (startDate) {
            where.entry_date = { [Op.gte]: startDate };
        } else if (endDate) {
            where.entry_date = { [Op.lte]: `${endDate} 23:59:59` };
        }

        const sortOrder = (req.query.sort_order || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const { rows, count } = await db.CashBook.findAndCountAll({
            where,
            include: [
                { association: 'branch', attributes: ['name'], required: false },
                { association: 'creator', attributes: ['name'], required: false },
            ],
            order: [['entry_date', sortOrder], ['id', sortOrder]],
            limit,
            offset,
        });

        const totals = await db.CashBook.findOne({
            where,
            attributes: [
                [sequelize.fn('SUM', sequelize.literal("CASE WHEN entry_type = 'receipt' THEN amount ELSE 0 END")), 'total_receipts'],
                [sequelize.fn('SUM', sequelize.literal("CASE WHEN entry_type = 'payment' THEN amount ELSE 0 END")), 'total_payments'],
            ],
            raw: true,
        });

        const latestBalance = await getLatestCashBalance(req.query.branch_id || null);

        res.json({
            success: true,
            data: {
                entries: rows.map(r => ({
                    id: r.id,
                    entry_type: r.entry_type === 'receipt' ? 'cash_in' : 'cash_out',
                    amount: parseFloat(r.amount || 0),
                    balance: parseFloat(r.balance_after || 0),
                    description: r.description,
                    source_type: r.reference_type,
                    reference_id: r.reference_id,
                    reference_number: r.reference_number,
                    entry_date: r.entry_date,
                    branch_id: r.branch_id,
                    created_by: r.created_by,
                    created_at: r.createdAt,
                    updated_at: r.updatedAt,
                })),
                summary: {
                    current_balance: latestBalance,
                    total_cash_in: parseFloat(totals.total_receipts || 0),
                    total_cash_out: parseFloat(totals.total_payments || 0),
                },
            },
            page,
            total_pages: Math.max(Math.ceil(count / limit), 1),
            has_more: offset + rows.length < count,
        });
    } catch (error) {
        console.error('getCashBook error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ─── GET CHEQUES ───────────────────────────────────────────────────────
const getCheques = async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.max(parseInt(req.query.limit, 10) || 50, 1);
        const offset = (page - 1) * limit;

        const where = {
            entry_type: { [Op.in]: ['cheque_in', 'cheque_out'] },
        };
        if (req.query.status) where.cheque_status = req.query.status;
        if (req.query.bank_name) {
            where.bank_name = { [Op.like]: `%${req.query.bank_name}%` };
        }
        if (req.query.branch_id) where.branch_id = req.query.branch_id;
        if (req.query.start_date && req.query.end_date) {
            where.entry_date = {
                [Op.between]: [req.query.start_date, `${req.query.end_date} 23:59:59`],
            };
        }

        const { rows, count } = await db.BankTransaction.findAndCountAll({
            where,
            include: [
                { association: 'branch', attributes: ['name'], required: false },
                { association: 'creator', attributes: ['name'], required: false },
            ],
            order: [['entry_date', 'DESC'], ['id', 'DESC']],
            limit,
            offset,
        });

        res.json({
            success: true,
            data: {
                entries: rows.map(r => ({
                    id: r.id,
                    entry_type: r.entry_type,
                    amount: parseFloat(r.amount || 0),
                    balance_after: parseFloat(r.balance_after || 0),
                    bank_name: r.bank_name,
                    cheque_number: r.cheque_number,
                    cheque_date: r.cheque_date,
                    cheque_status: r.cheque_status,
                    reference_type: r.reference_type,
                    reference_id: r.reference_id,
                    reference_number: r.reference_number,
                    description: r.description,
                    entry_date: r.entry_date,
                    cheque_status_date: r.cheque_status_date,
                })),
            },
            page,
            total_pages: Math.max(Math.ceil(count / limit), 1),
            has_more: offset + rows.length < count,
        });
    } catch (error) {
        console.error('getCheques error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ─── GET BANK TRANSACTIONS ─────────────────────────────────────────────
const getBankTransactions = async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.max(parseInt(req.query.limit, 10) || 50, 1);
        const offset = (page - 1) * limit;

        const where = {};
        if (req.query.bank_name) {
            where.bank_name = { [Op.like]: `%${req.query.bank_name}%` };
        }
        if (req.query.branch_id) where.branch_id = req.query.branch_id;
        if (req.query.start_date && req.query.end_date) {
            where.entry_date = {
                [Op.between]: [req.query.start_date, `${req.query.end_date} 23:59:59`],
            };
        }

        const { rows, count } = await db.BankTransaction.findAndCountAll({
            where,
            include: [
                { association: 'branch', attributes: ['name'], required: false },
                { association: 'creator', attributes: ['name'], required: false },
            ],
            order: [['entry_date', 'DESC'], ['id', 'DESC']],
            limit,
            offset,
        });

        res.json({
            success: true,
            data: {
                entries: rows.map(r => ({
                    id: r.id,
                    entry_type: r.entry_type,
                    amount: parseFloat(r.amount || 0),
                    balance_after: parseFloat(r.balance_after || 0),
                    bank_name: r.bank_name,
                    account_number: r.account_number,
                    cheque_number: r.cheque_number,
                    cheque_date: r.cheque_date,
                    cheque_status: r.cheque_status,
                    reference_type: r.reference_type,
                    reference_id: r.reference_id,
                    reference_number: r.reference_number,
                    description: r.description,
                    entry_date: r.entry_date,
                    cheque_status_date: r.cheque_status_date,
                    branch_id: r.branch_id,
                    created_by: r.created_by,
                    created_at: r.createdAt,
                    updated_at: r.updatedAt,
                })),
            },
            page,
            total_pages: Math.max(Math.ceil(count / limit), 1),
            has_more: offset + rows.length < count,
        });
    } catch (error) {
        console.error('getBankTransactions error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ─── UPDATE CHEQUE STATUS ──────────────────────────────────────────────
const updateChequeStatus = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { status, status_date } = req.body;

        if (!['cleared', 'bounced', 'cancelled'].includes(status)) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Invalid cheque status' });
        }

        if (status_date && !/^\d{4}-\d{2}-\d{2}$/.test(status_date)) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'status_date must be YYYY-MM-DD' });
        }

        const cheque = await db.BankTransaction.findByPk(req.params.id, { transaction: t });
        if (!cheque) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Cheque not found' });
        }

        const originalDate = cheque.entry_date;
        const statusDate = status_date || new Date().toISOString().split('T')[0];
        const statusDateTime = normalizeEntryDate(statusDate);
        const statusDay = dayOnly(statusDateTime);

        await cheque.update(
            { cheque_status: status, cheque_status_date: statusDate },
            { transaction: t }
        );

        if (status === 'bounced' && cheque.reference_type === 'customer_payment' && cheque.reference_id) {
            const ledgerEntry = await db.CustomerLedger.findByPk(cheque.reference_id, { transaction: t });
            if (ledgerEntry && ledgerEntry.entry_type === 'payment') {
                const customer = await db.Customer.findByPk(ledgerEntry.customer_id, { transaction: t });
                if (customer) {
                    const currentBalance = parseFloat(customer.current_balance || 0);
                    const reversedBalance = currentBalance + parseFloat(ledgerEntry.debit || 0);
                    await customer.update({ current_balance: reversedBalance }, { transaction: t });

                    await db.CustomerLedger.create({
                        customer_id: ledgerEntry.customer_id,
                        entry_type: 'adjustment',
                        reference_id: cheque.id,
                        reference_number: cheque.cheque_number,
                        debit: 0,
                        credit: parseFloat(ledgerEntry.debit || 0),
                        balance_after: reversedBalance,
                        description: `Cheque #${cheque.cheque_number} bounced - payment reversed`,
                        payment_method: 'cheque',
                        bank: cheque.bank_name,
                        entry_date: statusDateTime,
                        created_by: req.user.id,
                    }, { transaction: t });

                    const currentBankBalance = await getLatestBankBalance(cheque.bank_name, cheque.branch_id, t);
                    const newBankBalance = currentBankBalance - parseFloat(cheque.amount);
                    await db.BankTransaction.create({
                        entry_type: 'withdrawal',
                        amount: parseFloat(cheque.amount),
                        balance_after: newBankBalance,
                        bank_name: cheque.bank_name,
                        cheque_number: cheque.cheque_number,
                        description: `Cheque #${cheque.cheque_number} bounced - reversal`,
                        reference_type: 'cheque_bounce',
                        reference_id: cheque.id,
                        entry_date: statusDateTime,
                        branch_id: cheque.branch_id,
                        created_by: req.user.id,
                    }, { transaction: t });

                    const originalDay = dayOnly(originalDate);
                    const fromDate = originalDay < statusDay ? originalDay : statusDay;
                    await recomputeBankBalances(cheque.bank_name, fromDate, cheque.branch_id, t);
                }
            }
        }

        await t.commit();
        res.json({ success: true, message: `Cheque marked as ${status}` });
    } catch (error) {
        await t.rollback();
        console.error('updateChequeStatus error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ─── GET CUSTOMER LEDGER (with payments) ──────────────────────────────
const getCustomerLedgerWithPayments = async (req, res) => {
    try {
        const customerId = req.params.id;
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.max(parseInt(req.query.limit, 10) || 100, 1);
        const offset = (page - 1) * limit;

        const customer = await db.Customer.findByPk(customerId);
        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        const { rows, count } = await db.CustomerLedger.findAndCountAll({
            where: { customer_id: customerId },
            order: [['entry_date', 'DESC'], ['id', 'DESC']],
            limit,
            offset,
        });

        const chequeStatus = await getChequeStatusMap(rows, 'customer_payment');

        res.json({
            success: true,
            customer: {
                id: customer.id,
                name: customer.name,
                current_balance: parseFloat(customer.current_balance || 0),
                credit_limit: parseFloat(customer.credit_limit || 0),
            },
            entries: rows.map(r => {
                const ch =
                    r.payment_method === 'cheque' && r.entry_type === 'payment'
                        ? chequeStatus.get(r.id)
                        : null;
                return {
                    id: r.id,
                    entry_type: r.entry_type,
                    reference_id: r.reference_id,
                    reference_number: r.reference_number,
                    debit: parseFloat(r.debit || 0),
                    credit: parseFloat(r.credit || 0),
                    balance_after: parseFloat(r.balance_after || 0),
                    description: r.description,
                    payment_method: r.payment_method || null,
                    bank: r.bank || null,
                    cheque_status: ch ? ch.cheque_status || null : null,
                    cheque_number: ch ? ch.cheque_number || null : null,
                    cheque_date: ch ? ch.cheque_date || null : null,
                    cheque_status_date: ch ? ch.cheque_status_date || null : null,
                    entry_date: r.entry_date,
                    created_at: r.createdAt,
                };
            }),
            page,
            total_pages: Math.max(Math.ceil(count / limit), 1),
            has_more: offset + rows.length < count,
        });
    } catch (error) {
        console.error('getCustomerLedger error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ─── GET ALL CUSTOMERS' LEDGER (for offline sync pull) ────────────────
const getAllCustomerLedger = async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 5000);
        const offset = (page - 1) * limit;

        const { rows, count } = await db.CustomerLedger.findAndCountAll({
            order: [['entry_date', 'DESC'], ['id', 'DESC']],
            limit,
            offset,
        });

        const chequeStatus = await getChequeStatusMap(rows, 'customer_payment');

        res.json({
            success: true,
            entries: rows.map(r => {
                const ch =
                    r.payment_method === 'cheque' && r.entry_type === 'payment'
                        ? chequeStatus.get(r.id)
                        : null;
                return {
                    id: r.id,
                    customer_id: r.customer_id,
                    entry_type: r.entry_type,
                    reference_id: r.reference_id,
                    reference_number: r.reference_number,
                    debit: parseFloat(r.debit || 0),
                    credit: parseFloat(r.credit || 0),
                    balance_after: parseFloat(r.balance_after || 0),
                    description: r.description,
                    payment_method: r.payment_method || null,
                    bank: r.bank || null,
                    cheque_status: ch ? ch.cheque_status || null : null,
                    cheque_number: ch ? ch.cheque_number || null : null,
                    cheque_date: ch ? ch.cheque_date || null : null,
                    cheque_status_date: ch ? ch.cheque_status_date || null : null,
                    entry_date: r.entry_date,
                    created_by: r.created_by,
                    created_at: r.createdAt,
                };
            }),
            total: count,
            page,
            total_pages: Math.max(Math.ceil(count / limit), 1),
            has_more: offset + rows.length < count,
        });
    } catch (error) {
        console.error('getAllCustomerLedger error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ─── CREATE MANUAL CASH BOOK ENTRY ─────────────────────────────────────
const createManualCashBookEntry = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const {
            entry_type,
            amount,
            description,
            reference_number,
            entry_date,
            branch_id,
        } = req.body;

        const type = normaliseCashType(entry_type);
        if (!type) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Invalid entry type' });
        }
        const entryAmount = parseFloat(amount);
        if (!entryAmount || entryAmount <= 0) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Valid amount is required' });
        }
        if (!description || !description.trim()) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Description is required' });
        }

        const userId = req.user.id;
        const scopedBranch = await resolveBranchId(branch_id, t);

        const entryDateTime = normalizeEntryDate(entry_date);
        const entryDay = dayOnly(entryDateTime);

        const currentBalance = await getLatestCashBalance(scopedBranch, t);
        const newBalance =
            type.api === 'cash_in'
                ? currentBalance + entryAmount
                : currentBalance - entryAmount;

        const entry = await db.CashBook.create({
            entry_type: type.db,
            amount: entryAmount,
            balance_after: newBalance,
            description: description.trim(),
            reference_type: 'manual',
            reference_id: null,
            reference_number: reference_number || null,
            entry_date: entryDateTime,
            branch_id: scopedBranch,
            created_by: userId,
        }, { transaction: t });

        await recomputeCashBookBalances(entryDay, scopedBranch, t);

        await t.commit();
        await entry.reload();

        const payload = {
            id: entry.id,
            entry_type: entry.entry_type,
            amount: parseFloat(entry.amount),
            balance_after: parseFloat(entry.balance_after),
            description: entry.description,
            reference_type: entry.reference_type,
            reference_id: entry.reference_id,
            reference_number: entry.reference_number,
            entry_date: entry.entry_date,
            branch_id: entry.branch_id,
            created_by: entry.created_by,
            created_at: entry.createdAt,
            updated_at: entry.updatedAt,
        };

        res.status(201).json({
            success: true,
            message: 'Cash book entry added',
            entry: payload,
            data: payload,
        });
    } catch (error) {
        await t.rollback();
        console.error('createManualCashBookEntry error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// ─── UPDATE MANUAL CASH BOOK ENTRY ─────────────────────────────────────
const updateManualCashBookEntry = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const entry = await db.CashBook.findByPk(req.params.id, { transaction: t });
        if (!entry) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Entry not found' });
        }
        if (entry.reference_type !== 'manual') {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Only manual entries can be edited' });
        }

        const { entry_type, amount, description, reference_number, entry_date } = req.body;

        const type = normaliseCashType(entry_type);
        if (!type) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Invalid entry type' });
        }
        if (!amount || parseFloat(amount) <= 0) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Valid amount is required' });
        }

        const dbEntryType = type.db;

        const oldDateTime = entry.entry_date;
        const newDateTime = entry_date ? normalizeEntryDate(entry_date) : oldDateTime;

        await entry.update({
            entry_type: dbEntryType,
            amount: parseFloat(amount),
            description: description?.trim() || entry.description,
            reference_number: reference_number || null,
            entry_date: newDateTime,
        }, { transaction: t });

        const oldDay = dayOnly(oldDateTime);
        const newDay = dayOnly(newDateTime);
        const fromDay = oldDay < newDay ? oldDay : newDay;
        await recomputeCashBookBalances(fromDay, entry.branch_id || null, t);

        await t.commit();
        await entry.reload();

        res.json({ success: true, message: 'Entry updated', data: entry });
    } catch (error) {
        await t.rollback();
        console.error('updateManualCashBookEntry error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// ─── DELETE MANUAL CASH BOOK ENTRY ─────────────────────────────────────
const deleteManualCashBookEntry = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const entry = await db.CashBook.findByPk(req.params.id, { transaction: t });
        if (!entry) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Entry not found' });
        }
        if (entry.reference_type !== 'manual') {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Only manual entries can be deleted' });
        }

        const deletedDay = dayOnly(entry.entry_date);
        const deletedBranch = entry.branch_id || null;

        await entry.destroy({ transaction: t });

        await recomputeCashBookBalances(deletedDay, deletedBranch, t);

        await t.commit();
        res.json({ success: true, message: 'Entry deleted' });
    } catch (error) {
        await t.rollback();
        console.error('deleteManualCashBookEntry error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// ─── GET BANK ACCOUNTS SUMMARY ─────────────────────────────────────────
const getBankAccounts = async (req, res) => {
    try {
        const branchId = req.query.branch_id || null;
        const whereBranch = branchId ? { branch_id: branchId } : {};

        const rows = await db.BankTransaction.findAll({
            where: whereBranch,
            order: [['id', 'DESC']],
            attributes: [
                'id', 'bank_name', 'entry_type', 'amount',
                'balance_after', 'entry_date', 'account_number',
                'description',
            ],
            raw: true,
        });

        const seen = new Map();
        for (const r of rows) {
            if (!r.bank_name) continue;
            if (seen.has(r.bank_name)) continue;
            seen.set(r.bank_name, r);
        }

        const counts = await db.BankTransaction.findAll({
            where: whereBranch,
            attributes: [
                'bank_name',
                [sequelize.fn('COUNT', sequelize.col('id')), 'txn_count'],
                [
                    sequelize.fn(
                        'SUM',
                        sequelize.literal(
                            "CASE WHEN entry_type IN ('deposit','cheque_in','transfer_in') THEN amount ELSE 0 END"
                        )
                    ),
                    'total_in',
                ],
                [
                    sequelize.fn(
                        'SUM',
                        sequelize.literal(
                            "CASE WHEN entry_type IN ('withdrawal','cheque_out','transfer_out') THEN amount ELSE 0 END"
                        )
                    ),
                    'total_out',
                ],
            ],
            group: ['bank_name'],
            raw: true,
        });

        const countMap = new Map(counts.map((c) => [c.bank_name, c]));

        const accounts = Array.from(seen.entries()).map(([bankName, last]) => {
            const stats = countMap.get(bankName) || {};
            return {
                bank_name: bankName,
                account_number: last.account_number || null,
                current_balance: parseFloat(last.balance_after || 0),
                last_entry_date: last.entry_date,
                last_entry_type: last.entry_type,
                last_amount: parseFloat(last.amount || 0),
                txn_count: parseInt(stats.txn_count, 10) || 0,
                total_in: parseFloat(stats.total_in || 0),
                total_out: parseFloat(stats.total_out || 0),
            };
        });

        accounts.sort((a, b) => b.current_balance - a.current_balance);

        const grandTotal = accounts.reduce(
            (sum, a) => sum + a.current_balance,
            0
        );

        res.json({
            success: true,
            data: {
                accounts,
                summary: {
                    bank_count: accounts.length,
                    total_balance: grandTotal,
                },
            },
        });
    } catch (error) {
        console.error('getBankAccounts error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ─── INTER-BANK TRANSFER ──────────────────────────────────────────────
const transferBetweenBanks = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const {
            from_bank,
            to_bank,
            amount,
            description,
            entry_date,
            branch_id,
            reference_number,
        } = req.body;

        if (!from_bank || !to_bank) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: 'Both source and destination banks are required',
            });
        }

        const fromBank = canonicalBankName(from_bank);
        const toBank = canonicalBankName(to_bank);

        if (fromBank === toBank) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: 'Source and destination banks must be different',
            });
        }

        const amt = parseFloat(amount);
        if (!amt || amt <= 0) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: 'Valid amount is required',
            });
        }

        const payDate = normalizeEntryDate(entry_date);
        const payDay = dayOnly(payDate);
        const userId = req.user.id;
        const scopedBranch = await resolveBranchId(branch_id, t);

        const refNumber = reference_number || `TRF-${Date.now()}`;
        if (reference_number) {
            const existingOut = await db.BankTransaction.findOne({
                where: {
                    reference_type: 'bank_transfer',
                    reference_number: refNumber,
                    entry_type: 'transfer_out',
                },
                transaction: t,
            });
            if (existingOut) {
                const existingIn = existingOut.reference_id
                    ? await db.BankTransaction.findByPk(existingOut.reference_id, { transaction: t })
                    : null;
                await t.commit();
                return res.status(200).json({
                    success: true,
                    message: 'Transfer already recorded',
                    transaction: existingOut,
                    data: {
                        transfer_reference: refNumber,
                        transfer_out: existingOut,
                        transfer_in: existingIn,
                    },
                });
            }
        }

        const sourceBalance = await getLatestBankBalance(fromBank, scopedBranch, t);
        if (sourceBalance < amt) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message:
                    `Insufficient balance in ${fromBank}. ` +
                    `Available: Rs. ${sourceBalance.toFixed(2)}`,
            });
        }

        const destBalance = await getLatestBankBalance(toBank, scopedBranch, t);

        const descOut = description?.trim() || `Transfer to ${toBank}`;
        const descIn = description?.trim() || `Transfer from ${fromBank}`;

        const outEntry = await db.BankTransaction.create(
            {
                entry_type: 'transfer_out',
                amount: amt,
                balance_after: sourceBalance - amt,
                bank_name: fromBank,
                reference_type: 'bank_transfer',
                reference_number: refNumber,
                description: descOut,
                entry_date: payDate,
                branch_id: scopedBranch,
                created_by: userId,
            },
            { transaction: t }
        );

        const inEntry = await db.BankTransaction.create(
            {
                entry_type: 'transfer_in',
                amount: amt,
                balance_after: destBalance + amt,
                bank_name: toBank,
                reference_type: 'bank_transfer',
                reference_number: refNumber,
                description: descIn,
                entry_date: payDate,
                branch_id: scopedBranch,
                created_by: userId,
            },
            { transaction: t }
        );

        await outEntry.update({ reference_id: inEntry.id }, { transaction: t });
        await inEntry.update({ reference_id: outEntry.id }, { transaction: t });

        await recomputeBankBalances(fromBank, payDay, scopedBranch, t);
        await recomputeBankBalances(toBank, payDay, scopedBranch, t);

        await t.commit();

        await outEntry.reload();
        await inEntry.reload();

        const outPayload = {
            id: outEntry.id,
            entry_type: outEntry.entry_type,
            amount: parseFloat(outEntry.amount),
            balance_after: parseFloat(outEntry.balance_after),
            bank_name: outEntry.bank_name,
            reference_type: outEntry.reference_type,
            reference_id: outEntry.reference_id,
            reference_number: outEntry.reference_number,
            description: outEntry.description,
            entry_date: outEntry.entry_date,
            branch_id: outEntry.branch_id,
            created_by: outEntry.created_by,
            created_at: outEntry.createdAt,
            updated_at: outEntry.updatedAt,
        };

        res.status(201).json({
            success: true,
            message: `Transferred Rs. ${amt.toFixed(2)} from ${fromBank} to ${toBank}`,
            transaction: outPayload,
            data: {
                transfer_reference: refNumber,
                from_bank: fromBank,
                to_bank: toBank,
                amount: amt,
                source_new_balance: parseFloat(outEntry.balance_after),
                destination_new_balance: parseFloat(inEntry.balance_after),
                transfer_out: outPayload,
                transfer_in: {
                    id: inEntry.id,
                    entry_type: inEntry.entry_type,
                    amount: parseFloat(inEntry.amount),
                    balance_after: parseFloat(inEntry.balance_after),
                    bank_name: inEntry.bank_name,
                    reference_id: inEntry.reference_id,
                    reference_number: inEntry.reference_number,
                    entry_date: inEntry.entry_date,
                },
            },
        });
    } catch (error) {
        await t.rollback();
        console.error('transferBetweenBanks error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message,
        });
    }
};

// ─── MANUAL BANK TRANSACTION (add / deduct funds) ─────────────────────
const createManualBankTransaction = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const {
            bank_name,
            amount,
            entry_type,
            description,
            reference_number,
            account_number,
            entry_date,
            branch_id,
        } = req.body;

        if (!bank_name || !bank_name.trim()) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: 'Bank name is required',
            });
        }
        if (!['deposit', 'withdrawal'].includes(entry_type)) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: 'entry_type must be "deposit" or "withdrawal"',
            });
        }
        const amt = parseFloat(amount);
        if (!amt || amt <= 0) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: 'Valid amount is required',
            });
        }

        const userId = req.user.id;
        const bankName = canonicalBankName(bank_name);
        const scopedBranch = await resolveBranchId(branch_id, t);

        const entryDateTime = normalizeEntryDate(entry_date);
        const entryDay = dayOnly(entryDateTime);

        const currentBalance = await getLatestBankBalance(bankName, scopedBranch, t);

        if (entry_type === 'withdrawal' && currentBalance < amt) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message:
                    `Insufficient balance in ${bankName}. ` +
                    `Available: Rs. ${currentBalance.toFixed(2)}`,
            });
        }

        const newBalance =
            entry_type === 'deposit'
                ? currentBalance + amt
                : currentBalance - amt;

        const entry = await db.BankTransaction.create(
            {
                entry_type,
                amount: amt,
                balance_after: newBalance,
                bank_name: bankName,
                account_number: account_number || null,
                reference_type: 'manual',
                reference_number: reference_number || null,
                description: description?.trim() || null,
                entry_date: entryDateTime,
                branch_id: scopedBranch,
                created_by: userId,
            },
            { transaction: t }
        );

        await recomputeBankBalances(bankName, entryDay, scopedBranch, t);

        await t.commit();
        await entry.reload();

        const txnPayload = {
            id: entry.id,
            entry_type: entry.entry_type,
            amount: parseFloat(entry.amount),
            balance_after: parseFloat(entry.balance_after),
            bank_name: entry.bank_name,
            account_number: entry.account_number,
            reference_type: entry.reference_type,
            reference_number: entry.reference_number,
            description: entry.description,
            entry_date: entry.entry_date,
            branch_id: entry.branch_id,
            created_by: entry.created_by,
        };

        res.status(201).json({
            success: true,
            message:
                entry_type === 'deposit'
                    ? `Rs. ${amt.toFixed(2)} added to ${bankName}`
                    : `Rs. ${amt.toFixed(2)} deducted from ${bankName}`,
            transaction: txnPayload,
            data: {
                transaction: txnPayload,
                bank_new_balance: parseFloat(entry.balance_after),
            },
        });
    } catch (error) {
        await t.rollback();
        console.error('createManualBankTransaction error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message,
        });
    }
};

// ─── DELETE BANK TRANSACTION (manual or transfer) ──────────────────────
const deleteBankTransaction = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const entry = await db.BankTransaction.findByPk(req.params.id, { transaction: t });
        if (!entry) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Transaction not found' });
        }

        const isTransferLeg =
            entry.entry_type === 'transfer_in' || entry.entry_type === 'transfer_out';

        if (!isTransferLeg && entry.reference_type !== 'manual') {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: 'Only manual entries or transfers can be deleted directly',
            });
        }

        const affectedBanks = [];

        if (isTransferLeg) {
            const pairedEntry = entry.reference_id
                ? await db.BankTransaction.findByPk(entry.reference_id, { transaction: t })
                : null;

            const entryDay = dayOnly(entry.entry_date);
            const entryBank = entry.bank_name;
            const entryBranch = entry.branch_id || null;

            affectedBanks.push({ bankName: entryBank, fromDate: entryDay, branchId: entryBranch });

            await entry.destroy({ transaction: t });

            if (pairedEntry) {
                const pairedDay = dayOnly(pairedEntry.entry_date);
                const pairedBank = pairedEntry.bank_name;
                const pairedBranch = pairedEntry.branch_id || null;

                affectedBanks.push({ bankName: pairedBank, fromDate: pairedDay, branchId: pairedBranch });

                await pairedEntry.destroy({ transaction: t });
            }
        } else {
            affectedBanks.push({
                bankName: entry.bank_name,
                fromDate: dayOnly(entry.entry_date),
                branchId: entry.branch_id || null,
            });

            await entry.destroy({ transaction: t });
        }

        for (const { bankName, fromDate, branchId } of affectedBanks) {
            await recomputeBankBalances(bankName, fromDate, branchId, t);
        }

        await t.commit();

        res.json({
            success: true,
            message: isTransferLeg
                ? 'Transfer deleted from both banks'
                : 'Bank transaction deleted',
        });
    } catch (error) {
        await t.rollback();
        console.error('deleteBankTransaction error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// ─── GET CUSTOMER PAYMENTS ─────────────────────────────────────────────
// ✅ FIX: pagination now happens AFTER the cheque filter, using a larger
// over-fetch window and computing total_pages from the filtered array.
const getCustomerPayments = async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.max(parseInt(req.query.limit, 10) || 50, 1);
        const offset = (page - 1) * limit;

        const where = {
            entry_type: 'payment',
        };
        if (req.query.customer_id) where.customer_id = req.query.customer_id;
        if (req.query.payment_method) where.payment_method = req.query.payment_method;
        if (req.query.start_date && req.query.end_date) {
            where.entry_date = {
                [Op.between]: [req.query.start_date, `${req.query.end_date} 23:59:59`],
            };
        }

        // Over-fetch aggressively because cheque rows are dropped after
        // the join. Cap at 5000 to avoid pathological memory usage.
        const overFetchLimit = Math.min(limit * 10 + offset, 5000);

        const { rows } = await db.CustomerLedger.findAndCountAll({
            where,
            include: [
                { association: 'customer', attributes: ['id', 'name', 'phone'], required: false },
            ],
            order: [['entry_date', 'DESC'], ['id', 'DESC']],
            limit: overFetchLimit,
        });

        const results = [];
        for (const entry of rows) {
            const method = entry.payment_method;

            if (method === 'cheque') {
                const bankTxn = await db.BankTransaction.findOne({
                    where: {
                        reference_type: 'customer_payment',
                        reference_id: entry.id,
                    },
                });
                if (!bankTxn || bankTxn.cheque_status !== 'cleared') {
                    continue;
                }
                results.push({
                    ledger_id: entry.id,
                    customer_id: entry.customer_id,
                    customer_name: entry.customer ? entry.customer.name : null,
                    customer_phone: entry.customer ? entry.customer.phone : null,
                    amount: parseFloat(entry.debit || 0),
                    payment_method: 'cheque',
                    bank: entry.bank,
                    cheque_number: bankTxn.cheque_number,
                    cheque_status: bankTxn.cheque_status,
                    bank_transaction_id: bankTxn.id,
                    cash_book_id: null,
                    description: entry.description,
                    entry_date: entry.entry_date,
                    balance_after: parseFloat(entry.balance_after || 0),
                    created_at: entry.createdAt,
                });
            } else if (method === 'bank') {
                const bankTxn = await db.BankTransaction.findOne({
                    where: {
                        reference_type: 'customer_payment',
                        reference_id: entry.id,
                    },
                });
                results.push({
                    ledger_id: entry.id,
                    customer_id: entry.customer_id,
                    customer_name: entry.customer ? entry.customer.name : null,
                    customer_phone: entry.customer ? entry.customer.phone : null,
                    amount: parseFloat(entry.debit || 0),
                    payment_method: 'bank',
                    bank: entry.bank,
                    cheque_number: null,
                    cheque_status: null,
                    bank_transaction_id: bankTxn ? bankTxn.id : null,
                    cash_book_id: null,
                    description: entry.description,
                    entry_date: entry.entry_date,
                    balance_after: parseFloat(entry.balance_after || 0),
                    created_at: entry.createdAt,
                });
            } else if (method === 'cash') {
                const cashRow = await db.CashBook.findOne({
                    where: {
                        reference_type: 'customer_payment',
                        reference_id: entry.id,
                    },
                });
                results.push({
                    ledger_id: entry.id,
                    customer_id: entry.customer_id,
                    customer_name: entry.customer ? entry.customer.name : null,
                    customer_phone: entry.customer ? entry.customer.phone : null,
                    amount: parseFloat(entry.debit || 0),
                    payment_method: 'cash',
                    bank: null,
                    cheque_number: null,
                    cheque_status: null,
                    bank_transaction_id: null,
                    cash_book_id: cashRow ? cashRow.id : null,
                    description: entry.description,
                    entry_date: entry.entry_date,
                    balance_after: parseFloat(entry.balance_after || 0),
                    created_at: entry.createdAt,
                });
            }
        }

        const paged = results.slice(offset, offset + limit);

        res.json({
            success: true,
            data: {
                entries: paged,
            },
            page,
            total_pages: Math.max(Math.ceil(results.length / limit), 1),
            has_more: offset + paged.length < results.length,
        });
    } catch (error) {
        console.error('getCustomerPayments error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// ─── DELETE CUSTOMER PAYMENT ───────────────────────────────────────────
const deleteCustomerPayment = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const ledgerEntry = await db.CustomerLedger.findByPk(req.params.id, { transaction: t });
        if (!ledgerEntry) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }
        if (ledgerEntry.entry_type !== 'payment') {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: 'This ledger entry is not a payment and cannot be deleted here',
            });
        }

        const customer = await db.Customer.findByPk(ledgerEntry.customer_id, { transaction: t });
        if (!customer) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        const method = ledgerEntry.payment_method;
        const debitAmount = parseFloat(ledgerEntry.debit || 0);
        const originalLedgerDate = ledgerEntry.entry_date;

        let linkedBankTxn = null;
        let linkedCashRow = null;

        if (method === 'cheque' || method === 'bank') {
            linkedBankTxn = await db.BankTransaction.findOne({
                where: { reference_type: 'customer_payment', reference_id: ledgerEntry.id },
                transaction: t,
            });
            if (method === 'cheque' && linkedBankTxn && linkedBankTxn.cheque_status !== 'cleared') {
                await t.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Only cleared cheques can be deleted from the payments list. ' +
                        'Update the cheque status instead.',
                });
            }
        } else if (method === 'cash') {
            linkedCashRow = await db.CashBook.findOne({
                where: { reference_type: 'customer_payment', reference_id: ledgerEntry.id },
                transaction: t,
            });
        }

        const currentBalance = parseFloat(customer.current_balance || 0);
        const reversedBalance = currentBalance + debitAmount;
        await customer.update({ current_balance: reversedBalance }, { transaction: t });

        await ledgerEntry.destroy({ transaction: t });

        if (linkedBankTxn) {
            const bankName = linkedBankTxn.bank_name;
            const bankDay = dayOnly(linkedBankTxn.entry_date);
            const bankBranch = linkedBankTxn.branch_id || null;
            await linkedBankTxn.destroy({ transaction: t });
            await recomputeBankBalances(bankName, bankDay, bankBranch, t);
        }

        if (linkedCashRow) {
            const cashDay = dayOnly(linkedCashRow.entry_date);
            const cashBranch = linkedCashRow.branch_id || null;
            await linkedCashRow.destroy({ transaction: t });
            await recomputeCashBookBalances(cashDay, cashBranch, t);
        }

        const laterEntries = await db.CustomerLedger.findAll({
            where: {
                customer_id: ledgerEntry.customer_id,
                entry_date: { [Op.gte]: originalLedgerDate },
            },
            order: [['entry_date', 'ASC'], ['id', 'ASC']],
            transaction: t,
        });

        const seedEntry = await db.CustomerLedger.findOne({
            where: {
                customer_id: ledgerEntry.customer_id,
                entry_date: { [Op.lt]: originalLedgerDate },
            },
            order: [['entry_date', 'DESC'], ['id', 'DESC']],
            transaction: t,
        });
        let runningBalance = seedEntry ? parseFloat(seedEntry.balance_after || 0) : 0;

        for (const row of laterEntries) {
            runningBalance = runningBalance + parseFloat(row.debit || 0) - parseFloat(row.credit || 0);
            if (parseFloat(row.balance_after || 0) !== runningBalance) {
                await row.update({ balance_after: runningBalance }, { transaction: t });
            }
        }

        await customer.update({ current_balance: runningBalance }, { transaction: t });

        await t.commit();

        res.json({
            success: true,
            message: 'Payment deleted and reversed everywhere',
            data: {
                customer_id: ledgerEntry.customer_id,
                customer_new_balance: runningBalance,
            },
        });
    } catch (error) {
        await t.rollback();
        console.error('deleteCustomerPayment error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// ─── PAY SUPPLIER ──────────────────────────────────────────────────────
const paySupplier = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const {
            supplier_id,
            amount,
            payment_method,
            bank_name,
            account_number,
            cheque_number,
            cheque_date,
            description,
            entry_date,
            branch_id,
        } = req.body;

        if (!supplier_id) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Supplier ID is required' });
        }
        if (!amount || parseFloat(amount) <= 0) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Valid amount is required' });
        }
        if (!['cash', 'bank', 'cheque'].includes(payment_method)) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Invalid payment method' });
        }
        if ((payment_method === 'bank' || payment_method === 'cheque') && !bank_name) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Bank name is required' });
        }
        if (payment_method === 'cheque' && (!cheque_number || !cheque_date)) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Cheque number and date are required' });
        }

        const canonicalBank = bank_name ? canonicalBankName(bank_name) : null;

        const supplier = await db.Supplier.findByPk(supplier_id, { transaction: t });
        if (!supplier) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Supplier not found' });
        }

        const payAmount = parseFloat(amount);
        const payDate = normalizeEntryDate(entry_date);
        const payDay = dayOnly(payDate);
        const userId = req.user.id;
        const scopedBranch = await resolveBranchId(branch_id || supplier.branch_id, t);

        const currentBalance = parseFloat(supplier.current_balance || 0);
        const newBalance = currentBalance - payAmount;
        await supplier.update({ current_balance: newBalance }, { transaction: t });

        const ledgerEntry = await db.SupplierLedger.create({
            supplier_id,
            entry_type: 'payment',
            reference_id: null,
            reference_number: null,
            debit: 0,
            credit: payAmount,
            balance_after: newBalance,
            description: description || `Payment sent via ${payment_method}`,
            payment_method,
            bank: canonicalBank || null,
            entry_date: payDate,
            created_by: userId,
        }, { transaction: t });

        let cashBookEntry = null;
        if (payment_method === 'cash') {
            const currentCash = await getLatestCashBalance(scopedBranch, t);
            const newCashBalance = currentCash - payAmount;

            cashBookEntry = await db.CashBook.create({
                entry_type: 'payment',
                amount: payAmount,
                balance_after: newCashBalance,
                description: description || `Payment to ${supplier.name}`,
                reference_type: 'supplier_payment',
                reference_id: ledgerEntry.id,
                reference_number: supplier.name,
                entry_date: payDate,
                branch_id: scopedBranch,
                created_by: userId,
            }, { transaction: t });

            await recomputeCashBookBalances(payDay, scopedBranch, t);
        }

        let bankTransaction = null;
        if (payment_method === 'bank' || payment_method === 'cheque') {
            const currentBankBalance = await getLatestBankBalance(canonicalBank, scopedBranch, t);
            const newBankBalance = currentBankBalance - payAmount;

            bankTransaction = await db.BankTransaction.create({
                entry_type: payment_method === 'cheque' ? 'cheque_out' : 'withdrawal',
                amount: payAmount,
                balance_after: newBankBalance,
                bank_name: canonicalBank,
                account_number: account_number || null,
                cheque_number: cheque_number || null,
                cheque_date: cheque_date || null,
                cheque_status: payment_method === 'cheque' ? 'pending' : null,
                reference_type: 'supplier_payment',
                reference_id: ledgerEntry.id,
                reference_number: supplier.name,
                description: description || `Payment to ${supplier.name}`,
                entry_date: payDate,
                branch_id: scopedBranch,
                created_by: userId,
            }, { transaction: t });

            await recomputeBankBalances(canonicalBank, payDay, scopedBranch, t);
        }

        await t.commit();

        res.status(201).json({
            success: true,
            message: 'Payment sent successfully',
            data: {
                ledger_entry: {
                    id: ledgerEntry.id,
                    supplier_id,
                    credit: payAmount,
                    balance_after: newBalance,
                    payment_method,
                    bank: canonicalBank || null,
                    entry_date: payDate,
                },
                cash_book: cashBookEntry,
                bank_transaction: bankTransaction,
                supplier_new_balance: newBalance,
            },
        });
    } catch (error) {
        await t.rollback();
        console.error('paySupplier error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// ─── GET SUPPLIER PAYMENTS ─────────────────────────────────────────────
const getSupplierPayments = async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.max(parseInt(req.query.limit, 10) || 50, 1);
        const offset = (page - 1) * limit;

        const where = { entry_type: 'payment' };
        if (req.query.supplier_id) where.supplier_id = req.query.supplier_id;
        if (req.query.payment_method) where.payment_method = req.query.payment_method;
        if (req.query.start_date && req.query.end_date) {
            where.entry_date = {
                [Op.between]: [req.query.start_date, `${req.query.end_date} 23:59:59`],
            };
        }

        const { rows } = await db.SupplierLedger.findAndCountAll({
            where,
            include: [
                { association: 'supplier', attributes: ['id', 'name', 'phone'], required: false },
            ],
            order: [['entry_date', 'DESC'], ['id', 'DESC']],
            limit: limit * 10 + offset,
        });

        const results = [];
        for (const entry of rows) {
            const method = entry.payment_method;

            if (method === 'cheque') {
                const bankTxn = await db.BankTransaction.findOne({
                    where: { reference_type: 'supplier_payment', reference_id: entry.id },
                });
                if (!bankTxn || bankTxn.cheque_status !== 'cleared') continue;
                results.push(_mapSupplierPayment(entry, bankTxn, null));
            } else if (method === 'bank') {
                const bankTxn = await db.BankTransaction.findOne({
                    where: { reference_type: 'supplier_payment', reference_id: entry.id },
                });
                results.push(_mapSupplierPayment(entry, bankTxn, null));
            } else if (method === 'cash') {
                const cashRow = await db.CashBook.findOne({
                    where: { reference_type: 'supplier_payment', reference_id: entry.id },
                });
                results.push(_mapSupplierPayment(entry, null, cashRow));
            }
        }

        const paged = results.slice(offset, offset + limit);

        res.json({
            success: true,
            data: { entries: paged },
            page,
            total_pages: Math.max(Math.ceil(results.length / limit), 1),
            has_more: offset + paged.length < results.length,
        });
    } catch (error) {
        console.error('getSupplierPayments error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

const _mapSupplierPayment = (entry, bankTxn, cashRow) => ({
    ledger_id: entry.id,
    supplier_id: entry.supplier_id,
    supplier_name: entry.supplier ? entry.supplier.name : null,
    supplier_phone: entry.supplier ? entry.supplier.phone : null,
    amount: parseFloat(entry.credit || 0),
    payment_method: entry.payment_method,
    bank: entry.bank,
    cheque_number: bankTxn ? bankTxn.cheque_number : null,
    cheque_status: bankTxn ? bankTxn.cheque_status : null,
    bank_transaction_id: bankTxn ? bankTxn.id : null,
    cash_book_id: cashRow ? cashRow.id : null,
    description: entry.description,
    entry_date: entry.entry_date,
    balance_after: parseFloat(entry.balance_after || 0),
    created_at: entry.createdAt,
});

// ─── DELETE SUPPLIER PAYMENT ────────────────────────────────────────────
const deleteSupplierPayment = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const ledgerEntry = await db.SupplierLedger.findByPk(req.params.id, { transaction: t });
        if (!ledgerEntry) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }
        if (ledgerEntry.entry_type !== 'payment') {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: 'This ledger entry is not a payment',
            });
        }

        const supplier = await db.Supplier.findByPk(ledgerEntry.supplier_id, { transaction: t });
        if (!supplier) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Supplier not found' });
        }

        const method = ledgerEntry.payment_method;
        const creditAmount = parseFloat(ledgerEntry.credit || 0);
        const originalLedgerDate = ledgerEntry.entry_date;

        let linkedBankTxn = null;
        let linkedCashRow = null;

        if (method === 'cheque' || method === 'bank') {
            linkedBankTxn = await db.BankTransaction.findOne({
                where: { reference_type: 'supplier_payment', reference_id: ledgerEntry.id },
                transaction: t,
            });
            if (method === 'cheque' && linkedBankTxn && linkedBankTxn.cheque_status !== 'cleared') {
                await t.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Only cleared cheques can be deleted. Update the cheque status instead.',
                });
            }
        } else if (method === 'cash') {
            linkedCashRow = await db.CashBook.findOne({
                where: { reference_type: 'supplier_payment', reference_id: ledgerEntry.id },
                transaction: t,
            });
        }

        const currentBalance = parseFloat(supplier.current_balance || 0);
        const reversedBalance = currentBalance + creditAmount;
        await supplier.update({ current_balance: reversedBalance }, { transaction: t });

        await ledgerEntry.destroy({ transaction: t });

        if (linkedBankTxn) {
            const bankName = linkedBankTxn.bank_name;
            const bankDay = dayOnly(linkedBankTxn.entry_date);
            const bankBranch = linkedBankTxn.branch_id || null;
            await linkedBankTxn.destroy({ transaction: t });
            await recomputeBankBalances(bankName, bankDay, bankBranch, t);
        }

        if (linkedCashRow) {
            const cashDay = dayOnly(linkedCashRow.entry_date);
            const cashBranch = linkedCashRow.branch_id || null;
            await linkedCashRow.destroy({ transaction: t });
            await recomputeCashBookBalances(cashDay, cashBranch, t);
        }

        const laterEntries = await db.SupplierLedger.findAll({
            where: {
                supplier_id: ledgerEntry.supplier_id,
                entry_date: { [Op.gte]: originalLedgerDate },
            },
            order: [['entry_date', 'ASC'], ['id', 'ASC']],
            transaction: t,
        });

        const seedEntry = await db.SupplierLedger.findOne({
            where: {
                supplier_id: ledgerEntry.supplier_id,
                entry_date: { [Op.lt]: originalLedgerDate },
            },
            order: [['entry_date', 'DESC'], ['id', 'DESC']],
            transaction: t,
        });
        let running = seedEntry ? parseFloat(seedEntry.balance_after || 0) : 0;

        for (const row of laterEntries) {
            running = running + parseFloat(row.debit || 0) - parseFloat(row.credit || 0);
            if (parseFloat(row.balance_after || 0) !== running) {
                await row.update({ balance_after: running }, { transaction: t });
            }
        }

        await supplier.update({ current_balance: running }, { transaction: t });

        await t.commit();

        res.json({
            success: true,
            message: 'Supplier payment deleted and reversed',
            data: {
                supplier_id: ledgerEntry.supplier_id,
                supplier_new_balance: running,
            },
        });
    } catch (error) {
        await t.rollback();
        console.error('deleteSupplierPayment error:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// ─── GET ALL SUPPLIERS' LEDGER (for offline sync pull) ─────────────────
const getAllSupplierLedger = async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 5000);
        const offset = (page - 1) * limit;

        const { rows, count } = await db.SupplierLedger.findAndCountAll({
            order: [['entry_date', 'DESC'], ['id', 'DESC']],
            limit,
            offset,
        });

        const chequeStatus = await getChequeStatusMap(rows, 'supplier_payment');

        res.json({
            success: true,
            entries: rows.map(r => {
                const ch =
                    r.payment_method === 'cheque' && r.entry_type === 'payment'
                        ? chequeStatus.get(r.id)
                        : null;
                return {
                    id: r.id,
                    supplier_id: r.supplier_id,
                    entry_type: r.entry_type,
                    reference_id: r.reference_id,
                    reference_number: r.reference_number,
                    debit: parseFloat(r.debit || 0),
                    credit: parseFloat(r.credit || 0),
                    balance_after: parseFloat(r.balance_after || 0),
                    description: r.description,
                    payment_method: r.payment_method || null,
                    bank: r.bank || null,
                    cheque_status: ch ? ch.cheque_status || null : null,
                    cheque_number: ch ? ch.cheque_number || null : null,
                    cheque_date: ch ? ch.cheque_date || null : null,
                    cheque_status_date: ch ? ch.cheque_status_date || null : null,
                    entry_date: r.entry_date,
                    created_by: r.created_by,
                    created_at: r.createdAt,
                };
            }),
            total: count,
            page,
            total_pages: Math.max(Math.ceil(count / limit), 1),
            has_more: offset + rows.length < count,
        });
    } catch (error) {
        console.error('getAllSupplierLedger error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

module.exports = {
    receiveCustomerPayment,
    getCashBook,
    getBankTransactions,
    updateChequeStatus,
    getCustomerLedgerWithPayments,
    getAllCustomerLedger,
    createManualCashBookEntry,
    updateManualCashBookEntry,
    deleteManualCashBookEntry,
    getCheques,
    getBankAccounts,
    transferBetweenBanks,
    createManualBankTransaction,
    deleteBankTransaction,
    getCustomerPayments,
    deleteCustomerPayment,
    paySupplier,
    getSupplierPayments,
    deleteSupplierPayment,
    getAllSupplierLedger,
};