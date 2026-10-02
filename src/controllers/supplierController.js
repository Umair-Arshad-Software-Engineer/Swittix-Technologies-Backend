// src/controllers/supplierController.js
const { Op } = require('sequelize');
const db = require('../models');
const { normalizeEntryDate } = require('../utils/dates');

const formatSupplier = (supplier) => {
    const json = supplier.toJSON();
    return {
        id: json.id,
        name: json.name,
        company: json.company || '',
        phone: json.phone || '',
        email: json.email || '',
        address: json.address || '',
        city: json.city || '',
        cnic: json.cnic || '',
        tax_number: json.tax_number || '',
        opening_balance: parseFloat(json.opening_balance || 0),
        current_balance: parseFloat(json.current_balance || 0),
        credit_limit: parseFloat(json.credit_limit || 0),
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

const getChequeStatusMap = async (ledgerRows) => {
    const chequeIds = ledgerRows
        .filter(r => r.payment_method === 'cheque' && r.entry_type === 'payment')
        .map(r => r.id);

    if (chequeIds.length === 0) return new Map();

    const txns = await db.BankTransaction.findAll({
        where: {
            reference_type: 'supplier_payment',
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

const getAllSuppliers = async (req, res) => {
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
            const suppliers = await db.Supplier.findAll({
                ...baseOptions,
                where: {
                    [Op.or]: [
                        { name: { [Op.like]: q } },
                        { company: { [Op.like]: q } },
                        { phone: { [Op.like]: q } },
                        { email: { [Op.like]: q } },
                        { cnic: { [Op.like]: q } },
                    ],
                },
            });

            return res.json({
                success: true,
                suppliers: suppliers.map(formatSupplier),
                mode: 'search',
                total: suppliers.length,
            });
        }

        const offset = (page - 1) * limit;
        const { rows, count } = await db.Supplier.findAndCountAll({
            ...baseOptions,
            limit,
            offset,
        });

        res.json({
            success: true,
            suppliers: rows.map(formatSupplier),
            mode: 'page',
            page,
            limit,
            total: count,
            total_pages: Math.max(Math.ceil(count / limit), 1),
            has_more: offset + rows.length < count,
        });
    } catch (error) {
        console.error('getAllSuppliers error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

const getSupplier = async (req, res) => {
    try {
        const supplier = await db.Supplier.findByPk(req.params.id, {
            include: [
                { association: 'creator', attributes: ['name'], required: false },
                { association: 'branch', attributes: ['name'], required: false },
            ],
        });
        if (!supplier) {
            return res.status(404).json({ success: false, message: 'Supplier not found' });
        }
        res.json({ success: true, supplier: formatSupplier(supplier) });
    } catch (error) {
        console.error('getSupplier error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

const createSupplier = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const {
            name, company, phone, email, address, city, cnic, tax_number,
            opening_balance, credit_limit, notes, branch_id,
        } = req.body;

        if (!name) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: 'Supplier name is required',
            });
        }

        const openingBalance = parseFloat(opening_balance) || 0;

        const supplier = await db.Supplier.create({
            name: name.trim(),
            company: company?.trim() || null,
            phone: phone?.trim() || null,
            email: email?.trim() || null,
            address: address?.trim() || '',
            city: city?.trim() || null,
            cnic: cnic?.trim() || null,
            tax_number: tax_number?.trim() || null,
            opening_balance: openingBalance,
            current_balance: openingBalance,
            credit_limit: parseFloat(credit_limit) || 0,
            notes: notes?.trim() || '',
            branch_id: branch_id || null,
            created_by: req.user.id,
            is_active: true,
        }, { transaction: t });

        if (openingBalance !== 0) {
            await db.SupplierLedger.create({
                supplier_id: supplier.id,
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

        const full = await db.Supplier.findByPk(supplier.id, {
            include: [
                { association: 'creator', attributes: ['name'], required: false },
                { association: 'branch', attributes: ['name'], required: false },
            ],
        });

        res.status(201).json({
            success: true,
            supplier: formatSupplier(full),
            message: 'Supplier created successfully',
        });
    } catch (error) {
        await t.rollback();
        console.error('createSupplier error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

const updateSupplier = async (req, res) => {
    try {
        const supplier = await db.Supplier.findByPk(req.params.id);
        if (!supplier) {
            return res.status(404).json({ success: false, message: 'Supplier not found' });
        }

        const {
            name, company, phone, email, address, city, cnic, tax_number,
            credit_limit, is_active, notes, branch_id,
        } = req.body;

        const updateData = {};
        if (name !== undefined) updateData.name = name.trim();
        if (company !== undefined) updateData.company = company?.trim() || null;
        if (phone !== undefined) updateData.phone = phone?.trim() || null;
        if (email !== undefined) updateData.email = email?.trim() || null;
        if (address !== undefined) updateData.address = address?.trim() || '';
        if (city !== undefined) updateData.city = city?.trim() || null;
        if (cnic !== undefined) updateData.cnic = cnic?.trim() || null;
        if (tax_number !== undefined) updateData.tax_number = tax_number?.trim() || null;
        if (credit_limit !== undefined) updateData.credit_limit = parseFloat(credit_limit) || 0;
        if (is_active !== undefined) updateData.is_active = !!is_active;
        if (notes !== undefined) updateData.notes = notes?.trim() || '';
        if (branch_id !== undefined) updateData.branch_id = branch_id || null;

        await supplier.update(updateData);

        const full = await db.Supplier.findByPk(supplier.id, {
            include: [
                { association: 'creator', attributes: ['name'], required: false },
                { association: 'branch', attributes: ['name'], required: false },
            ],
        });

        res.json({
            success: true,
            supplier: formatSupplier(full),
            message: 'Supplier updated successfully',
        });
    } catch (error) {
        console.error('updateSupplier error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

const deleteSupplier = async (req, res) => {
    try {
        const supplier = await db.Supplier.findByPk(req.params.id);
        if (!supplier) {
            return res.status(404).json({ success: false, message: 'Supplier not found' });
        }
        await supplier.destroy();
        res.json({ success: true, message: 'Supplier deleted successfully' });
    } catch (error) {
        console.error('deleteSupplier error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

const getSupplierLedger = async (req, res) => {
    try {
        const supplierId = req.params.id;
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.max(parseInt(req.query.limit, 10) || 100, 1);
        const offset = (page - 1) * limit;

        const supplier = await db.Supplier.findByPk(supplierId);
        if (!supplier) {
            return res.status(404).json({ success: false, message: 'Supplier not found' });
        }

        const { rows, count } = await db.SupplierLedger.findAndCountAll({
            where: { supplier_id: supplierId },
            order: [['entry_date', 'DESC'], ['id', 'DESC']],
            limit,
            offset,
        });

        const chequeMap = await getChequeStatusMap(rows);

        res.json({
            success: true,
            supplier: {
                id: supplier.id,
                name: supplier.name,
                current_balance: parseFloat(supplier.current_balance || 0),
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
        console.error('getSupplierLedger error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

module.exports = {
    getAllSuppliers,
    getSupplier,
    createSupplier,
    updateSupplier,
    deleteSupplier,
    getSupplierLedger,
};