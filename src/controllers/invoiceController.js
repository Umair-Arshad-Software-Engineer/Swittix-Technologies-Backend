// src/controllers/invoiceController.js
const { Op } = require('sequelize');
const db = require('../models');
const { normalizeEntryDate } = require('../utils/dates');

const formatInvoice = (invoice) => {
    const json = invoice.toJSON();
    return {
        id: json.id,
        invoice_number: json.invoice_number,
        invoice_number_auto: json.invoice_number_auto,
        bilti_number: json.bilti_number || '',
        description: json.description || '',
        transport_company: json.transport_company || '',
        invoice_date: json.invoice_date,
        customer_id: json.customer_id,
        customer_name: json.customer_name || json.customer?.name || '',
        customer_phone: json.customer_phone || json.customer?.phone || '',
        subtotal: parseFloat(json.subtotal || 0),
        discount_type: json.discount_type,
        discount_value: parseFloat(json.discount_value || 0),
        discount_amount: parseFloat(json.discount_amount || 0),
        labour_amount: parseFloat(json.labour_amount || 0),
        tax_amount: parseFloat(json.tax_amount || 0),
        total_amount: parseFloat(json.total_amount || 0),
        branch_id: json.branch_id,
        branch_name: json.branch?.name || null,
        created_by: json.created_by,
        created_by_name: json.creator?.name || 'Unknown',
        status: json.status,
        notes: json.notes || '',
        local_uuid: json.local_uuid,
        items: (json.items || []).map(item => ({
            id: item.id,
            product_id: item.product_id,
            product_name: item.product_name,
            product_item_code: item.product_item_code,
            product_unit: item.product_unit || null,
            description: item.description || '',
            quantity: parseFloat(item.quantity || 0),
            unit_price: parseFloat(item.unit_price || 0),
            is_custom_price: !!item.is_custom_price,
            original_price: item.original_price ? parseFloat(item.original_price) : null,
            discount_percentage: parseFloat(item.discount_percentage || 0),
            discount_amount: parseFloat(item.discount_amount || 0),
            tax_percentage: parseFloat(item.tax_percentage || 0),
            tax_amount: parseFloat(item.tax_amount || 0),
            subtotal: parseFloat(item.subtotal || 0),
            total: parseFloat(item.total || 0),
        })),
        created_at: json.createdAt,
        updated_at: json.updatedAt,
    };
};

// Helper: apply stock change inside a transaction.
const applyStockChange = async (productId, delta, t) => {
    const product = await db.Product.findByPk(productId, { transaction: t });
    if (!product) {
        throw new Error(`Product ${productId} not found while applying stock change`);
    }
    const current = parseFloat(product.current_qty || 0);
    const next = current + delta;
    await product.update({ current_qty: next }, { transaction: t });
    return { product, previous: current, next };
};

// Helper: write one ledger row and update the customer's running balance.
const applyLedgerEntry = async ({
    customerId,
    entryType,
    referenceId,
    referenceNumber,
    debit = 0,
    credit = 0,
    description = '',
    entryDate,
    userId,
    t,
}) => {
    if (!customerId) return null;

    const customer = await db.Customer.findByPk(customerId, { transaction: t });
    if (!customer) {
        throw new Error(`Customer ${customerId} not found while writing ledger`);
    }

    const currentBalance = parseFloat(customer.current_balance || 0);
    const nextBalance = currentBalance + credit - debit;

    await db.CustomerLedger.create({
        customer_id: customerId,
        entry_type: entryType,
        reference_id: referenceId,
        reference_number: referenceNumber,
        debit,
        credit,
        balance_after: nextBalance,
        description,
        entry_date: normalizeEntryDate(entryDate),
        created_by: userId,
    }, { transaction: t });

    await customer.update({ current_balance: nextBalance }, { transaction: t });
    return nextBalance;
};

// Generate next invoice number
const generateInvoiceNumber = async (branchId = null) => {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `INV-${dateStr}-`;

    const lastInvoice = await db.Invoice.findOne({
        where: {
            invoice_number: { [Op.like]: `${prefix}%` },
        },
        order: [['invoice_number', 'DESC']],
    });

    let sequence = 1;
    if (lastInvoice) {
        const parts = lastInvoice.invoice_number.split('-');
        const lastSeq = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(lastSeq)) {
            sequence = lastSeq + 1;
        }
    }

    return `${prefix}${String(sequence).padStart(4, '0')}`;
};

// Get all invoices with pagination
const getAllInvoices = async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.max(parseInt(req.query.limit, 10) || 20, 1);
        const offset = (page - 1) * limit;
        const search = req.query.search?.trim();
        const customerId = req.query.customer_id;
        const startDate = req.query.start_date;
        const endDate = req.query.end_date;

        const where = {};

        if (customerId) {
            where.customer_id = customerId;
        }

        if (startDate && endDate) {
            where.invoice_date = {
                [Op.between]: [startDate, endDate],
            };
        } else if (startDate) {
            where.invoice_date = { [Op.gte]: startDate };
        } else if (endDate) {
            where.invoice_date = { [Op.lte]: endDate };
        }

        if (search) {
            where[Op.or] = [
                { invoice_number: { [Op.like]: `%${search}%` } },
                { bilti_number: { [Op.like]: `%${search}%` } },
                { customer_name: { [Op.like]: `%${search}%` } },
                { transport_company: { [Op.like]: `%${search}%` } },
            ];
        }

        const { rows, count } = await db.Invoice.findAndCountAll({
            where,
            include: [
                { association: 'customer', attributes: ['name', 'phone'], required: false },
                { association: 'branch', attributes: ['name'], required: false },
                { association: 'creator', attributes: ['name'], required: false },
                { association: 'items', required: false },
            ],
            order: [['invoice_date', 'DESC'], ['id', 'DESC']],
            limit,
            offset,
        });

        res.json({
            success: true,
            invoices: rows.map(formatInvoice),
            page,
            limit,
            total: count,
            total_pages: Math.max(Math.ceil(count / limit), 1),
            has_more: offset + rows.length < count,
        });
    } catch (error) {
        console.error('getAllInvoices error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get single invoice
const getInvoice = async (req, res) => {
    try {
        const invoice = await db.Invoice.findByPk(req.params.id, {
            include: [
                { association: 'customer', attributes: ['name', 'phone'], required: false },
                { association: 'branch', attributes: ['name'], required: false },
                { association: 'creator', attributes: ['name'], required: false },
                { association: 'items', required: false },
            ],
        });

        if (!invoice) {
            return res.status(404).json({ success: false, message: 'Invoice not found' });
        }

        res.json({ success: true, invoice: formatInvoice(invoice) });
    } catch (error) {
        console.error('getInvoice error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get next invoice number (preview)
const getNextInvoiceNumber = async (req, res) => {
    try {
        const nextNumber = await generateInvoiceNumber();
        res.json({ success: true, invoice_number: nextNumber });
    } catch (error) {
        console.error('getNextInvoiceNumber error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Create invoice with items
const createInvoice = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const {
            bilti_number, description, transport_company, invoice_date,
            customer_id, customer_name, customer_phone,
            discount_type = 'amount', discount_value = 0, labour_amount = 0,
            branch_id, notes = '', items = [], local_uuid,
            invoice_number: providedInvoiceNumber,
        } = req.body;

        if (local_uuid) {
            const existing = await db.Invoice.findOne({ where: { local_uuid }, transaction: t });
            if (existing) {
                await t.rollback();
                const full = await db.Invoice.findByPk(existing.id, {
                    include: [
                        { association: 'customer', attributes: ['name', 'phone'], required: false },
                        { association: 'items', required: false },
                    ],
                });
                return res.json({
                    success: true,
                    invoice: formatInvoice(full),
                    message: 'Invoice already exists (idempotent)',
                });
            }
        }

        if (!items || items.length === 0) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'At least one item is required' });
        }

        let invoiceNumber = providedInvoiceNumber?.trim();
        let invoiceNumberAuto = false;
        if (!invoiceNumber) {
            invoiceNumber = await generateInvoiceNumber(branch_id);
            invoiceNumberAuto = true;
        }
        const existingNumber = await db.Invoice.findOne({
            where: { invoice_number: invoiceNumber },
            transaction: t,
        });
        if (existingNumber) {
            await t.rollback();
            return res.status(409).json({
                success: false,
                message: `Invoice number "${invoiceNumber}" already exists`,
            });
        }

        let resolvedCustomerName = customer_name || '';
        let resolvedCustomerPhone = customer_phone || '';
        if (customer_id) {
            const customer = await db.Customer.findByPk(customer_id, { transaction: t });
            if (customer) {
                resolvedCustomerName = resolvedCustomerName || customer.name;
                resolvedCustomerPhone = resolvedCustomerPhone || customer.phone;
            }
        }

        let subtotal = 0, totalTax = 0, itemDiscountTotal = 0;
        const processedItems = items.map(item => {
            const qty = parseFloat(item.quantity) || 0;
            const unitPrice = parseFloat(item.unit_price) || 0;
            const taxPct = parseFloat(item.tax_percentage) || 0;
            const itemDiscPct = parseFloat(item.discount_percentage) || 0;

            const itemSubtotal = qty * unitPrice;
            const itemDiscount = (itemSubtotal * itemDiscPct) / 100;
            const afterDiscount = itemSubtotal - itemDiscount;
            const taxAmount = (afterDiscount * taxPct) / 100;
            const itemTotal = afterDiscount + taxAmount;

            subtotal += itemSubtotal;
            totalTax += taxAmount;
            itemDiscountTotal += itemDiscount;

            return {
                product_id: item.product_id,
                product_name: item.product_name,
                product_item_code: item.product_item_code || null,
                product_unit: item.product_unit || null,
                description: item.description || '',
                quantity: qty,
                unit_price: unitPrice,
                is_custom_price: !!item.is_custom_price,
                original_price: item.original_price ? parseFloat(item.original_price) : null,
                discount_percentage: itemDiscPct,
                discount_amount: itemDiscount,
                tax_percentage: taxPct,
                tax_amount: taxAmount,
                subtotal: itemSubtotal,
                total: itemTotal,
            };
        });

        const discValue = parseFloat(discount_value) || 0;
        let invoiceDiscountAmount = 0;
        if (discount_type === 'percentage') {
            invoiceDiscountAmount = ((subtotal - itemDiscountTotal) * discValue) / 100;
        } else {
            invoiceDiscountAmount = discValue;
        }
        const labour = parseFloat(labour_amount) || 0;
        const totalAmount =
            subtotal - itemDiscountTotal - invoiceDiscountAmount + totalTax + labour;

        const invoice = await db.Invoice.create({
            invoice_number: invoiceNumber,
            invoice_number_auto: invoiceNumberAuto,
            bilti_number: bilti_number?.trim() || null,
            description: description?.trim() || '',
            transport_company: transport_company?.trim() || null,
            invoice_date: invoice_date || new Date().toISOString().slice(0, 10),
            customer_id: customer_id || null,
            customer_name: resolvedCustomerName || null,
            customer_phone: resolvedCustomerPhone || null,
            subtotal,
            discount_type,
            discount_value: discValue,
            discount_amount: invoiceDiscountAmount,
            labour_amount: labour,
            tax_amount: totalTax,
            total_amount: totalAmount,
            branch_id: branch_id || null,
            created_by: req.user.id,
            status: 'confirmed',
            notes: notes?.trim() || '',
            local_uuid: local_uuid || null,
        }, { transaction: t });

        for (const item of processedItems) {
            await db.InvoiceItem.create({ ...item, invoice_id: invoice.id }, { transaction: t });
            await applyStockChange(item.product_id, -item.quantity, t);
        }

        await applyLedgerEntry({
            customerId: customer_id,
            entryType: 'invoice',
            referenceId: invoice.id,
            referenceNumber: invoice.invoice_number,
            debit: 0,
            credit: totalAmount,
            description: `Invoice ${invoice.invoice_number}`,
            entryDate: invoice.invoice_date,
            userId: req.user.id,
            t,
        });

        await t.commit();

        const full = await db.Invoice.findByPk(invoice.id, {
            include: [
                { association: 'customer', attributes: ['name', 'phone'], required: false },
                { association: 'branch', attributes: ['name'], required: false },
                { association: 'creator', attributes: ['name'], required: false },
                { association: 'items', required: false },
            ],
        });

        res.status(201).json({
            success: true,
            invoice: formatInvoice(full),
            message: 'Invoice created successfully',
        });
    } catch (error) {
        await t.rollback();
        console.error('createInvoice error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
};

// Update invoice
const updateInvoice = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const invoice = await db.Invoice.findByPk(req.params.id, { transaction: t });
        if (!invoice) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Invoice not found' });
        }

        const {
            bilti_number, description, transport_company, invoice_date,
            customer_id, customer_name, customer_phone,
            discount_type, discount_value, labour_amount,
            notes, items,
        } = req.body;

        const oldItems = await db.InvoiceItem.findAll({
            where: { invoice_id: invoice.id },
            transaction: t,
        });
        for (const old of oldItems) {
            await applyStockChange(old.product_id, +parseFloat(old.quantity), t);
        }

        if (invoice.customer_id) {
            await applyLedgerEntry({
                customerId: invoice.customer_id,
                entryType: 'adjustment',
                referenceId: invoice.id,
                referenceNumber: invoice.invoice_number,
                debit: parseFloat(invoice.total_amount || 0),
                credit: 0,
                description: `Reversal of invoice ${invoice.invoice_number}`,
                entryDate: new Date(),
                userId: req.user.id,
                t,
            });
        }

        let newSubtotal = 0, newTotalTax = 0, newItemDiscountTotal = 0;

        if (items && items.length > 0) {
            await db.InvoiceItem.destroy({
                where: { invoice_id: invoice.id },
                transaction: t,
            });

            for (const item of items) {
                const qty = parseFloat(item.quantity) || 0;
                const unitPrice = parseFloat(item.unit_price) || 0;
                const taxPct = parseFloat(item.tax_percentage) || 0;
                const itemDiscPct = parseFloat(item.discount_percentage) || 0;

                const itemSubtotal = qty * unitPrice;
                const itemDiscount = (itemSubtotal * itemDiscPct) / 100;
                const afterDiscount = itemSubtotal - itemDiscount;
                const taxAmount = (afterDiscount * taxPct) / 100;
                const itemTotal = afterDiscount + taxAmount;

                newSubtotal += itemSubtotal;
                newTotalTax += taxAmount;
                newItemDiscountTotal += itemDiscount;

                await db.InvoiceItem.create({
                    invoice_id: invoice.id,
                    product_id: item.product_id,
                    product_name: item.product_name,
                    product_item_code: item.product_item_code || null,
                    product_unit: item.product_unit || null,
                    description: item.description || '',
                    quantity: qty,
                    unit_price: unitPrice,
                    is_custom_price: !!item.is_custom_price,
                    original_price: item.original_price ? parseFloat(item.original_price) : null,
                    discount_percentage: itemDiscPct,
                    discount_amount: itemDiscount,
                    tax_percentage: taxPct,
                    tax_amount: taxAmount,
                    subtotal: itemSubtotal,
                    total: itemTotal,
                }, { transaction: t });

                await applyStockChange(item.product_id, -qty, t);
            }
        } else {
            // Items not provided — reapply the existing items to stock.
            for (const old of oldItems) {
                await applyStockChange(old.product_id, -parseFloat(old.quantity), t);
            }
            newSubtotal = parseFloat(invoice.subtotal);
            newTotalTax = parseFloat(invoice.tax_amount);
            newItemDiscountTotal = oldItems.reduce(
                (sum, i) => sum + parseFloat(i.discount_amount || 0), 0,
            );
        }

        const discType = discount_type || invoice.discount_type;
        const discValue = discount_value !== undefined
            ? parseFloat(discount_value)
            : parseFloat(invoice.discount_value);
        let invoiceDiscountAmount;
        if (discType === 'percentage') {
            invoiceDiscountAmount = ((newSubtotal - newItemDiscountTotal) * discValue) / 100;
        } else {
            invoiceDiscountAmount = discValue;
        }

        const labour = labour_amount !== undefined
            ? parseFloat(labour_amount)
            : parseFloat(invoice.labour_amount);
        const newTotal =
            newSubtotal - newItemDiscountTotal - invoiceDiscountAmount + newTotalTax + labour;

        const updateData = {
            subtotal: newSubtotal,
            discount_type: discType,
            discount_value: discValue,
            discount_amount: invoiceDiscountAmount,
            labour_amount: labour,
            tax_amount: newTotalTax,
            total_amount: newTotal,
        };
        if (bilti_number !== undefined) updateData.bilti_number = bilti_number?.trim() || null;
        if (description !== undefined) updateData.description = description?.trim() || '';
        if (transport_company !== undefined) updateData.transport_company = transport_company?.trim() || null;
        if (invoice_date !== undefined) updateData.invoice_date = invoice_date;
        if (customer_id !== undefined) updateData.customer_id = customer_id || null;
        if (customer_name !== undefined) updateData.customer_name = customer_name || null;
        if (customer_phone !== undefined) updateData.customer_phone = customer_phone || null;
        if (notes !== undefined) updateData.notes = notes?.trim() || '';

        await invoice.update(updateData, { transaction: t });

        const finalCustomerId = updateData.customer_id ?? invoice.customer_id;
        await applyLedgerEntry({
            customerId: finalCustomerId,
            entryType: 'invoice',
            referenceId: invoice.id,
            referenceNumber: invoice.invoice_number,
            debit: 0,
            credit: newTotal,
            description: `Invoice ${invoice.invoice_number} (updated)`,
            entryDate: updateData.invoice_date ?? invoice.invoice_date,
            userId: req.user.id,
            t,
        });

        await t.commit();

        const full = await db.Invoice.findByPk(invoice.id, {
            include: [
                { association: 'customer', attributes: ['name', 'phone'], required: false },
                { association: 'branch', attributes: ['name'], required: false },
                { association: 'creator', attributes: ['name'], required: false },
                { association: 'items', required: false },
            ],
        });

        res.json({
            success: true,
            invoice: formatInvoice(full),
            message: 'Invoice updated successfully',
        });
    } catch (error) {
        await t.rollback();
        console.error('updateInvoice error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
};

// Delete invoice
const deleteInvoice = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const invoice = await db.Invoice.findByPk(req.params.id, { transaction: t });
        if (!invoice) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Invoice not found' });
        }

        const items = await db.InvoiceItem.findAll({
            where: { invoice_id: invoice.id },
            transaction: t,
        });
        for (const item of items) {
            await applyStockChange(item.product_id, +parseFloat(item.quantity), t);
        }

        if (invoice.customer_id) {
            await applyLedgerEntry({
                customerId: invoice.customer_id,
                entryType: 'adjustment',
                referenceId: invoice.id,
                referenceNumber: invoice.invoice_number,
                debit: parseFloat(invoice.total_amount || 0),
                credit: 0,
                description: `Reversal on delete of invoice ${invoice.invoice_number}`,
                entryDate: new Date(),
                userId: req.user.id,
                t,
            });
        }

        await db.InvoiceItem.destroy({ where: { invoice_id: invoice.id }, transaction: t });
        await invoice.destroy({ transaction: t });

        await t.commit();
        res.json({ success: true, message: 'Invoice deleted successfully' });
    } catch (error) {
        await t.rollback();
        console.error('deleteInvoice error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
};

module.exports = {
    getAllInvoices,
    getInvoice,
    getNextInvoiceNumber,
    createInvoice,
    updateInvoice,
    deleteInvoice,
};