// src/controllers/purchaseOrderController.js
const { Op } = require('sequelize');
const db = require('../models');
const { canonicalBankName } = require('../utils/bankMatcher');
const { normalizeEntryDate, dayOnly } = require('../utils/dates');

// ── Number generators ────────────────────────────────────────────────────
const generatePONumber = async (transaction) => {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');

    const lastPO = await db.PurchaseOrder.findOne({
        where: { po_number: { [Op.like]: `PO-${dateStr}-%` } },
        order: [['id', 'DESC']],
        transaction,
    });

    let sequence = 1;
    if (lastPO) {
        const parts = lastPO.po_number.split('-');
        sequence = parseInt(parts[2], 10) + 1;
    }

    return `PO-${dateStr}-${String(sequence).padStart(4, '0')}`;
};

const generateGRNumber = async (transaction) => {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');

    const lastGR = await db.GoodsReceipt.findOne({
        where: { gr_number: { [Op.like]: `GR-${dateStr}-%` } },
        order: [['id', 'DESC']],
        transaction,
    });

    let sequence = 1;
    if (lastGR) {
        const parts = lastGR.gr_number.split('-');
        sequence = parseInt(parts[2], 10) + 1;
    }

    return `GR-${dateStr}-${String(sequence).padStart(4, '0')}`;
};

// ── Ledger helpers ───────────────────────────────────────────────────────
const recomputeCashBookBalances = async (fromDate, branchId = null, txn = null) => {
    if (!fromDate) return 0;
    const baseWhere = branchId ? { branch_id: branchId } : {};

    const seed = await db.CashBook.findOne({
        where: { ...baseWhere, entry_date: { [Op.lt]: fromDate } },
        order: [['entry_date', 'DESC'], ['id', 'DESC']],
        transaction: txn,
    });
    let running = seed ? parseFloat(seed.balance_after || 0) : 0;

    const rows = await db.CashBook.findAll({
        where: { ...baseWhere, entry_date: { [Op.gte]: fromDate } },
        order: [['entry_date', 'ASC'], ['id', 'ASC']],
        transaction: txn,
    });

    for (const row of rows) {
        const amt = parseFloat(row.amount || 0);
        running = row.entry_type === 'receipt' ? running + amt : running - amt;
        if (parseFloat(row.balance_after || 0) !== running) {
            await row.update({ balance_after: running }, { transaction: txn });
        }
    }
    return running;
};

const recomputeBankBalances = async (bankName, fromDate, branchId = null, txn = null) => {
    if (!bankName || !fromDate) return 0;
    const baseWhere = { bank_name: bankName };
    if (branchId) baseWhere.branch_id = branchId;

    const seed = await db.BankTransaction.findOne({
        where: { ...baseWhere, entry_date: { [Op.lt]: fromDate } },
        order: [['entry_date', 'DESC'], ['id', 'DESC']],
        transaction: txn,
    });
    let running = seed ? parseFloat(seed.balance_after || 0) : 0;

    const rows = await db.BankTransaction.findAll({
        where: { ...baseWhere, entry_date: { [Op.gte]: fromDate } },
        order: [['entry_date', 'ASC'], ['id', 'ASC']],
        transaction: txn,
    });

    const creditTypes = new Set(['deposit', 'cheque_in', 'transfer_in']);
    const debitTypes = new Set(['withdrawal', 'cheque_out', 'transfer_out']);

    for (const row of rows) {
        const amt = parseFloat(row.amount || 0);
        if (creditTypes.has(row.entry_type)) running += amt;
        else if (debitTypes.has(row.entry_type)) running -= amt;
        if (parseFloat(row.balance_after || 0) !== running) {
            await row.update({ balance_after: running }, { transaction: txn });
        }
    }
    return running;
};

const postSupplierLedgerEntry = async (txn, {
    supplierId,
    entryType,
    debit = 0,
    credit = 0,
    referenceId = null,
    referenceNumber = null,
    description = null,
    paymentMethod = null,
    bank = null,
    entryDate = null,
    createdBy = null,
}) => {
    if (!supplierId) throw new Error('postSupplierLedgerEntry: supplierId required');

    const supplier = await db.Supplier.findByPk(supplierId, { transaction: txn });
    if (!supplier) throw new Error(`Supplier ${supplierId} not found`);

    const currentBalance = parseFloat(supplier.current_balance || 0);
    const newBalance = currentBalance + debit - credit;

    await supplier.update({ current_balance: newBalance }, { transaction: txn });

    await db.SupplierLedger.create({
        supplier_id: supplierId,
        entry_type: entryType,
        reference_id: referenceId,
        reference_number: referenceNumber,
        debit,
        credit,
        balance_after: newBalance,
        description,
        payment_method: paymentMethod,
        bank,
        entry_date: normalizeEntryDate(entryDate),
        created_by: createdBy,
    }, { transaction: txn });

    return { supplier, newBalance };
};

// ── Format ───────────────────────────────────────────────────────────────
const formatPurchaseOrder = (po) => {
    const json = po.toJSON();
    return {
        id: json.id,
        po_number: json.po_number,
        supplier_id: json.supplier_id,
        supplier_name: json.supplier?.name || null,
        supplier_company: json.supplier?.company || null,
        supplier_phone: json.supplier?.phone || null,
        branch_id: json.branch_id,
        branch_name: json.branch?.name || null,
        order_date: json.order_date,
        expected_date: json.expected_date,
        status: json.status,
        subtotal: parseFloat(json.subtotal || 0),
        discount_type: json.discount_type,
        discount_value: parseFloat(json.discount_value || 0),
        discount_amount: parseFloat(json.discount_amount || 0),
        tax_amount: parseFloat(json.tax_amount || 0),
        shipping_amount: parseFloat(json.shipping_amount || 0),
        total_amount: parseFloat(json.total_amount || 0),
        paid_amount: parseFloat(json.paid_amount || 0),
        payment_status: json.payment_status,
        payment_method: json.payment_method,
        reference_number: json.reference_number,
        notes: json.notes || '',
        terms: json.terms || '',
        received_date: json.received_date,
        created_by: json.created_by,
        created_by_name: json.creator?.name || 'Unknown',
        created_at: json.createdAt,
        updated_at: json.updatedAt,
        local_uuid: json.local_uuid,
        items: (json.items || []).map(item => ({
            id: item.id,
            product_id: item.product_id,
            product_name: item.product_name,
            product_item_code: item.product_item_code,
            product_unit: item.product_unit,
            ordered_qty: parseFloat(item.ordered_qty || 0),
            received_qty: parseFloat(item.received_qty || 0),
            pending_qty:
                parseFloat(item.ordered_qty || 0) -
                parseFloat(item.received_qty || 0),
            unit_price: parseFloat(item.unit_price || 0),
            discount_percentage: parseFloat(item.discount_percentage || 0),
            discount_amount: parseFloat(item.discount_amount || 0),
            tax_percentage: parseFloat(item.tax_percentage || 0),
            tax_amount: parseFloat(item.tax_amount || 0),
            subtotal: parseFloat(item.subtotal || 0),
            total: parseFloat(item.total || 0),
            description: item.description || '',
        })),
        receipts: (json.receipts || []).map(gr => ({
            id: gr.id,
            gr_number: gr.gr_number,
            receipt_date: gr.receipt_date,
            status: gr.status,
            total_amount: parseFloat(gr.total_amount || 0),
        })),
    };
};

// ── GET ALL ──────────────────────────────────────────────────────────────
const getAllPurchaseOrders = async (req, res) => {
    try {
        const { search, status, supplier_id } = req.query;
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.max(parseInt(req.query.limit, 10) || 20, 1);
        const offset = (page - 1) * limit;

        const where = {};
        if (status && status !== 'all') where.status = status;
        if (supplier_id) where.supplier_id = supplier_id;
        if (search && search.trim()) {
            where[Op.or] = [
                { po_number: { [Op.like]: `%${search.trim()}%` } },
                { reference_number: { [Op.like]: `%${search.trim()}%` } },
                { notes: { [Op.like]: `%${search.trim()}%` } },
            ];
        }

        const { rows, count } = await db.PurchaseOrder.findAndCountAll({
            where,
            include: [
                { association: 'supplier', attributes: ['id', 'name', 'company', 'phone'] },
                { association: 'branch', attributes: ['id', 'name'] },
                { association: 'creator', attributes: ['id', 'name'] },
                { association: 'items' },
                {
                    association: 'receipts',
                    attributes: ['id', 'gr_number', 'receipt_date', 'status', 'total_amount'],
                },
            ],
            order: [['createdAt', 'DESC']],
            limit,
            offset,
            distinct: true,
        });

        res.json({
            success: true,
            purchase_orders: rows.map(formatPurchaseOrder),
            page,
            limit,
            total: count,
            total_pages: Math.max(Math.ceil(count / limit), 1),
            has_more: offset + rows.length < count,
        });
    } catch (error) {
        console.error('getAllPurchaseOrders error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ── GET ONE ──────────────────────────────────────────────────────────────
const getPurchaseOrder = async (req, res) => {
    try {
        const po = await db.PurchaseOrder.findByPk(req.params.id, {
            include: [
                { association: 'supplier' },
                { association: 'branch' },
                { association: 'creator', attributes: ['id', 'name'] },
                { association: 'items' },
                { association: 'receipts', include: [{ association: 'items' }] },
            ],
        });

        if (!po) {
            return res.status(404).json({ success: false, message: 'Purchase order not found' });
        }

        res.json({ success: true, purchase_order: formatPurchaseOrder(po) });
    } catch (error) {
        console.error('getPurchaseOrder error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ── CREATE PO ────────────────────────────────────────────────────────────
const createPurchaseOrder = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const {
            supplier_id, branch_id, order_date, expected_date,
            status = 'ordered', items = [],
            discount_type = 'amount', discount_value = 0,
            shipping_amount = 0, reference_number,
            notes = '', terms = '', local_uuid,
        } = req.body;

        if (!supplier_id) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Supplier is required' });
        }
        if (!items || items.length === 0) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'At least one item is required' });
        }

        const supplier = await db.Supplier.findByPk(supplier_id, { transaction: t });
        if (!supplier) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Supplier not found' });
        }

        const poNumber = await generatePONumber(t);

        let subtotal = 0;
        let totalTax = 0;
        let totalDiscount = 0;

        const processedItems = [];
        for (const item of items) {
            const qty = parseFloat(item.ordered_qty) || 0;
            const unitPrice = parseFloat(item.unit_price) || 0;
            const taxPct = parseFloat(item.tax_percentage) || 0;
            const discPct = parseFloat(item.discount_percentage) || 0;

            const lineSubtotal = qty * unitPrice;
            const lineDiscount = (lineSubtotal * discPct) / 100;
            const lineTaxable = lineSubtotal - lineDiscount;
            const lineTax = (lineTaxable * taxPct) / 100;
            const lineTotal = lineTaxable + lineTax;

            subtotal += lineSubtotal;
            totalDiscount += lineDiscount;
            totalTax += lineTax;

            const product = await db.Product.findByPk(item.product_id, { transaction: t });
            if (!product) {
                await t.rollback();
                return res.status(404).json({
                    success: false,
                    message: `Product ${item.product_id} not found`,
                });
            }

            processedItems.push({
                product_id: item.product_id,
                product_name: product.name,
                product_item_code: product.item_code,
                product_unit: product.unit?.abbreviation || product.unit?.name || null,
                ordered_qty: qty,
                received_qty: 0,
                unit_price: unitPrice,
                discount_percentage: discPct,
                discount_amount: lineDiscount,
                tax_percentage: taxPct,
                tax_amount: lineTax,
                subtotal: lineSubtotal,
                total: lineTotal,
                description: item.description || '',
            });
        }

        const orderDiscountAmount =
            discount_type === 'percentage'
                ? (subtotal * parseFloat(discount_value)) / 100
                : parseFloat(discount_value) || 0;

        const totalAmount =
            subtotal -
            totalDiscount -
            orderDiscountAmount +
            totalTax +
            parseFloat(shipping_amount || 0);

        const po = await db.PurchaseOrder.create({
            po_number: poNumber,
            supplier_id,
            branch_id: branch_id || null,
            order_date: order_date || new Date().toISOString().split('T')[0],
            expected_date: expected_date || null,
            status,
            subtotal,
            discount_type,
            discount_value: parseFloat(discount_value) || 0,
            discount_amount: orderDiscountAmount,
            tax_amount: totalTax,
            shipping_amount: parseFloat(shipping_amount) || 0,
            total_amount: totalAmount,
            reference_number: reference_number || null,
            notes: notes || '',
            terms: terms || '',
            created_by: req.user.id,
            local_uuid: local_uuid || null,
        }, { transaction: t });

        for (const item of processedItems) {
            await db.PurchaseOrderItem.create({
                purchase_order_id: po.id,
                ...item,
            }, { transaction: t });
        }

        await t.commit();

        const full = await db.PurchaseOrder.findByPk(po.id, {
            include: [
                { association: 'supplier' },
                { association: 'branch' },
                { association: 'creator', attributes: ['id', 'name'] },
                { association: 'items' },
            ],
        });

        res.status(201).json({
            success: true,
            purchase_order: formatPurchaseOrder(full),
            message: 'Purchase order created successfully',
        });
    } catch (error) {
        await t.rollback();
        console.error('createPurchaseOrder error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
};

// ── UPDATE PO ────────────────────────────────────────────────────────────
const updatePurchaseOrder = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const po = await db.PurchaseOrder.findByPk(req.params.id, { transaction: t });
        if (!po) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Purchase order not found' });
        }
        if (po.status === 'received') {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: 'Cannot update a fully received purchase order',
            });
        }

        const {
            supplier_id, branch_id, order_date, expected_date, status,
            items, discount_type, discount_value, shipping_amount,
            reference_number, notes, terms,
        } = req.body;

        const updateData = {};
        if (supplier_id !== undefined) updateData.supplier_id = supplier_id;
        if (branch_id !== undefined) updateData.branch_id = branch_id;
        if (order_date !== undefined) updateData.order_date = order_date;
        if (expected_date !== undefined) updateData.expected_date = expected_date;
        if (status !== undefined) updateData.status = status;
        if (discount_type !== undefined) updateData.discount_type = discount_type;
        if (discount_value !== undefined)
            updateData.discount_value = parseFloat(discount_value) || 0;
        if (shipping_amount !== undefined)
            updateData.shipping_amount = parseFloat(shipping_amount) || 0;
        if (reference_number !== undefined)
            updateData.reference_number = reference_number;
        if (notes !== undefined) updateData.notes = notes;
        if (terms !== undefined) updateData.terms = terms;

        if (items && items.length > 0) {
            const existingItems = await db.PurchaseOrderItem.findAll({
                where: { purchase_order_id: po.id },
                transaction: t,
            });
            const hasReceived = existingItems.some(
                item => parseFloat(item.received_qty) > 0,
            );
            if (hasReceived) {
                await t.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Cannot modify items after partial receipt',
                });
            }

            await db.PurchaseOrderItem.destroy({
                where: { purchase_order_id: po.id },
                transaction: t,
            });

            let subtotal = 0;
            let totalTax = 0;
            let totalDiscount = 0;

            for (const item of items) {
                const qty = parseFloat(item.ordered_qty) || 0;
                const unitPrice = parseFloat(item.unit_price) || 0;
                const taxPct = parseFloat(item.tax_percentage) || 0;
                const discPct = parseFloat(item.discount_percentage) || 0;

                const lineSubtotal = qty * unitPrice;
                const lineDiscount = (lineSubtotal * discPct) / 100;
                const lineTaxable = lineSubtotal - lineDiscount;
                const lineTax = (lineTaxable * taxPct) / 100;
                const lineTotal = lineTaxable + lineTax;

                subtotal += lineSubtotal;
                totalDiscount += lineDiscount;
                totalTax += lineTax;

                const product = await db.Product.findByPk(item.product_id, { transaction: t });

                await db.PurchaseOrderItem.create({
                    purchase_order_id: po.id,
                    product_id: item.product_id,
                    product_name: product?.name || item.product_name,
                    product_item_code: product?.item_code || null,
                    product_unit: product?.unit?.abbreviation || null,
                    ordered_qty: qty,
                    received_qty: 0,
                    unit_price: unitPrice,
                    discount_percentage: discPct,
                    discount_amount: lineDiscount,
                    tax_percentage: taxPct,
                    tax_amount: lineTax,
                    subtotal: lineSubtotal,
                    total: lineTotal,
                    description: item.description || '',
                }, { transaction: t });
            }

            const orderDiscountAmount =
                discount_type === 'percentage'
                    ? (subtotal * parseFloat(discount_value || 0)) / 100
                    : parseFloat(discount_value || 0);

            updateData.subtotal = subtotal;
            updateData.discount_amount = orderDiscountAmount;
            updateData.tax_amount = totalTax;
            updateData.total_amount =
                subtotal -
                totalDiscount -
                orderDiscountAmount +
                totalTax +
                parseFloat(shipping_amount || 0);
        }

        await po.update(updateData, { transaction: t });
        await t.commit();

        const full = await db.PurchaseOrder.findByPk(po.id, {
            include: [
                { association: 'supplier' },
                { association: 'branch' },
                { association: 'creator', attributes: ['id', 'name'] },
                { association: 'items' },
                { association: 'receipts' },
            ],
        });

        res.json({
            success: true,
            purchase_order: formatPurchaseOrder(full),
            message: 'Purchase order updated successfully',
        });
    } catch (error) {
        await t.rollback();
        console.error('updatePurchaseOrder error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
};

// ── DELETE PO ────────────────────────────────────────────────────────────
const deletePurchaseOrder = async (req, res) => {
    try {
        const po = await db.PurchaseOrder.findByPk(req.params.id);
        if (!po) {
            return res.status(404).json({ success: false, message: 'Purchase order not found' });
        }

        const receiptCount = await db.GoodsReceipt.count({
            where: { purchase_order_id: po.id },
        });
        if (receiptCount > 0) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete purchase order with receipts. Cancel it instead.',
            });
        }

        await po.destroy();
        res.json({ success: true, message: 'Purchase order deleted successfully' });
    } catch (error) {
        console.error('deletePurchaseOrder error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ── DIRECT PURCHASE ──────────────────────────────────────────────────────
const createDirectPurchase = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const {
            supplier_id, branch_id, order_date, received_date,
            items = [],
            discount_type = 'amount', discount_value = 0, shipping_amount = 0,
            reference_number, notes = '', terms = '',
            paid_amount = 0, payment_method,
            bank_name, account_number, cheque_number, cheque_date,
            supplier_invoice_number, supplier_invoice_date,
            local_uuid,
        } = req.body;

        if (!supplier_id) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Supplier is required' });
        }
        if (!items || items.length === 0) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'At least one item is required' });
        }

        const supplier = await db.Supplier.findByPk(supplier_id, { transaction: t });
        if (!supplier) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Supplier not found' });
        }

        const poNumber = await generatePONumber(t);
        const grNumber = await generateGRNumber(t);

        let subtotal = 0;
        let totalTax = 0;
        let totalDiscount = 0;
        const processedItems = [];

        for (const item of items) {
            const qty = parseFloat(item.received_qty ?? item.ordered_qty) || 0;
            const unitPrice = parseFloat(item.unit_price) || 0;
            const taxPct = parseFloat(item.tax_percentage) || 0;
            const discPct = parseFloat(item.discount_percentage) || 0;

            const lineSubtotal = qty * unitPrice;
            const lineDiscount = (lineSubtotal * discPct) / 100;
            const lineTaxable = lineSubtotal - lineDiscount;
            const lineTax = (lineTaxable * taxPct) / 100;
            const lineTotal = lineTaxable + lineTax;

            subtotal += lineSubtotal;
            totalDiscount += lineDiscount;
            totalTax += lineTax;

            const product = await db.Product.findByPk(item.product_id, { transaction: t });
            if (!product) {
                await t.rollback();
                return res.status(404).json({
                    success: false,
                    message: `Product ${item.product_id} not found`,
                });
            }

            processedItems.push({
                product_id: item.product_id,
                product_name: product.name,
                product_item_code: product.item_code,
                product_unit: product.unit?.abbreviation || product.unit?.name || null,
                qty, unit_price: unitPrice,
                discount_percentage: discPct,
                discount_amount: lineDiscount,
                tax_percentage: taxPct,
                tax_amount: lineTax,
                subtotal: lineSubtotal,
                total: lineTotal,
                description: item.description || '',
                batch_number: item.batch_number || null,
                expiry_date: item.expiry_date || null,
            });
        }

        const orderDiscountAmount =
            discount_type === 'percentage'
                ? (subtotal * parseFloat(discount_value)) / 100
                : parseFloat(discount_value) || 0;

        const totalAmount =
            subtotal -
            totalDiscount -
            orderDiscountAmount +
            totalTax +
            parseFloat(shipping_amount || 0);
        const paidAmount = parseFloat(paid_amount) || 0;
        const paymentStatus =
            paidAmount >= totalAmount
                ? 'paid'
                : paidAmount > 0
                    ? 'partial'
                    : 'unpaid';
        const receiptDate =
            received_date || new Date().toISOString().split('T')[0];

        const po = await db.PurchaseOrder.create({
            po_number: poNumber,
            supplier_id,
            branch_id: branch_id || null,
            order_date: order_date || new Date().toISOString().split('T')[0],
            expected_date: received_date || order_date,
            status: 'received',
            subtotal,
            discount_type,
            discount_value: parseFloat(discount_value) || 0,
            discount_amount: orderDiscountAmount,
            tax_amount: totalTax,
            shipping_amount: parseFloat(shipping_amount) || 0,
            total_amount: totalAmount,
            paid_amount: paidAmount,
            payment_status: paymentStatus,
            payment_method: payment_method || null,
            reference_number: reference_number || null,
            notes: notes || '',
            terms: terms || '',
            received_date: receiptDate,
            created_by: req.user.id,
            local_uuid: local_uuid || null,
        }, { transaction: t });

        const poItems = [];
        for (const item of processedItems) {
            const poItem = await db.PurchaseOrderItem.create({
                purchase_order_id: po.id,
                product_id: item.product_id,
                product_name: item.product_name,
                product_item_code: item.product_item_code,
                product_unit: item.product_unit,
                ordered_qty: item.qty,
                received_qty: item.qty,
                unit_price: item.unit_price,
                discount_percentage: item.discount_percentage,
                discount_amount: item.discount_amount,
                tax_percentage: item.tax_percentage,
                tax_amount: item.tax_amount,
                subtotal: item.subtotal,
                total: item.total,
                description: item.description,
            }, { transaction: t });
            poItems.push(poItem);
        }

        const gr = await db.GoodsReceipt.create({
            gr_number: grNumber,
            purchase_order_id: po.id,
            supplier_id,
            receipt_date: receiptDate,
            status: 'confirmed',
            supplier_invoice_number: supplier_invoice_number || null,
            supplier_invoice_date: supplier_invoice_date || null,
            subtotal,
            tax_amount: totalTax,
            shipping_amount: parseFloat(shipping_amount) || 0,
            discount_amount: orderDiscountAmount + totalDiscount,
            total_amount: totalAmount,
            paid_amount: paidAmount,
            payment_status: paymentStatus,
            payment_method: payment_method || null,
            notes: notes || '',
            received_by: req.user.id,
            local_uuid: local_uuid ? `${local_uuid}_gr` : null,
        }, { transaction: t });

        for (let i = 0; i < processedItems.length; i++) {
            const item = processedItems[i];

            await db.GoodsReceiptItem.create({
                goods_receipt_id: gr.id,
                purchase_order_item_id: poItems[i].id,
                product_id: item.product_id,
                product_name: item.product_name,
                product_item_code: item.product_item_code,
                product_unit: item.product_unit,
                received_qty: item.qty,
                unit_price: item.unit_price,
                discount_percentage: item.discount_percentage,
                discount_amount: item.discount_amount,
                tax_percentage: item.tax_percentage,
                tax_amount: item.tax_amount,
                subtotal: item.subtotal,
                total: item.total,
                batch_number: item.batch_number,
                expiry_date: item.expiry_date,
            }, { transaction: t });

            const product = await db.Product.findByPk(item.product_id, { transaction: t });
            const currentQty = parseFloat(product.current_qty || 0);
            await product.update({
                current_qty: currentQty + item.qty,
            }, { transaction: t });
        }

        if (totalAmount > 0) {
            await postSupplierLedgerEntry(t, {
                supplierId: supplier_id,
                entryType: 'purchase',
                debit: totalAmount,
                credit: 0,
                referenceId: gr.id,
                referenceNumber: grNumber,
                description: `Direct purchase (PO ${poNumber})`,
                entryDate: receiptDate,
                createdBy: req.user.id,
            });
        }

        if (paidAmount > 0) {
            await postSupplierLedgerEntry(t, {
                supplierId: supplier_id,
                entryType: 'payment',
                debit: 0,
                credit: paidAmount,
                referenceId: gr.id,
                referenceNumber: grNumber,
                description: `Immediate payment on PO ${poNumber}`,
                paymentMethod: payment_method || null,
                entryDate: receiptDate,
                createdBy: req.user.id,
            });

            const scopedBranch = branch_id || null;
            const payDateTime = normalizeEntryDate(receiptDate);
            const payDay = dayOnly(payDateTime);

            if (payment_method === 'cash') {
                const lastCash = await db.CashBook.findOne({
                    where: scopedBranch ? { branch_id: scopedBranch } : {},
                    order: [['id', 'DESC']],
                    transaction: t,
                });
                const lastBalance = lastCash ? parseFloat(lastCash.balance_after || 0) : 0;

                await db.CashBook.create({
                    entry_type: 'payment',
                    amount: paidAmount,
                    balance_after: lastBalance - paidAmount,
                    description: `Payment for PO ${poNumber}`,
                    reference_type: 'supplier_payment',
                    reference_id: gr.id,
                    reference_number: grNumber,
                    entry_date: payDateTime,
                    branch_id: scopedBranch,
                    created_by: req.user.id,
                }, { transaction: t });

                await recomputeCashBookBalances(payDay, scopedBranch, t);
            } else if (
                (payment_method === 'bank' || payment_method === 'cheque') &&
                bank_name
            ) {
                const canonical = canonicalBankName(bank_name);
                const lastBank = await db.BankTransaction.findOne({
                    where: {
                        bank_name: canonical,
                        ...(scopedBranch ? { branch_id: scopedBranch } : {}),
                    },
                    order: [['id', 'DESC']],
                    transaction: t,
                });
                const lastBalance = lastBank ? parseFloat(lastBank.balance_after || 0) : 0;

                await db.BankTransaction.create({
                    entry_type:
                        payment_method === 'cheque' ? 'cheque_out' : 'withdrawal',
                    amount: paidAmount,
                    balance_after: lastBalance - paidAmount,
                    bank_name: canonical,
                    account_number: account_number || null,
                    cheque_number: cheque_number || null,
                    cheque_date: cheque_date || null,
                    cheque_status:
                        payment_method === 'cheque' ? 'pending' : null,
                    reference_type: 'supplier_payment',
                    reference_id: gr.id,
                    reference_number: grNumber,
                    description: `Payment for PO ${poNumber}`,
                    entry_date: payDateTime,
                    branch_id: scopedBranch,
                    created_by: req.user.id,
                }, { transaction: t });

                await recomputeBankBalances(canonical, payDay, scopedBranch, t);
            }
        }

        await t.commit();

        const full = await db.PurchaseOrder.findByPk(po.id, {
            include: [
                { association: 'supplier' },
                { association: 'branch' },
                { association: 'creator', attributes: ['id', 'name'] },
                { association: 'items' },
                { association: 'receipts', include: [{ association: 'items' }] },
            ],
        });

        res.status(201).json({
            success: true,
            purchase_order: formatPurchaseOrder(full),
            message: 'Direct purchase created successfully',
        });
    } catch (error) {
        await t.rollback();
        console.error('createDirectPurchase error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
};

module.exports = {
    getAllPurchaseOrders,
    getPurchaseOrder,
    createPurchaseOrder,
    updatePurchaseOrder,
    deletePurchaseOrder,
    createDirectPurchase,
};