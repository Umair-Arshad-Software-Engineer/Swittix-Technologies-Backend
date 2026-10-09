// src/controllers/expenseSessionController.js
const { Op } = require('sequelize');
const db = require('../models');
const { normalizeEntryDate, dayOnly, startOfPktDay } = require('../utils/dates');
const { canonicalBankName } = require('../utils/bankMatcher');

// ─── Helper: today's date in YYYY-MM-DD (PKT) ──────────────────────────
const pktTodayStr = () => {
    const d = startOfPktDay();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ─── Helper: recompute session totals from entries ─────────────────────
const recomputeSessionTotals = async (session, transaction = null) => {
    const entries = await db.ExpenseEntry.findAll({
        where: { session_id: session.id },
        transaction,
    });

    let totalExpenses = 0;
    let totalSupplierPayments = 0;
    let totalBillPayments = 0;

    for (const e of entries) {
        const amt = parseFloat(e.amount || 0);
        if (e.entry_type === 'expense') totalExpenses += amt;
        else if (e.entry_type === 'supplier_payment') totalSupplierPayments += amt;
        else if (e.entry_type === 'bill_payment') totalBillPayments += amt;
    }

    const opening = parseFloat(session.opening_balance || 0);
    const closing = opening - totalExpenses - totalSupplierPayments - totalBillPayments;

    await session.update({
        total_expenses: totalExpenses,
        total_supplier_payments: totalSupplierPayments,
        total_bill_payments: totalBillPayments,
        closing_balance: closing,
    }, { transaction });

    return { totalExpenses, totalSupplierPayments, totalBillPayments, closingBalance: closing };
};

// ─── Formatter ──────────────────────────────────────────────────────────
const formatEntry = (e) => {
    const json = e.toJSON ? e.toJSON() : e;
    return {
        id: json.id,
        entry_type: json.entry_type,
        category: json.category,
        description: json.description,
        amount: parseFloat(json.amount || 0),
        payment_method: json.payment_method,
        bank_id: json.bank_id,
        bank_name: json.bank_name,
        cheque_number: json.cheque_number,
        cheque_date: json.cheque_date,
        cheque_id: json.cheque_id,
        supplier_id: json.supplier_id,
        supplier_ledger_id: json.supplier_ledger_id,
        supplier: json.supplier ? { id: json.supplier.id, name: json.supplier.name } : null,
        bill_type: json.bill_type,
        bill_name: json.bill_name,
        bill_number: json.bill_number,
        consumer_number: json.consumer_number,
        bill_image: json.bill_image,
        reference_number: json.reference_number,
        entry_time: json.entry_time,
        created_at: json.createdAt,
    };
};

const formatSession = (session) => {
    const json = session.toJSON ? session.toJSON() : session;
    return {
        id: json.id,
        session_date: json.session_date,
        opening_balance: parseFloat(json.opening_balance || 0),
        total_expenses: parseFloat(json.total_expenses || 0),
        total_supplier_payments: parseFloat(json.total_supplier_payments || 0),
        total_bill_payments: parseFloat(json.total_bill_payments || 0),
        closing_balance: parseFloat(json.closing_balance || 0),
        is_closed: !!json.is_closed,
        branch_id: json.branch_id,
        branch_name: json.branch?.name || null,
        created_by: json.created_by,
        created_by_name: json.creator?.name || 'Unknown',
        created_at: json.createdAt,
        updated_at: json.updatedAt,
        entries: (json.entries || []).map(formatEntry),
    };
};

const sessionInclude = [
    {
        association: 'entries',
        include: [{ association: 'supplier', attributes: ['id', 'name'], required: false }],
        required: false,
    },
    { association: 'branch',  attributes: ['name'], required: false },
    { association: 'creator', attributes: ['name'], required: false },
];

// ─── GET TODAY'S SESSION ────────────────────────────────────────────────
const getTodaySession = async (req, res) => {
    try {
        const todayStr = pktTodayStr();
        const where = { session_date: todayStr };
        if (req.query.branch_id) where.branch_id = req.query.branch_id;

        const session = await db.ExpenseSession.findOne({
            where,
            include: sessionInclude,
            order: [[{ model: db.ExpenseEntry, as: 'entries' }, 'entry_time', 'DESC']],
        });

        if (!session) {
            return res.status(404).json({ success: false, message: 'No session for today' });
        }
        return res.json({ success: true, data: formatSession(session) });
    } catch (err) {
        console.error('getTodaySession error:', err);
        return res.status(500).json({ success: false, message: 'Server error', error: err.message });
    }
};

// ─── GET SESSION BY DATE ────────────────────────────────────────────────
const getSessionByDate = async (req, res) => {
    try {
        const date = req.query.date;
        if (!date) return res.status(400).json({ success: false, message: 'date is required' });

        const where = { session_date: date };
        if (req.query.branch_id) where.branch_id = req.query.branch_id;

        const session = await db.ExpenseSession.findOne({
            where,
            include: sessionInclude,
            order: [[{ model: db.ExpenseEntry, as: 'entries' }, 'entry_time', 'DESC']],
        });

        if (!session) {
            return res.status(404).json({ success: false, message: 'No session for date' });
        }
        return res.json({ success: true, data: formatSession(session) });
    } catch (err) {
        console.error('getSessionByDate error:', err);
        return res.status(500).json({ success: false, message: 'Server error', error: err.message });
    }
};

// ─── LIST SESSIONS (paginated) ──────────────────────────────────────────
const listSessions = async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.max(parseInt(req.query.limit, 10) || 30, 1);
        const offset = (page - 1) * limit;

        const where = {};
        if (req.query.branch_id) where.branch_id = req.query.branch_id;
        if (req.query.start_date && req.query.end_date) {
            where.session_date = { [Op.between]: [req.query.start_date, req.query.end_date] };
        }

        const { rows, count } = await db.ExpenseSession.findAndCountAll({
            where,
            include: sessionInclude,
            order: [['session_date', 'DESC']],
            limit,
            offset,
        });

        res.json({
            success: true,
            sessions: rows.map(formatSession),
            page,
            total_pages: Math.max(Math.ceil(count / limit), 1),
            total: count,
            has_more: offset + rows.length < count,
        });
    } catch (err) {
        console.error('listSessions error:', err);
        res.status(500).json({ success: false, message: 'Server error', error: err.message });
    }
};

// ─── GET ONE SESSION ────────────────────────────────────────────────────
const getSession = async (req, res) => {
    try {
        const session = await db.ExpenseSession.findByPk(req.params.id, {
            include: sessionInclude,
        });
        if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
        res.json({ success: true, data: formatSession(session) });
    } catch (err) {
        console.error('getSession error:', err);
        res.status(500).json({ success: false, message: 'Server error', error: err.message });
    }
};

// ─── CREATE SESSION ─────────────────────────────────────────────────────
const createSession = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const { session_date, opening_balance, branch_id } = req.body;
        if (!session_date) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'session_date is required' });
        }

        const existing = await db.ExpenseSession.findOne({
            where: { session_date },
            transaction: t,
        });
        if (existing) {
            await t.rollback();
            return res.status(409).json({
                success: false,
                message: 'Session already exists for this date',
                data: formatSession(existing),
            });
        }

        const opening = parseFloat(opening_balance) || 0;

        const session = await db.ExpenseSession.create({
            session_date,
            opening_balance: opening,
            closing_balance: opening,
            total_expenses: 0,
            total_supplier_payments: 0,
            total_bill_payments: 0,
            is_closed: false,
            branch_id: branch_id || null,
            created_by: req.user.id,
        }, { transaction: t });

        await t.commit();

        const full = await db.ExpenseSession.findByPk(session.id, { include: sessionInclude });
        res.status(201).json({ success: true, data: formatSession(full) });
    } catch (err) {
        await t.rollback();
        console.error('createSession error:', err);
        res.status(500).json({ success: false, message: 'Server error', error: err.message });
    }
};

// ─── UPDATE OPENING BALANCE ─────────────────────────────────────────────
const updateOpeningBalance = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const session = await db.ExpenseSession.findByPk(req.params.id, { transaction: t });
        if (!session) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Session not found' });
        }
        if (session.is_closed) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Cannot edit a closed session' });
        }

        const newOpening = parseFloat(req.body.opening_balance);
        if (isNaN(newOpening) || newOpening < 0) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Invalid opening balance' });
        }

        await session.update({ opening_balance: newOpening }, { transaction: t });
        await recomputeSessionTotals(session, t);
        await t.commit();

        const full = await db.ExpenseSession.findByPk(session.id, { include: sessionInclude });
        res.json({ success: true, data: formatSession(full) });
    } catch (err) {
        await t.rollback();
        console.error('updateOpeningBalance error:', err);
        res.status(500).json({ success: false, message: 'Server error', error: err.message });
    }
};

// ─── CLOSE SESSION ──────────────────────────────────────────────────────
const closeSession = async (req, res) => {
    try {
        const session = await db.ExpenseSession.findByPk(req.params.id);
        if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
        await session.update({ is_closed: true });
        res.json({ success: true, message: 'Session closed' });
    } catch (err) {
        console.error('closeSession error:', err);
        res.status(500).json({ success: false, message: 'Server error', error: err.message });
    }
};

// ─── ADD EXPENSE ────────────────────────────────────────────────────────
const addExpense = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const session = await db.ExpenseSession.findByPk(req.params.id, { transaction: t });
        if (!session) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Session not found' });
        }
        if (session.is_closed) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Session is closed' });
        }

        const {
            category, description, amount, payment_method,
            bank_id, bank_name, cheque_number, cheque_date,
            reference_number, entry_date,
        } = req.body;

        const amt = parseFloat(amount);
        if (!amt || amt <= 0) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Valid amount is required' });
        }

        const entryTime = entry_date ? normalizeEntryDate(entry_date) : normalizeEntryDate(null);
        const canonicalBank = bank_name ? canonicalBankName(bank_name) : null;

        const entry = await db.ExpenseEntry.create({
            session_id: session.id,
            entry_type: 'expense',
            category: category || null,
            description: description || '',
            amount: amt,
            payment_method: payment_method || 'cash',
            bank_id: bank_id || null,
            bank_name: canonicalBank,
            cheque_number: cheque_number || null,
            cheque_date: cheque_date || null,
            reference_number: reference_number || null,
            entry_time: entryTime,
            created_by: req.user.id,
        }, { transaction: t });

        // Mirror to CashBook / BankTransaction so reports stay consistent
        if (payment_method === 'cash') {
            const lastCash = await db.CashBook.findOne({
                where: session.branch_id ? { branch_id: session.branch_id } : {},
                order: [['id', 'DESC']],
                transaction: t,
            });
            const running = lastCash ? parseFloat(lastCash.balance_after || 0) : 0;
            await db.CashBook.create({
                entry_type: 'payment',
                amount: amt,
                balance_after: running - amt,
                description: description || 'Daily expense',
                reference_type: 'expense',
                reference_id: entry.id,
                entry_date: entryTime,
                branch_id: session.branch_id,
                created_by: req.user.id,
            }, { transaction: t });
        } else if (canonicalBank) {
            const lastBank = await db.BankTransaction.findOne({
                where: { bank_name: canonicalBank },
                order: [['id', 'DESC']],
                transaction: t,
            });
            const running = lastBank ? parseFloat(lastBank.balance_after || 0) : 0;
            await db.BankTransaction.create({
                entry_type: payment_method === 'cheque' ? 'cheque_out' : 'withdrawal',
                amount: amt,
                balance_after: running - amt,
                bank_name: canonicalBank,
                cheque_number: cheque_number || null,
                cheque_date: cheque_date || null,
                cheque_status: payment_method === 'cheque' ? 'pending' : null,
                reference_type: 'expense',
                reference_id: entry.id,
                description: description || 'Daily expense',
                entry_date: entryTime,
                branch_id: session.branch_id,
                created_by: req.user.id,
            }, { transaction: t });
        }

        await recomputeSessionTotals(session, t);
        await t.commit();

        const fullEntry = await db.ExpenseEntry.findByPk(entry.id);
        res.status(201).json({ success: true, data: formatEntry(fullEntry) });
    } catch (err) {
        await t.rollback();
        console.error('addExpense error:', err);
        res.status(500).json({ success: false, message: 'Server error', error: err.message });
    }
};

// ─── ADD SUPPLIER PAYMENT ───────────────────────────────────────────────
const addSupplierPayment = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const session = await db.ExpenseSession.findByPk(req.params.id, { transaction: t });
        if (!session) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Session not found' });
        }
        if (session.is_closed) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Session is closed' });
        }

        const {
            supplier_id, amount, description, payment_method,
            bank_id, bank_name, cheque_number, cheque_date, cheque_id,
            reference_number, entry_date,
        } = req.body;

        if (!supplier_id) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'supplier_id is required' });
        }
        const amt = parseFloat(amount);
        if (!amt || amt <= 0) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Valid amount is required' });
        }

        const supplier = await db.Supplier.findByPk(supplier_id, { transaction: t });
        if (!supplier) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Supplier not found' });
        }

        const entryTime = entry_date ? normalizeEntryDate(entry_date) : normalizeEntryDate(null);
        const canonicalBank = bank_name ? canonicalBankName(bank_name) : null;

        // Update supplier balance (payment reduces what we owe)
        const currentBalance = parseFloat(supplier.current_balance || 0);
        const newBalance = currentBalance - amt;
        await supplier.update({ current_balance: newBalance }, { transaction: t });

        // Supplier ledger row
        const ledger = await db.SupplierLedger.create({
            supplier_id,
            entry_type: 'payment',
            debit: amt,
            credit: 0,
            balance_after: newBalance,
            description: description || `Payment via ${payment_method}`,
            payment_method: payment_method || 'cash',
            bank: canonicalBank || null,
            entry_date: entryTime,
            created_by: req.user.id,
        }, { transaction: t });

        // Expense entry
        const entry = await db.ExpenseEntry.create({
            session_id: session.id,
            entry_type: 'supplier_payment',
            description: description || `Payment to ${supplier.name}`,
            amount: amt,
            payment_method: payment_method || 'cash',
            bank_id: bank_id || null,
            bank_name: canonicalBank,
            cheque_number: cheque_number || null,
            cheque_date: cheque_date || null,
            cheque_id: cheque_id || null,
            supplier_id,
            supplier_ledger_id: ledger.id,
            reference_number: reference_number || null,
            entry_time: entryTime,
            created_by: req.user.id,
        }, { transaction: t });

        // Money leg: cash book or bank transaction
        if (payment_method === 'cash') {
            const lastCash = await db.CashBook.findOne({
                where: session.branch_id ? { branch_id: session.branch_id } : {},
                order: [['id', 'DESC']],
                transaction: t,
            });
            const running = lastCash ? parseFloat(lastCash.balance_after || 0) : 0;
            await db.CashBook.create({
                entry_type: 'payment',
                amount: amt,
                balance_after: running - amt,
                description: description || `Payment to ${supplier.name}`,
                reference_type: 'supplier_payment',
                reference_id: ledger.id,
                reference_number: supplier.name,
                entry_date: entryTime,
                branch_id: session.branch_id,
                created_by: req.user.id,
            }, { transaction: t });
        } else if (canonicalBank) {
            const lastBank = await db.BankTransaction.findOne({
                where: { bank_name: canonicalBank },
                order: [['id', 'DESC']],
                transaction: t,
            });
            const running = lastBank ? parseFloat(lastBank.balance_after || 0) : 0;
            await db.BankTransaction.create({
                entry_type: payment_method === 'cheque' ? 'cheque_out' : 'withdrawal',
                amount: amt,
                balance_after: running - amt,
                bank_name: canonicalBank,
                cheque_number: cheque_number || null,
                cheque_date: cheque_date || null,
                cheque_status: payment_method === 'cheque' ? 'pending' : null,
                reference_type: 'supplier_payment',
                reference_id: ledger.id,
                reference_number: supplier.name,
                description: description || `Payment to ${supplier.name}`,
                entry_date: entryTime,
                branch_id: session.branch_id,
                created_by: req.user.id,
            }, { transaction: t });
        }

        await recomputeSessionTotals(session, t);
        await t.commit();

        const fullEntry = await db.ExpenseEntry.findByPk(entry.id, {
            include: [{ association: 'supplier', attributes: ['id', 'name'], required: false }],
        });
        res.status(201).json({ success: true, data: formatEntry(fullEntry) });
    } catch (err) {
        await t.rollback();
        console.error('addSupplierPayment error:', err);
        res.status(500).json({ success: false, message: 'Server error', error: err.message });
    }
};

// ─── ADD BILL PAYMENT ───────────────────────────────────────────────────
const addBillPayment = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const session = await db.ExpenseSession.findByPk(req.params.id, { transaction: t });
        if (!session) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Session not found' });
        }
        if (session.is_closed) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Session is closed' });
        }

        const {
            bill_type, bill_name, bill_number, consumer_number,
            description, amount, payment_method,
            bank_id, bank_name, cheque_number, cheque_date, cheque_id,
            reference_number, bill_image, entry_date,
        } = req.body;

        const amt = parseFloat(amount);
        if (!amt || amt <= 0) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Valid amount is required' });
        }

        const entryTime = entry_date ? normalizeEntryDate(entry_date) : normalizeEntryDate(null);
        const canonicalBank = bank_name ? canonicalBankName(bank_name) : null;

        const entry = await db.ExpenseEntry.create({
            session_id: session.id,
            entry_type: 'bill_payment',
            description: description || `${bill_name || bill_type} payment`,
            amount: amt,
            payment_method: payment_method || 'cash',
            bank_id: bank_id || null,
            bank_name: canonicalBank,
            cheque_number: cheque_number || null,
            cheque_date: cheque_date || null,
            cheque_id: cheque_id || null,
            bill_type: bill_type || 'other',
            bill_name: bill_name || bill_type || 'Bill',
            bill_number: bill_number || null,
            consumer_number: consumer_number || null,
            bill_image: bill_image || null,
            reference_number: reference_number || null,
            entry_time: entryTime,
            created_by: req.user.id,
        }, { transaction: t });

        // Money leg
        if (payment_method === 'cash') {
            const lastCash = await db.CashBook.findOne({
                where: session.branch_id ? { branch_id: session.branch_id } : {},
                order: [['id', 'DESC']],
                transaction: t,
            });
            const running = lastCash ? parseFloat(lastCash.balance_after || 0) : 0;
            await db.CashBook.create({
                entry_type: 'payment',
                amount: amt,
                balance_after: running - amt,
                description: entry.description,
                reference_type: 'bill_payment',
                reference_id: entry.id,
                entry_date: entryTime,
                branch_id: session.branch_id,
                created_by: req.user.id,
            }, { transaction: t });
        } else if (canonicalBank) {
            const lastBank = await db.BankTransaction.findOne({
                where: { bank_name: canonicalBank },
                order: [['id', 'DESC']],
                transaction: t,
            });
            const running = lastBank ? parseFloat(lastBank.balance_after || 0) : 0;
            await db.BankTransaction.create({
                entry_type: payment_method === 'cheque' ? 'cheque_out' : 'withdrawal',
                amount: amt,
                balance_after: running - amt,
                bank_name: canonicalBank,
                cheque_number: cheque_number || null,
                cheque_date: cheque_date || null,
                cheque_status: payment_method === 'cheque' ? 'pending' : null,
                reference_type: 'bill_payment',
                reference_id: entry.id,
                description: entry.description,
                entry_date: entryTime,
                branch_id: session.branch_id,
                created_by: req.user.id,
            }, { transaction: t });
        }

        await recomputeSessionTotals(session, t);
        await t.commit();

        const fullEntry = await db.ExpenseEntry.findByPk(entry.id);
        res.status(201).json({ success: true, data: formatEntry(fullEntry) });
    } catch (err) {
        await t.rollback();
        console.error('addBillPayment error:', err);
        res.status(500).json({ success: false, message: 'Server error', error: err.message });
    }
};

// ─── LIST ALL BILL PAYMENTS (for Bill History) ──────────────────────────
const listBillPayments = async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.max(parseInt(req.query.limit, 10) || 100, 1);
        const offset = (page - 1) * limit;

        const where = { entry_type: 'bill_payment' };
        if (req.query.bill_type) where.bill_type = req.query.bill_type;
        if (req.query.start_date && req.query.end_date) {
            where.entry_time = { [Op.between]: [req.query.start_date, `${req.query.end_date} 23:59:59`] };
        }

        const { rows, count } = await db.ExpenseEntry.findAndCountAll({
            where,
            order: [['entry_time', 'DESC']],
            limit,
            offset,
        });

        res.json({
            success: true,
            data: rows.map(formatEntry),
            page,
            total_pages: Math.max(Math.ceil(count / limit), 1),
            total: count,
            has_more: offset + rows.length < count,
        });
    } catch (err) {
        console.error('listBillPayments error:', err);
        res.status(500).json({ success: false, message: 'Server error', error: err.message });
    }
};

// ─── DELETE ENTRY ───────────────────────────────────────────────────────
const deleteEntry = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const session = await db.ExpenseSession.findByPk(req.params.id, { transaction: t });
        if (!session) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Session not found' });
        }
        if (session.is_closed) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Session is closed' });
        }

        const entry = await db.ExpenseEntry.findOne({
            where: { id: req.params.entryId, session_id: session.id },
            transaction: t,
        });
        if (!entry) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Entry not found' });
        }

        // If it was a supplier payment, reverse the supplier ledger
        if (entry.entry_type === 'supplier_payment' && entry.supplier_id) {
            const supplier = await db.Supplier.findByPk(entry.supplier_id, { transaction: t });
            if (supplier) {
                const amt = parseFloat(entry.amount || 0);
                const current = parseFloat(supplier.current_balance || 0);
                const reversed = current + amt;
                await supplier.update({ current_balance: reversed }, { transaction: t });

                await db.SupplierLedger.create({
                    supplier_id: entry.supplier_id,
                    entry_type: 'adjustment',
                    debit: 0,
                    credit: amt,
                    balance_after: reversed,
                    description: `Reversal: deleted entry #${entry.id}`,
                    entry_date: normalizeEntryDate(null),
                    created_by: req.user.id,
                }, { transaction: t });
            }
        }

        await entry.destroy({ transaction: t });
        await recomputeSessionTotals(session, t);
        await t.commit();

        res.json({ success: true, message: 'Entry deleted' });
    } catch (err) {
        await t.rollback();
        console.error('deleteEntry error:', err);
        res.status(500).json({ success: false, message: 'Server error', error: err.message });
    }
};

module.exports = {
    getTodaySession,
    getSessionByDate,
    listSessions,
    getSession,
    createSession,
    updateOpeningBalance,
    closeSession,
    addExpense,
    addSupplierPayment,
    addBillPayment,
    listBillPayments,
    deleteEntry,
};