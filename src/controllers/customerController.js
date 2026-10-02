// src/controllers/customerController.js
const { Op } = require('sequelize');
const db = require('../models');
const { normalizeEntryDate } = require('../utils/dates');   // ✅ NEW

const formatCustomer = (customer) => {
    const json = customer.toJSON();
    return {
        id: json.id,
        local_uuid: json.local_uuid || null,
        name: json.name,
        phone: json.phone || '',
        email: json.email || '',
        address: json.address || '',
        city: json.city || '',
        cnic: json.cnic || '',
        opening_balance: parseFloat(json.opening_balance || 0),
        current_balance: parseFloat(json.current_balance || 0),
        credit_limit: parseFloat(json.credit_limit || 0),
        discount: parseFloat(json.discount || 0),
        is_active: !!json.is_active,
        notes: json.notes || '',
        branch_id: json.branch_id,
        branch_name: json.branch?.name || null,
        created_by: json.created_by,
        created_by_name: json.creator?.name || 'Unknown',
        created_at: json.createdAt,
        updated_at: json.updatedAt,
    };
};

// ─── Helper: map ledger ids -> cheque details ─────────────────────────
const getChequeStatusMap = async (ledgerRows) => {
    const chequeIds = ledgerRows
        .filter(r => r.payment_method === 'cheque' && r.entry_type === 'payment')
        .map(r => r.id);

    if (chequeIds.length === 0) return new Map();

    const txns = await db.BankTransaction.findAll({
        where: {
            reference_type: 'customer_payment',
            reference_id: { [Op.in]: chequeIds },
        },
        attributes: [
            'reference_id', 'cheque_status', 'cheque_number',
            'cheque_date', 'cheque_status_date',
        ],
        raw: true,
    });

    return new Map(txns.map(t => [t.reference_id, t]));
};

// Get all customers
const getAllCustomers = async (req, res) => {
    try {
        const { search } = req.query;
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.max(parseInt(req.query.limit, 10) || 20, 1);

        const baseOptions = {
            include: [
                { association: 'creator', attributes: ['name'], required: false },
                { association: 'branch', attributes: ['name'], required: false },
            ],
            order: [['name', 'ASC']],
        };

        if (search && search.trim() !== '') {
            const q = `%${search.trim()}%`;
            const customers = await db.Customer.findAll({
                ...baseOptions,
                where: {
                    [Op.or]: [
                        { name: { [Op.like]: q } },
                        { phone: { [Op.like]: q } },
                        { email: { [Op.like]: q } },
                        { cnic: { [Op.like]: q } },
                    ],
                },
            });

            return res.json({
                success: true,
                customers: customers.map(formatCustomer),
                mode: 'search',
                total: customers.length,
            });
        }

        const offset = (page - 1) * limit;
        const { rows, count } = await db.Customer.findAndCountAll({
            ...baseOptions,
            limit,
            offset,
        });

        res.json({
            success: true,
            customers: rows.map(formatCustomer),
            mode: 'page',
            page,
            limit,
            total: count,
            total_pages: Math.max(Math.ceil(count / limit), 1),
            has_more: offset + rows.length < count,
        });
    } catch (error) {
        console.error('getAllCustomers error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get single customer
const getCustomer = async (req, res) => {
    try {
        const customer = await db.Customer.findByPk(req.params.id, {
            include: [
                { association: 'creator', attributes: ['name'], required: false },
                { association: 'branch', attributes: ['name'], required: false },
            ],
        });

        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        res.json({ success: true, customer: formatCustomer(customer) });
    } catch (error) {
        console.error('getCustomer error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Create customer — idempotent on local_uuid
const createCustomer = async (req, res) => {
    const t = await db.sequelize.transaction();   // ✅ transactional now
    try {
        const {
            name, phone, email, address, city, cnic,
            opening_balance, credit_limit, discount,
            notes, branch_id, local_uuid,
        } = req.body;

        if (!name) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: 'Customer name is required',
            });
        }

        // Idempotency: if this UUID already exists, return that row
        if (local_uuid && String(local_uuid).trim() !== '') {
            const existing = await db.Customer.findOne({
                where: { local_uuid: String(local_uuid).trim() },
                include: [
                    { association: 'creator', attributes: ['name'], required: false },
                    { association: 'branch', attributes: ['name'], required: false },
                ],
                transaction: t,
            });
            if (existing) {
                await t.commit();
                return res.status(200).json({
                    success: true,
                    customer: formatCustomer(existing),
                    message: 'Customer already exists (idempotent)',
                });
            }
        }

        const openingBalance = parseFloat(opening_balance) || 0;

        const customer = await db.Customer.create({
            name: name.trim(),
            phone: phone?.trim() || null,
            email: email?.trim() || null,
            address: address?.trim() || '',
            city: city?.trim() || null,
            cnic: cnic?.trim() || null,
            opening_balance: openingBalance,
            current_balance: openingBalance,
            credit_limit: parseFloat(credit_limit) || 0,
            discount: parseFloat(discount) || 0,
            notes: notes?.trim() || '',
            branch_id: branch_id || null,
            created_by: req.user.id,
            is_active: true,
            local_uuid: (local_uuid && String(local_uuid).trim() !== '')
                ? String(local_uuid).trim()
                : null,
        }, { transaction: t });

        // ✅ FIX: seed the opening-balance ledger row so recomputes stay consistent
        if (openingBalance !== 0) {
            await db.CustomerLedger.create({
                customer_id: customer.id,
                entry_type: 'opening',
                reference_id: null,
                reference_number: null,
                debit: openingBalance > 0 ? openingBalance : 0,
                credit: openingBalance < 0 ? -openingBalance : 0,
                balance_after: openingBalance,
                description: 'Opening balance',
                entry_date: normalizeEntryDate(null),
                created_by: req.user.id,
            }, { transaction: t });
        }

        await t.commit();

        const full = await db.Customer.findByPk(customer.id, {
            include: [
                { association: 'creator', attributes: ['name'], required: false },
                { association: 'branch', attributes: ['name'], required: false },
            ],
        });

        res.status(201).json({
            success: true,
            customer: formatCustomer(full),
            message: 'Customer created successfully',
        });
    } catch (error) {
        await t.rollback();
        if (error.name === 'SequelizeUniqueConstraintError') {
            const { local_uuid } = req.body;
            if (local_uuid && String(local_uuid).trim() !== '') {
                const existing = await db.Customer.findOne({
                    where: { local_uuid: String(local_uuid).trim() },
                    include: [
                        { association: 'creator', attributes: ['name'], required: false },
                        { association: 'branch', attributes: ['name'], required: false },
                    ],
                });
                if (existing) {
                    return res.status(200).json({
                        success: true,
                        customer: formatCustomer(existing),
                        message: 'Customer already exists (race-resolved)',
                    });
                }
            }
        }
        console.error('createCustomer error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Update customer
const updateCustomer = async (req, res) => {
    try {
        const customer = await db.Customer.findByPk(req.params.id);

        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        const {
            name, phone, email, address, city, cnic,
            credit_limit, discount,
            is_active, notes, branch_id,
        } = req.body;

        const updateData = {};
        if (name !== undefined) updateData.name = name.trim();
        if (phone !== undefined) updateData.phone = phone?.trim() || null;
        if (email !== undefined) updateData.email = email?.trim() || null;
        if (address !== undefined) updateData.address = address?.trim() || '';
        if (city !== undefined) updateData.city = city?.trim() || null;
        if (cnic !== undefined) updateData.cnic = cnic?.trim() || null;
        if (credit_limit !== undefined) updateData.credit_limit = parseFloat(credit_limit) || 0;
        if (discount !== undefined) updateData.discount = parseFloat(discount) || 0;
        if (is_active !== undefined) updateData.is_active = !!is_active;
        if (notes !== undefined) updateData.notes = notes?.trim() || '';
        if (branch_id !== undefined) updateData.branch_id = branch_id || null;

        await customer.update(updateData);

        const full = await db.Customer.findByPk(customer.id, {
            include: [
                { association: 'creator', attributes: ['name'], required: false },
                { association: 'branch', attributes: ['name'], required: false },
            ],
        });

        res.json({
            success: true,
            customer: formatCustomer(full),
            message: 'Customer updated successfully',
        });
    } catch (error) {
        console.error('updateCustomer error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Delete customer
const deleteCustomer = async (req, res) => {
    try {
        const customer = await db.Customer.findByPk(req.params.id);

        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        await customer.destroy();

        res.json({ success: true, message: 'Customer deleted successfully' });
    } catch (error) {
        console.error('deleteCustomer error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Customer ledger — includes full cheque details
const getCustomerLedger = async (req, res) => {
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

        const chequeMap = await getChequeStatusMap(rows);

        res.json({
            success: true,
            customer: {
                id: customer.id,
                name: customer.name,
                current_balance: parseFloat(customer.current_balance || 0),
            },
            entries: rows.map(r => {
                const ch =
                    r.payment_method === 'cheque' && r.entry_type === 'payment'
                        ? chequeMap.get(r.id)
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

module.exports = {
    getAllCustomers,
    getCustomer,
    createCustomer,
    updateCustomer,
    deleteCustomer,
    getCustomerLedger,
};