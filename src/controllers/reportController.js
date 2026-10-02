// src/controllers/reportController.js
const { Op, fn, col, literal } = require('sequelize');
const db = require('../models');

// ─── Helper: date range filter ───────────────────────────────────────────
const buildDateWhere = (startDate, endDate, field = 'createdAt') => {
    const where = {};
    if (startDate && endDate) {
        where[field] = { [Op.between]: [startDate, `${endDate} 23:59:59`] };
    } else if (startDate) {
        where[field] = { [Op.gte]: startDate };
    } else if (endDate) {
        where[field] = { [Op.lte]: `${endDate} 23:59:59` };
    }
    return where;
};

const parseNum = (v) => {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
};

// ─── 1. ITEM-WISE SALE REPORT ────────────────────────────────────────────
// FIX: every aggregated column is now qualified with "InvoiceItem." because
// both InvoiceItem and Invoice have subtotal / discount_amount / tax_amount,
// which caused an "ambiguous column" SQL error.
const getItemWiseSaleReport = async (req, res) => {
    try {
        const { start_date, end_date, branch_id } = req.query;
        const where = buildDateWhere(start_date, end_date, 'invoice_date');

        const invoiceWhere = { status: 'confirmed' };
        if (branch_id) invoiceWhere.branch_id = branch_id;
        Object.assign(invoiceWhere, where);

        const rows = await db.InvoiceItem.findAll({
            attributes: [
                'product_id',
                'product_name',
                'product_item_code',
                'product_unit',
                [fn('SUM', col('InvoiceItem.quantity')), 'total_qty'],
                [fn('SUM', col('InvoiceItem.subtotal')), 'gross_amount'],
                [fn('SUM', col('InvoiceItem.discount_amount')), 'total_discount'],
                [fn('SUM', col('InvoiceItem.tax_amount')), 'total_tax'],
                [fn('SUM', col('InvoiceItem.total')), 'net_amount'],
                [fn('COUNT', fn('DISTINCT', col('InvoiceItem.invoice_id'))), 'invoice_count'],
            ],
            include: [{
                association: 'invoice',
                attributes: [],
                where: invoiceWhere,
                required: true,
            }],
            group: [
                col('InvoiceItem.product_id'),
                col('InvoiceItem.product_name'),
                col('InvoiceItem.product_item_code'),
                col('InvoiceItem.product_unit'),
            ],
            order: [[literal('net_amount'), 'DESC']],
            raw: true,
        });

        // Attach current purchase rate as cost basis
        const productIds = rows.map(r => r.product_id).filter(Boolean);
        const products = productIds.length
            ? await db.Product.findAll({
                where: { id: { [Op.in]: productIds } },
                attributes: ['id', 'purchase_rate', 'sale_rate', 'current_qty'],
                raw: true,
            })
            : [];
        const productMap = new Map(products.map(p => [p.id, p]));

        let totals = {
            total_qty: 0,
            gross_amount: 0,
            total_discount: 0,
            total_tax: 0,
            net_amount: 0,
            total_cost: 0,
            gross_profit: 0,
            invoice_count: 0,
        };

        const items = rows.map(r => {
            const product = productMap.get(r.product_id) || {};
            const costRate = parseNum(product.purchase_rate);
            const qty = parseNum(r.total_qty);
            const net = parseNum(r.net_amount);
            const cost = costRate * qty;
            const profit = net - cost;

            totals.total_qty += qty;
            totals.gross_amount += parseNum(r.gross_amount);
            totals.total_discount += parseNum(r.total_discount);
            totals.total_tax += parseNum(r.total_tax);
            totals.net_amount += net;
            totals.total_cost += cost;
            totals.gross_profit += profit;
            totals.invoice_count += parseNum(r.invoice_count);

            return {
                product_id: r.product_id,
                product_name: r.product_name,
                product_item_code: r.product_item_code,
                product_unit: r.product_unit,
                quantity_sold: qty,
                gross_amount: parseNum(r.gross_amount),
                discount: parseNum(r.total_discount),
                tax: parseNum(r.total_tax),
                net_amount: net,
                cost_rate: costRate,
                total_cost: cost,
                gross_profit: profit,
                profit_margin: net > 0 ? (profit / net) * 100 : 0,
                invoice_count: parseNum(r.invoice_count),
            };
        });

        res.json({
            success: true,
            report_type: 'item_wise_sale',
            period: { start_date, end_date },
            totals,
            items,
        });
    } catch (error) {
        console.error('getItemWiseSaleReport error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
};

// ─── 2. CUSTOMER-WISE SALE REPORT ────────────────────────────────────────
const getCustomerWiseSaleReport = async (req, res) => {
    try {
        const { start_date, end_date, branch_id } = req.query;
        const where = buildDateWhere(start_date, end_date, 'invoice_date');

        const invoiceWhere = { status: 'confirmed' };
        if (branch_id) invoiceWhere.branch_id = branch_id;
        Object.assign(invoiceWhere, where);

        const rows = await db.Invoice.findAll({
            attributes: [
                'customer_id',
                'customer_name',
                'customer_phone',
                [fn('COUNT', col('Invoice.id')), 'invoice_count'],
                [fn('SUM', col('Invoice.subtotal')), 'gross_amount'],
                [fn('SUM', col('Invoice.discount_amount')), 'total_discount'],
                [fn('SUM', col('Invoice.tax_amount')), 'total_tax'],
                [fn('SUM', col('Invoice.labour_amount')), 'total_labour'],
                [fn('SUM', col('Invoice.total_amount')), 'net_amount'],
            ],
            where: invoiceWhere,
            group: ['customer_id', 'customer_name', 'customer_phone'],
            order: [[literal('net_amount'), 'DESC']],
            raw: true,
        });

        // Compute cost for profit (sum of item costs per customer)
        const customerIds = rows.map(r => r.customer_id).filter(Boolean);
        let costMap = new Map();
        if (customerIds.length) {
            const costRows = await db.InvoiceItem.findAll({
                attributes: [
                    [col('invoice.customer_id'), 'customer_id'],
                    [fn('SUM', literal('`InvoiceItem`.`quantity` * `product`.`purchase_rate`')), 'total_cost'],
                ],
                include: [
                    {
                        association: 'invoice',
                        attributes: [],
                        where: invoiceWhere,
                        required: true,
                    },
                    {
                        association: 'product',
                        attributes: [],
                        required: false,
                    },
                ],
                group: [col('invoice.customer_id')],
                raw: true,
            });
            costMap = new Map(costRows.map(r => [r.customer_id, parseNum(r.total_cost)]));
        }

        let totals = {
            invoice_count: 0,
            gross_amount: 0,
            total_discount: 0,
            total_tax: 0,
            total_labour: 0,
            net_amount: 0,
            total_cost: 0,
            gross_profit: 0,
        };

        const customers = rows.map(r => {
            const net = parseNum(r.net_amount);
            const cost = costMap.get(r.customer_id) || 0;
            const profit = net - cost;

            totals.invoice_count += parseNum(r.invoice_count);
            totals.gross_amount += parseNum(r.gross_amount);
            totals.total_discount += parseNum(r.total_discount);
            totals.total_tax += parseNum(r.total_tax);
            totals.total_labour += parseNum(r.total_labour);
            totals.net_amount += net;
            totals.total_cost += cost;
            totals.gross_profit += profit;

            return {
                customer_id: r.customer_id,
                customer_name: r.customer_name || 'Walk-in Customer',
                customer_phone: r.customer_phone || '',
                invoice_count: parseNum(r.invoice_count),
                gross_amount: parseNum(r.gross_amount),
                discount: parseNum(r.total_discount),
                tax: parseNum(r.total_tax),
                labour: parseNum(r.total_labour),
                net_amount: net,
                total_cost: cost,
                gross_profit: profit,
                profit_margin: net > 0 ? (profit / net) * 100 : 0,
            };
        });

        res.json({
            success: true,
            report_type: 'customer_wise_sale',
            period: { start_date, end_date },
            totals,
            customers,
        });
    } catch (error) {
        console.error('getCustomerWiseSaleReport error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
};

// ─── 3. ITEM-WISE PURCHASE REPORT ────────────────────────────────────────
// FIX: columns qualified with "GoodsReceiptItem." (same ambiguity as sales).
const getItemWisePurchaseReport = async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        const where = buildDateWhere(start_date, end_date, 'receipt_date');

        const grWhere = { status: 'confirmed' };
        Object.assign(grWhere, where);

        const rows = await db.GoodsReceiptItem.findAll({
            attributes: [
                'product_id',
                'product_name',
                'product_item_code',
                'product_unit',
                [fn('SUM', col('GoodsReceiptItem.received_qty')), 'total_qty'],
                [fn('SUM', col('GoodsReceiptItem.subtotal')), 'gross_amount'],
                [fn('SUM', col('GoodsReceiptItem.discount_amount')), 'total_discount'],
                [fn('SUM', col('GoodsReceiptItem.tax_amount')), 'total_tax'],
                [fn('SUM', col('GoodsReceiptItem.total')), 'net_amount'],
                [fn('COUNT', fn('DISTINCT', col('GoodsReceiptItem.goods_receipt_id'))), 'receipt_count'],
            ],
            include: [{
                association: 'goodsReceipt',
                attributes: [],
                where: grWhere,
                required: true,
            }],
            group: [
                col('GoodsReceiptItem.product_id'),
                col('GoodsReceiptItem.product_name'),
                col('GoodsReceiptItem.product_item_code'),
                col('GoodsReceiptItem.product_unit'),
            ],
            order: [[literal('net_amount'), 'DESC']],
            raw: true,
        });

        let totals = {
            total_qty: 0,
            gross_amount: 0,
            total_discount: 0,
            total_tax: 0,
            net_amount: 0,
            receipt_count: 0,
        };

        const items = rows.map(r => {
            const qty = parseNum(r.total_qty);
            const net = parseNum(r.net_amount);
            const avgRate = qty > 0 ? net / qty : 0;

            totals.total_qty += qty;
            totals.gross_amount += parseNum(r.gross_amount);
            totals.total_discount += parseNum(r.total_discount);
            totals.total_tax += parseNum(r.total_tax);
            totals.net_amount += net;
            totals.receipt_count += parseNum(r.receipt_count);

            return {
                product_id: r.product_id,
                product_name: r.product_name,
                product_item_code: r.product_item_code,
                product_unit: r.product_unit,
                quantity_received: qty,
                gross_amount: parseNum(r.gross_amount),
                discount: parseNum(r.total_discount),
                tax: parseNum(r.total_tax),
                net_amount: net,
                average_rate: avgRate,
                receipt_count: parseNum(r.receipt_count),
            };
        });

        res.json({
            success: true,
            report_type: 'item_wise_purchase',
            period: { start_date, end_date },
            totals,
            items,
        });
    } catch (error) {
        console.error('getItemWisePurchaseReport error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
};

// ─── 4. SUPPLIER-WISE PURCHASE REPORT ────────────────────────────────────
const getSupplierWisePurchaseReport = async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        const where = buildDateWhere(start_date, end_date, 'receipt_date');

        const grWhere = { status: 'confirmed' };
        Object.assign(grWhere, where);

        const rows = await db.GoodsReceipt.findAll({
            attributes: [
                'supplier_id',
                [fn('COUNT', col('GoodsReceipt.id')), 'receipt_count'],
                [fn('SUM', col('GoodsReceipt.subtotal')), 'gross_amount'],
                [fn('SUM', col('GoodsReceipt.discount_amount')), 'total_discount'],
                [fn('SUM', col('GoodsReceipt.tax_amount')), 'total_tax'],
                [fn('SUM', col('GoodsReceipt.shipping_amount')), 'total_shipping'],
                [fn('SUM', col('GoodsReceipt.total_amount')), 'net_amount'],
                [fn('SUM', col('GoodsReceipt.paid_amount')), 'paid_amount'],
            ],
            where: grWhere,
            include: [{
                association: 'supplier',
                attributes: ['id', 'name', 'company', 'phone'],
                required: false,
            }],
            group: [
                'GoodsReceipt.supplier_id',
                'supplier.id',
                'supplier.name',
                'supplier.company',
                'supplier.phone',
            ],
            order: [[literal('net_amount'), 'DESC']],
            raw: false,
        });

        let totals = {
            receipt_count: 0,
            gross_amount: 0,
            total_discount: 0,
            total_tax: 0,
            total_shipping: 0,
            net_amount: 0,
            paid_amount: 0,
            balance: 0,
        };

        const suppliers = rows.map(r => {
            const j = r.toJSON();
            const net = parseNum(j.net_amount);
            const paid = parseNum(j.paid_amount);
            const balance = net - paid;

            totals.receipt_count += parseNum(j.receipt_count);
            totals.gross_amount += parseNum(j.gross_amount);
            totals.total_discount += parseNum(j.total_discount);
            totals.total_tax += parseNum(j.total_tax);
            totals.total_shipping += parseNum(j.total_shipping);
            totals.net_amount += net;
            totals.paid_amount += paid;
            totals.balance += balance;

            return {
                supplier_id: j.supplier_id,
                supplier_name: j.supplier?.name || 'Unknown Supplier',
                supplier_company: j.supplier?.company || '',
                supplier_phone: j.supplier?.phone || '',
                receipt_count: parseNum(j.receipt_count),
                gross_amount: parseNum(j.gross_amount),
                discount: parseNum(j.total_discount),
                tax: parseNum(j.total_tax),
                shipping: parseNum(j.total_shipping),
                net_amount: net,
                paid_amount: paid,
                balance,
            };
        });

        res.json({
            success: true,
            report_type: 'supplier_wise_purchase',
            period: { start_date, end_date },
            totals,
            suppliers,
        });
    } catch (error) {
        console.error('getSupplierWisePurchaseReport error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
};

// ─── 5. PROFIT & LOSS REPORT ─────────────────────────────────────────────
// COGS uses the average purchase rate from GoodsReceiptItem over the period,
// falling back to the product's current purchase_rate if none found.
const getProfitLossReport = async (req, res) => {
    try {
        const { start_date, end_date, branch_id } = req.query;
        const dateWhere = buildDateWhere(start_date, end_date, 'invoice_date');

        const invoiceWhere = { status: 'confirmed' };
        if (branch_id) invoiceWhere.branch_id = branch_id;
        Object.assign(invoiceWhere, dateWhere);

        // 1. Revenue from sales
        const salesSummary = await db.Invoice.findOne({
            attributes: [
                [fn('COUNT', col('Invoice.id')), 'invoice_count'],
                [fn('SUM', col('Invoice.subtotal')), 'gross_sales'],
                [fn('SUM', col('Invoice.discount_amount')), 'total_discount'],
                [fn('SUM', col('Invoice.tax_amount')), 'total_tax'],
                [fn('SUM', col('Invoice.labour_amount')), 'total_labour'],
                [fn('SUM', col('Invoice.total_amount')), 'net_sales'],
            ],
            where: invoiceWhere,
            raw: true,
        });

        // 2. Average purchase rate per product over the period
        const purchaseDateWhere = buildDateWhere(start_date, end_date, 'receipt_date');
        const grWhere = { status: 'confirmed' };
        Object.assign(grWhere, purchaseDateWhere);

        const avgPurchaseRows = await db.GoodsReceiptItem.findAll({
            attributes: [
                'product_id',
                [fn('SUM', col('GoodsReceiptItem.received_qty')), 'total_qty'],
                [fn('SUM', col('GoodsReceiptItem.total')), 'total_cost'],
            ],
            include: [{
                association: 'goodsReceipt',
                attributes: [],
                where: grWhere,
                required: true,
            }],
            group: [col('GoodsReceiptItem.product_id')],
            raw: true,
        });

        const avgRateMap = new Map();
        for (const r of avgPurchaseRows) {
            const qty = parseNum(r.total_qty);
            const cost = parseNum(r.total_cost);
            if (qty > 0) {
                avgRateMap.set(r.product_id, cost / qty);
            }
        }

        // 3. Items sold, grouped by product
        const soldItems = await db.InvoiceItem.findAll({
            attributes: [
                'product_id',
                'product_name',
                [fn('SUM', col('InvoiceItem.quantity')), 'total_qty'],
                [fn('SUM', col('InvoiceItem.total')), 'net_amount'],
            ],
            include: [{
                association: 'invoice',
                attributes: [],
                where: invoiceWhere,
                required: true,
            }],
            group: [
                col('InvoiceItem.product_id'),
                col('InvoiceItem.product_name'),
            ],
            raw: true,
        });

        // Fill in missing purchase rates with the product's current rate
        const missingIds = soldItems
            .filter(i => !avgRateMap.has(i.product_id) && i.product_id)
            .map(i => i.product_id);

        if (missingIds.length) {
            const products = await db.Product.findAll({
                where: { id: { [Op.in]: missingIds } },
                attributes: ['id', 'purchase_rate'],
                raw: true,
            });
            for (const p of products) {
                avgRateMap.set(p.id, parseNum(p.purchase_rate));
            }
        }

        let cogs = 0;
        let totalQtySold = 0;
        const itemBreakdown = soldItems.map(i => {
            const qty = parseNum(i.total_qty);
            const revenue = parseNum(i.net_amount);
            const rate = avgRateMap.get(i.product_id) || 0;
            const cost = rate * qty;
            cogs += cost;
            totalQtySold += qty;

            return {
                product_id: i.product_id,
                product_name: i.product_name,
                quantity_sold: qty,
                revenue,
                cost_rate: rate,
                cost,
                profit: revenue - cost,
                profit_margin: revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0,
            };
        }).sort((a, b) => b.profit - a.profit);

        const grossSales = parseNum(salesSummary?.gross_sales);
        const totalDiscount = parseNum(salesSummary?.total_discount);
        const totalTax = parseNum(salesSummary?.total_tax);
        const totalLabour = parseNum(salesSummary?.total_labour);
        const netSales = parseNum(salesSummary?.net_sales);
        const grossProfit = netSales - cogs;

        // 4. Purchase summary for the period (context only)
        const purchaseSummary = await db.GoodsReceipt.findOne({
            attributes: [
                [fn('COUNT', col('GoodsReceipt.id')), 'receipt_count'],
                [fn('SUM', col('GoodsReceipt.subtotal')), 'gross_purchases'],
                [fn('SUM', col('GoodsReceipt.discount_amount')), 'total_purchase_discount'],
                [fn('SUM', col('GoodsReceipt.tax_amount')), 'total_purchase_tax'],
                [fn('SUM', col('GoodsReceipt.shipping_amount')), 'total_shipping'],
                [fn('SUM', col('GoodsReceipt.total_amount')), 'net_purchases'],
                [fn('SUM', col('GoodsReceipt.paid_amount')), 'paid_amount'],
            ],
            where: grWhere,
            raw: true,
        });

        res.json({
            success: true,
            report_type: 'profit_loss',
            period: { start_date, end_date },
            summary: {
                // Sales side
                invoice_count: parseNum(salesSummary?.invoice_count),
                gross_sales: grossSales,
                sales_discount: totalDiscount,
                sales_tax: totalTax,
                labour_charges: totalLabour,
                net_sales: netSales,

                // Cost side
                cogs,
                total_qty_sold: totalQtySold,

                // Profit
                gross_profit: grossProfit,
                profit_margin: netSales > 0 ? (grossProfit / netSales) * 100 : 0,

                // Purchase context (NOT subtracted from profit; already in COGS)
                purchase_receipt_count: parseNum(purchaseSummary?.receipt_count),
                gross_purchases: parseNum(purchaseSummary?.gross_purchases),
                purchase_discount: parseNum(purchaseSummary?.total_purchase_discount),
                purchase_tax: parseNum(purchaseSummary?.total_purchase_tax),
                purchase_shipping: parseNum(purchaseSummary?.total_shipping),
                net_purchases: parseNum(purchaseSummary?.net_purchases),
                purchase_paid: parseNum(purchaseSummary?.paid_amount),
                purchase_balance:
                    parseNum(purchaseSummary?.net_purchases) -
                    parseNum(purchaseSummary?.paid_amount),
            },
            item_breakdown: itemBreakdown,
        });
    } catch (error) {
        console.error('getProfitLossReport error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
};

module.exports = {
    getItemWiseSaleReport,
    getCustomerWiseSaleReport,
    getItemWisePurchaseReport,
    getSupplierWisePurchaseReport,
    getProfitLossReport,
};