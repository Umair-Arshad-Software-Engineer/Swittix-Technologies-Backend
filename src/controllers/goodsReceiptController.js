// src/controllers/goodsReceiptController.js
const { Op } = require('sequelize');
const db = require('../models');
const { canonicalBankName } = require('../utils/bankMatcher');
const { normalizeEntryDate, dayOnly } = require('../utils/dates');

const generateGRNumber = async (transaction) => {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');

    const lastGR = await db.GoodsReceipt.findOne({
        where: {
            gr_number: { [Op.like]: `GR-${dateStr}-%` },
        },
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

const formatGoodsReceipt = (gr) => {
    const json = gr.toJSON();
    return {
        id: json.id,
        gr_number: json.gr_number,
        purchase_order_id: json.purchase_order_id,
        po_number: json.purchaseOrder?.po_number || null,
        supplier_id: json.supplier_id,
        supplier_name: json.supplier?.name || null,
        supplier_company: json.supplier?.company || null,
        receipt_date: json.receipt_date,
        status: json.status,
        supplier_invoice_number: json.supplier_invoice_number,
        supplier_invoice_date: json.supplier_invoice_date,
        subtotal: parseFloat(json.subtotal || 0),
        tax_amount: parseFloat(json.tax_amount || 0),
        shipping_amount: parseFloat(json.shipping_amount || 0),
        discount_amount: parseFloat(json.discount_amount || 0),
        total_amount: parseFloat(json.total_amount || 0),
        paid_amount: parseFloat(json.paid_amount || 0),
        payment_status: json.payment_status,
        payment_method: json.payment_method,
        notes: json.notes || '',
        received_by: json.received_by,
        received_by_name: json.receiver?.name || 'Unknown',
        created_at: json.createdAt,
        updated_at: json.updatedAt,
        local_uuid: json.local_uuid,
        items: (json.items || []).map(item => ({
            id: item.id,
            purchase_order_item_id: item.purchase_order_item_id,
            product_id: item.product_id,
            product_name: item.product_name,
            product_item_code: item.product_item_code,
            product_unit: item.product_unit,
            received_qty: parseFloat(item.received_qty || 0),
            unit_price: parseFloat(item.unit_price || 0),
            discount_percentage: parseFloat(item.discount_percentage || 0),
            discount_amount: parseFloat(item.discount_amount || 0),
            tax_percentage: parseFloat(item.tax_percentage || 0),
            tax_amount: parseFloat(item.tax_amount || 0),
            subtotal: parseFloat(item.subtotal || 0),
            total: parseFloat(item.total || 0),
            batch_number: item.batch_number,
            expiry_date: item.expiry_date,
        })),
    };
};

// ─── GET ALL ────────────────────────────────────────────────────────────
const getAllGoodsReceipts = async (req, res) => {
    try {
        const { search, supplier_id, purchase_order_id } = req.query;
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.max(parseInt(req.query.limit, 10) || 20, 1);
        const offset = (page - 1) * limit;

        const where = {};
        if (supplier_id) where.supplier_id = supplier_id;
        if (purchase_order_id) where.purchase_order_id = purchase_order_id;
        if (search && search.trim()) {
            where[Op.or] = [
                { gr_number: { [Op.like]: `%${search.trim()}%` } },
                { supplier_invoice_number: { [Op.like]: `%${search.trim()}%` } },
                { notes: { [Op.like]: `%${search.trim()}%` } },
            ];
        }

        const { rows, count } = await db.GoodsReceipt.findAndCountAll({
            where,
            include: [
                { association: 'purchaseOrder', attributes: ['id', 'po_number'] },
                { association: 'supplier', attributes: ['id', 'name', 'company'] },
                { association: 'receiver', attributes: ['id', 'name'] },
                { association: 'items' },
            ],
            order: [['createdAt', 'DESC']],
            limit,
            offset,
            distinct: true,
        });

        res.json({
            success: true,
            goods_receipts: rows.map(formatGoodsReceipt),
            page,
            limit,
            total: count,
            total_pages: Math.max(Math.ceil(count / limit), 1),
            has_more: offset + rows.length < count,
        });
    } catch (error) {
        console.error('getAllGoodsReceipts error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ─── GET ONE ────────────────────────────────────────────────────────────
const getGoodsReceipt = async (req, res) => {
    try {
        const gr = await db.GoodsReceipt.findByPk(req.params.id, {
            include: [
                { association: 'purchaseOrder', attributes: ['id', 'po_number'] },
                { association: 'supplier' },
                { association: 'receiver', attributes: ['id', 'name'] },
                { association: 'items' },
            ],
        });

        if (!gr) {
            return res.status(404).json({ success: false, message: 'Goods receipt not found' });
        }

        res.json({ success: true, goods_receipt: formatGoodsReceipt(gr) });
    } catch (error) {
        console.error('getGoodsReceipt error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ─── CREATE (against an existing PO) ────────────────────────────────────
const createGoodsReceipt = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const {
            purchase_order_id,
            receipt_date,
            items = [],
            supplier_invoice_number,
            supplier_invoice_date,
            shipping_amount = 0,
            notes = '',
            paid_amount = 0,
            payment_method,
            bank_name,
            account_number,
            cheque_number,
            cheque_date,
            local_uuid,
        } = req.body;

        if (!purchase_order_id) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'Purchase order ID is required' });
        }
        if (!items || items.length === 0) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'At least one item is required' });
        }

        const po = await db.PurchaseOrder.findByPk(purchase_order_id, {
            include: [{ association: 'items' }],
            transaction: t,
        });

        if (!po) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Purchase order not found' });
        }
        if (po.status === 'received') {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: 'Purchase order is already fully received',
            });
        }
        if (po.status === 'cancelled') {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: 'Purchase order is cancelled',
            });
        }

        const grNumber = await generateGRNumber(t);

        let subtotal = 0;
        let totalTax = 0;
        let totalDiscount = 0;
        const processedItems = [];

        for (const item of items) {
            const poItem = po.items.find(pi => pi.id === item.purchase_order_item_id);
            if (!poItem) {
                await t.rollback();
                return res.status(400).json({
                    success: false,
                    message: `PO item ${item.purchase_order_item_id} not found`,
                });
            }

            const receivedQty = parseFloat(item.received_qty) || 0;
            if (receivedQty <= 0) continue;

            const remainingQty =
                parseFloat(poItem.ordered_qty) - parseFloat(poItem.received_qty);
            if (receivedQty > remainingQty) {
                await t.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Cannot receive ${receivedQty} of ${poItem.product_name}. Only ${remainingQty} remaining.`,
                });
            }

            const unitPrice = parseFloat(item.unit_price ?? poItem.unit_price) || 0;
            const taxPct = parseFloat(item.tax_percentage ?? poItem.tax_percentage) || 0;
            const discPct =
                parseFloat(item.discount_percentage ?? poItem.discount_percentage) || 0;

            const lineSubtotal = receivedQty * unitPrice;
            const lineDiscount = (lineSubtotal * discPct) / 100;
            const lineTaxable = lineSubtotal - lineDiscount;
            const lineTax = (lineTaxable * taxPct) / 100;
            const lineTotal = lineTaxable + lineTax;

            subtotal += lineSubtotal;
            totalDiscount += lineDiscount;
            totalTax += lineTax;

            processedItems.push({
                poItem,
                product_id: poItem.product_id,
                product_name: poItem.product_name,
                product_item_code: poItem.product_item_code,
                product_unit: poItem.product_unit,
                received_qty: receivedQty,
                unit_price: unitPrice,
                discount_percentage: discPct,
                discount_amount: lineDiscount,
                tax_percentage: taxPct,
                tax_amount: lineTax,
                subtotal: lineSubtotal,
                total: lineTotal,
                batch_number: item.batch_number || null,
                expiry_date: item.expiry_date || null,
            });
        }

        if (processedItems.length === 0) {
            await t.rollback();
            return res.status(400).json({ success: false, message: 'No valid items to receive' });
        }

        const totalAmount =
            subtotal - totalDiscount + totalTax + parseFloat(shipping_amount || 0);
        const paidAmount = parseFloat(paid_amount) || 0;
        const paymentStatus =
            paidAmount >= totalAmount
                ? 'paid'
                : paidAmount > 0
                    ? 'partial'
                    : 'unpaid';

        const receiptDate =
            receipt_date || new Date().toISOString().split('T')[0];

        const gr = await db.GoodsReceipt.create({
            gr_number: grNumber,
            purchase_order_id: po.id,
            supplier_id: po.supplier_id,
            receipt_date: receiptDate,
            status: 'confirmed',
            supplier_invoice_number: supplier_invoice_number || null,
            supplier_invoice_date: supplier_invoice_date || null,
            subtotal,
            tax_amount: totalTax,
            shipping_amount: parseFloat(shipping_amount) || 0,
            discount_amount: totalDiscount,
            total_amount: totalAmount,
            paid_amount: paidAmount,
            payment_status: paymentStatus,
            payment_method: payment_method || null,
            notes: notes || '',
            received_by: req.user.id,
            local_uuid: local_uuid || null,
        }, { transaction: t });

        for (const item of processedItems) {
            await db.GoodsReceiptItem.create({
                goods_receipt_id: gr.id,
                purchase_order_item_id: item.poItem.id,
                product_id: item.product_id,
                product_name: item.product_name,
                product_item_code: item.product_item_code,
                product_unit: item.product_unit,
                received_qty: item.received_qty,
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

            const newReceivedQty =
                parseFloat(item.poItem.received_qty || 0) + item.received_qty;
            await item.poItem.update({ received_qty: newReceivedQty }, { transaction: t });

            const product = await db.Product.findByPk(item.product_id, { transaction: t });
            const currentQty = parseFloat(product.current_qty || 0);
            await product.update(
                { current_qty: currentQty + item.received_qty },
                { transaction: t },
            );
        }

        const allPOItems = await db.PurchaseOrderItem.findAll({
            where: { purchase_order_id: po.id },
            transaction: t,
        });
        const allReceived = allPOItems.every(
            item => parseFloat(item.received_qty) >= parseFloat(item.ordered_qty),
        );
        await po.update({
            status: allReceived ? 'received' : 'partially_received',
            received_date: allReceived ? receiptDate : po.received_date,
        }, { transaction: t });

        if (totalAmount > 0) {
            await postSupplierLedgerEntry(t, {
                supplierId: po.supplier_id,
                entryType: 'purchase',
                debit: totalAmount,
                credit: 0,
                referenceId: gr.id,
                referenceNumber: grNumber,
                description: `Goods received on PO ${po.po_number}`,
                entryDate: receiptDate,
                createdBy: req.user.id,
            });
        }

        if (paidAmount > 0) {
            await postSupplierLedgerEntry(t, {
                supplierId: po.supplier_id,
                entryType: 'payment',
                debit: 0,
                credit: paidAmount,
                referenceId: gr.id,
                referenceNumber: grNumber,
                description: `Immediate payment for GR ${grNumber}`,
                paymentMethod: payment_method || null,
                entryDate: receiptDate,
                createdBy: req.user.id,
            });

            const scopedBranch = po.branch_id || null;
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
                    description: `Payment for GR ${grNumber}`,
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
                    description: `Payment for GR ${grNumber}`,
                    entry_date: payDateTime,
                    branch_id: scopedBranch,
                    created_by: req.user.id,
                }, { transaction: t });

                await recomputeBankBalances(canonical, payDay, scopedBranch, t);
            }
        }

        await t.commit();

        const full = await db.GoodsReceipt.findByPk(gr.id, {
            include: [
                { association: 'purchaseOrder', attributes: ['id', 'po_number'] },
                { association: 'supplier' },
                { association: 'receiver', attributes: ['id', 'name'] },
                { association: 'items' },
            ],
        });

        res.status(201).json({
            success: true,
            goods_receipt: formatGoodsReceipt(full),
            message: 'Goods received successfully',
        });
    } catch (error) {
        await t.rollback();
        console.error('createGoodsReceipt error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
};

// ─── DELETE ─────────────────────────────────────────────────────────────
const deleteGoodsReceipt = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const gr = await db.GoodsReceipt.findByPk(req.params.id, {
            include: [{ association: 'items' }],
            transaction: t,
        });

        if (!gr) {
            await t.rollback();
            return res.status(404).json({ success: false, message: 'Goods receipt not found' });
        }

        for (const item of gr.items) {
            const product = await db.Product.findByPk(item.product_id, { transaction: t });
            if (product) {
                const currentQty = parseFloat(product.current_qty || 0);
                await product.update({
                    current_qty: currentQty - parseFloat(item.received_qty),
                }, { transaction: t });
            }

            if (item.purchase_order_item_id) {
                const poItem = await db.PurchaseOrderItem.findByPk(
                    item.purchase_order_item_id,
                    { transaction: t },
                );
                if (poItem) {
                    const newReceivedQty =
                        parseFloat(poItem.received_qty || 0) -
                        parseFloat(item.received_qty);
                    await poItem.update({
                        received_qty: Math.max(0, newReceivedQty),
                    }, { transaction: t });
                }
            }
        }

        const po = await db.PurchaseOrder.findByPk(gr.purchase_order_id, {
            include: [{ association: 'items' }],
            transaction: t,
        });

        if (po) {
            const allReceived = po.items.every(
                item => parseFloat(item.received_qty) >= parseFloat(item.ordered_qty),
            );
            const anyReceived = po.items.some(
                item => parseFloat(item.received_qty) > 0,
            );
            let newStatus = 'ordered';
            if (allReceived) newStatus = 'received';
            else if (anyReceived) newStatus = 'partially_received';

            await po.update({ status: newStatus }, { transaction: t });
        }

        const totalAmount = parseFloat(gr.total_amount || 0);
        const paidAmount = parseFloat(gr.paid_amount || 0);

        const reversalDate = new Date();

        if (totalAmount > 0) {
            await postSupplierLedgerEntry(t, {
                supplierId: gr.supplier_id,
                entryType: 'adjustment',
                debit: -totalAmount,
                credit: 0,
                referenceId: gr.id,
                referenceNumber: gr.gr_number,
                description: `Reversal of GR ${gr.gr_number}`,
                entryDate: reversalDate,
                createdBy: req.user.id,
            });
        }

        if (paidAmount > 0) {
            await postSupplierLedgerEntry(t, {
                supplierId: gr.supplier_id,
                entryType: 'adjustment',
                debit: 0,
                credit: -paidAmount,
                referenceId: gr.id,
                referenceNumber: gr.gr_number,
                description: `Reversal of payment for GR ${gr.gr_number}`,
                paymentMethod: gr.payment_method || null,
                entryDate: reversalDate,
                createdBy: req.user.id,
            });
        }

        await gr.destroy({ transaction: t });
        await t.commit();

        res.json({ success: true, message: 'Goods receipt deleted successfully' });
    } catch (error) {
        await t.rollback();
        console.error('deleteGoodsReceipt error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

module.exports = {
    getAllGoodsReceipts,
    getGoodsReceipt,
    createGoodsReceipt,
    deleteGoodsReceipt,
};